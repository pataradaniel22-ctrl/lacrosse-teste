"""Notification Center: athlete custom reminders + staff-sent notifications (Web Push).

Extends the existing Web Push infrastructure (push_routes) with:
  - Athlete-defined custom reminders (title/body/time/weekdays/deep-link).
  - Staff notifications to athletes (all / by team / individuals), sent now or scheduled.
Reuses push_subscriptions (devices) and push_send_log (per-day dedup).
"""
import logging
from datetime import datetime, timezone
from typing import Optional, List
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app_time import local_now as app_local_now
from push_routes import send_push_to_subscription, _local_now, DEFAULT_TZ

logger = logging.getLogger(__name__)


# --- Models ---
class CustomReminderReq(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(default="", max_length=200)
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    days: List[int] = Field(default_factory=list)  # 0=Mon .. 6=Sun; empty = daily
    url: str = Field(default="/athlete", max_length=200)
    enabled: bool = True


class StaffNotificationReq(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(default="", max_length=300)
    url: str = Field(default="/athlete", max_length=200)
    target_type: str = Field(default="all")  # all | team | athletes
    target_team: Optional[str] = None
    target_athlete_ids: List[str] = Field(default_factory=list)
    scheduled_at: Optional[str] = None  # ISO UTC; None/past = send immediately


# --- Delivery helpers ---
async def _send_to_athlete(db, athlete_id: str, payload: dict) -> bool:
    """Send a push to all of an athlete's enabled devices. Prunes dead subs."""
    subs = await db.push_subscriptions.find(
        {"athlete_id": athlete_id, "enabled": True}, {"_id": 0}
    ).to_list(length=None)
    delivered = False
    for sub in subs:
        status = await send_push_to_subscription(sub, payload)
        if status == "ok":
            delivered = True
        elif status == "gone":
            # Only prune permanently-expired subscriptions (404/410).
            # Transient errors keep the device so it isn't lost on a flaky send.
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
    return delivered


async def _resolve_targets(db, target_type: str, target_team, target_athlete_ids) -> List[str]:
    if target_type == "athletes":
        return list(target_athlete_ids or [])
    query = {"active": True, "status": {"$in": ["approved", None]}}
    if target_type == "team" and target_team:
        query["team"] = target_team
    athletes = await db.athletes.find(query, {"_id": 0, "id": 1}).to_list(length=None)
    return [a["id"] for a in athletes]


async def _dispatch_staff_notification(db, n: dict) -> dict:
    ids = await _resolve_targets(db, n.get("target_type"), n.get("target_team"), n.get("target_athlete_ids"))
    payload = {
        "title": n["title"],
        "body": n.get("body", ""),
        "url": n.get("url", "/athlete"),
        "tag": f"staff-{n['id']}",
    }
    now = datetime.now(timezone.utc).isoformat()
    push_delivered = 0
    inapp_docs = []
    for aid in ids:
        # Best-effort Web Push (requires the athlete to have enabled push on a device)
        try:
            if await _send_to_athlete(db, aid, payload):
                push_delivered += 1
        except Exception:
            pass
        # Guaranteed in-app delivery: always lands in the athlete's notification bell
        inapp_docs.append({
            "id": str(uuid4()), "athlete_id": aid, "title": n["title"],
            "message": n.get("body", ""), "url": n.get("url", "/athlete"),
            "type": "staff_broadcast", "source_id": n["id"], "read": False, "created_at": now,
        })
    if inapp_docs:
        await db.notifications.insert_many(inapp_docs)
    # "Delivered" = reached the athlete in-app (everyone targeted); push is a bonus channel.
    delivered = len(ids)
    await db.staff_notifications.update_one(
        {"id": n["id"]},
        {"$set": {
            "status": "sent",
            "sent_at": now,
            "delivered_count": delivered,
            "push_delivered_count": push_delivered,
            "target_count": len(ids),
        }},
    )
    return {"delivered_count": delivered, "push_delivered_count": push_delivered, "target_count": len(ids)}


# --- Schedulers (run every minute) ---
async def _check_custom_reminders(db):
    try:
        reminders = await db.custom_reminders.find({"enabled": True}, {"_id": 0}).to_list(length=None)
        today = app_local_now().strftime("%Y-%m-%d")
        for r in reminders:
            athlete_id = r.get("athlete_id")
            if not athlete_id:
                continue
            sub = await db.push_subscriptions.find_one(
                {"athlete_id": athlete_id, "enabled": True}, {"_id": 0}
            )
            if not sub:
                continue
            now_local = _local_now(sub.get("timezone") or DEFAULT_TZ)
            if now_local.strftime("%H:%M") != r.get("time"):
                continue
            days = r.get("days") or []
            if days and now_local.weekday() not in days:
                continue
            dedup_kind = f"custom-{r['id']}"
            if await db.push_send_log.find_one({"athlete_id": athlete_id, "kind": dedup_kind, "date": today}):
                continue
            payload = {
                "title": r["title"],
                "body": r.get("body", ""),
                "url": r.get("url", "/athlete"),
                "tag": f"custom-{r['id']}-{today}",
            }
            if await _send_to_athlete(db, athlete_id, payload):
                await db.push_send_log.insert_one({
                    "id": str(uuid4()),
                    "athlete_id": athlete_id,
                    "kind": dedup_kind,
                    "date": today,
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                })
    except Exception as e:
        logger.exception(f"Custom reminder loop error: {e}")


async def _check_scheduled_staff_notifications(db):
    try:
        now = datetime.now(timezone.utc)
        pending = await db.staff_notifications.find({"status": "scheduled"}, {"_id": 0}).to_list(length=None)
        for n in pending:
            sched = n.get("scheduled_at")
            if not sched:
                continue
            try:
                sched_dt = datetime.fromisoformat(sched)
            except Exception:
                continue
            if sched_dt.tzinfo is None:
                sched_dt = sched_dt.replace(tzinfo=timezone.utc)
            if sched_dt <= now:
                await _dispatch_staff_notification(db, n)
                logger.info(f"Dispatched scheduled staff notification {n['id']}")
    except Exception as e:
        logger.exception(f"Scheduled staff notification loop error: {e}")


def start_notification_center_scheduler(db):
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(_check_custom_reminders, "interval", minutes=1, args=[db],
                      max_instances=1, coalesce=True, id="custom_reminders")
    scheduler.add_job(_check_scheduled_staff_notifications, "interval", minutes=1, args=[db],
                      max_instances=1, coalesce=True, id="scheduled_staff_notifications")
    scheduler.start()
    logger.info("Notification Center scheduler started (custom reminders + scheduled staff)")
    return scheduler


# --- Routes ---
def register_notification_center_routes(api_router, db, get_current_user):

    # ===== Athlete custom reminders =====
    @api_router.get("/notifications/reminders")
    async def list_reminders(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        items = await db.custom_reminders.find(
            {"athlete_id": athlete_id}, {"_id": 0}
        ).sort("time", 1).to_list(length=None)
        return items

    @api_router.post("/notifications/reminders")
    async def create_reminder(req: CustomReminderReq, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": str(uuid4()),
            "athlete_id": athlete_id,
            **req.model_dump(),
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        await db.custom_reminders.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api_router.put("/notifications/reminders/{reminder_id}")
    async def update_reminder(reminder_id: str, req: CustomReminderReq, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        r = await db.custom_reminders.update_one(
            {"id": reminder_id, "athlete_id": athlete_id},
            {"$set": {**req.model_dump(), "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Reminder not found")
        return {"success": True}

    @api_router.delete("/notifications/reminders/{reminder_id}")
    async def delete_reminder(reminder_id: str, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        r = await db.custom_reminders.delete_one({"id": reminder_id, "athlete_id": athlete_id})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Reminder not found")
        return {"success": True}

    # ===== Staff notifications =====
    @api_router.post("/staff/notifications")
    async def create_staff_notification(req: StaffNotificationReq, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        staff = current_user["user"]
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        # Decide immediate vs scheduled
        send_now = True
        if req.scheduled_at:
            try:
                sched_dt = datetime.fromisoformat(req.scheduled_at)
                if sched_dt.tzinfo is None:
                    sched_dt = sched_dt.replace(tzinfo=timezone.utc)
                send_now = sched_dt <= now
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid scheduled_at (use ISO 8601 UTC)")

        doc = {
            "id": str(uuid4()),
            "created_by": staff.get("id"),
            "created_by_name": staff.get("name", "Staff"),
            "title": req.title,
            "body": req.body,
            "url": req.url,
            "target_type": req.target_type,
            "target_team": req.target_team,
            "target_athlete_ids": req.target_athlete_ids,
            "scheduled_at": None if send_now else req.scheduled_at,
            "status": "scheduled",
            "delivered_count": 0,
            "target_count": 0,
            "created_at": now_iso,
            "sent_at": None,
        }
        await db.staff_notifications.insert_one(doc)
        doc.pop("_id", None)

        if send_now:
            result = await _dispatch_staff_notification(db, doc)
            doc.update(result)
            doc["status"] = "sent"
            doc["sent_at"] = datetime.now(timezone.utc).isoformat()
        return doc

    @api_router.get("/staff/notifications")
    async def list_staff_notifications(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        items = await db.staff_notifications.find({}, {"_id": 0}).sort("created_at", -1).to_list(length=200)
        return items

    @api_router.delete("/staff/notifications/{notification_id}")
    async def cancel_staff_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        n = await db.staff_notifications.find_one({"id": notification_id}, {"_id": 0})
        if not n:
            raise HTTPException(status_code=404, detail="Notification not found")
        if n.get("status") != "scheduled":
            raise HTTPException(status_code=400, detail="Only scheduled notifications can be cancelled")
        await db.staff_notifications.update_one({"id": notification_id}, {"$set": {"status": "cancelled"}})
        return {"success": True}

    @api_router.get("/staff/notifications/analytics")
    async def staff_notification_analytics(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        total_athletes = await db.athletes.count_documents(
            {"active": True, "status": {"$in": ["approved", None]}}
        )
        active_subs = await db.push_subscriptions.count_documents({"enabled": True})
        sent = await db.staff_notifications.count_documents({"status": "sent"})
        scheduled = await db.staff_notifications.count_documents({"status": "scheduled"})
        # Aggregate delivery totals from sent notifications
        agg = await db.staff_notifications.aggregate([
            {"$match": {"status": "sent"}},
            {"$group": {"_id": None,
                        "delivered": {"$sum": "$delivered_count"},
                        "targeted": {"$sum": "$target_count"}}},
        ]).to_list(length=1)
        delivered = agg[0]["delivered"] if agg else 0
        targeted = agg[0]["targeted"] if agg else 0
        return {
            "total_athletes": total_athletes,
            "active_subscribers": active_subs,
            "coverage_pct": round((active_subs / total_athletes) * 100) if total_athletes else 0,
            "notifications_sent": sent,
            "notifications_scheduled": scheduled,
            "total_delivered": delivered,
            "total_targeted": targeted,
            "delivery_rate_pct": round((delivered / targeted) * 100) if targeted else 0,
        }
