"""Push notification endpoints + scheduler for athlete check-in reminders."""
import os
import json
import logging
from datetime import datetime, timezone, timedelta
from app_time import local_now as app_local_now
from typing import Optional
from uuid import uuid4

import pytz
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pywebpush import webpush, WebPushException
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

push_router = APIRouter(prefix="/api/push")

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_PEM_PATH = os.environ.get("VAPID_PRIVATE_PEM_PATH", "/app/backend/vapid_private.pem")
VAPID_CONTACT_EMAIL = os.environ.get("VAPID_CONTACT_EMAIL", "mailto:admin@example.com")
DEFAULT_TZ = "America/New_York"


# --- Pydantic models ---
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    timezone: Optional[str] = DEFAULT_TZ


class PushPreferences(BaseModel):
    enabled: bool = True
    morning_time: str = Field(default="08:00", pattern=r"^\d{2}:\d{2}$")
    evening_time: str = Field(default="21:00", pattern=r"^\d{2}:\d{2}$")
    recovery_enabled: bool = True
    recovery_time: str = Field(default="19:00", pattern=r"^\d{2}:\d{2}$")
    timezone: str = DEFAULT_TZ


# --- VAPID claims for pywebpush ---
# Keys generated automatically (and kept in MongoDB) when none are configured
# through environment variables, so a fresh deployment needs no manual setup.
_db = None
_vapid_pem_cache: Optional[str] = None


async def _ensure_vapid_keys() -> None:
    """Make sure a VAPID key pair is available.

    Order: environment variables -> key pair stored in MongoDB -> generate a new
    pair and store it (so it survives restarts and stays stable for subscribers).
    """
    global VAPID_PUBLIC_KEY, _vapid_pem_cache
    if VAPID_PUBLIC_KEY and (os.environ.get("VAPID_PRIVATE_KEY_B64") or os.path.isfile(VAPID_PRIVATE_PEM_PATH)):
        return
    if _vapid_pem_cache and VAPID_PUBLIC_KEY:
        return
    if _db is None:
        return
    doc = await _db.app_settings.find_one({"_id": "vapid_keys"})
    if not doc:
        import base64
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("utf-8")
        raw_pub = key.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        pub = base64.urlsafe_b64encode(raw_pub).decode("ascii").rstrip("=")
        doc = {"_id": "vapid_keys", "public_key": pub, "private_pem": pem}
        try:
            await _db.app_settings.insert_one(doc)
            logger.info("Generated and stored a new VAPID key pair")
        except Exception:
            # Another worker stored one first: use that one.
            doc = await _db.app_settings.find_one({"_id": "vapid_keys"})
    VAPID_PUBLIC_KEY = doc["public_key"]
    _vapid_pem_cache = doc["private_pem"]


def _get_vapid_pem() -> str:
    if _vapid_pem_cache:
        return _vapid_pem_cache
    # Prefer the env-provided key (works in production where the gitignored
    # .pem file is absent); fall back to the local file for development.
    b64 = os.environ.get("VAPID_PRIVATE_KEY_B64")
    if b64:
        import base64
        return base64.b64decode(b64).decode("utf-8")
    with open(VAPID_PRIVATE_PEM_PATH, "r") as f:
        return f.read()


def _vapid_claims() -> dict:
    return {"sub": VAPID_CONTACT_EMAIL}


# --- Push sending ---
async def send_push_to_subscription(subscription_doc: dict, payload: dict) -> str:
    """Send a push to a single subscription.

    Returns a status string:
      - "ok"    : delivered
      - "gone"  : subscription permanently expired (404/410) -> caller should delete it
      - "error" : transient failure (network/timeout/etc.) -> caller should KEEP the sub and retry later
    """
    await _ensure_vapid_keys()
    try:
        webpush(
            subscription_info={
                "endpoint": subscription_doc["endpoint"],
                "keys": subscription_doc["keys"],
            },
            data=json.dumps(payload),
            vapid_private_key=_get_vapid_pem(),
            vapid_claims=_vapid_claims(),
            timeout=10,
        )
        return "ok"
    except WebPushException as e:
        # 404/410 = subscription is gone for good, safe to delete
        if e.response is not None and e.response.status_code in (404, 410):
            logger.info(f"Subscription expired/gone: {subscription_doc.get('endpoint', '')[:60]}... — deleting")
            return "gone"
        # Any other push error is transient — DO NOT delete the device
        logger.warning(f"WebPush failed (transient, keeping sub): {e}")
        return "error"
    except Exception as e:
        logger.warning(f"Push send error (transient, keeping sub): {e}")
        return "error"


