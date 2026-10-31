"""Messages / Athlete Feedback Center — async messaging between athletes and Admin.

Phase 1 scope:
  - Athlete: start conversation (question / pain / guidance / feedback / training / recovery / other),
    pain-report form, reply, view own history, mark resolved, image attachment.
  - Admin (staff role == 'Admin'): inbox with filters, reply, resolve/archive, internal notes,
    pinned feedback on the athlete profile, start a conversation to one athlete.
  - Neutral Web Push to the athlete (staff has no push device -> in-app counters/badges).
  - Pain messages are also linked to the athlete profile pain report (source = 'Message').
Reuses object storage (training_files) for attachments and _send_to_athlete for push.
"""
import logging
from datetime import datetime, timezone
from typing import Optional, List
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header, Query, Response
from pydantic import BaseModel, Field

from app_time import local_now
from notification_center_routes import _send_to_athlete
from recovery_storage import put_object as _put_object, get_object as _get_object, make_lowres as _make_lowres

logger = logging.getLogger(__name__)

CATEGORIES = {"question", "pain", "guidance", "feedback", "training", "recovery", "reminder", "monitoring", "general", "other"}
PRIORITIES = {"low", "normal", "high", "urgent"}
ATTACH_APP = "brazil-lacrosse-recovery"
ATTACH_MAX_BYTES = 15 * 1024 * 1024


# --- Models ---
class PainDetails(BaseModel):
    body_region: Optional[str] = None
    side: Optional[str] = None  # Left / Right / Both / N/A
    pain_intensity: Optional[int] = Field(default=None, ge=0, le=10)
    onset: Optional[str] = None
    trend: Optional[str] = None  # improving / worsening / same
    occurred_during_training: Optional[bool] = None
    can_train_normally: Optional[bool] = None
    aggravating_movements: Optional[str] = None
    additional_notes: Optional[str] = None


class NewAthleteConversation(BaseModel):
    category: str = Field(default="question")
    title: str = Field(min_length=1, max_length=120)
    message_body: str = Field(min_length=1, max_length=4000)
    priority: str = Field(default="normal")
    attachment_id: Optional[str] = None
    pain: Optional[PainDetails] = None


class ReplyBody(BaseModel):
    message_body: str = Field(min_length=1, max_length=4000)
    attachment_id: Optional[str] = None


class InternalNoteBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AdminNewConversation(BaseModel):
    athlete_id: str
    category: str = Field(default="general")
    title: str = Field(min_length=1, max_length=120)
    message_body: str = Field(min_length=1, max_length=4000)
    priority: str = Field(default="normal")
    send_push: bool = True


