"""The Fittest — internal social + consistency challenge feature.

Athletes publish photo posts linked to training check-ins and complete (100/100)
recovery to earn points during Admin-created challenges. Overall leaderboard unites
both teams. Reactions + comments included. Admin manages challenges and moderation.

Strict rules:
- No photo -> cannot publish.
- No published post -> no points.
- Recovery only scores when the day's recovery points >= required (default 100).
- Training check-in scores only if the athlete has a training session that day.
- No duplicate points for the same (challenge, athlete, day, source).
- Only Admin creates/manages challenges.
"""
import os
import io
import csv
import uuid
import logging
from datetime import datetime, timedelta
from typing import Optional, List

import jwt
from fastapi import HTTPException, Depends, UploadFile, File, Form, Header, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from zoneinfo import ZoneInfo

from app_time import local_now, today_str

_DEFAULT_TZ = ZoneInfo("America/New_York")


def _resolve_tz(tz_name: Optional[str]):
    """Resolve an IANA timezone name (from the athlete's device) safely."""
    if not tz_name:
        return _DEFAULT_TZ
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return _DEFAULT_TZ


def _today_in_tz(tzinfo) -> str:
    return datetime.now(tzinfo).strftime("%Y-%m-%d")


def _local_date_of(dt_str: Optional[str], tzinfo) -> Optional[str]:
    """Calendar date (YYYY-MM-DD) of an ISO timestamp in the given timezone.
    Aware timestamps are converted to the tz; naive strings are treated as
    already-local wall-clock time."""
    if not dt_str:
        return None
    s = str(dt_str).strip().replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except Exception:
        return str(dt_str)[:10]
    if d.tzinfo is None:
        return d.strftime("%Y-%m-%d")
    return d.astimezone(tzinfo).strftime("%Y-%m-%d")
from recovery_storage import (
    put_object as _put_object,
    get_object as _get_object,
    make_lowres as _make_lowres,
    make_thumbnail as _make_thumbnail,
)
try:
    from push_routes import send_push_to_subscription as _send_push
except Exception:  # pragma: no cover
    _send_push = None

logger = logging.getLogger(__name__)

JWT_SECRET = os.environ.get('JWT_SECRET', 'brazil-lacrosse-secret-2024')
JWT_ALGORITHM = "HS256"
APP_NAME = "brazil-lacrosse-recovery"

MAX_PHOTO_BYTES = 15 * 1024 * 1024
ALLOWED_EXT = {"jpg", "jpeg", "png", "webp", "heic", "heif"}
POST_TYPES = {"training_checkin", "recovery", "training_and_recovery", "admin_announcement"}
EMOJIS = ["🔥", "💪", "👏", "⚡", "✅", "🏆", "🙌", "🇧🇷", "🥍", "❗"]


# ---------------- Pydantic models ----------------
class ChallengeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = ""
    event_id: Optional[str] = None
    event_name: Optional[str] = None
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    included_teams: List[str] = []       # empty = all teams
    included_athlete_ids: List[str] = []  # empty = all athletes in included teams
    points_per_training_checkin: int = 1
    points_per_complete_recovery: int = 1
    recovery_required_points: int = 100
    max_training_points_per_day: int = 1
    max_recovery_points_per_day: int = 1
    allow_comments: bool = True
    allow_reactions: bool = True
    require_photo: bool = True
    opening_message: Optional[str] = ""
    final_message: Optional[str] = ""
    tie_breaker_rule: str = "training_checkins"  # training_checkins | recoveries | consistency
    status: str = "active"  # draft | active


class ChallengeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    included_teams: Optional[List[str]] = None
    included_athlete_ids: Optional[List[str]] = None
    points_per_training_checkin: Optional[int] = None
    points_per_complete_recovery: Optional[int] = None
    recovery_required_points: Optional[int] = None
    allow_comments: Optional[bool] = None
    allow_reactions: Optional[bool] = None
    opening_message: Optional[str] = None
    final_message: Optional[str] = None
    tie_breaker_rule: Optional[str] = None
    status: Optional[str] = None


class PostCreate(BaseModel):
    challenge_id: str
    post_type: str
    caption: Optional[str] = ""
    photo_id: str
    linked_training_session_id: Optional[str] = None
    tz: Optional[str] = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=500)


class ReactionCreate(BaseModel):
    emoji: str


class ReportCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
    details: Optional[str] = ""


class ModerateAction(BaseModel):
    action: str  # hide | remove | restore | invalidate
    reason: Optional[str] = ""


class PointAdjust(BaseModel):
    challenge_id: str
    athlete_id: str
    points: int  # may be negative
    reason: str = Field(min_length=1, max_length=300)


class FittestSettings(BaseModel):
    is_enabled: Optional[bool] = None
    require_photo_to_publish: Optional[bool] = None
    badge_count_type: Optional[str] = None  # new | today
    allow_gallery_upload: Optional[bool] = None
    allow_camera_upload: Optional[bool] = None
    watermark_enabled: Optional[bool] = None