# --- Reminder scheduler ---
def _local_now(tz_name: str) -> datetime:
    try:
        return datetime.now(pytz.timezone(tz_name))
    except Exception:
        return datetime.now(pytz.timezone(DEFAULT_TZ))


async def _check_and_send_reminders(db):
    """Runs every minute. For each enabled subscription, send reminder if local time matches and check-in not yet done."""
    try:
        subs = await db.push_subscriptions.find({"enabled": True}, {"_id": 0}).to_list(length=None)
        if not subs:
            return

        # Group by athlete to avoid duplicate sends for athletes with multiple devices
        for sub in subs:
            athlete_id = sub.get("athlete_id")
            if not athlete_id:
                continue
            tz = sub.get("timezone") or DEFAULT_TZ
            now_local = _local_now(tz)
            hhmm = now_local.strftime("%H:%M")
            # Day boundary for DB date keys is always Boston (matches check-in /
            # recovery / training "date" fields), regardless of device tz.
            today = app_local_now().strftime("%Y-%m-%d")

            morning_t = sub.get("morning_time", "08:00")
            evening_t = sub.get("evening_time", "21:00")
            recovery_t = sub.get("recovery_time", "19:00")

            payload = None
            kind = None
            if hhmm == morning_t:
                # Check if morning check-in already done
                done = await db.daily_readiness.find_one(
                    {"athlete_id": athlete_id, "date": today},
                    {"_id": 0, "id": 1},
                )
                if not done:
                    payload = {
                        "title": "Good morning! Time for your check-in",
                        "body": "Do your morning check-in to record how you're feeling today.",
                        "url": "/athlete/morning-check-in",
                        "tag": f"morning-{today}",
                    }
                    kind = "morning"
            elif hhmm == evening_t:
                # Check if any training session logged today
                done = await db.training_sessions.find_one(
                    {"athlete_id": athlete_id, "date_time_start": {"$regex": f"^{today}"}},
                    {"_id": 0, "id": 1},
                )
                if not done:
                    payload = {
                        "title": "Reminder: log your training",
                        "body": "Don't forget to log your training and recovery for today.",
                        "url": "/athlete/post-training",
                        "tag": f"evening-{today}",
                    }
                    kind = "evening"
            elif hhmm == recovery_t and sub.get("recovery_enabled", True):
                # Recovery points reminder: fire if athlete hasn't reached today's target
                settings = await db.recovery_settings.find_one({"id": "global"}, {"_id": 0})
                target = int((settings or {}).get("daily_target", 100))
                logs = await db.recovery_logs.find(
                    {"athlete_id": athlete_id, "date": today, "status": "approved"},
                    {"_id": 0, "points": 1},
                ).to_list(length=None)
                points = sum(int(lg.get("points", 0)) for lg in logs)
                if points < target:
                    remaining = target - points
                    payload = {
                        "title": "Recovery reminder",
                        "body": f"You're at {points}/{target} recovery points today. {remaining} to go — log your recovery to hit your goal!",
                        "url": "/athlete/recovery",
                        "tag": f"recovery-{today}",
                    }
                    kind = "recovery"

            if not payload:
                continue

            # Dedup: skip if already sent for this athlete + kind today
            already_sent = await db.push_send_log.find_one(
                {"athlete_id": athlete_id, "kind": kind, "date": today}
            )
            if already_sent:
                continue

            delivered = await send_push_to_subscription(sub, payload)
            if delivered == "ok":
                await db.push_send_log.insert_one(
                    {
                        "id": str(uuid4()),
                        "athlete_id": athlete_id,
                        "kind": kind,
                        "date": today,
                        "sent_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                logger.info(f"Push sent: athlete={athlete_id} kind={kind}")
            elif delivered == "gone":
                # Remove only permanently-dead subscriptions
                await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
            # transient "error": keep the sub and retry next cycle
    except Exception as e:
        logger.exception(f"Reminder loop error: {e}")


def start_reminder_scheduler(db):
    """Call once on FastAPI startup."""
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        _check_and_send_reminders,
        "interval",
        minutes=1,
        args=[db],
        max_instances=1,
        coalesce=True,
        id="push_reminders",
    )
    scheduler.start()
    logger.info("Push reminder scheduler started (1-min interval)")
    return scheduler


# --- Endpoints ---
def register_push_routes(api_router, db, get_current_user):
    """Register all push routes on the existing api_router (so /api prefix is preserved)."""
    global _db
    _db = db

    @api_router.get("/push/vapid-public-key")
    async def get_vapid_public_key():
        await _ensure_vapid_keys()
        return {"public_key": VAPID_PUBLIC_KEY}

    @api_router.get("/push/preferences")
    async def get_preferences(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        sub = await db.push_subscriptions.find_one(
            {"athlete_id": athlete_id}, {"_id": 0}
        )
        if not sub:
            return {
                "subscribed": False,
                "enabled": False,
                "morning_time": "08:00",
                "evening_time": "21:00",
                "recovery_enabled": True,
                "recovery_time": "19:00",
                "timezone": DEFAULT_TZ,
            }
        return {
            "subscribed": True,
            "enabled": sub.get("enabled", True),
            "morning_time": sub.get("morning_time", "08:00"),
            "evening_time": sub.get("evening_time", "21:00"),
            "recovery_enabled": sub.get("recovery_enabled", True),
            "recovery_time": sub.get("recovery_time", "19:00"),
            "timezone": sub.get("timezone", DEFAULT_TZ),
        }

    @api_router.post("/push/subscribe")
    async def subscribe(req: PushSubscribeRequest, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]

        # Use endpoint as unique key (one device = one subscription). Upsert.
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = await db.push_subscriptions.find_one(
            {"athlete_id": athlete_id}, {"_id": 0}
        )
        defaults = {
            "morning_time": existing.get("morning_time", "08:00") if existing else "08:00",
            "evening_time": existing.get("evening_time", "21:00") if existing else "21:00",
            "recovery_time": existing.get("recovery_time", "19:00") if existing else "19:00",
            "recovery_enabled": existing.get("recovery_enabled", True) if existing else True,
            "enabled": existing.get("enabled", True) if existing else True,
        }
        # Remove any old subscriptions for this athlete (single device)
        await db.push_subscriptions.delete_many({"athlete_id": athlete_id})
        doc = {
            "id": str(uuid4()),
            "athlete_id": athlete_id,
            "endpoint": req.endpoint,
            "keys": req.keys.model_dump(),
            "timezone": req.timezone or DEFAULT_TZ,
            "morning_time": defaults["morning_time"],
            "evening_time": defaults["evening_time"],
            "recovery_time": defaults["recovery_time"],
            "recovery_enabled": defaults["recovery_enabled"],
            "enabled": defaults["enabled"],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        await db.push_subscriptions.insert_one(doc)
        return {"success": True, "subscribed": True, **defaults}

    @api_router.put("/push/preferences")
    async def update_preferences(prefs: PushPreferences, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        existing = await db.push_subscriptions.find_one({"athlete_id": athlete_id})
        if not existing:
            raise HTTPException(status_code=400, detail="No active subscription. Subscribe first.")
        await db.push_subscriptions.update_one(
            {"athlete_id": athlete_id},
            {
                "$set": {
                    "enabled": prefs.enabled,
                    "morning_time": prefs.morning_time,
                    "evening_time": prefs.evening_time,
                    "recovery_enabled": prefs.recovery_enabled,
                    "recovery_time": prefs.recovery_time,
                    "timezone": prefs.timezone,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        return {"success": True, **prefs.model_dump()}

    @api_router.delete("/push/unsubscribe")
    async def unsubscribe(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        r = await db.push_subscriptions.delete_many({"athlete_id": athlete_id})
        return {"success": True, "deleted": r.deleted_count}

    @api_router.post("/push/test")
    async def send_test_push(current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        athlete_id = current_user["user"]["id"]
        sub = await db.push_subscriptions.find_one(
            {"athlete_id": athlete_id}, {"_id": 0}
        )
        if not sub:
            raise HTTPException(status_code=400, detail="No active subscription")
        payload = {
            "title": "Test notification",
            "body": "All good! Your notifications are working.",
            "url": "/athlete",
            "tag": "test",
        }
        ok = await send_push_to_subscription(sub, payload)
        if ok != "ok":
            raise HTTPException(status_code=502, detail="Failed to send notification. Please subscribe again.")
        return {"success": True}
