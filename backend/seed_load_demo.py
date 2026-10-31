"""One-off demo seeder: training sessions (varied load) + a few session photos.

Creates realistic training-load data for the last ~10 days so the Staff
Dashboard "Training Load Monitoring" chart has content, including 3 athletes
with elevated load (above mean + 1 SD) and a few sessions with photos.
"""
import asyncio
import os
import random
import uuid
from datetime import timedelta

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image
from io import BytesIO

from app_time import local_now
from recovery_storage import _make_lowres_sync, _put_object_sync

load_dotenv()

SESSION_TYPES = ["Strength", "Conditioning", "Technical", "Tactical", "Match", "Home training"]
APP_NAME = "brazil-lacrosse-recovery"


def make_demo_photo_bytes(color):
    img = Image.new("RGB", (1400, 1000), color)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    athletes = await db.athletes.find({"active": True}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    if not athletes:
        print("No active athletes")
        return

    # Clear any existing demo sessions/files first (idempotent)
    await db.training_sessions.delete_many({"demo_seed": True})
    await db.training_files.delete_many({"demo_seed": True})

    # Pick 3 athletes as high-load
    high_ids = {a["id"] for a in random.sample(athletes, min(3, len(athletes)))}

    now = local_now()
    session_docs = []
    photo_targets = []  # (athlete_id, day_offset) to attach photos

    for a in athletes:
        is_high = a["id"] in high_ids
        n_sessions = random.randint(6, 8) if is_high else random.randint(3, 5)
        used_days = set()
        for _ in range(n_sessions):
            day_off = random.randint(0, 9)
            used_days.add(day_off)
            dt = (now - timedelta(days=day_off)).replace(hour=random.randint(7, 18), minute=0, second=0, microsecond=0)
            duration = random.randint(60, 100) if is_high else random.randint(40, 75)
            rpe = random.randint(8, 10) if is_high else random.randint(4, 7)
            internal_load = duration * rpe
            pain_after = random.choice([0, 0, 0, 1, 2, 3])
            doc = {
                "id": str(uuid.uuid4()),
                "athlete_id": a["id"],
                "date_time_start": dt.isoformat(),
                "date_time_end": (dt + timedelta(minutes=duration)).isoformat(),
                "session_type": random.choice(SESSION_TYPES),
                "duration_min": duration,
                "rpe": rpe,
                "pain_during": 0,
                "pain_after": pain_after,
                "end_fatigue": random.randint(6, 9) if is_high else random.randint(3, 6),
                "body_region": None,
                "laterality": None,
                "pain_reports": None,
                "session_notes": None,
                "photo_id": None,
                "internal_load": internal_load,
                "created_at": dt.isoformat(),
                "demo_seed": True,
            }
            session_docs.append(doc)

    # Attach photos to the first ~4 sessions
    colors = [(210, 90, 40), (40, 130, 90), (60, 90, 200), (180, 150, 50)]
    for i, color in enumerate(colors):
        if i >= len(session_docs):
            break
        s = session_docs[i]
        try:
            lowres = _make_lowres_sync(make_demo_photo_bytes(color))
            file_id = str(uuid.uuid4())
            path = f"{APP_NAME}/training/{s['athlete_id']}/{file_id}.jpg"
            result = _put_object_sync(path, lowres, "image/jpeg")
            await db.training_files.insert_one({
                "id": file_id,
                "athlete_id": s["athlete_id"],
                "storage_path": result.get("path", path),
                "content_type": "image/jpeg",
                "size": len(lowres),
                "is_deleted": False,
                "created_at": s["created_at"],
                "demo_seed": True,
            })
            s["photo_id"] = file_id
            print(f"  photo attached to session for athlete {s['athlete_id'][:8]} ({len(lowres)} bytes)")
        except Exception as e:
            print(f"  photo upload failed (non-fatal): {e}")

    await db.training_sessions.insert_many(session_docs)
    print(f"Inserted {len(session_docs)} demo training sessions ({len(high_ids)} high-load athletes).")

    # ---- Daily readiness (morning check-ins) for the last ~12 days ----
    await db.daily_readiness.delete_many({"demo_seed": True})
    readiness_docs = []
    for a in athletes:
        team = ""
        full = await db.athletes.find_one({"id": a["id"]}, {"_id": 0, "team": 1})
        if full:
            team = full.get("team", "")
        is_high = a["id"] in high_ids
        for day_off in range(0, 12):
            if random.random() < 0.15:  # ~15% missed days
                continue
            dt = (now - timedelta(days=day_off)).replace(hour=8, minute=0, second=0, microsecond=0)
            date_str = dt.strftime("%Y-%m-%d")
            # High-load athletes trend towards worse recovery markers
            sleep_quality = random.randint(4, 6) if is_high else random.randint(6, 9)
            morning_fatigue = random.randint(6, 9) if is_high else random.randint(2, 5)
            muscle_soreness = random.randint(6, 9) if is_high else random.randint(2, 5)
            stress = random.randint(5, 8) if is_high else random.randint(1, 4)
            readiness = random.randint(3, 5) if is_high else random.randint(6, 9)
            fatigue_score_10 = 10 - morning_fatigue
            soreness_score_10 = 10 - muscle_soreness
            stress_score_10 = 10 - stress
            readiness_score = round((sleep_quality + fatigue_score_10 + soreness_score_10 + stress_score_10 + readiness) / 5, 2)
            doc = {
                "id": str(uuid.uuid4()),
                "athlete_id": a["id"],
                "date": date_str,
                "sleep_quality": sleep_quality,
                "morning_fatigue": morning_fatigue,
                "muscle_soreness": muscle_soreness,
                "stress": stress,
                "readiness": readiness,
                "notes": None,
                "fatigue_score_10": fatigue_score_10,
                "soreness_score_10": soreness_score_10,
                "stress_score_10": stress_score_10,
                "readiness_score": readiness_score,
                "created_at": dt.isoformat(),
                "demo_seed": True,
            }
            if "Women" in team:
                is_menstruating = random.random() < 0.25
                doc["is_menstruating"] = is_menstruating
                if is_menstruating:
                    doc["menstrual_flow"] = random.choice(["Light", "Moderate", "Heavy"])
                    doc["menstrual_pain"] = random.choice(["None", "Mild", "Moderate", "Severe"])
                    doc["menstrual_symptoms"] = random.sample(["Cramps", "Headache", "Fatigue", "Bloating"], k=random.randint(0, 2))
            readiness_docs.append(doc)

    await db.daily_readiness.insert_many(readiness_docs)
    print(f"Inserted {len(readiness_docs)} demo daily readiness check-ins.")


if __name__ == "__main__":
    asyncio.run(main())
