"""One-off seed: rich demo feed for The Fittest (photos, reactions, comments)."""
import asyncio
import io
import uuid
import random
import urllib.request
from datetime import datetime, timedelta

from dotenv import load_dotenv
load_dotenv()
import os
from motor.motor_asyncio import AsyncIOMotorClient

from recovery_storage import make_lowres, make_thumbnail, put_object
from the_fittest_routes import _watermark_sync

APP_NAME = "brazil-lacrosse-recovery"

IMAGES = {
    "lift1": "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "lift2": "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "lift3": "https://images.unsplash.com/photo-1722925541142-5db2668ca492?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "lift4": "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "lax1": "https://images.unsplash.com/photo-1788371587320-24a1aacf0b84?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "lax2": "https://images.unsplash.com/photo-1758646119420-12488edce72c?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "lax3": "https://images.unsplash.com/photo-1788371915478-10bdeb45147f?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "rec1": "https://images.unsplash.com/photo-1562771379-eafdca7a02f8?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "rec2": "https://images.unsplash.com/photo-1531403939386-c08a16cd7eef?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
    "run1": "https://images.unsplash.com/photo-1698671823406-035c77ff6fcd?crop=entropy&cs=srgb&fm=jpg&q=85&w=1080",
}

EMOJIS = ["🔥", "💪", "👏", "⚡", "✅", "🏆", "🙌", "🇧🇷", "🥍"]

# (athlete_name, image_key, post_type, caption, points, days_ago)
POSTS = [
    ("Ana Oliveira", "lift3", "training_and_recovery", "Heavy squats done + full recovery 100/100 🙌", 2, 0),
    ("Lucas Silva", "lift1", "training_checkin", "Morning lift done. Feeling strong 💪", 1, 0),
    ("Bruno Ferreira", "lax3", "training_checkin", "Field session with the boys 🥍", 1, 0),
    ("Camila Lima", "rec1", "recovery", "Mobility + stretching. Recovery on point ✅", 1, 1),
    ("Diego Almeida", "run1", "training_checkin", "Sprint intervals on the track 🏃", 1, 1),
    ("Julia Pereira", "lax2", "training_and_recovery", "Stick work + ice bath 100/100 ❄️", 2, 1),
    ("Rafael Oliveira", "lift2", "training_checkin", "Deadlift PR today! 🔥", 1, 2),
    ("Maria Souza", "rec2", "recovery", "Yoga flow to close the day 🧘", 1, 2),
    ("Gabriel Costa", "lift4", "training_checkin", "Arms day. No days off.", 1, 2),
    ("Fernanda Silva", "lax1", "training_checkin", "Game day prep 🟡", 1, 3),
    ("Thiago Martins", "run1", "training_and_recovery", "Conditioning + recovery complete 💯", 2, 3),
    ("Larissa Costa", "rec1", "recovery", "Foam rolling + sleep focus 😴", 1, 3),
]

COMMENTS = [
    "Let's go! 🔥", "Beast mode 💪", "Inspiring!", "Vamos time! 🇧🇷", "That's the way 👏",
    "Recovery king 👑", "Strong work!", "Respect 🙌", "Keep climbing!", "Top demais!",
]


