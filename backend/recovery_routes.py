"""
Recovery Points Ecosystem - Phase 1
===================================
Athlete-facing recovery accountability system:
- Recovery activities organized in categories (Gold/Silver/Bronze + custom)
- Daily Recovery Points with a 100-point target (consistency, not perfection)
- Mandatory proof upload (image/PDF) stored in Emergent Object Storage
- Automatic OR staff approval (admin-configurable)
- Daily score, colored progress, streaks, compliance %, motivational badges
- Admin config of activities / categories / points / approval mode

All language is ENGLISH per product requirement.
"""
import logging
from datetime import datetime, timezone, timedelta
from app_time import local_now
from collections import defaultdict
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from recovery_storage import (
    put_object,
    get_object,
    make_thumbnail,
    validate_extension,
    MIME_TYPES,
    MAX_FILE_BYTES,
    THUMBNAILABLE,
    APP_NAME,
)

logger = logging.getLogger(__name__)

DAILY_TARGET_DEFAULT = 100

# ---- Default catalog seeded on first startup ----
DEFAULT_CATEGORIES = [
    {"name": "Gold", "color": "gold", "default_points": 40, "order": 1},
    {"name": "Silver", "color": "silver", "default_points": 25, "order": 2},
    {"name": "Bronze", "color": "bronze", "default_points": 15, "order": 3},
]

DEFAULT_ACTIVITIES = [
    # Gold (40)
    ("8+ Hours Sleep", "Gold", 40, "moon", "sleep"),
    ("Hydration Goal Achieved", "Gold", 40, "droplet", "hydration"),
    # Silver (25)
    ("Massage", "Silver", 25, "hand", "modality"),
    ("Foam Rolling", "Silver", 25, "cylinder", "mobility"),
    ("Mobility Session", "Silver", 25, "move", "mobility"),
    ("Bike Recovery", "Silver", 25, "bike", "modality"),
    ("Pool Recovery", "Silver", 25, "waves", "modality"),
    ("Stretching", "Silver", 25, "stretch", "mobility"),
    ("Recovery Walk", "Silver", 25, "footprints", "modality"),
    ("Yoga", "Silver", 25, "flower", "mobility"),
    # Bronze (15)
    ("Compression Boots", "Bronze", 15, "boot", "modality"),
    ("Self Release", "Bronze", 15, "hand", "mobility"),
    ("Sports Drink", "Bronze", 15, "cup", "hydration"),
    ("Nap", "Bronze", 15, "bed", "sleep"),
    ("Contrast Shower", "Bronze", 15, "shower", "modality"),
]


# ============================================================
# Pydantic request models
# ============================================================
class RecoverySettingsUpdate(BaseModel):
    approval_mode: str = Field(pattern=r"^(automatic|manual)$")
    daily_target: int = Field(ge=10, le=1000)


class ActivityCreate(BaseModel):
    name: str
    category: str
    points: int = Field(ge=1, le=500)
    icon: Optional[str] = "sparkles"


class ActivityUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    points: Optional[int] = Field(default=None, ge=1, le=500)
    icon: Optional[str] = None
    active: Optional[bool] = None


class CategoryCreate(BaseModel):
    name: str
    color: Optional[str] = "slate"
    default_points: int = Field(ge=1, le=500)


class ReviewAction(BaseModel):
    action: str = Field(pattern=r"^(approve|reject)$")
    feedback: Optional[str] = None


# ============================================================
# Helpers
# ============================================================
def _today_str(offset_days: int = 0) -> str:
    return (local_now() - timedelta(days=offset_days)).strftime("%Y-%m-%d")


def _score_color(points: int, target: int) -> str:
    pct = (points / target * 100) if target else 0
    if pct >= 100:
        return "green"
    if pct >= 80:
        return "yellow"
    if pct >= 50:
        return "orange"
    return "red"


async def _get_settings(db) -> dict:
    s = await db.recovery_settings.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = {"id": "global", "approval_mode": "automatic", "daily_target": DAILY_TARGET_DEFAULT}
        await db.recovery_settings.insert_one(dict(s))
    return s


async def _daily_points(db, athlete_id: str, date_str: str) -> int:
    logs = await db.recovery_logs.find(
        {"athlete_id": athlete_id, "date": date_str, "status": "approved"},
        {"_id": 0, "points": 1},
    ).to_list(length=None)
    return sum(int(lg.get("points", 0)) for lg in logs)


