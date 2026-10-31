"""
Nutrition & Hydration Calculator
=================================
Auto-calculates daily macros, pre-competition nutrition timing blocks and
hydration targets from an athlete's body weight (kg) and athlete type
(Endurance vs. Strength/Power), using the federation's exact formulas.

- Athletes can calculate and save plans to their own history.
- Staff can view any athlete's plan/history and apply manual overrides
  (flagged as "Modified by staff").

All formulas come directly from the product requirement (do NOT invent values):
  DAILY
    Endurance  Carbs: P*8..P*10 g/day  | Protein: P*1.4..P*1.8 g/day | Fat: 20-35% kcal
    Strength   Carbs: P*5..P*6  g/day  | Protein: P*1.4..P*1.8 g/day | Fat: 20-35% kcal
  PRE-COMPETITION
    3-4h: Carbs P*1..P*4 g | Protein P*0.15..P*0.25 g | low fat/fiber
    1-2h: 30-60 g simple carbs | small protein if tolerated | very low fat/fiber
    <1h : ~30 g liquid/gel carb | avoid protein | avoid fat/fiber
  HYDRATION
    4h before: P*5..P*7 mL
    2h before: P*3..P*5 mL (if needed / dark urine)
    During: 90-240 mL / 15 min ; endurance carbs 30-90 g/h
    After (if weight lost): kg lost * 1.5 = liters
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

ATHLETE_TYPES = ("endurance", "strength")
POST_HYDRATION_FACTOR = 1.5  # liters per kg lost

# Urine-color hydration scale (1 = well hydrated ... 8 = severe dehydration)
HYDRATION_LEVELS = {
    1: {"color": "#FCFCE3", "status": "Good", "action": "You are hydrated"},
    2: {"color": "#F7F8CB", "status": "Good", "action": "You are hydrated"},
    3: {"color": "#F2F080", "status": "Good", "action": "You are hydrated"},
    4: {"color": "#FBE251", "status": "Fair", "action": "Start drinking water"},
    5: {"color": "#FBD332", "status": "Dehydrated", "action": "Drink water"},
    6: {"color": "#F5C518", "status": "Dehydrated", "action": "Drink water"},
    7: {"color": "#DFB878", "status": "Very Dehydrated", "action": "Consider Rehydration sachets"},
    8: {"color": "#C89A28", "status": "Severe Dehydration", "action": "Consider Rehydration sachets"},
}


def _r(v):
    """Round to 1 decimal, drop trailing .0 for integers."""
    if v is None:
        return None
    rv = round(v, 1)
    return int(rv) if rv == int(rv) else rv


def compute_metrics(weight: float, athlete_type: str):
    """Return a flat list of metric rows grouped by `section`."""
    P = weight
    metrics = []

    def add(key, section, label, lo=None, hi=None, unit="", text=None, editable=False, note=None):
        metrics.append({
            "key": key,
            "section": section,
            "label": label,
            "min": _r(lo),
            "max": _r(hi),
            "unit": unit,
            "text": text,
            "editable": editable,
            "note": note,
        })

    # ---------- 1. Daily nutrition ----------
    if athlete_type == "endurance":
        carb_lo, carb_hi = P * 8, P * 10
    else:
        carb_lo, carb_hi = P * 5, P * 6
    add("daily_carbs", "Daily Nutrition", "Carbohydrates", carb_lo, carb_hi, "g/day", editable=True)
    add("daily_protein", "Daily Nutrition", "Protein", P * 1.4, P * 1.8, "g/day", editable=True)
    add("daily_fat", "Daily Nutrition", "Fats", unit="%", text="20–35% of total daily calories")

    # ---------- 2. Pre-competition ----------
    add("pre34_carbs", "Pre-Competition · 3–4h before", "Carbohydrates", P * 1, P * 4, "g", editable=True)
    add("pre34_protein", "Pre-Competition · 3–4h before", "Protein", P * 0.15, P * 0.25, "g", editable=True)
    add("pre34_fat", "Pre-Competition · 3–4h before", "Fat and fiber", text="Low")

    add("pre12_carbs", "Pre-Competition · 1–2h before", "Carbohydrates", text="30–60 g of simple carbs")
    add("pre12_protein", "Pre-Competition · 1–2h before", "Protein", text="Small amount, if tolerated")
    add("pre12_fat", "Pre-Competition · 1–2h before", "Fat and fiber", text="Very low")

    add("pre1_carbs", "Pre-Competition · Less than 1h before", "Carbohydrates", text="≈30 g of liquid or gel carbohydrate")
    add("pre1_protein", "Pre-Competition · Less than 1h before", "Protein", text="Avoid")
    add("pre1_fat", "Pre-Competition · Less than 1h before", "Fat and fiber", text="Avoid")

    # ---------- 3. Hydration ----------
    add("hyd4", "Hydration Before Competing · 4h before", "Volume", P * 5, P * 7, "mL", editable=True)
    add("hyd2", "Hydration Before Competing · 2h before", "Volume", P * 3, P * 5, "mL", editable=True,
        note="Use if needed, especially if urine is dark or the athlete has not urinated.")
    add("during_fluid", "Hydration During Competition", "Volume", text="90–240 mL every 15 minutes")
    add("during_carbs", "Hydration During Competition", "Carbohydrate (endurance)", text="30–90 g of carbohydrate per hour")
    add("post_fluid", "Hydration After Competition", "Fluid replacement",
        text="Weight lost (kg) × 1.5 = liters",
        note="Use the calculator below by entering the weight lost to get the volume in liters.")

    return metrics


def _apply_overrides(metrics, overrides):
    overrides = overrides or {}
    for m in metrics:
        ov = overrides.get(m["key"])
        if m["editable"] and ov:
            m["override_min"] = _r(ov.get("min"))
            m["override_max"] = _r(ov.get("max"))
            m["is_overridden"] = True
        else:
            m["override_min"] = None
            m["override_max"] = None
            m["is_overridden"] = False
    return metrics


# ---------- request models ----------
class CalcRequest(BaseModel):
    body_weight_kg: float = Field(gt=0, le=400)
    athlete_type: str

    def normalized_type(self):
        t = (self.athlete_type or "").lower().strip()
        return t if t in ATHLETE_TYPES else "endurance"


class PlanRequest(CalcRequest):
    athlete_id: Optional[str] = None  # staff may save on behalf of an athlete


class OverrideItem(BaseModel):
    min: Optional[float] = None
    max: Optional[float] = None


class OverrideRequest(BaseModel):
    overrides: dict = Field(default_factory=dict)
    note: Optional[str] = None


def register_nutrition_routes(api_router: APIRouter, db, get_current_user):

    def _actor(current_user):
        return current_user["user_type"], current_user["user"]

    async def _athlete_name(athlete_id):
        a = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "name": 1})
        return a["name"] if a else None

    def _serialize(plan):
        metrics = compute_metrics(plan["body_weight_kg"], plan["athlete_type"])
        metrics = _apply_overrides(metrics, plan.get("overrides"))
        type_label = "Endurance" if plan["athlete_type"] == "endurance" else "Strength / Power"
        return {
            "id": plan["id"],
            "athlete_id": plan["athlete_id"],
            "body_weight_kg": plan["body_weight_kg"],
            "athlete_type": plan["athlete_type"],
            "athlete_type_label": type_label,
            "is_current": plan.get("is_current", False),
            "modified_by_staff": plan.get("modified_by_staff", False),
            "modified_by_name": plan.get("modified_by_name"),
            "modified_at": plan.get("modified_at"),
            "created_at": plan["created_at"],
            "created_by_type": plan.get("created_by_type"),
            "created_by_name": plan.get("created_by_name"),
            "overrides": plan.get("overrides") or {},
            "post_hydration_factor": POST_HYDRATION_FACTOR,
            "metrics": metrics,
        }

    async def _resolve_athlete_id(current_user, requested_id):
        """Athletes are restricted to themselves; staff may target any athlete."""
        user_type, user = _actor(current_user)
        if user_type == "athlete":
            return user["id"]
        # staff
        if not requested_id:
            raise HTTPException(status_code=400, detail="athlete_id is required for staff")
        return requested_id
    # ---------- Hydration self-check history (from daily check-in) ----------
    @api_router.get("/nutrition/hydration")
    async def hydration_history(athlete_id: Optional[str] = Query(default=None),
                                current_user: dict = Depends(get_current_user)):
        aid = await _resolve_athlete_id(current_user, athlete_id)
        docs = await db.daily_readiness.find(
            {"athlete_id": aid, "hydration_level": {"$exists": True, "$ne": None}},
            {"_id": 0, "date": 1, "hydration_level": 1},
        ).sort("date", -1).to_list(60)
        out = []
        for d in docs:
            lvl = d.get("hydration_level")
            info = HYDRATION_LEVELS.get(lvl)
            if not info:
                continue
            out.append({
                "date": d.get("date"),
                "level": lvl,
                "color": info["color"],
                "status": info["status"],
                "action": info["action"],
            })
        return {"levels": HYDRATION_LEVELS, "entries": out}

    # ---------- Team hydration trend (staff): % of athletes dehydrated per day ----------
    @api_router.get("/staff/nutrition/hydration-trend")
    async def team_hydration_trend(days: int = Query(default=30),
                                   team: Optional[str] = Query(default=None),
                                   current_user: dict = Depends(get_current_user)):
        if current_user['user_type'] != 'staff':
            raise HTTPException(status_code=403, detail="Staff only")
        from app_time import local_now
        from datetime import timedelta
        start = (local_now() - timedelta(days=days)).strftime("%Y-%m-%d")

        aq = {"active": True}
        if team and team != 'all':
            aq["team"] = team
        athletes = await db.athletes.find(aq, {"_id": 0, "id": 1}).to_list(500)
        ids = [a["id"] for a in athletes]

        docs = await db.daily_readiness.find(
            {"athlete_id": {"$in": ids}, "date": {"$gte": start},
             "hydration_level": {"$exists": True, "$ne": None}},
            {"_id": 0, "date": 1, "hydration_level": 1},
        ).to_list(5000)

        # Dehydration threshold: urine color level >= 5
        by_day = {}
        for d in docs:
            day = d["date"]
            lvl = d.get("hydration_level")
            if lvl is None:
                continue
            b = by_day.setdefault(day, {"count": 0, "dehydrated": 0, "sum": 0})
            b["count"] += 1
            b["sum"] += lvl
            if lvl >= 5:
                b["dehydrated"] += 1

        trend = []
        for day in sorted(by_day.keys()):
            b = by_day[day]
            trend.append({
                "date": day,
                "reports": b["count"],
                "dehydrated": b["dehydrated"],
                "pct_dehydrated": round(100 * b["dehydrated"] / b["count"]) if b["count"] else 0,
                "avg_level": round(b["sum"] / b["count"], 1) if b["count"] else 0,
            })
        return {"threshold": 5, "days": days, "trend": trend}


    # ---------- Live preview (no save) ----------
    @api_router.post("/nutrition/calculate")
    async def calculate(req: CalcRequest, current_user: dict = Depends(get_current_user)):
        atype = req.normalized_type()
        metrics = _apply_overrides(compute_metrics(req.body_weight_kg, atype), {})
        return {
            "body_weight_kg": req.body_weight_kg,
            "athlete_type": atype,
            "athlete_type_label": "Endurance" if atype == "endurance" else "Strength / Power",
            "post_hydration_factor": POST_HYDRATION_FACTOR,
            "metrics": metrics,
        }

    # ---------- Save a plan (becomes current) ----------
    @api_router.post("/nutrition/plans")
    async def save_plan(req: PlanRequest, current_user: dict = Depends(get_current_user)):
        user_type, user = _actor(current_user)
        athlete_id = user["id"] if user_type == "athlete" else await _resolve_athlete_id(current_user, req.athlete_id)
        atype = req.normalized_type()

        # Demote previous current plan for this athlete
        await db.nutrition_plans.update_many(
            {"athlete_id": athlete_id, "is_current": True}, {"$set": {"is_current": False}}
        )

        plan = {
            "id": str(uuid4()),
            "athlete_id": athlete_id,
            "body_weight_kg": float(req.body_weight_kg),
            "athlete_type": atype,
            "overrides": {},
            "modified_by_staff": False,
            "modified_by_name": None,
            "modified_at": None,
            "is_current": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by_type": user_type,
            "created_by_name": user.get("name"),
        }
        await db.nutrition_plans.insert_one(plan)
        return _serialize(plan)

    # ---------- Current plan ----------
    @api_router.get("/nutrition/plans/current")
    async def current_plan(athlete_id: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
        aid = await _resolve_athlete_id(current_user, athlete_id)
        plan = await db.nutrition_plans.find_one({"athlete_id": aid, "is_current": True}, {"_id": 0})
        if not plan:
            return None
        return _serialize(plan)

    # ---------- History ----------
    @api_router.get("/nutrition/plans/history")
    async def plan_history(athlete_id: Optional[str] = Query(None), limit: int = 50,
                           current_user: dict = Depends(get_current_user)):
        aid = await _resolve_athlete_id(current_user, athlete_id)
        plans = await db.nutrition_plans.find({"athlete_id": aid}, {"_id": 0}) \
            .sort("created_at", -1).to_list(length=limit)
        return [_serialize(p) for p in plans]

    # ---------- Staff override ----------
    @api_router.patch("/nutrition/plans/{plan_id}/override")
    async def apply_override(plan_id: str, req: OverrideRequest, current_user: dict = Depends(get_current_user)):
        user_type, user = _actor(current_user)
        if user_type != "staff":
            raise HTTPException(status_code=403, detail="Only staff can apply overrides")

        plan = await db.nutrition_plans.find_one({"id": plan_id}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        # Only editable metric keys may be overridden
        editable_keys = {m["key"] for m in compute_metrics(plan["body_weight_kg"], plan["athlete_type"]) if m["editable"]}
        clean = {}
        for k, v in (req.overrides or {}).items():
            if k in editable_keys and isinstance(v, dict):
                mn = v.get("min")
                mx = v.get("max")
                if mn is None and mx is None:
                    continue
                clean[k] = {"min": mn, "max": mx}

        update = {
            "overrides": clean,
            "modified_by_staff": bool(clean),
            "modified_by_name": user.get("name") if clean else None,
            "modified_at": datetime.now(timezone.utc).isoformat() if clean else None,
            "override_note": req.note,
        }
        await db.nutrition_plans.update_one({"id": plan_id}, {"$set": update})
        plan.update(update)
        return _serialize(plan)

    # ---------- Delete a plan ----------
    @api_router.delete("/nutrition/plans/{plan_id}")
    async def delete_plan(plan_id: str, current_user: dict = Depends(get_current_user)):
        user_type, user = _actor(current_user)
        plan = await db.nutrition_plans.find_one({"id": plan_id}, {"_id": 0})
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if user_type == "athlete" and plan["athlete_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Not your plan")
        await db.nutrition_plans.delete_one({"id": plan_id})
        # If we removed the current plan, promote the most recent remaining one
        if plan.get("is_current"):
            latest = await db.nutrition_plans.find({"athlete_id": plan["athlete_id"]}, {"_id": 0}) \
                .sort("created_at", -1).to_list(length=1)
            if latest:
                await db.nutrition_plans.update_one({"id": latest[0]["id"]}, {"$set": {"is_current": True}})
        return {"deleted": True}

    logger.info("Nutrition & Hydration routes registered")