class FeedbackBody(BaseModel):
    athlete_id: str
    title: str = Field(min_length=1, max_length=120)
    feedback_body: str = Field(min_length=1, max_length=4000)
    category: str = Field(default="general")
    pinned_to_profile: bool = False
    important: bool = False
    send_push: bool = True


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def register_messages_routes(api_router, db, get_current_user):

    def _require_athlete(cu):
        if cu["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        return cu["user"]

    def _require_admin(cu):
        if cu["user_type"] != "staff" or cu["user"].get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        return cu["user"]

    def _athlete_view_status(conv):
        s = conv.get("status")
        if s == "resolved":
            return "resolved"
        if conv.get("last_sender_role") == "staff":
            return "staff_replied" if conv.get("unread_athlete") else "read"
        return "sent"

    async def _notify_athlete_new_message(athlete_id, conv_id, kind="message"):
        if kind == "feedback":
            url = "/athlete/messages"
            payload = {"title": "New feedback", "body": "Staff added feedback to your profile.", "url": url}
            notif_title, notif_msg = "New feedback", "Staff added feedback to your profile."
        else:
            url = f"/athlete/messages/{conv_id}"
            payload = {"title": "New staff message", "body": "You have a new message in the app.", "url": url}
            notif_title, notif_msg = "New staff message", "You have a new message in the app."
        payload["tag"] = f"msg-{conv_id}"
        try:
            await _send_to_athlete(db, athlete_id, payload)
        except Exception as e:
            logger.warning(f"Push notify failed: {e}")
        now = _now_iso()
        await db.message_notifications.insert_one({
            "id": str(uuid4()), "athlete_id": athlete_id, "conversation_id": conv_id,
            "notification_type": kind, "title": payload["title"], "message": payload["body"],
            "sent_at": now, "created_at": now,
        })
        # Also feed the in-app notification bell (db.notifications powers GET /api/notifications)
        await db.notifications.insert_one({
            "id": str(uuid4()), "athlete_id": athlete_id, "title": notif_title, "message": notif_msg,
            "url": url, "conversation_id": conv_id or None, "type": kind, "read": False, "created_at": now,
        })

    async def _append_message(conv_id, sender_role, sender_id, sender_name, body, attachment_id=None):
        msg = {
            "id": str(uuid4()), "conversation_id": conv_id, "sender_id": sender_id,
            "sender_role": sender_role, "sender_name": sender_name, "message_body": body,
            "attachment_id": attachment_id, "read_at": None, "created_at": _now_iso(),
        }
        await db.messages.insert_one(dict(msg))
        msg.pop("_id", None)
        return msg

    async def _conv_public(conv):
        conv = dict(conv)
        conv.pop("_id", None)
        return conv

    # ===================== Attachments =====================
    @api_router.post("/messages/attachment")
    async def upload_attachment(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
        owner_id = current_user["user"]["id"]
        ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "").lower()
        if ext not in {"jpg", "jpeg", "png", "webp", "heic", "heif"}:
            raise HTTPException(status_code=400, detail="Unsupported image type. Use JPG, PNG, WEBP or HEIC.")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(data) > ATTACH_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Image too large (max 15MB)")
        lowres = await _make_lowres(data)
        if not lowres:
            raise HTTPException(status_code=400, detail="Could not process image")
        file_id = str(uuid4())
        path = f"{ATTACH_APP}/messages/{owner_id}/{file_id}.jpg"
        try:
            result = await _put_object(path, lowres, "image/jpeg")
        except Exception:
            logger.exception("Attachment upload failed")
            raise HTTPException(status_code=502, detail="Failed to upload image. Please try again.")
        await db.training_files.insert_one({
            "id": file_id, "athlete_id": owner_id, "storage_path": result.get("path", path),
            "content_type": "image/jpeg", "size": len(lowres), "is_deleted": False,
            "kind": "message_attachment", "created_at": _now_iso(),
        })
        return {"attachment_id": file_id, "url": f"/api/messages/attachment/{file_id}"}

    @api_router.get("/messages/attachment/{file_id}")
    async def get_attachment(file_id: str, authorization: str = Header(None), auth: str = Query(None)):
        import jwt as _jwt, os as _os
        token = None
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ", 1)[1]
        elif auth:
            token = auth
        if not token:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            payload = _jwt.decode(token, _os.environ.get("JWT_SECRET", "brazil-lacrosse-secret-2024"), algorithms=["HS256"])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
        rec = await db.training_files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
        if not rec:
            raise HTTPException(status_code=404, detail="Not found")
        # Athlete may only view attachments in their own conversations.
        if payload.get("user_type") == "athlete":
            msg = await db.messages.find_one({"attachment_id": file_id}, {"_id": 0, "conversation_id": 1})
            allowed = rec.get("athlete_id") == payload.get("user_id")
            if not allowed and msg:
                conv = await db.conversations.find_one({"id": msg["conversation_id"]}, {"_id": 0, "athlete_id": 1})
                allowed = conv and conv["athlete_id"] == payload.get("user_id")
            if not allowed:
                raise HTTPException(status_code=403, detail="Access denied")
        try:
            data, ctype = await _get_object(rec["storage_path"])
        except Exception:
            raise HTTPException(status_code=404, detail="Unavailable")
        return Response(content=data, media_type=ctype or "image/jpeg")

    # ===================== Athlete =====================
    @api_router.get("/messages/athlete/conversations")
    async def athlete_list(filter: str = "all", current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        q = {"athlete_id": athlete["id"], "status": {"$ne": "archived"}}
        if filter == "pain":
            q["is_pain_related"] = True
        elif filter == "resolved":
            q["status"] = "resolved"
        elif filter in ("question", "guidance", "feedback"):
            q["category"] = filter
        convs = await db.conversations.find(q, {"_id": 0, "internal_notes": 0}).sort("last_message_at", -1).to_list(200)
        for c in convs:
            c["athlete_status"] = _athlete_view_status(c)
        return convs

    @api_router.post("/messages/athlete/conversations")
    async def athlete_create(body: NewAthleteConversation, current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        if body.category not in CATEGORIES:
            body.category = "other"
        if body.priority not in PRIORITIES:
            body.priority = "normal"
        is_pain = body.category == "pain" or body.pain is not None
        conv_id = str(uuid4())
        now = _now_iso()
        conv = {
            "id": conv_id, "athlete_id": athlete["id"], "athlete_name": athlete.get("name", "Athlete"),
            "team": athlete.get("team"), "created_by_user_id": athlete["id"], "created_by_role": "athlete",
            "category": body.category, "title": body.title, "status": "pending", "priority": body.priority,
            "is_pain_related": is_pain, "last_message_at": now, "last_message_preview": body.message_body[:120],
            "last_sender_role": "athlete", "unread_athlete": False, "unread_admin": True,
            "last_read_by_athlete_at": now, "last_read_by_admin_at": None,
            "internal_notes": [], "resolved_at": None, "archived_at": None,
            "created_at": now, "updated_at": now,
        }
        await db.conversations.insert_one(dict(conv))
        await _append_message(conv_id, "athlete", athlete["id"], athlete.get("name", "Athlete"), body.message_body, body.attachment_id)

        if is_pain and body.pain:
            pd = body.pain.model_dump()
            await db.message_pain_details.insert_one({
                "id": str(uuid4()), "conversation_id": conv_id, "athlete_id": athlete["id"],
                **pd, "requires_follow_up": False, "resolved_at": None, "created_at": now,
            })
        return await _conv_public(conv)

    @api_router.get("/messages/athlete/conversations/{conv_id}")
    async def athlete_detail(conv_id: str, current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        conv = await db.conversations.find_one({"id": conv_id, "athlete_id": athlete["id"]}, {"_id": 0, "internal_notes": 0})
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        await db.conversations.update_one({"id": conv_id}, {"$set": {"unread_athlete": False, "last_read_by_athlete_at": _now_iso()}})
        msgs = await db.messages.find({"conversation_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
        pain = await db.message_pain_details.find_one({"conversation_id": conv_id}, {"_id": 0})
        conv["athlete_status"] = _athlete_view_status(conv)
        return {"conversation": conv, "messages": msgs, "pain": pain}

    @api_router.post("/messages/athlete/conversations/{conv_id}/reply")
    async def athlete_reply(conv_id: str, body: ReplyBody, current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        conv = await db.conversations.find_one({"id": conv_id, "athlete_id": athlete["id"]}, {"_id": 0, "id": 1})
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        msg = await _append_message(conv_id, "athlete", athlete["id"], athlete.get("name", "Athlete"), body.message_body, body.attachment_id)
        await db.conversations.update_one({"id": conv_id}, {"$set": {
            "status": "pending", "last_message_at": msg["created_at"], "last_message_preview": body.message_body[:120],
            "last_sender_role": "athlete", "unread_admin": True, "updated_at": msg["created_at"],
        }})
        return {"success": True, "message": msg}

    @api_router.post("/messages/athlete/conversations/{conv_id}/resolve")
    async def athlete_resolve(conv_id: str, current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        r = await db.conversations.update_one({"id": conv_id, "athlete_id": athlete["id"]},
                                              {"$set": {"status": "resolved", "resolved_at": _now_iso(), "updated_at": _now_iso()}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"success": True}

    @api_router.get("/messages/athlete/unread-count")
    async def athlete_unread(current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        n = await db.conversations.count_documents({"athlete_id": athlete["id"], "unread_athlete": True, "status": {"$ne": "archived"}})
        fb = await db.athlete_feedback.count_documents({"athlete_id": athlete["id"], "read_at": None, "archived_at": None})
        return {"unread": n + fb, "unread_messages": n, "unread_feedback": fb}

    @api_router.get("/messages/athlete/feedback")
    async def athlete_feedback(current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        items = await db.athlete_feedback.find({"athlete_id": athlete["id"], "archived_at": None}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return items

    @api_router.post("/messages/athlete/feedback/{feedback_id}/read")
    async def athlete_feedback_read(feedback_id: str, current_user: dict = Depends(get_current_user)):
        athlete = _require_athlete(current_user)
        await db.athlete_feedback.update_one({"id": feedback_id, "athlete_id": athlete["id"], "read_at": None},
                                             {"$set": {"read_at": _now_iso()}})
        return {"success": True}

    # ===================== Admin =====================
    @api_router.get("/messages/admin/counts")
    async def admin_counts(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        base = {"status": {"$nin": ["archived"]}}
        unread = await db.conversations.count_documents({**base, "unread_admin": True})
        pain = await db.conversations.count_documents({**base, "is_pain_related": True, "status": {"$nin": ["archived", "resolved"]}})
        high = await db.conversations.count_documents({**base, "priority": {"$in": ["high", "urgent"]}, "status": {"$nin": ["archived", "resolved"]}})
        pending = await db.conversations.count_documents({**base, "status": "pending"})
        return {"unread": unread, "pain": pain, "high_priority": high, "pending": pending}

    @api_router.get("/messages/admin/alerts")
    async def admin_alerts(current_user: dict = Depends(get_current_user)):
        """Bell feed for the staff dashboard: unread conversations that are pain-related
        or high/urgent priority, newest first. Admin only."""
        _require_admin(current_user)
        convs = await db.conversations.find(
            {"unread_admin": True, "status": {"$nin": ["archived"]},
             "$or": [{"is_pain_related": True}, {"priority": {"$in": ["high", "urgent"]}}]},
            {"_id": 0, "id": 1, "athlete_name": 1, "team": 1, "title": 1, "category": 1,
             "priority": 1, "is_pain_related": 1, "last_message_preview": 1, "last_message_at": 1}
        ).sort("last_message_at", -1).to_list(50)
        # Also surface plain unread messages (non-pain, normal priority) as lower-priority items
        others = await db.conversations.find(
            {"unread_admin": True, "status": {"$nin": ["archived"]},
             "is_pain_related": {"$ne": True}, "priority": {"$nin": ["high", "urgent"]}},
            {"_id": 0, "id": 1, "athlete_name": 1, "team": 1, "title": 1, "category": 1,
             "priority": 1, "is_pain_related": 1, "last_message_preview": 1, "last_message_at": 1}
        ).sort("last_message_at", -1).to_list(50)
        return {"priority_count": len(convs), "total_unread": len(convs) + len(others),
                "priority": convs, "others": others}

    @api_router.get("/messages/admin/conversations")
    async def admin_list(status: Optional[str] = None, category: Optional[str] = None, priority: Optional[str] = None,
                         team: Optional[str] = None, athlete_id: Optional[str] = None, is_pain: Optional[bool] = None,
                         q: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        query = {}
        if status and status != "all":
            if status == "unread":
                query["unread_admin"] = True
                query["status"] = {"$ne": "archived"}
            else:
                query["status"] = status
        else:
            query["status"] = {"$ne": "archived"}
        if category and category != "all":
            query["category"] = category
        if priority and priority != "all":
            query["priority"] = priority
        if team and team != "all":
            query["team"] = team
        if athlete_id:
            query["athlete_id"] = athlete_id
        if is_pain:
            query["is_pain_related"] = True
        if q:
            query["$or"] = [{"title": {"$regex": q, "$options": "i"}},
                            {"athlete_name": {"$regex": q, "$options": "i"}},
                            {"last_message_preview": {"$regex": q, "$options": "i"}}]
        convs = await db.conversations.find(query, {"_id": 0}).sort("last_message_at", -1).to_list(300)
        return convs

    @api_router.get("/messages/admin/conversations/{conv_id}")
    async def admin_detail(conv_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        conv = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        await db.conversations.update_one({"id": conv_id}, {"$set": {"unread_admin": False, "last_read_by_admin_at": _now_iso()}})
        msgs = await db.messages.find({"conversation_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
        pain = await db.message_pain_details.find_one({"conversation_id": conv_id}, {"_id": 0})
        athlete = await db.athletes.find_one({"id": conv["athlete_id"]}, {"_id": 0, "password_hash": 0})
        return {"conversation": conv, "messages": msgs, "pain": pain, "athlete": athlete}

    @api_router.post("/messages/admin/conversations")
    async def admin_create(body: AdminNewConversation, current_user: dict = Depends(get_current_user)):
        admin = _require_admin(current_user)
        athlete = await db.athletes.find_one({"id": body.athlete_id}, {"_id": 0})
        if not athlete:
            raise HTTPException(status_code=404, detail="Athlete not found")
        conv_id = str(uuid4()); now = _now_iso()
        conv = {
            "id": conv_id, "athlete_id": athlete["id"], "athlete_name": athlete.get("name", "Athlete"),
            "team": athlete.get("team"), "created_by_user_id": admin["id"], "created_by_role": "staff",
            "category": body.category if body.category in CATEGORIES else "general", "title": body.title,
            "status": "replied", "priority": body.priority if body.priority in PRIORITIES else "normal",
            "is_pain_related": False, "last_message_at": now, "last_message_preview": body.message_body[:120],
            "last_sender_role": "staff", "unread_athlete": True, "unread_admin": False,
            "last_read_by_athlete_at": None, "last_read_by_admin_at": now,
            "internal_notes": [], "resolved_at": None, "archived_at": None, "created_at": now, "updated_at": now,
        }
        await db.conversations.insert_one(dict(conv))
        await _append_message(conv_id, "staff", admin["id"], admin.get("name", "Staff"), body.message_body)
        if body.send_push:
            await _notify_athlete_new_message(athlete["id"], conv_id, "message")
        return await _conv_public(conv)

    @api_router.post("/messages/admin/conversations/{conv_id}/reply")
    async def admin_reply(conv_id: str, body: ReplyBody, current_user: dict = Depends(get_current_user)):
        admin = _require_admin(current_user)
        conv = await db.conversations.find_one({"id": conv_id}, {"_id": 0, "athlete_id": 1})
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        msg = await _append_message(conv_id, "staff", admin["id"], admin.get("name", "Staff"), body.message_body, body.attachment_id)
        await db.conversations.update_one({"id": conv_id}, {"$set": {
            "status": "replied", "last_message_at": msg["created_at"], "last_message_preview": body.message_body[:120],
            "last_sender_role": "staff", "unread_athlete": True, "unread_admin": False, "updated_at": msg["created_at"],
        }})
        await _notify_athlete_new_message(conv["athlete_id"], conv_id, "message")
        return {"success": True, "message": msg}

    @api_router.post("/messages/admin/conversations/{conv_id}/resolve")
    async def admin_resolve(conv_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        r = await db.conversations.update_one({"id": conv_id}, {"$set": {"status": "resolved", "resolved_at": _now_iso(), "updated_at": _now_iso()}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
        await db.message_pain_details.update_many({"conversation_id": conv_id}, {"$set": {"resolved_at": _now_iso()}})
        return {"success": True}

    @api_router.post("/messages/admin/conversations/{conv_id}/archive")
    async def admin_archive(conv_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        r = await db.conversations.update_one({"id": conv_id}, {"$set": {"status": "archived", "archived_at": _now_iso(), "updated_at": _now_iso()}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"success": True}

    @api_router.post("/messages/admin/conversations/{conv_id}/internal-note")
    async def admin_note(conv_id: str, body: InternalNoteBody, current_user: dict = Depends(get_current_user)):
        admin = _require_admin(current_user)
        note = {"id": str(uuid4()), "author": admin.get("name", "Staff"), "text": body.text, "created_at": _now_iso()}
        r = await db.conversations.update_one({"id": conv_id}, {"$push": {"internal_notes": note}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"success": True, "note": note}

    @api_router.post("/messages/admin/conversations/{conv_id}/pain-followup")
    async def admin_pain_followup(conv_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        r = await db.message_pain_details.update_one({"conversation_id": conv_id}, {"$set": {"requires_follow_up": True}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="No pain details on this conversation")
        return {"success": True}

    @api_router.post("/messages/admin/feedback")
    async def admin_feedback(body: FeedbackBody, current_user: dict = Depends(get_current_user)):
        admin = _require_admin(current_user)
        athlete = await db.athletes.find_one({"id": body.athlete_id}, {"_id": 0, "id": 1})
        if not athlete:
            raise HTTPException(status_code=404, detail="Athlete not found")
        doc = {
            "id": str(uuid4()), "athlete_id": body.athlete_id, "admin_id": admin["id"],
            "admin_name": admin.get("name", "Staff"), "title": body.title, "feedback_body": body.feedback_body,
            "category": body.category, "pinned_to_profile": body.pinned_to_profile, "important": body.important,
            "read_at": None, "archived_at": None, "created_at": _now_iso(),
        }
        await db.athlete_feedback.insert_one(dict(doc))
        doc.pop("_id", None)
        if body.send_push:
            await _notify_athlete_new_message(body.athlete_id, "", "feedback")
        return doc

    @api_router.get("/messages/admin/athlete/{athlete_id}/feedback")
    async def admin_athlete_feedback(athlete_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        items = await db.athlete_feedback.find({"athlete_id": athlete_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return items

    @api_router.get("/messages/admin/analytics")
    async def admin_analytics(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        total = await db.conversations.count_documents({})
        pending = await db.conversations.count_documents({"status": "pending"})
        resolved = await db.conversations.count_documents({"status": "resolved"})
        pain = await db.conversations.count_documents({"is_pain_related": True})
        high = await db.conversations.count_documents({"priority": {"$in": ["high", "urgent"]}})
        feedbacks = await db.athlete_feedback.count_documents({})
        by_cat = await db.conversations.aggregate([{"$group": {"_id": "$category", "count": {"$sum": 1}}}]).to_list(50)
        return {
            "total": total, "pending": pending, "resolved": resolved, "pain": pain,
            "high_priority": high, "feedbacks_sent": feedbacks,
            "by_category": {c["_id"]: c["count"] for c in by_cat},
        }