async def _compute_streak(db, athlete_id: str, target: int) -> int:
    """Consecutive days (ending today, with a grace day for today) meeting the target."""
    today = datetime.now(timezone.utc).date()
    streak = 0
    # Grace: if today not yet met, start counting from yesterday
    start_offset = 0
    if await _daily_points(db, athlete_id, today.strftime("%Y-%m-%d")) < target:
        start_offset = 1
    d = today - timedelta(days=start_offset)
    # Cap lookback at 400 days
    for _ in range(400):
        if await _daily_points(db, athlete_id, d.strftime("%Y-%m-%d")) >= target:
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return streak


async def _compute_compliance(db, athlete_id: str, target: int) -> dict:
    """Compliance % over a rolling window since the athlete's first log (max 30 days)."""
    today = datetime.now(timezone.utc).date()
    first_log = await db.recovery_logs.find_one(
        {"athlete_id": athlete_id}, {"_id": 0, "date": 1}, sort=[("date", 1)]
    )
    if not first_log:
        return {"compliance_pct": 0, "days_met": 0, "days_expected": 0}
    first_date = datetime.strptime(first_log["date"], "%Y-%m-%d").date()
    window_start = max(first_date, today - timedelta(days=29))
    days_expected = (today - window_start).days + 1
    days_met = 0
    d = window_start
    for _ in range(days_expected):
        if await _daily_points(db, athlete_id, d.strftime("%Y-%m-%d")) >= target:
            days_met += 1
        d += timedelta(days=1)
    pct = round(days_met / days_expected * 100) if days_expected else 0
    return {"compliance_pct": pct, "days_met": days_met, "days_expected": days_expected}


async def _compute_badges(db, athlete_id: str, streak: int) -> list:
    logs = await db.recovery_logs.find(
        {"athlete_id": athlete_id, "status": "approved"},
        {"_id": 0, "tag": 1},
    ).to_list(length=None)
    tag_counts = {}
    for lg in logs:
        t = lg.get("tag") or "other"
        tag_counts[t] = tag_counts.get(t, 0) + 1

    defs = [
        {"id": "rookie", "name": "Recovery Rookie", "icon": "award", "desc": "7-day streak", "earned": streak >= 7},
        {"id": "pro", "name": "Recovery Pro", "icon": "medal", "desc": "30-day streak", "earned": streak >= 30},
        {"id": "master", "name": "Recovery Master", "icon": "crown", "desc": "90-day streak", "earned": streak >= 90},
        {"id": "hydration_king", "name": "Hydration King", "icon": "droplet", "desc": "14 hydration logs", "earned": tag_counts.get("hydration", 0) >= 14},
        {"id": "sleep_champion", "name": "Sleep Champion", "icon": "moon", "desc": "14 sleep logs", "earned": tag_counts.get("sleep", 0) >= 14},
        {"id": "mobility_expert", "name": "Mobility Expert", "icon": "move", "desc": "14 mobility logs", "earned": tag_counts.get("mobility", 0) >= 14},
    ]
    return defs


def _log_public(log: dict) -> dict:
    return {
        "id": log["id"],
        "athlete_id": log["athlete_id"],
        "date": log["date"],
        "time": log.get("time"),
        "activity_name": log.get("activity_name"),
        "category": log.get("category"),
        "points": log.get("points", 0),
        "status": log.get("status"),
        "notes": log.get("notes"),
        "feedback": log.get("feedback"),
        "file_id": log.get("file_id"),
        "has_proof": bool(log.get("file_id")),
        "pain_reports": log.get("pain_reports") or [],
        "created_at": log.get("created_at"),
    }


# ============================================================
# Startup seed
# ============================================================
async def seed_recovery_catalog(db):
    """Seed default categories + activities + settings if empty."""
    if await db.recovery_categories.count_documents({}) == 0:
        await db.recovery_categories.insert_many([
            {"id": str(uuid4()), "name": c["name"], "color": c["color"],
             "default_points": c["default_points"], "order": c["order"],
             "is_default": True, "active": True,
             "created_at": datetime.now(timezone.utc).isoformat()}
            for c in DEFAULT_CATEGORIES
        ])
    if await db.recovery_activities.count_documents({}) == 0:
        await db.recovery_activities.insert_many([
            {"id": str(uuid4()), "name": name, "category": cat, "points": pts,
             "icon": icon, "tag": tag, "is_default": True, "active": True,
             "created_by": "system", "created_at": datetime.now(timezone.utc).isoformat()}
            for (name, cat, pts, icon, tag) in DEFAULT_ACTIVITIES
        ])
    await _get_settings(db)
    logger.info("Recovery catalog ready")