async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]

    ch = await db.the_fittest_challenges.find_one({"status": "active"}, {"_id": 0})
    if not ch:
        print("No active challenge; aborting")
        return
    cid = ch["id"]

    athletes = await db.athletes.find({}, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(100)
    by_name = {a["name"]: a for a in athletes}

    # clear existing demo feed for a clean seed
    for col in ["the_fittest_posts", "the_fittest_points", "the_fittest_reactions",
                "the_fittest_comments", "the_fittest_files"]:
        await db[col].delete_many({"challenge_id": cid} if col in ("the_fittest_posts", "the_fittest_points") else {})

    # download + process images once
    processed = {}
    for key, url in IMAGES.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            raw = urllib.request.urlopen(req, timeout=30).read()
            low = await make_lowres(raw)
            low = _watermark_sync(low, "AMS Brasil Lacrosse")
            thumb = await make_thumbnail(low) or low
            processed[key] = (low, thumb)
            print("processed", key, len(low), "bytes")
        except Exception as e:
            print("FAILED image", key, e)

    now = datetime.now()
    for (name, imgkey, ptype, caption, points, days_ago) in POSTS:
        a = by_name.get(name)
        if not a or imgkey not in processed:
            print("skip", name, imgkey)
            continue
        low, thumb = processed[imgkey]
        file_id = str(uuid.uuid4())
        base = f"{APP_NAME}/fittest/{a['id']}/{file_id}"
        full = await put_object(f"{base}.jpg", low, "image/jpeg")
        th = await put_object(f"{base}_thumb.jpg", thumb, "image/jpeg")
        await db.the_fittest_files.insert_one({
            "id": file_id, "athlete_id": a["id"],
            "storage_path": full.get("path", f"{base}.jpg"),
            "thumb_path": th.get("path", f"{base}_thumb.jpg"),
            "content_type": "image/jpeg", "is_deleted": False,
            "created_at": now.isoformat(),
        })
        post_dt = now - timedelta(days=days_ago, hours=random.randint(0, 8), minutes=random.randint(0, 59))
        date_str = post_dt.strftime("%Y-%m-%d")
        post_id = str(uuid.uuid4())
        await db.the_fittest_posts.insert_one({
            "id": post_id, "challenge_id": cid, "event_id": ch.get("event_id"),
            "athlete_id": a["id"], "athlete_name": a["name"], "team": a["team"],
            "post_type": ptype, "caption": caption, "photo_id": file_id,
            "linked_training_session_id": None,
            "points_awarded": points, "is_valid_for_points": points > 0,
            "status": "active", "posted_at": date_str, "posted_at_ts": post_dt.isoformat(),
            "created_at": post_dt.isoformat(),
        })
        # points records
        if ptype in ("training_checkin", "training_and_recovery"):
            await db.the_fittest_points.insert_one({
                "id": str(uuid.uuid4()), "challenge_id": cid, "athlete_id": a["id"],
                "post_id": post_id, "source_type": "training_checkin", "source_id": None,
                "date": date_str, "points": 1, "reason": "Training check-in with photo",
                "awarded_at": post_dt.isoformat(), "revoked": False})
        if ptype in ("recovery", "training_and_recovery"):
            await db.the_fittest_points.insert_one({
                "id": str(uuid.uuid4()), "challenge_id": cid, "athlete_id": a["id"],
                "post_id": post_id, "source_type": "complete_recovery", "source_id": date_str,
                "date": date_str, "points": 1, "reason": "Complete recovery (100/100) with photo",
                "awarded_at": post_dt.isoformat(), "revoked": False})

        # reactions from other athletes
        others = [x for x in athletes if x["id"] != a["id"]]
        for reactor in random.sample(others, k=random.randint(3, 7)):
            await db.the_fittest_reactions.insert_one({
                "id": str(uuid.uuid4()), "post_id": post_id, "athlete_id": reactor["id"],
                "emoji": random.choice(EMOJIS), "created_at": post_dt.isoformat()})
        # comments from other athletes
        for commenter in random.sample(others, k=random.randint(1, 3)):
            await db.the_fittest_comments.insert_one({
                "id": str(uuid.uuid4()), "post_id": post_id, "athlete_id": commenter["id"],
                "athlete_name": commenter["name"], "team": commenter["team"],
                "body": random.choice(COMMENTS), "status": "active",
                "created_at": (post_dt + timedelta(minutes=random.randint(5, 300))).isoformat()})
        print("seeded post", name, ptype, points, "pts")

    total_posts = await db.the_fittest_posts.count_documents({"challenge_id": cid})
    total_react = await db.the_fittest_reactions.count_documents({})
    total_comm = await db.the_fittest_comments.count_documents({})
    print(f"DONE: {total_posts} posts, {total_react} reactions, {total_comm} comments")


if __name__ == "__main__":
    asyncio.run(main())
