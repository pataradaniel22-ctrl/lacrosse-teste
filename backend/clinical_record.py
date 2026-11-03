"""Clinical Record routes (replaces the simple athlete notes; old notes keep working).

GET    /api/staff/athlete/{id}/notes                 entries visible to the viewer + follow-ups
POST   /api/staff/athlete/{id}/notes                 new entry (date can be retroactive)
PUT    /api/staff/athlete-note/{note_id}             amend (author or admin) — previous values kept
DELETE /api/staff/athlete-note/{note_id}             admin only, soft delete (kept for audit)
POST   /api/staff/athlete-note/{note_id}/attachments photo/PDF ≤10 MB
GET    /api/staff/clinical-attachments/{att_id}/file
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

import clinical_record_logic as C
from app_time import local_now

ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf"}
MAX_BYTES = 10 * 1024 * 1024


def _now():
    return datetime.now(timezone.utc).isoformat()


def register_clinical_record_routes(api_router, db, get_current_user):
    from recovery_storage import put_object, get_object

    def viewer(cu):
        if cu["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        role, uid = cu["user"].get("role"), cu["user"].get("id")
        if not C.can_read_record(role):
            raise HTTPException(status_code=403, detail="The clinical record is not available for your role")
        return role, uid

    def author(cu):
        u = cu["user"]
        return {"author": u.get("name") or u.get("email"), "author_role": u.get("role"), "author_id": u.get("id")}

    async def get_entry(note_id, cu, edit=False):
        role, uid = viewer(cu)
        e = await db.athlete_notes.find_one({"id": note_id}, {"_id": 0})
        if not e or e.get("deleted_at") or not C.can_see_entry(e, role, uid):
            raise HTTPException(status_code=404, detail="Entry not found")
        if edit and not C.can_edit_entry(e, role, uid):
            raise HTTPException(status_code=403, detail="Only the author or an admin can change this entry")
        return e

    @api_router.get("/staff/athlete/{athlete_id}/notes")
    async def list_entries(athlete_id: str, current_user: dict = Depends(get_current_user)):
        role, uid = viewer(current_user)
        raw = await db.athlete_notes.find({"athlete_id": athlete_id, "deleted_at": {"$in": [None]}}, {"_id": 0}).to_list(2000)
        today = local_now().date()
        notes = []
        for e in raw:
            if not C.can_see_entry(e, role, uid):
                continue
            e = C.normalise_legacy(e)
            e["attachments"] = [{k: v for k, v in a.items() if k != "path"} for a in e.get("attachments") or []]
            e["follow_up_status"] = C.follow_up_status(e, today)
            e["can_edit"] = C.can_edit_entry(e, role, uid)
            notes.append(e)
        notes.sort(key=lambda e: (e.get("occurred_on") or "", e.get("occurred_time") or "", e.get("created_at") or ""), reverse=True)
        return {"count": len(notes), "notes": notes, "types": C.ENTRY_TYPES, "domains": C.DOMAINS,
                "availability": C.AVAILABILITY, "can_mark_confidential": role in C.CLINICAL_ROLES,
                "is_admin": role == "Admin"}

    @api_router.post("/staff/athlete/{athlete_id}/notes")
    async def add_entry(athlete_id: str, body: dict, current_user: dict = Depends(get_current_user)):
        role, _ = viewer(current_user)
        if not await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=404, detail="Athlete not found")
        try:
            data = C.clean_entry(body or {}, local_now().date())
        except C.EntryError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if data.get("confidential") and role not in C.CLINICAL_ROLES:
            data["confidential"] = False
        doc = {"id": str(uuid.uuid4()), "athlete_id": athlete_id, **author(current_user), **data,
               "attachments": [], "revisions": [], "created_at": local_now().isoformat()}
        await db.athlete_notes.insert_one(dict(doc))
        doc["can_edit"] = True
        doc["follow_up_status"] = C.follow_up_status(doc, local_now().date())
        return {"success": True, "note": doc}

    @api_router.put("/staff/athlete-note/{note_id}")
    async def amend_entry(note_id: str, body: dict, current_user: dict = Depends(get_current_user)):
        e = await get_entry(note_id, current_user, edit=True)
        role = current_user["user"].get("role")
        try:
            data = C.clean_entry(body or {}, local_now().date(), partial=True)
        except C.EntryError as err:
            raise HTTPException(status_code=400, detail=str(err))
        if data.get("confidential") and role not in C.CLINICAL_ROLES:
            data.pop("confidential")
        prev = C.diff(C.normalise_legacy(e), data)
        if not prev:
            return {"success": True, "note": e, "changed": []}
        merged = {**e, **data}
        if not (merged.get("body") or merged.get("soap") or merged.get("title")):
            raise HTTPException(status_code=400, detail="An entry needs a title, a note or SOAP fields")
        rev = {"at": _now(), "by": current_user["user"].get("name"), "by_id": current_user["user"].get("id"), "previous": prev}
        await db.athlete_notes.update_one({"id": note_id}, {"$set": {**data, "updated_at": _now()}, "$push": {"revisions": rev}})
        e = C.normalise_legacy(await db.athlete_notes.find_one({"id": note_id}, {"_id": 0}))
        e["attachments"] = [{k: v for k, v in a.items() if k != "path"} for a in e.get("attachments") or []]
        e["can_edit"] = True
        e["follow_up_status"] = C.follow_up_status(e, local_now().date())
        return {"success": True, "note": e, "changed": sorted(prev)}

    @api_router.delete("/staff/athlete-note/{note_id}")
    async def delete_entry(note_id: str, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff" or current_user["user"].get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        r = await db.athlete_notes.update_one({"id": note_id, "deleted_at": None},
                                              {"$set": {"deleted_at": _now(), "deleted_by": current_user["user"].get("name")}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Entry not found")
        return {"success": True}

    @api_router.post("/staff/athlete-note/{note_id}/attachments")
    async def add_attachment(note_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
        e = await get_entry(note_id, current_user, edit=True)
        ctype = (file.content_type or "").lower()
        if ctype not in ALLOWED:
            raise HTTPException(status_code=400, detail="Only photos (JPG, PNG, WEBP, HEIC) or PDF files")
        data = await file.read(MAX_BYTES + 1)
        if not data or len(data) > MAX_BYTES:
            raise HTTPException(status_code=400, detail="File must be between 1 byte and 10 MB")
        if ctype == "application/pdf" and not data.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Invalid PDF file")
        att_id = str(uuid.uuid4())
        path = f"clinical/{e['athlete_id']}/{att_id}.{ALLOWED[ctype]}"
        await put_object(path, data, ctype)
        att = {"id": att_id, "filename": (file.filename or "attachment")[:120], "content_type": ctype, "size": len(data),
               "path": path, "uploaded_at": _now(), "uploaded_by": current_user["user"].get("name")}
        await db.athlete_notes.update_one({"id": note_id}, {"$push": {"attachments": att}})
        att = {k: v for k, v in att.items() if k != "path"}
        return {"success": True, "attachment": att}

    @api_router.get("/staff/clinical-attachments/{att_id}/file")
    async def attachment_file(att_id: str, download: bool = False, current_user: dict = Depends(get_current_user)):
        role, uid = viewer(current_user)
        e = await db.athlete_notes.find_one({"attachments.id": att_id}, {"_id": 0})
        if not e or not C.can_see_entry(e, role, uid):
            raise HTTPException(status_code=404, detail="File not found")
        att = next(a for a in e["attachments"] if a["id"] == att_id)
        try:
            data, ctype = await get_object(att["path"])
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found")
        await db.hub_audit.insert_one({"id": str(uuid.uuid4()), "at": _now(), "action": "clinical_attachment_viewed",
                                       "athlete_id": e["athlete_id"], "actor": {"id": uid, "name": current_user["user"].get("name"), "role": role},
                                       "detail": {"note_id": e["id"], "attachment_id": att_id}})
        safe = "".join(c for c in att["filename"] if c.isalnum() or c in "._- ")[:100] or "attachment"
        return Response(content=data, media_type=ctype, headers={
            "Content-Disposition": f'{"attachment" if download else "inline"}; filename="{safe}"',
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