# ============================================================
# Route registration
# ============================================================
def register_recovery_routes(api_router, db, get_current_user):

    def _require_athlete(current_user):
        if current_user["user_type"] != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        return current_user["user"]["id"]

    def _require_staff(current_user):
        if current_user["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        return current_user["user"]

    def _require_admin(current_user):
        user = _require_staff(current_user)
        if user.get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        return user

    # ---------- Catalog (activities + categories) ----------
    @api_router.get("/recovery/catalog")
    async def get_catalog(current_user: dict = Depends(get_current_user)):
        cats = await db.recovery_categories.find(
            {"active": True}, {"_id": 0}
        ).sort("order", 1).to_list(length=None)
        acts = await db.recovery_activities.find(
            {"active": True}, {"_id": 0}
        ).to_list(length=None)
        settings = await _get_settings(db)
        # Group activities by category
        by_cat = {}
        for a in acts:
            by_cat.setdefault(a["category"], []).append(a)
        return {
            "categories": cats,
            "activities": acts,
            "activities_by_category": by_cat,
            "settings": {"approval_mode": settings["approval_mode"], "daily_target": settings["daily_target"]},
        }

    # ---------- Athlete: submit a recovery log (proof optional) ----------
    @api_router.post("/recovery/logs")
    async def submit_recovery(
        activity_id: str = Form(...),
        notes: Optional[str] = Form(None),
        pain_reports: Optional[str] = Form(None),
        file: Optional[UploadFile] = File(None),
        current_user: dict = Depends(get_current_user),
    ):
        athlete_id = _require_athlete(current_user)

        activity = await db.recovery_activities.find_one(
            {"id": activity_id, "active": True}, {"_id": 0}
        )
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")

        # Optional pain report (JSON string from multipart form)
        pain_list = None
        if pain_reports:
            try:
                import json as _json
                parsed = _json.loads(pain_reports)
                if isinstance(parsed, list):
                    pain_list = [
                        {
                            "body_region": p.get("body_region"),
                            "laterality": p.get("laterality"),
                            "pain_level": int(p.get("pain_level", 0)),
                            "region_note": (str(p.get("region_note")).strip()[:200] if p.get("region_note") else None),
                        }
                        for p in parsed if p.get("body_region")
                    ] or None
                    for _p in (pain_list or []):
                        if _p["body_region"] == "Other" and not _p.get("region_note"):
                            raise HTTPException(status_code=400, detail='Please describe the "Other" pain location.')
            except HTTPException:
                raise
            except Exception:
                pain_list = None

        # Proof is OPTIONAL. If provided, validate, read and upload it.
        file_id = None
        if file is not None and (file.filename or "").strip():
            try:
                ext = validate_extension(file.filename or "")
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            data = await file.read()
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=400, detail="File too large (max 10MB)")
            if len(data) > 0:
                content_type = MIME_TYPES.get(ext, "application/octet-stream")
                file_id = str(uuid4())
                storage_path = f"{APP_NAME}/proofs/{athlete_id}/{file_id}.{ext}"
                try:
                    result = await put_object(storage_path, data, content_type)
                except Exception:
                    logger.exception("Proof upload failed")
                    raise HTTPException(status_code=502, detail="Failed to upload proof. Please try again.")

                # Generate a lightweight thumbnail for fast gallery loading (non-fatal).
                thumb_path = None
                if ext in THUMBNAILABLE:
                    thumb_bytes = await make_thumbnail(data)
                    if thumb_bytes:
                        candidate = f"{APP_NAME}/proofs/{athlete_id}/{file_id}_thumb.jpg"
                        try:
                            await put_object(candidate, thumb_bytes, "image/jpeg")
                            thumb_path = candidate
                        except Exception:
                            logger.exception("Thumbnail upload failed (non-fatal)")
                            thumb_path = None

                await db.recovery_files.insert_one({
                    "id": file_id,
                    "athlete_id": athlete_id,
                    "storage_path": result.get("path", storage_path),
                    "thumb_path": thumb_path,
                    "original_filename": file.filename,
                    "content_type": content_type,
                    "size": result.get("size", len(data)),
                    "is_deleted": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

        settings = await _get_settings(db)
        status = "approved" if settings["approval_mode"] == "automatic" else "pending"

        now = datetime.now(timezone.utc)
        local_ts = local_now()
        log = {
            "id": str(uuid4()),
            "athlete_id": athlete_id,
            "date": local_ts.strftime("%Y-%m-%d"),
            "time": local_ts.strftime("%H:%M"),
            "activity_id": activity_id,
            "activity_name": activity["name"],
            "category": activity["category"],
            "points": int(activity["points"]),
            "tag": activity.get("tag", "other"),
            "status": status,
            "notes": (notes or "").strip() or None,
            "pain_reports": pain_list,
            "feedback": None,
            "file_id": file_id,
            "reviewed_by": None,
            "reviewed_at": None,
            "created_at": now.isoformat(),
        }
        await db.recovery_logs.insert_one(dict(log))

        # Auto-create severe pain alerts (Active Alerts) from recovery pain reports
        if pain_list:
            try:
                from alerts_util import create_severe_pain_alerts
                await create_severe_pain_alerts(db, athlete_id, pain_list, "Recovery", log["date"])
            except Exception as e:
                logger.error("Failed to create pain alert from recovery: %s", e)

        target = settings["daily_target"]
        day_points = await _daily_points(db, athlete_id, log["date"])
        return {
            "success": True,
            "log": _log_public(log),
            "awarded": status == "approved",
            "status": status,
            "day_points": day_points,
            "target": target,
            "goal_achieved": day_points >= target,
        }

    # ---------- Athlete: today's summary ----------
    @api_router.get("/recovery/today")
    async def recovery_today(current_user: dict = Depends(get_current_user)):
        athlete_id = _require_athlete(current_user)
        settings = await _get_settings(db)
        target = settings["daily_target"]
        date_str = _today_str()
        logs = await db.recovery_logs.find(
            {"athlete_id": athlete_id, "date": date_str}, {"_id": 0}
        ).sort("created_at", 1).to_list(length=None)
        approved_points = sum(int(lg["points"]) for lg in logs if lg["status"] == "approved")
        pending_points = sum(int(lg["points"]) for lg in logs if lg["status"] == "pending")
        streak = await _compute_streak(db, athlete_id, target)
        return {
            "date": date_str,
            "points": approved_points,
            "pending_points": pending_points,
            "target": target,
            "color": _score_color(approved_points, target),
            "goal_achieved": approved_points >= target,
            "remaining": max(0, target - approved_points),
            "streak": streak,
            "logs": [_log_public(lg) for lg in logs],
            "approval_mode": settings["approval_mode"],
        }

    # ---------- Athlete: full personal summary (streak, compliance, badges, history) ----------
    @api_router.get("/recovery/my-summary")
    async def recovery_my_summary(current_user: dict = Depends(get_current_user)):
        athlete_id = _require_athlete(current_user)
        settings = await _get_settings(db)
        target = settings["daily_target"]
        streak = await _compute_streak(db, athlete_id, target)
        compliance = await _compute_compliance(db, athlete_id, target)
        badges = await _compute_badges(db, athlete_id, streak)
        # last 14 days points series
        series = []
        for off in range(13, -1, -1):
            d = _today_str(off)
            pts = await _daily_points(db, athlete_id, d)
            series.append({"date": d, "points": pts, "met": pts >= target, "color": _score_color(pts, target)})
        return {
            "target": target,
            "streak": streak,
            "compliance": compliance,
            "badges": badges,
            "series_14d": series,
        }

    # ---------- Athlete: logs by date ----------
    @api_router.get("/recovery/logs")
    async def recovery_logs(date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        athlete_id = _require_athlete(current_user)
        q = {"athlete_id": athlete_id}
        if date:
            q["date"] = date
        logs = await db.recovery_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"logs": [_log_public(lg) for lg in logs]}

    # ---------- Athlete: delete one of TODAY's own submissions (mistake fix) ----------
    @api_router.delete("/recovery/logs/{log_id}")
    async def delete_recovery_log(log_id: str, current_user: dict = Depends(get_current_user)):
        athlete_id = _require_athlete(current_user)
        log = await db.recovery_logs.find_one({"id": log_id, "athlete_id": athlete_id}, {"_id": 0})
        if not log:
            raise HTTPException(status_code=404, detail="Submission not found")
        # Only same-day (Boston) submissions can be removed; older ones are locked.
        today = local_now().strftime("%Y-%m-%d")
        if log.get("date") != today:
            raise HTTPException(
                status_code=403,
                detail="Only today's submissions can be deleted. Past entries are locked.",
            )

        await db.recovery_logs.delete_one({"id": log_id, "athlete_id": athlete_id})

        # Remove the attached proof photo (and its thumbnail) from the gallery.
        file_id = log.get("file_id")
        if file_id:
            await db.recovery_files.update_one(
                {"id": file_id, "athlete_id": athlete_id},
                {"$set": {"is_deleted": True}},
            )

        day_points = await _daily_points(db, athlete_id, today)
        settings = await _get_settings(db)
        target = settings["daily_target"]
        return {
            "success": True,
            "deleted_id": log_id,
            "day_points": day_points,
            "target": target,
            "goal_achieved": day_points >= target,
        }

    # ---------- Serve proof file (auth via header OR ?auth= query for <img>) ----------
    @api_router.get("/recovery/files/{file_id}")
    async def get_proof(
        file_id: str,
        authorization: str = Header(None),
        auth: str = Query(None),
        thumb: bool = Query(False),
        current_user_dep=None,
    ):
        # Manual auth (cannot use Depends easily with query-token for <img>)
        import jwt as _jwt
        import os as _os
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
        user_type = payload.get("user_type")
        user_id = payload.get("user_id")

        record = await db.recovery_files.find_one({"id": file_id, "is_deleted": False}, {"_id": 0})
        if not record:
            raise HTTPException(status_code=404, detail="File not found")
        # Athlete can only see own proof; staff can see all
        if user_type == "athlete" and record["athlete_id"] != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Serve the thumbnail when requested and available; otherwise the original.
        serve_thumb = bool(thumb and record.get("thumb_path"))
        serve_path = record["thumb_path"] if serve_thumb else record["storage_path"]
        serve_ctype = "image/jpeg" if serve_thumb else record.get("content_type", "application/octet-stream")
        try:
            data, ctype = await get_object(serve_path)
        except Exception:
            raise HTTPException(status_code=404, detail="Proof unavailable")
        # Cache in the browser (private — auth'd, per-athlete) so gallery re-opens are instant.
        headers = {
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"{file_id}{"-t" if serve_thumb else ""}"',
        }
        return Response(content=data, media_type=serve_ctype, headers=headers)

    # ============================================================
    # STAFF: Proofs gallery (all submitted recovery proofs)
    # ============================================================
    @api_router.get("/recovery/proofs")
    async def recovery_proofs(
        team: Optional[str] = None,
        days: int = 14,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        athlete_id: Optional[str] = None,
        category: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)

        # Date window: explicit start/end range overrides the rolling `days`.
        date_q = {}
        if start_date:
            date_q["$gte"] = start_date
        if end_date:
            date_q["$lte"] = end_date
        if not date_q:
            days = max(1, min(180, days))
            date_q["$gte"] = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")

        q = {"status": "approved"}
        if team:
            q["team"] = team
        athletes = await db.athletes.find(q, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(500)
        amap = {a["id"]: a for a in athletes}
        aids = list(amap.keys())
        if athlete_id:
            aids = [athlete_id] if athlete_id in amap else []

        log_query = {"athlete_id": {"$in": aids}, "file_id": {"$ne": None}, "date": date_q}
        if category:
            log_query["category"] = category

        logs = await db.recovery_logs.find(log_query, {"_id": 0}).sort("created_at", -1).to_list(20000)

        out = []
        for lg in logs:
            a = amap.get(lg["athlete_id"], {})
            out.append({
                "id": lg["id"],
                "athlete_id": lg["athlete_id"],
                "athlete_name": a.get("name", "Unknown"),
                "team": a.get("team"),
                "activity_name": lg.get("activity_name"),
                "category": lg.get("category"),
                "points": lg.get("points"),
                "date": lg.get("date"),
                "time": lg.get("time"),
                "status": lg.get("status"),
                "file_id": lg.get("file_id"),
            })
        return {"proofs": out, "count": len(out)}

    # ============================================================
    # STAFF: Recovery Intelligence (comprehensive dashboard)
    # ============================================================
    @api_router.get("/recovery/staff/overview")
    async def staff_overview(
        team: Optional[str] = None,
        days: int = 14,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        days = max(7, min(31, days))
        settings = await _get_settings(db)
        target = settings["daily_target"]

        # Athletes (optionally team-filtered)
        q = {"status": "approved"}
        if team:
            q["team"] = team
        athletes = await db.athletes.find(q, {"_id": 0, "id": 1, "name": 1, "team": 1, "photo_url": 1}).to_list(500)
        aids = [a["id"] for a in athletes]
        amap = {a["id"]: a for a in athletes}

        today = local_now().date()
        window_dates = [(today - timedelta(days=i)) for i in range(days - 1, -1, -1)]  # old -> new
        window_strs = [d.strftime("%Y-%m-%d") for d in window_dates]
        today_str = window_strs[-1]
        # 45-day map for streaks
        streak_start = today - timedelta(days=44)

        if not aids:
            return {
                "target": target, "days": days, "team": team,
                "kpis": {}, "alerts": [], "leaderboard": [], "heatmap": {"dates": window_strs, "rows": []},
                "trends": {"daily": [], "category_breakdown": []},
                "relationships": {"recovery_vs_readiness": [], "recovery_vs_pain": []},
            }

        # One query: all approved logs in last 45 days
        all_logs = await db.recovery_logs.find(
            {"athlete_id": {"$in": aids}, "status": "approved",
             "date": {"$gte": streak_start.strftime("%Y-%m-%d")}},
            {"_id": 0, "athlete_id": 1, "date": 1, "points": 1, "tag": 1},
        ).to_list(length=None)

        pts = defaultdict(lambda: defaultdict(int))            # pts[aid][date]
        cat_totals = defaultdict(int)                          # by tag (window only)
        for lg in all_logs:
            pts[lg["athlete_id"]][lg["date"]] += int(lg["points"])
            if lg["date"] in window_strs:
                cat_totals[lg.get("tag") or "other"] += int(lg["points"])

        def day_pts(aid, ds):
            return pts.get(aid, {}).get(ds, 0)

        def streak_for(aid):
            s = 0
            d = today
            if day_pts(aid, d.strftime("%Y-%m-%d")) < target:
                d = d - timedelta(days=1)
            for _ in range(45):
                if day_pts(aid, d.strftime("%Y-%m-%d")) >= target:
                    s += 1
                    d -= timedelta(days=1)
                else:
                    break
            return s

        # ---- KPIs ----
        today_points = {aid: day_pts(aid, today_str) for aid in aids}
        avg_today = round(sum(today_points.values()) / len(aids), 1) if aids else 0
        above = sum(1 for aid in aids if today_points[aid] >= target)
        below = len(aids) - above
        # team compliance over window
        met = sum(1 for aid in aids for ds in window_strs if day_pts(aid, ds) >= target)
        team_compliance = round(met / (len(aids) * len(window_strs)) * 100) if aids else 0
        streaks = {aid: streak_for(aid) for aid in aids}
        leader_aid = max(streaks, key=streaks.get) if streaks else None
        pending_count = await db.recovery_logs.count_documents(
            {"status": "pending", "athlete_id": {"$in": aids}}
        )
        kpis = {
            "avg_recovery_points_today": avg_today,
            "team_compliance_pct": team_compliance,
            "athletes_above_goal": above,
            "athletes_below_goal": below,
            "streak_leader": {"name": amap.get(leader_aid, {}).get("name", "-"), "streak": streaks.get(leader_aid, 0)} if leader_aid else {"name": "-", "streak": 0},
            "pending_approvals": pending_count,
            "total_athletes": len(aids),
        }

        # ---- Alerts ----
        alerts = []
        for aid in aids:
            name = amap[aid]["name"]
            tp = today_points[aid]
            # missed 3 consecutive days (incl today)
            last3 = window_strs[-3:] if len(window_strs) >= 3 else window_strs
            if all(day_pts(aid, ds) == 0 for ds in last3) and len(last3) == 3:
                alerts.append({"severity": "red", "athlete_id": aid, "athlete_name": name,
                               "type": "missed", "message": f"{name} missed {len(last3)} consecutive recovery logs"})
            elif tp == 0:
                alerts.append({"severity": "orange", "athlete_id": aid, "athlete_name": name,
                               "type": "no_submission", "message": f"{name} has no recovery submission today"})
            elif tp < target * 0.5:
                alerts.append({"severity": "yellow", "athlete_id": aid, "athlete_name": name,
                               "type": "low_points", "message": f"{name} low recovery points today ({tp}/{target})"})
            # decline trend: this week vs previous week avg
            if len(window_strs) >= 14:
                this_week = [day_pts(aid, ds) for ds in window_strs[-7:]]
                prev_week = [day_pts(aid, ds) for ds in window_strs[-14:-7]]
                tw = sum(this_week) / 7
                pw = sum(prev_week) / 7
                if pw > 0 and tw < pw * 0.6:
                    drop = round((1 - tw / pw) * 100)
                    alerts.append({"severity": "yellow", "athlete_id": aid, "athlete_name": name,
                                   "type": "decline", "message": f"{name}: recovery points down {drop}% vs last week"})
        severity_rank = {"red": 0, "orange": 1, "yellow": 2}
        alerts.sort(key=lambda a: severity_rank.get(a["severity"], 3))

        # ---- Leaderboard ----
        leaderboard = []
        for aid in aids:
            window_total = sum(day_pts(aid, ds) for ds in window_strs)
            met_days = sum(1 for ds in window_strs if day_pts(aid, ds) >= target)
            leaderboard.append({
                "athlete_id": aid, "name": amap[aid]["name"], "team": amap[aid].get("team"),
                "total_points": window_total, "avg_points": round(window_total / len(window_strs), 1),
                "streak": streaks[aid], "compliance_pct": round(met_days / len(window_strs) * 100),
                "today_points": today_points[aid],
            })
        leaderboard.sort(key=lambda x: (x["total_points"], x["streak"]), reverse=True)
        for i, row in enumerate(leaderboard):
            row["rank"] = i + 1

        # ---- Heatmap ----
        heatmap_rows = []
        for row in leaderboard:  # ordered by rank
            aid = row["athlete_id"]
            cells = [{"date": ds, "points": day_pts(aid, ds), "color": _score_color(day_pts(aid, ds), target)} for ds in window_strs]
            heatmap_rows.append({"athlete_id": aid, "name": amap[aid]["name"], "cells": cells})

        # ---- Trends ----
        daily = []
        for ds in window_strs:
            vals = [day_pts(aid, ds) for aid in aids]
            daily.append({"date": ds, "avg_points": round(sum(vals) / len(aids), 1),
                          "athletes_logged": sum(1 for v in vals if v > 0)})
        tag_label = {"sleep": "Sleep", "hydration": "Hydration", "mobility": "Mobility", "modality": "Modalities", "custom": "Custom", "other": "Other"}
        cat_breakdown = [{"category": tag_label.get(k, k.title()), "points": v} for k, v in sorted(cat_totals.items(), key=lambda x: -x[1])]

        # ---- Relationships (recovery vs readiness / pain) ----
        readiness_docs = await db.daily_readiness.find(
            {"athlete_id": {"$in": aids}, "date": {"$in": window_strs}},
            {"_id": 0, "athlete_id": 1, "date": 1, "readiness_score": 1},
        ).to_list(length=None)
        rvr = []
        for r in readiness_docs:
            rp = day_pts(r["athlete_id"], r["date"])
            if r.get("readiness_score") is not None:
                rvr.append({"recovery": rp, "readiness": round(float(r["readiness_score"]), 1)})

        session_docs = await db.training_sessions.find(
            {"athlete_id": {"$in": aids}, "date_time_start": {"$gte": window_strs[0]}},
            {"_id": 0, "athlete_id": 1, "date_time_start": 1, "pain_after": 1},
        ).to_list(length=None)
        pain_by_day = defaultdict(int)  # (aid,date) -> max pain
        for s in session_docs:
            ds = (s.get("date_time_start") or "")[:10]
            if ds in window_strs:
                pain_by_day[(s["athlete_id"], ds)] = max(pain_by_day[(s["athlete_id"], ds)], int(s.get("pain_after") or 0))
        rvp = []
        for (aid, ds), pain in pain_by_day.items():
            rvp.append({"recovery": day_pts(aid, ds), "pain": pain})

        return {
            "target": target, "days": days, "team": team,
            "kpis": kpis,
            "alerts": alerts,
            "leaderboard": leaderboard,
            "heatmap": {"dates": window_strs, "rows": heatmap_rows},
            "trends": {"daily": daily, "category_breakdown": cat_breakdown},
            "relationships": {"recovery_vs_readiness": rvr, "recovery_vs_pain": rvp},
        }

    # ============================================================
    # STAFF: approval queue + review
    # ============================================================
    @api_router.get("/recovery/pending")
    async def recovery_pending(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        logs = await db.recovery_logs.find(
            {"status": "pending"}, {"_id": 0}
        ).sort("created_at", 1).to_list(500)
        # attach athlete name/team
        ids = list({lg["athlete_id"] for lg in logs})
        athletes = await db.athletes.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(500)
        amap = {a["id"]: a for a in athletes}
        out = []
        for lg in logs:
            a = amap.get(lg["athlete_id"], {})
            if team and a.get("team") != team:
                continue
            pub = _log_public(lg)
            pub["athlete_name"] = a.get("name", "Unknown")
            pub["team"] = a.get("team")
            out.append(pub)
        return {"pending": out, "count": len(out)}

    @api_router.post("/recovery/logs/{log_id}/review")
    async def review_recovery(log_id: str, body: ReviewAction, current_user: dict = Depends(get_current_user)):
        staff = _require_staff(current_user)
        log = await db.recovery_logs.find_one({"id": log_id}, {"_id": 0})
        if not log:
            raise HTTPException(status_code=404, detail="Log not found")
        new_status = "approved" if body.action == "approve" else "rejected"
        await db.recovery_logs.update_one(
            {"id": log_id},
            {"$set": {
                "status": new_status,
                "feedback": (body.feedback or "").strip() or None,
                "reviewed_by": staff.get("id"),
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"success": True, "status": new_status}

    # ============================================================
    # ADMIN: settings + activity/category CRUD
    # ============================================================
    @api_router.get("/recovery/settings")
    async def get_recovery_settings(current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        s = await _get_settings(db)
        return {"approval_mode": s["approval_mode"], "daily_target": s["daily_target"]}

    @api_router.put("/recovery/settings")
    async def update_recovery_settings(body: RecoverySettingsUpdate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        await db.recovery_settings.update_one(
            {"id": "global"},
            {"$set": {"approval_mode": body.approval_mode, "daily_target": body.daily_target}},
            upsert=True,
        )
        return {"success": True, "approval_mode": body.approval_mode, "daily_target": body.daily_target}

    @api_router.post("/recovery/activities")
    async def create_activity(body: ActivityCreate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        doc = {
            "id": str(uuid4()), "name": body.name.strip(), "category": body.category,
            "points": body.points, "icon": body.icon or "sparkles", "tag": "custom",
            "is_default": False, "active": True, "created_by": current_user["user"].get("id"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.recovery_activities.insert_one(dict(doc))
        doc.pop("_id", None)
        return {"success": True, "activity": doc}

    @api_router.put("/recovery/activities/{activity_id}")
    async def update_activity(activity_id: str, body: ActivityUpdate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No changes")
        r = await db.recovery_activities.update_one({"id": activity_id}, {"$set": updates})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Activity not found")
        return {"success": True}

    @api_router.delete("/recovery/activities/{activity_id}")
    async def delete_activity(activity_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        r = await db.recovery_activities.update_one({"id": activity_id}, {"$set": {"active": False}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Activity not found")
        return {"success": True}

    @api_router.post("/recovery/categories")
    async def create_category(body: CategoryCreate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        existing = await db.recovery_categories.find_one({"name": body.name})
        if existing:
            raise HTTPException(status_code=400, detail="Category already exists")
        count = await db.recovery_categories.count_documents({})
        doc = {
            "id": str(uuid4()), "name": body.name.strip(), "color": body.color or "slate",
            "default_points": body.default_points, "order": count + 1,
            "is_default": False, "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.recovery_categories.insert_one(dict(doc))
        doc.pop("_id", None)
        return {"success": True, "category": doc}
