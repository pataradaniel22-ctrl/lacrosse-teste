"""Shared utility to auto-generate staff Alerts from athlete pain reports.

Used by morning check-ins (server.py), training sessions (server.py) and
recovery submissions (recovery_routes.py). Kept in its own module to avoid
circular imports between server.py and recovery_routes.py.
"""
import logging
from datetime import datetime, timezone
from uuid import uuid4

logger = logging.getLogger(__name__)

REGION_LABELS = {
    "Neck": "Neck", "Shoulder": "Shoulder", "Elbow": "Elbow", "WristHand": "Wrist/Hand",
    "LowBack": "Low Back", "HipGroin": "Hip/Groin", "Knee": "Knee", "AnkleFoot": "Ankle/Foot",
    "Other": "Other",
}

SEVERE_PAIN_THRESHOLD = 7  # only severe pain (>=7/10) raises an alert


async def create_severe_pain_alerts(db, athlete_id, pain_reports, source, date_str=None):
    """Create unresolved staff Alerts (PersistentPain / Red) for each pain
    report at or above the severe threshold.

    Deduplicated by athlete + message (region/side/level/source/date) while the
    alert is still unresolved, so repeated submissions don't spam Active Alerts.

    `pain_reports` is a list of dicts: {body_region, laterality, pain_level}.
    Returns the number of alerts created.
    """
    if not pain_reports:
        return 0
    date_str = date_str or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "name": 1})
    athlete_name = athlete.get("name", "Athlete") if athlete else "Athlete"

    created = 0
    for pr in pain_reports:
        try:
            level = int(pr.get("pain_level", 0) or 0)
        except (TypeError, ValueError):
            level = 0
        if level < SEVERE_PAIN_THRESHOLD:
            continue

        region = pr.get("body_region") or "Unspecified"
        region_label = REGION_LABELS.get(region, region)
        laterality = pr.get("laterality") or "N/A"
        side = f" ({laterality})" if laterality and laterality != "N/A" else ""
        message = f"Severe pain reported: {region_label}{side} {level}/10 — {source} ({date_str})"

        existing = await db.alerts.find_one(
            {"athlete_id": athlete_id, "message": message, "resolved": False}
        )
        if existing:
            continue

        await db.alerts.insert_one({
            "id": str(uuid4()),
            "athlete_id": athlete_id,
            "alert_type": "PersistentPain",
            "severity": "Red",
            "message": message,
            "resolved": False,
            "resolved_by": None,
            "resolved_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            # Extra metadata for richer UI (Alert model ignores extras on read)
            "athlete_name": athlete_name,
            "source": source,
            "body_region": region,
            "laterality": laterality,
            "pain_level": level,
            "date": date_str,
        })
        created += 1

    if created:
        logger.info("Created %d severe-pain alert(s) for athlete %s from %s", created, athlete_id, source)
    return created
