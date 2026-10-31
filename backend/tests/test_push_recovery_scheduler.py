"""
Direct unit test for the Recovery push reminder branch in
push_routes._check_and_send_reminders.

Avoids pytest-asyncio by driving the coroutine with asyncio.run().
Monkeypatches send_push_to_subscription to capture the payload instead of
performing a real web push.
"""
import os
import sys
import asyncio
import uuid
from datetime import datetime

import pytz
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Make backend importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import push_routes  # noqa: E402

TZ = "America/Sao_Paulo"


def _now_hhmm(offset_min=0):
    from datetime import timedelta
    t = datetime.now(pytz.timezone(TZ)) + timedelta(minutes=offset_min)
    return t.strftime("%H:%M")


def _today():
    return datetime.now(pytz.timezone(TZ)).strftime("%Y-%m-%d")


async def _run_recovery_scenario(send_recovery_logs_today):
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    athlete_id = f"test-rec-{uuid.uuid4().hex[:8]}"
    today = _today()
    captured = []

    async def fake_send(sub, payload):
        if sub.get("athlete_id") == athlete_id:
            captured.append(payload)
        return True

    original = push_routes.send_push_to_subscription
    push_routes.send_push_to_subscription = fake_send
    try:
        # Ensure recovery settings target exists
        await db.recovery_settings.update_one(
            {"id": "global"},
            {"$setOnInsert": {"id": "global", "approval_mode": "automatic", "daily_target": 100}},
            upsert=True,
        )
        settings = await db.recovery_settings.find_one({"id": "global"})
        target = int(settings.get("daily_target", 100))

        # Subscription whose recovery_time == current minute; morning/evening do NOT match
        await db.push_subscriptions.delete_many({"athlete_id": athlete_id})
        await db.push_subscriptions.insert_one({
            "id": str(uuid.uuid4()),
            "athlete_id": athlete_id,
            "endpoint": f"https://example.com/{athlete_id}",
            "keys": {"p256dh": "x", "auth": "y"},
            "timezone": TZ,
            "morning_time": _now_hhmm(30),
            "evening_time": _now_hhmm(45),
            "recovery_time": _now_hhmm(0),
            "recovery_enabled": True,
            "enabled": True,
        })

        # Clean send-log + logs for this athlete/today
        await db.push_send_log.delete_many({"athlete_id": athlete_id})
        await db.recovery_logs.delete_many({"athlete_id": athlete_id, "date": today})
        if send_recovery_logs_today:
            # Insert enough approved points to MEET the target -> reminder must NOT fire
            await db.recovery_logs.insert_one({
                "id": str(uuid.uuid4()), "athlete_id": athlete_id, "date": today,
                "status": "approved", "points": target,
            })

        await push_routes._check_and_send_reminders(db)
        log_entry = await db.push_send_log.find_one(
            {"athlete_id": athlete_id, "kind": "recovery", "date": today}
        )
        return captured, log_entry
    finally:
        push_routes.send_push_to_subscription = original
        await db.push_subscriptions.delete_many({"athlete_id": athlete_id})
        await db.push_send_log.delete_many({"athlete_id": athlete_id})
        await db.recovery_logs.delete_many({"athlete_id": athlete_id, "date": today})


def test_recovery_reminder_fires_when_below_target():
    captured, log_entry = asyncio.run(_run_recovery_scenario(send_recovery_logs_today=False))
    assert len(captured) == 1, f"expected 1 recovery push, got {len(captured)}"
    payload = captured[0]
    assert payload["url"] == "/athlete/recovery"
    assert "recovery" in payload["tag"]
    assert "recovery points" in payload["body"].lower()
    assert log_entry is not None, "push_send_log should record the recovery send"


def test_recovery_reminder_skipped_when_target_met():
    captured, log_entry = asyncio.run(_run_recovery_scenario(send_recovery_logs_today=True))
    assert len(captured) == 0, "recovery reminder must not fire once daily target is met"
    assert log_entry is None
