"""Athlete Hub: the staff's central athlete registry (replaces the tracker spreadsheet).

* Configurable profile fields + document types (admins).
* Per-field visibility: 'admin' (sensitive: CPF, address...) or 'staff'.
  Research users never see personal data. Athletes see/edit only their own
  record and only the fields allowed for them.
* Documents (passport, certificates...) stored in the app's private file store,
  served only through authenticated, permission-checked requests.
* Requests: staff ask specific athletes for missing items; the athlete gets a
  push notification + a banner, and the request closes by itself when done.
* Audit trail: every change and every document view/download is recorded.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import athlete_hub_logic as L
from app_time import local_now

FIELDS_ID = "hub_fields"
DOCS_ID = "hub_doc_types"


def _now():
    return datetime.now(timezone.utc).isoformat()


class ConfigUpdate(BaseModel):
    fields: Optional[list] = None
    doc_types: Optional[list] = None


class ValuesUpdate(BaseModel):
    values: dict


class RequestCreate(BaseModel):
    athlete_ids: List[str]
    items: Optional[List[str]] = None  # field / doc keys; empty -> everything missing
    message: Optional[str] = ""
    due_date: Optional[str] = None


class RequestUpdate(BaseModel):
    status: str


class ImportRow(BaseModel):
    athlete_id: str
    values: dict


class ImportRequest(BaseModel):
    rows: List[ImportRow]
    dry_run: bool = True
    overwrite: bool = False


def register_athlete_hub_routes(api_router, db, get_current_user):
    from recovery_storage import put_object, get_object

    # ------------------------------------------------------------ helpers
    async def load_config():
        f = await db.app_settings.find_one({"_id": FIELDS_ID})
        d = await db.app_settings.find_one({"_id": DOCS_ID})
        return (f or {}).get("fields") or L.default_fields(), (d or {}).get("types") or L.default_doc_types()

    def who(cu):
        u = cu["user"]
        return {"id": u.get("id"), "name": u.get("name"), "type": cu["user_type"], "role": u.get("role")}

    def role_of(cu):
        return cu["user"].get("role") if cu["user_type"] == "staff" else None

    def require_staff(cu):
        if cu["user_type"] != "staff" or cu["user"].get("role") == "Research":
            raise HTTPException(status_code=403, detail="Staff only")

    def require_admin(cu):
        if cu["user_type"] != "staff" or cu["user"].get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")

    async def audit(cu, action, athlete_id=None, detail=None):
        await db.hub_audit.insert_one({"id": str(uuid.uuid4()), "at": _now(), "actor": who(cu),
                                       "action": action, "athlete_id": athlete_id, "detail": detail or {}})

    async def get_values(athlete_id):
        p = await db.athlete_profiles.find_one({"athlete_id": athlete_id}, {"_id": 0})
        return (p or {}).get("values") or {}

    async def docs_for(athlete_ids):
        docs = await db.athlete_documents.find({"athlete_id": {"$in": list(athlete_ids)}}, {"_id": 0, "path": 0}).sort("uploaded_at", -1).to_list(10000)
        by = {}
        for d in docs:
            by.setdefault(d["athlete_id"], []).append(d)
        return by

    def doc_count_by_type(docs):
        c = {}
        for d in docs or []:
            c[d["doc_type"]] = c.get(d["doc_type"], 0) + 1
        return c

    def enrich(values, fields, docs, today):
        """Computed info for display: age, tones, date alerts, missing items."""
        tones, alerts = {}, {}
        for f in fields:
            v = values.get(f["key"])
            t = L.tone_of(f, v)
            if t:
                tones[f["key"]] = t
            a = L.date_alert(f, v, today)
            if a:
                alerts[f["key"]] = a
        return {"age": L.age_on(values.get("birth_date"), today), "tones": tones, "alerts": alerts}

    async def refresh_requests(athlete_id, values=None, docs=None, fields=None, doc_types=None):
        """Close open requests whose items are all present; return open ones with remaining items."""
        reqs = await db.hub_requests.find({"athlete_id": athlete_id, "status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(100)
        if not reqs:
            return []
        if values is None:
            values = await get_values(athlete_id)
        if docs is None:
            docs = (await docs_for([athlete_id])).get(athlete_id, [])
        counts = doc_count_by_type(docs)
        still = []
        for r in reqs:
            remaining = [i for i in r.get("items", [])
                         if (i["kind"] == "field" and values.get(i["key"]) in (None, ""))
                         or (i["kind"] == "doc" and not counts.get(i["key"]))]
            if not remaining:
                await db.hub_requests.update_one({"id": r["id"]}, {"$set": {"status": "done", "completed_at": _now()}})
            else:
                r["remaining"] = remaining
                still.append(r)
        return still

    async def notify(athlete_id, title, body, url="/athlete/my-info"):
        try:
            from push_routes import send_push_to_subscription
            subs = await db.push_subscriptions.find({"athlete_id": athlete_id}, {"_id": 0}).to_list(10)
            for s in subs:
                await send_push_to_subscription(s, {"title": title, "body": body, "url": url})
        except Exception:
            pass

    # ------------------------------------------------------------ config
    @api_router.get("/hub/config")
    async def hub_config(current_user: dict = Depends(get_current_user)):
        fields, doc_types = await load_config()
        role, ut = role_of(current_user), current_user["user_type"]
        if ut == "staff" and role == "Research":
            raise HTTPException(status_code=403, detail="Not available for your role")
        return {
            "fields": [f for f in fields if L.can_see(f, role, ut) and (ut == "staff" or not f.get("hidden"))],
            "doc_types": [d for d in doc_types if L.can_see(d, role, ut)],
            "sections": L.SECTIONS, "tones": sorted(L.TONES), "field_types": sorted(L.FIELD_TYPES),
            "is_admin": role == "Admin",
        }

    @api_router.put("/admin/hub/config")
    async def save_hub_config(data: ConfigUpdate, current_user: dict = Depends(get_current_user)):
        require_admin(current_user)
        fields, doc_types = await load_config()
        try:
            if data.fields is not None:
                fields = L.validate_fields(data.fields, fields)
                await db.app_settings.update_one({"_id": FIELDS_ID}, {"$set": {"fields": fields}}, upsert=True)
            if data.doc_types is not None:
                doc_types = L.validate_doc_types(data.doc_types, doc_types)
                await db.app_settings.update_one({"_id": DOCS_ID}, {"$set": {"types": doc_types}}, upsert=True)
        except L.ConfigError as e:
            raise HTTPException(status_code=400, detail=str(e))
        await audit(current_user, "config_changed", None, {"fields": data.fields is not None, "doc_types": data.doc_types is not None})
        return {"fields": fields, "doc_types": doc_types}

    # ------------------------------------------------------------ staff
    @api_router.get("/staff/hub/roster")
    async def hub_roster(current_user: dict = Depends(get_current_user)):
        require_staff(current_user)
        role = role_of(current_user)
        fields, doc_types = await load_config()
        vis_fields = [f for f in fields if L.can_see(f, role, "staff")]
        vis_docs = [d for d in doc_types if L.can_see(d, role, "staff")]
        vis_doc_keys = {d["key"] for d in vis_docs}
        athletes = await db.athletes.find({"active": True, "status": {"$in": ["approved", None]}},
                                          {"_id": 0, "id": 1, "name": 1, "email": 1, "team": 1, "groups": 1, "profile_photo": 1}).to_list(2000)
        ids = [a["id"] for a in athletes]
        profiles = {p["athlete_id"]: p for p in await db.athlete_profiles.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(5000)}
        docs = await docs_for(ids)
        open_reqs = {}
        async for r in db.hub_requests.find({"athlete_id": {"$in": ids}, "status": "open"}, {"_id": 0, "athlete_id": 1}):
            open_reqs[r["athlete_id"]] = open_reqs.get(r["athlete_id"], 0) + 1
        today = local_now().date()
        rows = []
        for a in athletes:
            p = profiles.get(a["id"]) or {}
            values = {**L.prefill_from_athlete(a), **(p.get("values") or {})}
            counts = doc_count_by_type(docs.get(a["id"]))
            missing = L.missing_items(values, counts, fields, doc_types)
            rows.append({
                "athlete": a,
                "values": L.visible_values(values, vis_fields, role, "staff"),
                **enrich(values, vis_fields, None, today),
                "doc_counts": {k: v for k, v in counts.items() if k in vis_doc_keys},
                "missing": [m for m in missing if (m["kind"] == "field" and any(f["key"] == m["key"] for f in vis_fields)) or (m["kind"] == "doc" and m["key"] in vis_doc_keys)],
                "missing_total": len(missing),
                "open_requests": open_reqs.get(a["id"], 0),
                "updated_at": p.get("updated_at"),
            })
        rows.sort(key=lambda r: (r["athlete"].get("name") or "").strip().lower())
        return {"rows": rows, "fields": vis_fields, "doc_types": vis_docs, "is_admin": role == "Admin",
                "can_request": role in ("Admin", "Coach")}

    @api_router.get("/staff/hub/athlete/{athlete_id}")
    async def hub_athlete(athlete_id: str, current_user: dict = Depends(get_current_user)):
        require_staff(current_user)
        role = role_of(current_user)
        a = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "password_hash": 0, "google_sub": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Athlete not found")
        fields, doc_types = await load_config()
        vis_fields = [f for f in fields if L.can_see(f, role, "staff")]
        vis_docs = [d for d in doc_types if L.can_see(d, role, "staff")]
        p = await db.athlete_profiles.find_one({"athlete_id": athlete_id}, {"_id": 0}) or {}
        values = {**L.prefill_from_athlete(a), **(p.get("values") or {})}
        docs = (await docs_for([athlete_id])).get(athlete_id, [])
        reqs = await refresh_requests(athlete_id, values, docs)
        history = await db.hub_requests.find({"athlete_id": athlete_id, "status": {"$ne": "open"}}, {"_id": 0}).sort("created_at", -1).to_list(20)
        out = {
            "athlete": {k: a.get(k) for k in ("id", "name", "email", "team", "groups", "profile_photo")},
            "values": L.visible_values(values, vis_fields, role, "staff"),
            **enrich(values, vis_fields, None, local_now().date()),
            "fields": vis_fields, "doc_types": vis_docs,
            "documents": [d for d in docs if any(t["key"] == d["doc_type"] for t in vis_docs)],
            "missing": L.missing_items(values, doc_count_by_type(docs), vis_fields, vis_docs),
            "requests": reqs, "request_history": history,
            "updated_at": p.get("updated_at"), "updated_by": p.get("updated_by"),
            "is_admin": role == "Admin", "can_request": role in ("Admin", "Coach"),
        }
        if role == "Admin":
            out["audit"] = await db.hub_audit.find({"athlete_id": athlete_id}, {"_id": 0}).sort("at", -1).to_list(30)
        return out

    async def save_values(athlete_id, incoming: dict, allowed_fields: list, cu, overwrite=True):
        by_key = {f["key"]: f for f in allowed_fields}
        current = await get_values(athlete_id)
        changes, errors = {}, []
        for k, v in (incoming or {}).items():
            f = by_key.get(k)
            if not f:
                continue
            try:
                cv = L.clean_value(f, v)
            except L.ConfigError as e:
                errors.append(str(e))
                continue
            if not overwrite and current.get(k) not in (None, ""):
                continue
            if current.get(k) != cv:
                changes[k] = cv
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        if changes:
            new_values = {**current, **changes}
            new_values = {k: v for k, v in new_values.items() if v is not None}
            await db.athlete_profiles.update_one(
                {"athlete_id": athlete_id},
                {"$set": {"values": new_values, "updated_at": _now(), "updated_by": who(cu)},
                 "$setOnInsert": {"athlete_id": athlete_id, "created_at": _now()}},
                upsert=True)
            await audit(cu, "values_changed", athlete_id, {"fields": sorted(changes)})
        return changes

    @api_router.put("/staff/hub/athlete/{athlete_id}")
    async def hub_update(athlete_id: str, data: ValuesUpdate, current_user: dict = Depends(get_current_user)):
        require_admin(current_user)
        if not await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=404, detail="Athlete not found")
        fields, _ = await load_config()
        changes = await save_values(athlete_id, data.values, fields, current_user)
        await refresh_requests(athlete_id)
        return {"changed": sorted(changes)}

    # ------------------------------------------------------------ documents
    async def check_doc_access(cu, athlete_id, doc_type_key, write=False):
        _, doc_types = await load_config()
        dt = next((d for d in doc_types if d["key"] == doc_type_key), None)
        if cu["user_type"] == "athlete":
            if cu["user"]["id"] != athlete_id:
                raise HTTPException(status_code=403, detail="Not allowed")
            if write and (not dt or not dt.get("athlete_can_upload")):
                raise HTTPException(status_code=403, detail="This document is managed by the staff")
            return dt
        role = role_of(cu)
        if write and role != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        if role == "Research" or (dt and not L.can_see(dt, role, "staff")) or (not dt and role != "Admin"):
            raise HTTPException(status_code=403, detail="Not allowed")
        return dt

    @api_router.post("/hub/athlete/{athlete_id}/documents")
    async def upload_document(athlete_id: str, file: UploadFile = File(...), doc_type: str = Form(...),
                              note: str = Form(""), current_user: dict = Depends(get_current_user)):
        dt = await check_doc_access(current_user, athlete_id, doc_type, write=True)
        if not dt:
            raise HTTPException(status_code=400, detail="Unknown document type")
        if not await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=404, detail="Athlete not found")
        ctype = (file.content_type or "").lower()
        if ctype not in L.ALLOWED_DOC_TYPES:
            raise HTTPException(status_code=400, detail="Only photos (JPG, PNG, WEBP, HEIC) or PDF files")
        data = await file.read(L.MAX_DOC_BYTES + 1)
        if len(data) > L.MAX_DOC_BYTES:
            raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
        if not data:
            raise HTTPException(status_code=400, detail="Empty file")
        if ctype == "application/pdf" and not data.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Invalid PDF file")
        doc_id = str(uuid.uuid4())
        path = f"athlete-hub/{athlete_id}/{doc_id}.{L.ALLOWED_DOC_TYPES[ctype]}"
        await put_object(path, data, ctype)
        doc = {"id": doc_id, "athlete_id": athlete_id, "doc_type": doc_type, "filename": (file.filename or "document")[:120],
               "content_type": ctype, "size": len(data), "path": path, "note": (note or "")[:300],
               "uploaded_by": who(current_user), "uploaded_at": _now()}
        await db.athlete_documents.insert_one(dict(doc))
        await audit(current_user, "document_uploaded", athlete_id, {"doc_type": doc_type, "document_id": doc_id})
        await refresh_requests(athlete_id)
        doc.pop("path", None)
        return doc

    @api_router.get("/hub/documents/{doc_id}/file")
    async def document_file(doc_id: str, download: bool = False, current_user: dict = Depends(get_current_user)):
        doc = await db.athlete_documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        await check_doc_access(current_user, doc["athlete_id"], doc["doc_type"])
        try:
            data, ctype = await get_object(doc["path"])
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found")
        await audit(current_user, "document_viewed", doc["athlete_id"], {"document_id": doc_id, "doc_type": doc["doc_type"]})
        safe = "".join(c for c in doc.get("filename", "document") if c.isalnum() or c in "._- ")[:100] or "document"
        disp = "attachment" if download else "inline"
        return Response(content=data, media_type=ctype, headers={
            "Content-Disposition": f'{disp}; filename="{safe}"', "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff"})

    @api_router.delete("/hub/documents/{doc_id}")
    async def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
        doc = await db.athlete_documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        if current_user["user_type"] == "athlete":
            if current_user["user"]["id"] != doc["athlete_id"] or doc.get("uploaded_by", {}).get("id") != current_user["user"]["id"]:
                raise HTTPException(status_code=403, detail="You can only remove documents you uploaded")
        else:
            require_admin(current_user)
        await db.athlete_documents.delete_one({"id": doc_id})
        try:
            from recovery_storage import init_storage
            import asyncio

            def _rm():
                fs = init_storage()
                for f in fs.find({"filename": doc["path"]}):
                    fs.delete(f._id)
            await asyncio.to_thread(_rm)
        except Exception:
            pass
        await audit(current_user, "document_deleted", doc["athlete_id"], {"document_id": doc_id, "doc_type": doc["doc_type"]})
        return {"deleted": doc_id}

    # ------------------------------------------------------------ requests
    @api_router.post("/staff/hub/requests")
    async def create_requests(data: RequestCreate, current_user: dict = Depends(get_current_user)):
        require_staff(current_user)
        if role_of(current_user) not in ("Admin", "Coach"):
            raise HTTPException(status_code=403, detail="Only admins and coaches can send requests")
        if not data.athlete_ids or len(data.athlete_ids) > 500:
            raise HTTPException(status_code=400, detail="Choose between 1 and 500 athletes")
        fields, doc_types = await load_config()
        catalog = {**{f["key"]: {"kind": "field", "key": f["key"], "label": f["label"]} for f in fields if f.get("athlete_editable")},
                   **{d["key"]: {"kind": "doc", "key": d["key"], "label": d["label"]} for d in doc_types if d.get("athlete_can_upload")}}
        wanted = [catalog[k] for k in (data.items or []) if k in catalog]
        created, skipped = [], []
        for aid in dict.fromkeys(data.athlete_ids):
            a = await db.athletes.find_one({"id": aid}, {"_id": 0, "id": 1, "name": 1, "email": 1})
            if not a:
                continue
            values = {**L.prefill_from_athlete(a), **(await get_values(aid))}
            counts = doc_count_by_type((await docs_for([aid])).get(aid, []))
            if wanted:
                items = [i for i in wanted if (i["kind"] == "field" and values.get(i["key"]) in (None, "")) or (i["kind"] == "doc" and not counts.get(i["key"]))]
            else:
                items = [m for m in L.missing_items(values, counts, fields, doc_types) if m["key"] in catalog]
            if not items:
                skipped.append(a["name"])
                continue
            req = {"id": str(uuid.uuid4()), "athlete_id": aid, "items": items, "message": (data.message or "")[:1000],
                   "due_date": data.due_date, "status": "open", "created_by": who(current_user), "created_at": _now()}
            await db.hub_requests.insert_one(dict(req))
            created.append(aid)
            await notify(aid, "Brasil Lacrosse needs some info", (data.message or "Please complete: " + ", ".join(i["label"] for i in items))[:150])
        await audit(current_user, "requests_sent", None, {"count": len(created)})
        return {"created": len(created), "skipped_complete": skipped}

    @api_router.put("/staff/hub/requests/{req_id}")
    async def update_request(req_id: str, data: RequestUpdate, current_user: dict = Depends(get_current_user)):
        require_staff(current_user)
        if data.status not in ("cancelled", "done"):
            raise HTTPException(status_code=400, detail="Invalid status")
        r = await db.hub_requests.update_one({"id": req_id}, {"$set": {"status": data.status, "closed_by": who(current_user), "completed_at": _now()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Request not found")
        return {"id": req_id, "status": data.status}

    # ------------------------------------------------------------ athlete
    @api_router.get("/athlete/hub/me")
    async def my_hub(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        a = current_user["user"]
        fields, doc_types = await load_config()
        my_fields = [f for f in fields if L.can_see(f, None, "athlete") and not f.get("hidden")]
        values = {**L.prefill_from_athlete(a), **(await get_values(a["id"]))}
        docs = (await docs_for([a["id"]])).get(a["id"], [])
        reqs = await refresh_requests(a["id"], values, docs)
        return {
            "fields": my_fields, "doc_types": doc_types,
            "values": L.visible_values(values, my_fields, None, "athlete"),
            "age": L.age_on(values.get("birth_date"), local_now().date()),
            "documents": docs, "requests": reqs,
            "missing": [m for m in L.missing_items(values, doc_count_by_type(docs), my_fields, doc_types)
                        if (m["kind"] == "field" and any(f["key"] == m["key"] and f.get("athlete_editable") for f in my_fields))
                        or (m["kind"] == "doc" and any(d["key"] == m["key"] and d.get("athlete_can_upload") for d in doc_types))],
        }

    @api_router.put("/athlete/hub/me")
    async def update_my_hub(data: ValuesUpdate, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        fields, _ = await load_config()
        editable = [f for f in fields if f.get("athlete_editable") and not f.get("hidden")]
        changes = await save_values(current_user["user"]["id"], data.values, editable, current_user)
        reqs = await refresh_requests(current_user["user"]["id"])
        return {"changed": sorted(changes), "open_requests": len(reqs)}

    # ------------------------------------------------------------ import
    @api_router.post("/admin/hub/import")
    async def hub_import(data: ImportRequest, current_user: dict = Depends(get_current_user)):
        require_admin(current_user)
        fields, _ = await load_config()
        by_key = {f["key"]: f for f in fields}
        report = []
        for row in data.rows[:2000]:
            a = await db.athletes.find_one({"id": row.athlete_id}, {"_id": 0, "id": 1, "name": 1})
            if not a:
                report.append({"athlete_id": row.athlete_id, "error": "athlete not found"})
                continue
            clean, errors = {}, []
            for k, v in row.values.items():
                if k not in by_key:
                    errors.append(f"unknown field {k}")
                    continue
                try:
                    cv = L.clean_value(by_key[k], v)
                except L.ConfigError as e:
                    errors.append(str(e))
                    continue
                if cv is not None:
                    clean[k] = cv
            changed = []
            if not data.dry_run and clean:
                changed = sorted(await save_values(row.athlete_id, clean, fields, current_user, overwrite=data.overwrite))
            report.append({"athlete_id": row.athlete_id, "name": a["name"], "fields": sorted(clean), "changed": changed, "errors": errors})
        if not data.dry_run:
            await audit(current_user, "import", None, {"rows": len(report)})
        return {"dry_run": data.dry_run, "rows": report}
