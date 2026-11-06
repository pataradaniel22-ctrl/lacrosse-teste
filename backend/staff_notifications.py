"""Staff notification centre (the bell).

GET  /api/staff/notifications            items + unread count for the current staff member
POST /api/staff/notifications/seen       mark everything as seen (badge -> 0)
POST /api/staff/notifications/dismiss    {ids:[...]} hide items for this staff member
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import Depends, HTTPException
from pydantic import BaseModel

import staff_notifications_logic as N

WINDOW_DAYS = 14
MAX_DISMISSED = 2000


class DismissRequest(BaseModel):
    ids: List[str]


def register_staff_notification_routes(api_router, db, get_current_user, list_alerts):
    """`list_alerts(current_user)` returns the unresolved health alerts (same as /staff/alerts)."""

    def staff(cu):
        if cu["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        return cu["user"].get("role"), cu["user"].get("id")

    async def state_of(uid):
        return await db.staff_notif_state.find_one({"user_id": uid}, {"_id": 0}) or {"user_id": uid, "seen_at": None, "dismissed": []}

    async def collect(cu):
        role, uid = staff(cu)
        since = (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).isoformat()
        athletes = await db.athletes.find({"active": True}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)
        names = {a["id"]: (a.get("name") or "").strip() for a in athletes}
        ids = list(names)

        try:
            alerts = await list_alerts(cu)
        except Exception:
            alerts = []

        conversations = []
        if role == "Admin":
            conversations = await db.conversations.find(
                {"unread_admin": True, "status": {"$nin": ["archived"]}},
                {"_id": 0, "id": 1, "athlete_name": 1, "title": 1, "priority": 1, "is_pain_related": 1,
                 "last_message_preview": 1, "last_message_at": 1}).sort("last_message_at", -1).to_list(50)

        documents, requests_done, follow_ups, pending = [], [], [], []
        if role != "Research":
            # Athlete Hub: documents uploaded by athletes the viewer is allowed to see
            try:
                import athlete_hub_logic as L
                stored = await db.app_settings.find_one({"_id": "hub_doc_types"})
                types = L.merge_defaults((stored or {}).get("types"), L.default_doc_types())
                visible = {t["key"]: t["label"] for t in types if L.can_see(t, role, "staff")}
                docs = await db.athlete_documents.find(
                    {"athlete_id": {"$in": ids}, "uploaded_at": {"$gte": since}, "uploaded_by.type": "athlete"},
                    {"_id": 0, "path": 0}).sort("uploaded_at", -1).to_list(100)
                for d in docs:
                    if d.get("doc_type") in visible:
                        documents.append({**d, "athlete_name": names.get(d["athlete_id"]), "type_label": visible[d["doc_type"]]})
            except Exception:
                pass
            reqs = await db.hub_requests.find(
                {"athlete_id": {"$in": ids}, "status": "done", "completed_at": {"$gte": since}, "closed_by": {"$exists": False}},
                {"_id": 0}).sort("completed_at", -1).to_list(100)
            requests_done = [{**r, "athlete_name": names.get(r["athlete_id"])} for r in reqs]

            # Clinical Record follow-ups due within 2 days or overdue (not older than the window)
            try:
                import clinical_record_logic as C
                from app_time import local_now
                today = local_now().date()
                soon = (today + timedelta(days=2)).isoformat()
                notes = await db.athlete_notes.find(
                    {"athlete_id": {"$in": ids}, "follow_up_on": {"$ne": None, "$lte": soon, "$gte": (today - timedelta(days=WINDOW_DAYS)).isoformat()},
                     "follow_up_done": {"$ne": True}, "deleted_at": None},
                    {"_id": 0, "id": 1, "athlete_id": 1, "follow_up_on": 1, "title": 1, "entry_type": 1, "confidential": 1, "author_id": 1}).to_list(200)
                for n in notes:
                    if C.can_see_entry(n, role, uid):
                        follow_ups.append({**n, "athlete_name": names.get(n["athlete_id"]), "status": C.follow_up_status(n, today)})
            except Exception:
                pass

        if role == "Admin":
            pa = await db.athletes.find({"status": "pending"}, {"_id": 0, "id": 1, "name": 1, "created_at": 1}).to_list(100)
            ps = await db.staff_users.find({"status": "pending"}, {"_id": 0, "id": 1, "name": 1, "created_at": 1}).to_list(100)
            pending = [{**p, "kind": "Athlete"} for p in pa] + [{**p, "kind": "Staff"} for p in ps]

        return N.build_items(alerts, conversations, documents, requests_done, follow_ups, pending), uid

    @api_router.get("/staff/notifications")
    async def get_notifications(current_user: dict = Depends(get_current_user)):
        items, uid = await collect(current_user)
        st = await state_of(uid)
        return N.apply_state(items, st.get("seen_at"), st.get("dismissed") or [])

    @api_router.post("/staff/notifications/seen")
    async def mark_seen(current_user: dict = Depends(get_current_user)):
        _, uid = staff(current_user)
        now = datetime.now(timezone.utc).isoformat()
        await db.staff_notif_state.update_one({"user_id": uid}, {"$set": {"seen_at": now}}, upsert=True)
        return {"seen_at": now}

    @api_router.post("/staff/notifications/dismiss")
    async def dismiss(data: DismissRequest, current_user: dict = Depends(get_current_user)):
        _, uid = staff(current_user)
        ids = [str(i)[:200] for i in data.ids[:500]]
        st = await state_of(uid)
        merged = list(dict.fromkeys((st.get("dismissed") or []) + ids))[-MAX_DISMISSED:]
        await db.staff_notif_state.update_one({"user_id": uid}, {"$set": {"dismissed": merged}}, upsert=True)
        return {"dismissed": len(ids)}