def _watermark_sync(jpeg_bytes: bytes, text: str) -> bytes:
    """Draw a discreet bottom-right text watermark onto a JPEG. Best-effort."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        w, h = img.size
        draw = ImageDraw.Draw(img, "RGBA")
        size = max(14, int(w * 0.032))
        font = None
        for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            try:
                font = ImageFont.truetype(path, size)
                break
            except Exception:
                continue
        if font is None:
            font = ImageFont.load_default()
        try:
            bbox = draw.textbbox((0, 0), text, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        except Exception:
            tw, th = draw.textsize(text, font=font)
        pad = max(8, int(w * 0.015))
        x, y = w - tw - pad, h - th - pad - max(4, int(size * 0.3))
        draw.text((x + 1, y + 1), text, font=font, fill=(0, 0, 0, 120))
        draw.text((x, y), text, font=font, fill=(255, 255, 255, 190))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=82, optimize=True)
        return out.getvalue()
    except Exception:
        logger.exception("Watermark failed; using original")
        return jpeg_bytes


def register_the_fittest_routes(api_router, db, get_current_user):

    # ---------------- Auth helpers ----------------
    def _require_admin(current_user):
        if current_user['user_type'] != 'staff' or current_user['user'].get('role') != 'Admin':
            raise HTTPException(status_code=403, detail="Admin only")

    def _require_athlete(current_user):
        if current_user['user_type'] != 'athlete':
            raise HTTPException(status_code=403, detail="Athletes only")

    def _actor(current_user):
        u = current_user['user']
        is_staff = current_user['user_type'] == 'staff'
        name = u.get('name') or ('Staff' if is_staff else 'Athlete')
        return u.get('id'), name, u.get('team'), is_staff

    # ---------------- Settings ----------------
    DEFAULT_SETTINGS = {
        "id": "global", "is_enabled": True, "require_photo_to_publish": True,
        "badge_count_type": "new", "allow_gallery_upload": True,
        "allow_camera_upload": True, "watermark_enabled": True,
    }

    async def _get_settings():
        s = await db.the_fittest_settings.find_one({"id": "global"}, {"_id": 0})
        if not s:
            await db.the_fittest_settings.insert_one(dict(DEFAULT_SETTINGS))
            return dict(DEFAULT_SETTINGS)
        return {**DEFAULT_SETTINGS, **s}

    # ---------------- Push ----------------
    async def _notify_athletes(athlete_ids, payload: dict, kind: str, dedupe_key: Optional[str] = None):
        if not _send_push or not athlete_ids:
            return
        try:
            subs = await db.push_subscriptions.find(
                {"athlete_id": {"$in": list(athlete_ids)}, "enabled": True}, {"_id": 0}
            ).to_list(length=None)
            for sub in subs:
                if dedupe_key:
                    already = await db.push_send_log.find_one(
                        {"athlete_id": sub["athlete_id"], "kind": kind, "date": dedupe_key})
                    if already:
                        continue
                status = await _send_push(sub, payload)
                if status == "ok" and dedupe_key:
                    await db.push_send_log.insert_one({
                        "id": str(uuid.uuid4()), "athlete_id": sub["athlete_id"],
                        "kind": kind, "date": dedupe_key, "sent_at": local_now().isoformat()})
                elif status == "gone":
                    await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
        except Exception:
            logger.exception("Fittest push notify failed")

    # ---------------- Data helpers ----------------
    async def _recovery_target():
        s = await db.recovery_settings.find_one({"id": "global"}, {"_id": 0, "daily_target": 1})
        return int(s["daily_target"]) if s and s.get("daily_target") else 100

    async def _recovery_day_points(athlete_id: str, date_str: str, tzinfo=_DEFAULT_TZ) -> int:
        logs = await db.recovery_logs.find(
            {"athlete_id": athlete_id, "status": "approved"},
            {"_id": 0, "points": 1, "created_at": 1, "date": 1},
        ).sort("created_at", -1).to_list(300)
        total = 0
        for lg in logs:
            if _local_date_of(lg.get("created_at") or lg.get("date"), tzinfo) == date_str:
                total += int(lg.get("points", 0))
        return total

    async def _training_session_that_day(athlete_id: str, date_str: str, tzinfo=_DEFAULT_TZ):
        sessions = await db.training_sessions.find(
            {"athlete_id": athlete_id},
            {"_id": 0, "id": 1, "date_time_start": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(80)
        for s in sessions:
            if _local_date_of(s.get("date_time_start") or s.get("created_at"), tzinfo) == date_str:
                return s
        return None

    async def _has_recovery_log_today(athlete_id: str, date_str: str, tzinfo=_DEFAULT_TZ) -> bool:
        logs = await db.recovery_logs.find(
            {"athlete_id": athlete_id},
            {"_id": 0, "created_at": 1, "date": 1},
        ).sort("created_at", -1).to_list(300)
        for lg in logs:
            if _local_date_of(lg.get("created_at") or lg.get("date"), tzinfo) == date_str:
                return True
        return False

    def _athlete_included(ch: dict, athlete: dict) -> bool:
        ids = ch.get("included_athlete_ids") or []
        if ids:
            return athlete.get("id") in ids
        teams = ch.get("included_teams") or []
        if teams:
            return athlete.get("team") in teams
        return True

    async def _athlete_ids_for_challenge(ch: dict) -> List[str]:
        ids = ch.get("included_athlete_ids") or []
        if ids:
            return ids
        q = {}
        teams = ch.get("included_teams") or []
        if teams:
            q["team"] = {"$in": teams}
        athletes = await db.athletes.find(q, {"_id": 0, "id": 1}).to_list(length=None)
        return [a["id"] for a in athletes]

    async def _active_challenge_for_athlete(athlete: dict):
        settings = await _get_settings()
        if not settings.get("is_enabled", True):
            return None
        today = today_str()
        chs = await db.the_fittest_challenges.find(
            {"status": "active"}, {"_id": 0}
        ).sort("start_date", -1).to_list(length=None)
        for ch in chs:
            if ch["start_date"] <= today <= ch["end_date"] and _athlete_included(ch, athlete):
                return ch
        return None

    async def _reactions_summary(post_id: str, viewer_id: Optional[str]):
        reactions = await db.the_fittest_reactions.find(
            {"post_id": post_id}, {"_id": 0, "emoji": 1, "athlete_id": 1}
        ).to_list(length=None)
        counts = {}
        mine = None
        for r in reactions:
            counts[r["emoji"]] = counts.get(r["emoji"], 0) + 1
            if viewer_id and r["athlete_id"] == viewer_id:
                mine = r["emoji"]
        return counts, mine, len(reactions)

    async def _serialize_post(post: dict, viewer_id: Optional[str], is_staff: bool):
        counts, mine, total_reactions = await _reactions_summary(post["id"], viewer_id)
        comment_count = await db.the_fittest_comments.count_documents(
            {"post_id": post["id"], "status": "active"}
        )
        return {
            "id": post["id"],
            "challenge_id": post.get("challenge_id"),
            "athlete_id": post.get("athlete_id"),
            "athlete_name": post.get("athlete_name"),
            "team": post.get("team"),
            "post_type": post.get("post_type"),
            "caption": post.get("caption", ""),
            "photo_id": post.get("photo_id"),
            "points_awarded": post.get("points_awarded", 0),
            "is_valid_for_points": post.get("is_valid_for_points", False),
            "status": post.get("status"),
            "posted_at": post.get("posted_at"),
            "reactions": counts,
            "reactions_total": total_reactions,
            "my_reaction": mine,
            "comment_count": comment_count,
            "is_mine": viewer_id is not None and post.get("athlete_id") == viewer_id,
            "can_moderate": is_staff,
        }

    async def _award_points(ch: dict, post: dict, athlete_id: str, date_str: str, tzinfo=_DEFAULT_TZ):
        """Compute & persist points for a post. Returns (total_points, messages)."""
        messages = []
        total = 0
        ptype = post["post_type"]
        cid = ch["id"]

        wants_training = ptype in ("training_checkin", "training_and_recovery")
        wants_recovery = ptype in ("recovery", "training_and_recovery")

        # Challenge active + date within range
        in_range = ch["start_date"] <= date_str <= ch["end_date"]
        if ch["status"] != "active" or not in_range:
            messages.append("Post is outside the challenge period — no points awarded.")
            return 0, messages

        if wants_training:
            already = await db.the_fittest_points.find_one({
                "challenge_id": cid, "athlete_id": athlete_id, "date": date_str,
                "source_type": "training_checkin", "revoked": {"$ne": True},
            })
            if already:
                messages.append("This training check-in has already been counted for The Fittest.")
            else:
                sess = await _training_session_that_day(athlete_id, date_str, tzinfo)
                if not sess:
                    messages.append("No training session logged today — training point not awarded.")
                else:
                    pts = int(ch.get("points_per_training_checkin", 1))
                    await db.the_fittest_points.insert_one({
                        "id": str(uuid.uuid4()), "challenge_id": cid, "athlete_id": athlete_id,
                        "post_id": post["id"], "source_type": "training_checkin",
                        "source_id": sess.get("id"), "date": date_str, "points": pts,
                        "reason": "Training check-in with photo",
                        "awarded_at": local_now().isoformat(), "revoked": False,
                    })
                    total += pts
                    messages.append(f"+{pts} training point!")

        if wants_recovery:
            already = await db.the_fittest_points.find_one({
                "challenge_id": cid, "athlete_id": athlete_id, "date": date_str,
                "source_type": "complete_recovery", "revoked": {"$ne": True},
            })
            if already:
                messages.append("Your complete recovery has already been counted today.")
            else:
                required = int(ch.get("recovery_required_points", 100))
                day_pts = await _recovery_day_points(athlete_id, date_str, tzinfo)
                if day_pts < required:
                    messages.append(f"Recovery {day_pts}/{required} — complete recovery not reached, no recovery point.")
                else:
                    pts = int(ch.get("points_per_complete_recovery", 1))
                    await db.the_fittest_points.insert_one({
                        "id": str(uuid.uuid4()), "challenge_id": cid, "athlete_id": athlete_id,
                        "post_id": post["id"], "source_type": "complete_recovery",
                        "source_id": date_str, "date": date_str, "points": pts,
                        "reason": "Complete recovery (100/100) with photo",
                        "awarded_at": local_now().isoformat(), "revoked": False,
                    })
                    total += pts
                    messages.append(f"+{pts} recovery point!")

        return total, messages

    async def _revoke_post_points(post_id: str, admin_id: Optional[str], reason: str):
        await db.the_fittest_points.update_many(
            {"post_id": post_id, "revoked": {"$ne": True}},
            {"$set": {"revoked": True, "revoked_at": local_now().isoformat(),
                      "revoked_by_admin_id": admin_id, "revoke_reason": reason}},
        )
        await db.the_fittest_posts.update_one(
            {"id": post_id}, {"$set": {"points_awarded": 0, "is_valid_for_points": False}}
        )

    async def _athlete_summary(cid: str, athlete_id: str):
        pts = await db.the_fittest_points.find(
            {"challenge_id": cid, "athlete_id": athlete_id, "revoked": {"$ne": True}},
            {"_id": 0, "points": 1, "source_type": 1},
        ).to_list(length=None)
        total = sum(int(p["points"]) for p in pts)
        training = sum(1 for p in pts if p["source_type"] == "training_checkin")
        recovery = sum(1 for p in pts if p["source_type"] == "complete_recovery")
        return total, training, recovery

    async def _leaderboard(ch: dict, viewer_id: Optional[str] = None):
        cid = ch["id"]
        athlete_ids = await _athlete_ids_for_challenge(ch)
        athletes = await db.athletes.find(
            {"id": {"$in": athlete_ids}}, {"_id": 0, "id": 1, "name": 1, "team": 1, "profile_photo": 1}
        ).to_list(length=None)
        # aggregate points per athlete
        pipeline = [
            {"$match": {"challenge_id": cid, "revoked": {"$ne": True}}},
            {"$group": {
                "_id": "$athlete_id",
                "points": {"$sum": "$points"},
                "training": {"$sum": {"$cond": [{"$eq": ["$source_type", "training_checkin"]}, 1, 0]}},
                "recovery": {"$sum": {"$cond": [{"$eq": ["$source_type", "complete_recovery"]}, 1, 0]}},
                "last_activity": {"$max": "$awarded_at"},
            }},
        ]
        agg = {row["_id"]: row async for row in db.the_fittest_points.aggregate(pipeline)}
        rows = []
        for a in athletes:
            r = agg.get(a["id"], {})
            rows.append({
                "athlete_id": a["id"],
                "name": a.get("name"),
                "team": a.get("team"),
                "profile_photo": a.get("profile_photo"),
                "points": int(r.get("points", 0)),
                "training_checkins": int(r.get("training", 0)),
                "recoveries": int(r.get("recovery", 0)),
                "last_activity": r.get("last_activity"),
            })

        tie = ch.get("tie_breaker_rule", "training_checkins")

        def sort_key(x):
            secondary = x["training_checkins"] if tie != "recoveries" else x["recoveries"]
            tertiary = x["recoveries"] if tie != "recoveries" else x["training_checkins"]
            return (-x["points"], -secondary, -tertiary, x["last_activity"] or "9999")

        rows.sort(key=sort_key)
        for i, r in enumerate(rows):
            r["rank"] = i + 1
        return rows

    # ================= ATHLETE / SHARED ENDPOINTS =================
    @api_router.get("/fittest/active-challenge")
    async def get_active_challenge(current_user: dict = Depends(get_current_user)):
        is_staff = current_user['user_type'] == 'staff'
        if is_staff:
            ch = await db.the_fittest_challenges.find_one(
                {"status": "active"}, {"_id": 0}, sort=[("start_date", -1)]
            )
            if not ch:
                return {"challenge": None}
            board = await _leaderboard(ch)
            return {"challenge": ch, "my": None, "leaderboard_preview": board[:3], "is_staff": True}

        athlete = current_user['user']
        ch = await _active_challenge_for_athlete(athlete)
        if not ch:
            return {"challenge": None}
        total, training, recovery = await _athlete_summary(ch["id"], athlete["id"])
        board = await _leaderboard(ch, athlete["id"])
        my_rank = next((r["rank"] for r in board if r["athlete_id"] == athlete["id"]), None)
        points_to_next = None
        next_name = None
        if my_rank and my_rank > 1:
            ahead = board[my_rank - 2]
            points_to_next = max(0, ahead["points"] - total)
            next_name = ahead["name"]
        today = today_str()
        days_left = (datetime.strptime(ch["end_date"], "%Y-%m-%d") - datetime.strptime(today, "%Y-%m-%d")).days
        return {
            "challenge": ch,
            "my": {
                "points": total, "training_checkins": training, "recoveries": recovery,
                "rank": my_rank, "points_to_next": points_to_next, "next_name": next_name,
            },
            "days_left": max(0, days_left),
            "leaderboard_preview": board[:3],
            "total_participants": len(board),
            "is_staff": False,
        }

    @api_router.get("/fittest/my-trainings-today")
    async def my_trainings_today(tz: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        _require_athlete(current_user)
        athlete = current_user['user']
        tzinfo = _resolve_tz(tz)
        date_str = _today_in_tz(tzinfo)
        ch = await _active_challenge_for_athlete(athlete)
        recent = await db.training_sessions.find(
            {"athlete_id": athlete["id"]}, {"_id": 0}
        ).sort("created_at", -1).to_list(80)
        sessions = [s for s in recent
                    if _local_date_of(s.get("date_time_start") or s.get("created_at"), tzinfo) == date_str]
        sessions.sort(key=lambda s: s.get("date_time_start") or "")
        posted_ids = set()
        if ch:
            posts = await db.the_fittest_posts.find(
                {"challenge_id": ch["id"], "athlete_id": athlete["id"],
                 "linked_training_session_id": {"$ne": None}, "status": {"$in": ["active", "hidden"]}},
                {"_id": 0, "linked_training_session_id": 1}
            ).to_list(100)
            posted_ids = {p["linked_training_session_id"] for p in posts}
        def _local_time(dt_str):
            if not dt_str:
                return ""
            s = str(dt_str).strip().replace("Z", "+00:00")
            try:
                d = datetime.fromisoformat(s)
            except Exception:
                return str(dt_str)[11:16]
            if d.tzinfo is not None:
                d = d.astimezone(tzinfo)
            return d.strftime("%H:%M")
        out = []
        for s in sessions:
            out.append({
                "id": s.get("id"),
                "session_type": s.get("session_type") or s.get("type") or "Training",
                "time": _local_time(s.get("date_time_start")),
                "duration_min": s.get("duration_min") or s.get("duration"),
                "rpe": s.get("rpe"),
                "internal_load": s.get("internal_load"),
                "posted": s.get("id") in posted_ids,
            })
        return {"trainings": out}

    @api_router.get("/fittest/eligibility")
    async def get_eligibility(tz: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        _require_athlete(current_user)
        athlete = current_user['user']
        tzinfo = _resolve_tz(tz)
        ch = await _active_challenge_for_athlete(athlete)
        today = _today_in_tz(tzinfo)
        target = await _recovery_target()
        recovery_pts = await _recovery_day_points(athlete["id"], today, tzinfo)
        has_training = await _training_session_that_day(athlete["id"], today, tzinfo) is not None
        has_recovery = await _has_recovery_log_today(athlete["id"], today, tzinfo)
        already_training = already_recovery = False
        if ch:
            already_training = await db.the_fittest_points.find_one({
                "challenge_id": ch["id"], "athlete_id": athlete["id"], "date": today,
                "source_type": "training_checkin", "revoked": {"$ne": True}}) is not None
            already_recovery = await db.the_fittest_points.find_one({
                "challenge_id": ch["id"], "athlete_id": athlete["id"], "date": today,
                "source_type": "complete_recovery", "revoked": {"$ne": True}}) is not None
        return {
            "has_active_challenge": ch is not None,
            "has_training_today": has_training,
            "has_recovery_today": has_recovery,
            "recovery_points_today": recovery_pts,
            "recovery_target": target,
            "recovery_complete": recovery_pts >= target,
            "already_earned_training_today": already_training,
            "already_earned_recovery_today": already_recovery,
        }

    @api_router.get("/fittest/feed")
    async def get_feed(
        challenge_id: Optional[str] = None,
        filter: str = "all",
        current_user: dict = Depends(get_current_user),
    ):
        is_staff = current_user['user_type'] == 'staff'
        viewer_id = current_user['user']['id']
        athlete = None if is_staff else current_user['user']

        if not challenge_id:
            if is_staff:
                ch = await db.the_fittest_challenges.find_one({"status": "active"}, {"_id": 0}, sort=[("start_date", -1)])
            else:
                ch = await _active_challenge_for_athlete(athlete)
            if not ch:
                return {"posts": [], "challenge": None}
            challenge_id = ch["id"]

        q = {"challenge_id": challenge_id, "status": "active"}
        if filter == "training":
            q["post_type"] = {"$in": ["training_checkin", "training_and_recovery"]}
        elif filter == "recovery":
            q["post_type"] = {"$in": ["recovery", "training_and_recovery"]}
        elif filter == "my_team" and athlete:
            q["team"] = athlete.get("team")
        elif filter == "today":
            q["posted_at"] = {"$gte": today_str()}

        posts = await db.the_fittest_posts.find(q, {"_id": 0}).sort("posted_at_ts", -1).to_list(200)
        if filter == "top":
            posts.sort(key=lambda p: p.get("points_awarded", 0), reverse=True)
        serialized = [await _serialize_post(p, viewer_id, is_staff) for p in posts]
        return {"posts": serialized, "challenge_id": challenge_id}

    @api_router.post("/fittest/photo")
    async def upload_fittest_photo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
        _require_athlete(current_user)
        athlete_id = current_user['user']['id']
        ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "").lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(status_code=400, detail="Unsupported image type. Use JPG, PNG, WEBP or HEIC.")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=400, detail="Image too large (max 15MB)")
        lowres = await _make_lowres(data)
        if not lowres:
            raise HTTPException(status_code=422, detail="Could not process image. Please use a larger photo (min 128px).")
        settings = await _get_settings()
        if settings.get("watermark_enabled", True):
            import asyncio as _asyncio
            lowres = await _asyncio.to_thread(_watermark_sync, lowres, "AMS Brasil Lacrosse")
        thumb = await _make_thumbnail(lowres) or lowres
        file_id = str(uuid.uuid4())
        base = f"{APP_NAME}/fittest/{athlete_id}/{file_id}"
        try:
            full = await _put_object(f"{base}.jpg", lowres, "image/jpeg")
            th = await _put_object(f"{base}_thumb.jpg", thumb, "image/jpeg")
        except Exception:
            logger.exception("Fittest photo upload failed")
            raise HTTPException(status_code=502, detail="Failed to upload photo. Please try again.")
        await db.the_fittest_files.insert_one({
            "id": file_id, "athlete_id": athlete_id,
            "storage_path": full.get("path", f"{base}.jpg"),
            "thumb_path": th.get("path", f"{base}_thumb.jpg"),
            "content_type": "image/jpeg", "is_deleted": False,
            "created_at": local_now().isoformat(),
        })
        return {"photo_id": file_id, "url": f"/api/fittest/photo/{file_id}"}

    @api_router.get("/fittest/photo/{file_id}")
    async def serve_fittest_photo(file_id: str, thumb: int = 0, authorization: str = Header(None), auth: str = Query(None)):
        token = None
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ", 1)[1]
        elif auth:
            token = auth
        if not token:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
        record = await db.the_fittest_files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
        if not record:
            raise HTTPException(status_code=404, detail="Photo not found")
        path = record.get("thumb_path") if thumb else record.get("storage_path")
        try:
            data, ctype = await _get_object(path or record["storage_path"])
        except Exception:
            raise HTTPException(status_code=404, detail="Photo unavailable")
        return Response(content=data, media_type=record.get("content_type", "image/jpeg"),
                        headers={"Cache-Control": "private, max-age=86400", "ETag": f'"{file_id}{thumb}"'})

    @api_router.post("/fittest/posts")
    async def create_post(data: PostCreate, current_user: dict = Depends(get_current_user)):
        _require_athlete(current_user)
        athlete = current_user['user']
        if data.post_type not in POST_TYPES or data.post_type == "admin_announcement":
            raise HTTPException(status_code=400, detail="Invalid post type")
        if not data.photo_id:
            raise HTTPException(status_code=400, detail="A photo is required to publish on The Fittest.")
        photo = await db.the_fittest_files.find_one({"id": data.photo_id, "athlete_id": athlete["id"], "is_deleted": False})
        if not photo:
            raise HTTPException(status_code=400, detail="Photo not found. Please re-upload.")
        ch = await db.the_fittest_challenges.find_one({"id": data.challenge_id}, {"_id": 0})
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found")
        if not _athlete_included(ch, athlete):
            raise HTTPException(status_code=403, detail="You are not part of this challenge")

        now = local_now()
        tzinfo = _resolve_tz(data.tz)
        date_str = _today_in_tz(tzinfo)
        # Gate: must have logged the corresponding activity today before posting
        wants_training = data.post_type in ("training_checkin", "training_and_recovery")
        wants_recovery = data.post_type in ("recovery", "training_and_recovery")
        if wants_training:
            sid = data.linked_training_session_id
            if not sid:
                raise HTTPException(status_code=400, detail="Select which training session to post.")
            sess = await db.training_sessions.find_one(
                {"id": sid, "athlete_id": athlete["id"]}, {"_id": 0, "id": 1, "date_time_start": 1, "created_at": 1})
            if not sess or _local_date_of(sess.get("date_time_start") or sess.get("created_at"), tzinfo) != date_str:
                raise HTTPException(status_code=400, detail="That training session was not found for today.")
            already_posted = await db.the_fittest_posts.find_one(
                {"challenge_id": ch["id"], "athlete_id": athlete["id"],
                 "linked_training_session_id": sid, "status": {"$in": ["active", "hidden"]}}, {"_id": 0, "id": 1})
            if already_posted:
                raise HTTPException(status_code=400, detail="You already posted this training session.")
        if wants_recovery and not await _has_recovery_log_today(athlete["id"], date_str, tzinfo):
            raise HTTPException(status_code=400, detail="Log your recovery today before posting a recovery.")
        post = {
            "id": str(uuid.uuid4()),
            "challenge_id": ch["id"],
            "event_id": ch.get("event_id"),
            "athlete_id": athlete["id"],
            "athlete_name": athlete.get("name"),
            "team": athlete.get("team"),
            "post_type": data.post_type,
            "caption": (data.caption or "").strip()[:500],
            "photo_id": data.photo_id,
            "linked_training_session_id": data.linked_training_session_id,
            "points_awarded": 0,
            "is_valid_for_points": False,
            "status": "active",
            "posted_at": date_str,
            "posted_at_ts": now.isoformat(),
            "created_at": now.isoformat(),
        }
        await db.the_fittest_posts.insert_one(dict(post))
        points, messages = await _award_points(ch, post, athlete["id"], date_str, tzinfo)
        if points:
            await db.the_fittest_posts.update_one(
                {"id": post["id"]}, {"$set": {"points_awarded": points, "is_valid_for_points": True}}
            )
            post["points_awarded"] = points
            post["is_valid_for_points"] = True
            # Top-3 push (once per challenge per athlete)
            try:
                board = await _leaderboard(ch, athlete["id"])
                my = next((r for r in board if r["athlete_id"] == athlete["id"]), None)
                if my and my["rank"] <= 3:
                    await _notify_athletes(
                        [athlete["id"]],
                        {"title": "You're in the Top 3! 🏆",
                         "body": f"You're #{my['rank']} in {ch['title']} with {my['points']} pts. Keep it up!",
                         "url": "/athlete/the-fittest", "tag": f"tf-top3-{ch['id']}"},
                        kind=f"tf-top3-{ch['id']}", dedupe_key=athlete["id"])
            except Exception:
                logger.exception("top3 push failed")
        serialized = await _serialize_post(post, athlete["id"], False)
        serialized["messages"] = messages
        serialized["points_earned"] = points
        return serialized

    @api_router.delete("/fittest/posts/{post_id}")
    async def delete_post(post_id: str, current_user: dict = Depends(get_current_user)):
        _require_athlete(current_user)
        athlete_id = current_user['user']['id']
        post = await db.the_fittest_posts.find_one({"id": post_id}, {"_id": 0})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        if post["athlete_id"] != athlete_id:
            raise HTTPException(status_code=403, detail="You can only delete your own posts")
        await _revoke_post_points(post_id, None, "author_deleted")
        await db.the_fittest_posts.update_one(
            {"id": post_id}, {"$set": {"status": "removed", "removed_at": local_now().isoformat()}}
        )
        return {"success": True}

    # ---------- Reactions ----------
    @api_router.post("/fittest/posts/{post_id}/reactions")
    async def toggle_reaction(post_id: str, data: ReactionCreate, current_user: dict = Depends(get_current_user)):
        actor_id, actor_name, _team, is_staff = _actor(current_user)
        if data.emoji not in EMOJIS:
            raise HTTPException(status_code=400, detail="Invalid emoji")
        post = await db.the_fittest_posts.find_one({"id": post_id, "status": "active"}, {"_id": 0})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        ch = await db.the_fittest_challenges.find_one({"id": post["challenge_id"]}, {"_id": 0, "allow_reactions": 1})
        if ch and ch.get("allow_reactions") is False:
            raise HTTPException(status_code=403, detail="Reactions are disabled for this challenge")
        existing = await db.the_fittest_reactions.find_one({"post_id": post_id, "athlete_id": actor_id})
        if existing:
            if existing["emoji"] == data.emoji:
                await db.the_fittest_reactions.delete_one({"post_id": post_id, "athlete_id": actor_id})
                action = "removed"
            else:
                await db.the_fittest_reactions.update_one(
                    {"post_id": post_id, "athlete_id": actor_id},
                    {"$set": {"emoji": data.emoji, "created_at": local_now().isoformat()}},
                )
                action = "changed"
        else:
            await db.the_fittest_reactions.insert_one({
                "id": str(uuid.uuid4()), "post_id": post_id, "athlete_id": actor_id,
                "emoji": data.emoji, "is_staff": is_staff, "created_at": local_now().isoformat(),
            })
            action = "added"
        counts, mine, total = await _reactions_summary(post_id, actor_id)
        if action in ("added", "changed") and post.get("athlete_id") and post["athlete_id"] != actor_id:
            who = f"{actor_name} (staff)" if is_staff else actor_name
            await _notify_athletes(
                [post["athlete_id"]],
                {"title": f"{data.emoji} New reaction",
                 "body": f"{who} reacted {data.emoji} to your post",
                 "url": "/athlete/the-fittest", "tag": f"tf-react-{post_id}"},
                kind=f"tf-react-{post_id}-{actor_id}", dedupe_key=today_str())
        return {"action": action, "reactions": counts, "my_reaction": mine, "reactions_total": total}

    # ---------- Comments ----------
    @api_router.get("/fittest/posts/{post_id}/comments")
    async def list_comments(post_id: str, current_user: dict = Depends(get_current_user)):
        actor_id, _n, _t, is_staff = _actor(current_user)
        comments = await db.the_fittest_comments.find(
            {"post_id": post_id, "status": "active"}, {"_id": 0}
        ).sort("created_at", 1).to_list(500)
        for c in comments:
            c["is_mine"] = c.get("athlete_id") == actor_id
            c["can_moderate"] = is_staff
        return {"comments": comments}

    @api_router.post("/fittest/posts/{post_id}/comments")
    async def add_comment(post_id: str, data: CommentCreate, current_user: dict = Depends(get_current_user)):
        actor_id, actor_name, actor_team, is_staff = _actor(current_user)
        post = await db.the_fittest_posts.find_one({"id": post_id, "status": "active"}, {"_id": 0})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        ch = await db.the_fittest_challenges.find_one({"id": post["challenge_id"]}, {"_id": 0, "allow_comments": 1})
        if ch and ch.get("allow_comments") is False:
            raise HTTPException(status_code=403, detail="Comments are disabled for this challenge")
        comment = {
            "id": str(uuid.uuid4()), "post_id": post_id, "athlete_id": actor_id,
            "athlete_name": actor_name, "team": actor_team,
            "from_staff": is_staff,
            "body": data.body.strip()[:500], "status": "active",
            "created_at": local_now().isoformat(),
        }
        await db.the_fittest_comments.insert_one(dict(comment))
        comment["is_mine"] = True
        comment["can_moderate"] = is_staff
        if post.get("athlete_id") and post["athlete_id"] != actor_id:
            who = f"{actor_name} (staff)" if is_staff else actor_name
            await _notify_athletes(
                [post["athlete_id"]],
                {"title": "New comment on your post 💬",
                 "body": f"{who}: {comment['body'][:80]}",
                 "url": "/athlete/the-fittest", "tag": f"tf-comment-{post_id}"},
                kind=f"tf-comment-{comment['id']}")
        return comment

    @api_router.delete("/fittest/comments/{comment_id}")
    async def delete_comment(comment_id: str, current_user: dict = Depends(get_current_user)):
        is_staff = current_user['user_type'] == 'staff'
        c = await db.the_fittest_comments.find_one({"id": comment_id}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Comment not found")
        if not is_staff and c["athlete_id"] != current_user['user']['id']:
            raise HTTPException(status_code=403, detail="Not allowed")
        removed_by = current_user['user']['id'] if is_staff else None
        await db.the_fittest_comments.update_one(
            {"id": comment_id},
            {"$set": {"status": "removed", "removed_at": local_now().isoformat(), "removed_by_admin_id": removed_by}},
        )
        return {"success": True}

    # ---------- Report ----------
    @api_router.post("/fittest/posts/{post_id}/report")
    async def report_post(post_id: str, data: ReportCreate, current_user: dict = Depends(get_current_user)):
        _require_athlete(current_user)
        post = await db.the_fittest_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        await db.the_fittest_reports.insert_one({
            "id": str(uuid.uuid4()), "post_id": post_id,
            "reported_by_athlete_id": current_user['user']['id'],
            "reason": data.reason, "details": data.details or "", "status": "open",
            "created_at": local_now().isoformat(),
        })
        return {"success": True, "message": "Thanks — staff will review this post."}

    # ---------- Leaderboard ----------
    @api_router.get("/fittest/leaderboard")
    async def get_leaderboard(challenge_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        is_staff = current_user['user_type'] == 'staff'
        athlete = None if is_staff else current_user['user']
        if challenge_id:
            ch = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        elif is_staff:
            ch = await db.the_fittest_challenges.find_one({"status": "active"}, {"_id": 0}, sort=[("start_date", -1)])
        else:
            ch = await _active_challenge_for_athlete(athlete)
        if not ch:
            return {"challenge": None, "leaderboard": []}
        board = await _leaderboard(ch, athlete["id"] if athlete else None)
        my_rank = None
        if athlete:
            my_rank = next((r["rank"] for r in board if r["athlete_id"] == athlete["id"]), None)
        return {"challenge": ch, "leaderboard": board, "my_rank": my_rank}

    # ---------- Badge / views ----------
    @api_router.get("/fittest/unread-count")
    async def unread_count(current_user: dict = Depends(get_current_user)):
        if current_user['user_type'] != 'athlete':
            return {"count": 0, "today": 0, "has_active_challenge": False}
        athlete = current_user['user']
        ch = await _active_challenge_for_athlete(athlete)
        if not ch:
            return {"count": 0, "today": 0, "has_active_challenge": False}
        view = await db.the_fittest_post_views.find_one(
            {"athlete_id": athlete["id"], "challenge_id": ch["id"]}, {"_id": 0, "last_viewed_at": 1}
        )
        last = view.get("last_viewed_at") if view else None
        q = {"challenge_id": ch["id"], "status": "active", "athlete_id": {"$ne": athlete["id"]}}
        if last:
            q["posted_at_ts"] = {"$gt": last}
        count = await db.the_fittest_posts.count_documents(q)
        today = await db.the_fittest_posts.count_documents(
            {"challenge_id": ch["id"], "status": "active", "posted_at": today_str()}
        )
        settings = await _get_settings()
        badge = today if settings.get("badge_count_type") == "today" else count
        return {"count": badge, "new": count, "today": today, "has_active_challenge": True}

    @api_router.post("/fittest/mark-viewed")
    async def mark_viewed(current_user: dict = Depends(get_current_user)):
        if current_user['user_type'] != 'athlete':
            return {"success": True}
        athlete = current_user['user']
        ch = await _active_challenge_for_athlete(athlete)
        if not ch:
            return {"success": True}
        await db.the_fittest_post_views.update_one(
            {"athlete_id": athlete["id"], "challenge_id": ch["id"]},
            {"$set": {"last_viewed_at": local_now().isoformat()}}, upsert=True,
        )
        return {"success": True}

    # ================= ADMIN ENDPOINTS =================
    @api_router.get("/fittest/admin/challenges")
    async def admin_list_challenges(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        chs = await db.the_fittest_challenges.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"challenges": chs}

    @api_router.post("/fittest/admin/challenges")
    async def admin_create_challenge(data: ChallengeCreate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        if data.start_date > data.end_date:
            raise HTTPException(status_code=400, detail="Start date must be before end date")
        ch = data.model_dump()
        ch["id"] = str(uuid.uuid4())
        ch["created_by_admin_id"] = current_user['user']['id']
        ch["winner_athlete_id"] = None
        ch["created_at"] = local_now().isoformat()
        ch["updated_at"] = local_now().isoformat()
        ch["archived_at"] = None
        await db.the_fittest_challenges.insert_one(dict(ch))
        if ch.get("status") == "active":
            try:
                ids = await _athlete_ids_for_challenge(ch)
                await _notify_athletes(
                    ids,
                    {"title": "New challenge: The Fittest 🔥",
                     "body": f"{ch['title']} is live! Post a photo of your training or 100/100 recovery to score.",
                     "url": "/athlete/the-fittest", "tag": f"tf-new-{ch['id']}"},
                    kind=f"tf-new-{ch['id']}", dedupe_key="start")
            except Exception:
                logger.exception("new-challenge push failed")
        return ch

    @api_router.put("/fittest/admin/challenges/{challenge_id}")
    async def admin_update_challenge(challenge_id: str, data: ChallengeUpdate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        existing = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Challenge not found")
        updates = {k: v for k, v in data.model_dump().items() if v is not None}
        updates["updated_at"] = local_now().isoformat()
        await db.the_fittest_challenges.update_one({"id": challenge_id}, {"$set": updates})
        ch = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        return ch

    @api_router.post("/fittest/admin/challenges/{challenge_id}/finish")
    async def admin_finish_challenge(challenge_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        ch = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found")
        board = await _leaderboard(ch)
        winner = board[0] if board and board[0]["points"] > 0 else None
        await db.the_fittest_challenges.update_one(
            {"id": challenge_id},
            {"$set": {"status": "finished", "winner_athlete_id": winner["athlete_id"] if winner else None,
                      "updated_at": local_now().isoformat()}},
        )
        try:
            ids = await _athlete_ids_for_challenge(ch)
            body = (f"🏆 {winner['name']} won {ch['title']} with {winner['points']} pts!"
                    if winner else f"{ch['title']} has ended. Thanks for competing!")
            await _notify_athletes(
                ids, {"title": "Challenge finished 🏁", "body": body,
                      "url": "/athlete/the-fittest", "tag": f"tf-winner-{ch['id']}"},
                kind=f"tf-winner-{ch['id']}", dedupe_key="finish")
        except Exception:
            logger.exception("winner push failed")
        return {"success": True, "winner": winner}

    @api_router.post("/fittest/admin/challenges/{challenge_id}/archive")
    async def admin_archive_challenge(challenge_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        await db.the_fittest_challenges.update_one(
            {"id": challenge_id},
            {"$set": {"status": "archived", "archived_at": local_now().isoformat(), "updated_at": local_now().isoformat()}},
        )
        return {"success": True}

    @api_router.get("/fittest/admin/overview")
    async def admin_overview(challenge_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        if challenge_id:
            ch = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        else:
            ch = await db.the_fittest_challenges.find_one({"status": "active"}, {"_id": 0}, sort=[("start_date", -1)])
        if not ch:
            return {"challenge": None}
        cid = ch["id"]
        today = today_str()
        board = await _leaderboard(ch)
        posts_total = await db.the_fittest_posts.count_documents({"challenge_id": cid, "status": "active"})
        posts_today = await db.the_fittest_posts.count_documents({"challenge_id": cid, "status": "active", "posted_at": today})
        training_posts = await db.the_fittest_points.count_documents({"challenge_id": cid, "source_type": "training_checkin", "revoked": {"$ne": True}})
        recovery_posts = await db.the_fittest_points.count_documents({"challenge_id": cid, "source_type": "complete_recovery", "revoked": {"$ne": True}})
        active_today = len(await db.the_fittest_posts.distinct("athlete_id", {"challenge_id": cid, "status": "active", "posted_at": today}))
        reported = await db.the_fittest_reports.count_documents({"status": "open"})
        days_left = (datetime.strptime(ch["end_date"], "%Y-%m-%d") - datetime.strptime(today, "%Y-%m-%d")).days
        return {
            "challenge": ch,
            "days_left": max(0, days_left),
            "posts_total": posts_total,
            "posts_today": posts_today,
            "training_checkins": training_posts,
            "complete_recoveries": recovery_posts,
            "active_today": active_today,
            "total_participants": len(board),
            "reported_open": reported,
            "top10": board[:10],
        }

    @api_router.post("/fittest/admin/posts/{post_id}/moderate")
    async def admin_moderate_post(post_id: str, data: ModerateAction, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        admin_id = current_user['user']['id']
        post = await db.the_fittest_posts.find_one({"id": post_id}, {"_id": 0})
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        if data.action in ("hide", "remove", "invalidate"):
            await _revoke_post_points(post_id, admin_id, data.reason or data.action)
            new_status = "hidden" if data.action == "hide" else ("removed" if data.action == "remove" else post["status"])
            await db.the_fittest_posts.update_one(
                {"id": post_id},
                {"$set": {"status": new_status, "removed_at": local_now().isoformat(),
                          "removed_by_admin_id": admin_id, "removal_reason": data.reason or ""}},
            )
        elif data.action == "restore":
            await db.the_fittest_posts.update_one({"id": post_id}, {"$set": {"status": "active"}})
            ch = await db.the_fittest_challenges.find_one({"id": post["challenge_id"]}, {"_id": 0})
            if ch:
                points, _ = await _award_points(ch, post, post["athlete_id"], post.get("posted_at", today_str()))
                if points:
                    await db.the_fittest_posts.update_one(
                        {"id": post_id}, {"$set": {"points_awarded": points, "is_valid_for_points": True}}
                    )
        else:
            raise HTTPException(status_code=400, detail="Invalid action")
        # resolve any open reports for this post
        await db.the_fittest_reports.update_many(
            {"post_id": post_id, "status": "open"},
            {"$set": {"status": "reviewed", "reviewed_by_admin_id": admin_id, "reviewed_at": local_now().isoformat()}},
        )
        return {"success": True}

    @api_router.get("/fittest/admin/reported")
    async def admin_reported(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        reports = await db.the_fittest_reports.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(200)
        out = []
        for r in reports:
            post = await db.the_fittest_posts.find_one({"id": r["post_id"]}, {"_id": 0})
            if post:
                out.append({"report": r, "post": await _serialize_post(post, None, True)})
        return {"reports": out}

    @api_router.get("/fittest/admin/events")
    async def admin_events(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        events = await db.events.find({}, {"_id": 0, "id": 1, "name": 1, "team": 1}).sort("start_date", -1).to_list(200)
        return {"events": events}

    @api_router.get("/fittest/admin/athletes")
    async def admin_athletes(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        athletes = await db.athletes.find({}, {"_id": 0, "id": 1, "name": 1, "team": 1}).sort("name", 1).to_list(1000)
        return {"athletes": athletes}

    # ---------- Manual point adjustment ----------
    @api_router.post("/fittest/admin/points/adjust")
    async def admin_adjust_points(data: PointAdjust, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        ch = await db.the_fittest_challenges.find_one({"id": data.challenge_id}, {"_id": 0, "id": 1})
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found")
        athlete = await db.athletes.find_one({"id": data.athlete_id}, {"_id": 0, "id": 1})
        if not athlete:
            raise HTTPException(status_code=404, detail="Athlete not found")
        await db.the_fittest_points.insert_one({
            "id": str(uuid.uuid4()), "challenge_id": data.challenge_id, "athlete_id": data.athlete_id,
            "post_id": None, "source_type": "manual_adjustment", "source_id": None,
            "date": today_str(), "points": int(data.points), "reason": data.reason,
            "awarded_at": local_now().isoformat(), "revoked": False,
            "adjusted_by_admin_id": current_user['user']['id'],
        })
        total, _, _ = await _athlete_summary(data.challenge_id, data.athlete_id)
        return {"success": True, "new_total": total}

    @api_router.get("/fittest/admin/points/adjustments")
    async def admin_adjustments(challenge_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        rows = await db.the_fittest_points.find(
            {"challenge_id": challenge_id, "source_type": "manual_adjustment"}, {"_id": 0}
        ).sort("awarded_at", -1).to_list(500)
        return {"adjustments": rows}

    # ---------- CSV export ----------
    @api_router.get("/fittest/admin/leaderboard/export")
    async def admin_export_csv(challenge_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        ch = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found")
        board = await _leaderboard(ch)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Rank", "Athlete", "Team", "Points", "Training check-ins", "Complete recoveries", "Last activity"])
        for r in board:
            writer.writerow([r["rank"], r["name"], r.get("team", ""), r["points"],
                             r["training_checkins"], r["recoveries"], r.get("last_activity", "") or ""])
        buf.seek(0)
        fname = f"the_fittest_{(ch.get('title') or 'challenge').replace(' ', '_')}.csv"
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    # ---------- Engagement analytics ----------
    @api_router.get("/fittest/admin/engagement")
    async def admin_engagement(challenge_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        ch = await db.the_fittest_challenges.find_one({"id": challenge_id}, {"_id": 0})
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found")
        cid = challenge_id
        # daily series over last 14 days (or challenge range clipped)
        days = []
        for i in range(13, -1, -1):
            days.append((local_now() - timedelta(days=i)).strftime("%Y-%m-%d"))
        posts = await db.the_fittest_posts.find({"challenge_id": cid, "status": "active"}, {"_id": 0, "posted_at": 1, "athlete_id": 1, "team": 1}).to_list(length=None)
        post_ids = [p for p in await db.the_fittest_posts.find({"challenge_id": cid}, {"_id": 0, "id": 1}).to_list(length=None)]
        pid_list = [p["id"] for p in post_ids]
        comments = await db.the_fittest_comments.find({"post_id": {"$in": pid_list}, "status": "active"}, {"_id": 0, "created_at": 1}).to_list(length=None)
        reactions = await db.the_fittest_reactions.find({"post_id": {"$in": pid_list}}, {"_id": 0, "created_at": 1}).to_list(length=None)

        def count_by_day(items, key):
            m = {d: 0 for d in days}
            for it in items:
                d = (it.get(key) or "")[:10]
                if d in m:
                    m[d] += 1
            return m
        posts_by_day = count_by_day(posts, "posted_at")
        comments_by_day = count_by_day(comments, "created_at")
        reactions_by_day = count_by_day(reactions, "created_at")
        series = [{"date": d, "posts": posts_by_day[d], "comments": comments_by_day[d], "reactions": reactions_by_day[d]} for d in days]

        # top posters
        poster_counts = {}
        team_counts = {}
        for p in posts:
            poster_counts[p["athlete_id"]] = poster_counts.get(p["athlete_id"], 0) + 1
            team_counts[p.get("team") or "—"] = team_counts.get(p.get("team") or "—", 0) + 1
        all_ids = await _athlete_ids_for_challenge(ch)
        athletes = await db.athletes.find({"id": {"$in": all_ids}}, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(length=None)
        name_map = {a["id"]: a for a in athletes}
        top_posters = sorted(
            [{"athlete_id": k, "name": name_map.get(k, {}).get("name", "?"), "team": name_map.get(k, {}).get("team"), "posts": v} for k, v in poster_counts.items()],
            key=lambda x: -x["posts"])[:10]
        no_posts = [{"athlete_id": a["id"], "name": a["name"], "team": a.get("team")} for a in athletes if a["id"] not in poster_counts]
        return {
            "series": series,
            "top_posters": top_posters,
            "no_posts": no_posts,
            "participation_by_team": [{"team": k, "posts": v} for k, v in team_counts.items()],
            "totals": {"posts": len(posts), "comments": len(comments), "reactions": len(reactions),
                       "posted_athletes": len(poster_counts), "silent_athletes": len(no_posts)},
        }

    # ---------- Global settings ----------
    @api_router.get("/fittest/admin/settings")
    async def admin_get_settings(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        return await _get_settings()

    @api_router.put("/fittest/admin/settings")
    async def admin_update_settings(data: FittestSettings, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        updates = {k: v for k, v in data.model_dump().items() if v is not None}
        await db.the_fittest_settings.update_one({"id": "global"}, {"$set": {**updates, "id": "global"}}, upsert=True)
        return await _get_settings()

    @api_router.get("/fittest/settings")
    async def public_settings(current_user: dict = Depends(get_current_user)):
        s = await _get_settings()
        return {"is_enabled": s.get("is_enabled", True),
                "allow_gallery_upload": s.get("allow_gallery_upload", True),
                "allow_camera_upload": s.get("allow_camera_upload", True)}

    # ---------- Athlete: recent winner banner ----------
    @api_router.get("/fittest/recent-winner")
    async def recent_winner(current_user: dict = Depends(get_current_user)):
        if current_user['user_type'] != 'athlete':
            return {"winner": None}
        athlete = current_user['user']
        cutoff = (local_now() - timedelta(days=5)).isoformat()
        chs = await db.the_fittest_challenges.find(
            {"status": "finished", "updated_at": {"$gte": cutoff}}, {"_id": 0}
        ).sort("updated_at", -1).to_list(20)
        for ch in chs:
            if not _athlete_included(ch, athlete):
                continue
            wid = ch.get("winner_athlete_id")
            if not wid:
                continue
            wa = await db.athletes.find_one({"id": wid}, {"_id": 0, "name": 1, "team": 1})
            return {"winner": {
                "challenge_id": ch["id"], "challenge_title": ch["title"],
                "winner_name": wa.get("name") if wa else "—",
                "winner_team": wa.get("team") if wa else None,
                "is_me": wid == athlete["id"],
            }}
        return {"winner": None}

    logger.info("The Fittest routes registered")


async def _fittest_athlete_ids(db, ch: dict):
    ids = ch.get("included_athlete_ids") or []
    if ids:
        return ids
    q = {}
    teams = ch.get("included_teams") or []
    if teams:
        q["team"] = {"$in": teams}
    athletes = await db.athletes.find(q, {"_id": 0, "id": 1}).to_list(length=None)
    return [a["id"] for a in athletes]


async def _check_ending_soon(db):
    """Notify participants once when an active challenge ends tomorrow (local time)."""
    if not _send_push:
        return
    try:
        tomorrow = (local_now() + timedelta(days=1)).strftime("%Y-%m-%d")
        chs = await db.the_fittest_challenges.find(
            {"status": "active", "end_date": tomorrow}, {"_id": 0}
        ).to_list(length=None)
        for ch in chs:
            ids = await _fittest_athlete_ids(db, ch)
            subs = await db.push_subscriptions.find(
                {"athlete_id": {"$in": ids}, "enabled": True}, {"_id": 0}
            ).to_list(length=None)
            kind = f"tf-ending-{ch['id']}"
            for sub in subs:
                already = await db.push_send_log.find_one(
                    {"athlete_id": sub["athlete_id"], "kind": kind, "date": "ending"})
                if already:
                    continue
                payload = {"title": "Last day tomorrow ⏳",
                           "body": f"{ch['title']} ends tomorrow — post your check-in to climb the board!",
                           "url": "/athlete/the-fittest", "tag": kind}
                status = await _send_push(sub, payload)
                if status == "ok":
                    await db.push_send_log.insert_one({
                        "id": str(uuid.uuid4()), "athlete_id": sub["athlete_id"],
                        "kind": kind, "date": "ending", "sent_at": local_now().isoformat()})
                elif status == "gone":
                    await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
    except Exception:
        logger.exception("ending-soon check failed")


def start_the_fittest_scheduler(db):
    """Call once on FastAPI startup — hourly 'ending soon' push check."""
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(_check_ending_soon, "interval", hours=1, args=[db],
                      max_instances=1, coalesce=True, id="fittest_ending_soon")
    scheduler.start()
    logger.info("The Fittest scheduler started (hourly ending-soon check)")
    return scheduler
