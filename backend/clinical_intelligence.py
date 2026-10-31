"""
Clinical Intelligence Module - Phase 1
=======================================

Implements descriptive, evidence-based athlete monitoring:
1. Recovery Composite Score
2. Training Availability Score
3. Trend Detection Engine
4. Weekly Heatmap
5. Flagged Athletes Panel
6. Performance Snapshot (aggregates the above)

Scientific principles (BJSM / JOSPT / IOC consensus):
- Descriptive only — never diagnose or predict injury
- Conservative language ("may indicate", "suggests")
- Trend-based monitoring, not single-point alarms
"""
import logging
import statistics
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)


# ============================================================
# 1) RECOVERY COMPOSITE SCORE
# ============================================================
def compute_recovery_composite(readiness_doc: dict) -> Optional[dict]:
    """
    Combine sleep quality, fatigue, soreness, stress into a single 0-10 score.
    Returns {score, components, missing_count} or None if no data.

    All sub-metrics are normalized to 0-10 where higher = better.
    Athlete reports fatigue/soreness/stress as 0-10 where higher = WORSE,
    so we invert them: better = 10 - reported_value.
    """
    if not readiness_doc:
        return None

    sleep = readiness_doc.get("sleep_quality")
    fatigue = readiness_doc.get("fatigue_level") or readiness_doc.get("morning_fatigue")
    soreness = readiness_doc.get("muscle_soreness")
    stress = readiness_doc.get("stress_level") or readiness_doc.get("stress")

    parts = []
    components = {}
    if sleep is not None:
        components["sleep"] = round(float(sleep), 1)
        parts.append(float(sleep))
    if fatigue is not None:
        inv = max(0.0, 10.0 - float(fatigue))
        components["fatigue_inv"] = round(inv, 1)
        parts.append(inv)
    if soreness is not None:
        inv = max(0.0, 10.0 - float(soreness))
        components["soreness_inv"] = round(inv, 1)
        parts.append(inv)
    if stress is not None:
        inv = max(0.0, 10.0 - float(stress))
        components["stress_inv"] = round(inv, 1)
        parts.append(inv)

    if not parts:
        return None

    score = round(sum(parts) / len(parts), 1)
    return {
        "score": score,
        "components": components,
        "available_dimensions": len(parts),
        "missing_count": 4 - len(parts),
    }


async def get_recovery_composite_series(db, athlete_id: str, days: int = 14) -> dict:
    """Return composite recovery score series for the last N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("date", 1).to_list(length=None)

    series = []
    for r in rows:
        c = compute_recovery_composite(r)
        if c:
            series.append({"date": r["date"], "score": c["score"]})

    current = series[-1]["score"] if series else None
    avg_7d = (
        round(statistics.mean([s["score"] for s in series[-7:]]), 1)
        if len(series) >= 1
        else None
    )
    avg_prev_7d = (
        round(statistics.mean([s["score"] for s in series[-14:-7]]), 1)
        if len(series) >= 14
        else None
    )
    delta = round(avg_7d - avg_prev_7d, 1) if avg_7d is not None and avg_prev_7d is not None else None

    return {
        "series": series,
        "current": current,
        "avg_7d": avg_7d,
        "avg_prev_7d": avg_prev_7d,
        "delta_7d_vs_prev": delta,
    }


# ============================================================
# 2) TRAINING AVAILABILITY SCORE
# ============================================================
async def compute_training_availability(db, athlete_id: str) -> dict:
    """
    Descriptive availability indicator (0-100% + category).
    Strictly NOT a medical clearance — purely descriptive.

    Weights (sum=100):
      - Readiness (last 1 day): 30
      - Recovery composite (avg last 3 days): 25
      - Pain (highest active region last 7 days): 25
      - Compliance (last 7 days): 10
      - Acute load relative to baseline (last 7d): 10
    """
    now = datetime.now(timezone.utc)
    last7 = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    last28 = (now - timedelta(days=28)).strftime("%Y-%m-%d")

    # Latest readiness
    last_readiness = await db.daily_readiness.find_one(
        {"athlete_id": athlete_id}, {"_id": 0}, sort=[("date", -1)]
    )

    # Last 7 readiness for recovery + compliance
    recent_readiness = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": last7}}, {"_id": 0}
    ).to_list(length=None)

    # Last 7 + last 28 sessions for pain + load
    sessions_7 = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": last7}}, {"_id": 0}
    ).to_list(length=None)
    sessions_28 = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": last28}}, {"_id": 0}
    ).to_list(length=None)

    reasons = []

    # 1) Readiness score (most recent)
    readiness_score = (last_readiness or {}).get("readiness_score")
    if readiness_score is not None:
        readiness_pct = max(0.0, min(1.0, float(readiness_score) / 10.0))
    else:
        readiness_pct = 0.5
        reasons.append("Sem check-in recente")

    # 2) Recovery composite avg of last 3 days
    last3 = sorted(recent_readiness, key=lambda r: r["date"], reverse=True)[:3]
    rec_scores = [compute_recovery_composite(r)["score"] for r in last3 if compute_recovery_composite(r)]
    recovery_pct = (sum(rec_scores) / len(rec_scores) / 10.0) if rec_scores else 0.5

    # 3) Pain — invert highest pain in last 7d sessions/readiness
    pain_values = []
    for s in sessions_7:
        for p in s.get("pain_reports") or []:
            v = p.get("pain_level") or p.get("pain_after") or 0
            pain_values.append(float(v))
        if s.get("pain_after"):
            pain_values.append(float(s["pain_after"]))
    for r in recent_readiness:
        # readiness has 'pain_reports' or pain_today field
        for p in r.get("pain_reports") or []:
            pain_values.append(float(p.get("pain_level", 0)))
    max_pain = max(pain_values) if pain_values else 0
    pain_pct = max(0.0, 1.0 - (max_pain / 10.0))
    if max_pain >= 5:
        reasons.append(f"Reported moderate/high pain (max {int(max_pain)}/10)")

    # 4) Compliance — readiness entries in last 7 days
    compliance_pct = min(1.0, len(recent_readiness) / 7.0)
    if compliance_pct < 0.5:
        reasons.append("Low check-in adherence")

    # 5) Acute/Chronic load ratio (acute = last 7d sum, chronic = 28d avg per week)
    acute = sum(float(s.get("internal_load") or 0) for s in sessions_7)
    chronic_weekly = (
        sum(float(s.get("internal_load") or 0) for s in sessions_28) / 4.0
        if sessions_28
        else 0
    )
    if chronic_weekly > 0:
        load_ratio = acute / chronic_weekly
    else:
        load_ratio = 1.0
    # Optimal load balance zone; outside reduces availability
    if 0.8 <= load_ratio <= 1.3:
        load_pct = 1.0
    elif load_ratio < 0.8:
        load_pct = max(0.5, load_ratio / 0.8)
    else:  # elevated load balance
        load_pct = max(0.4, 1.0 - (load_ratio - 1.3) * 0.5)
        if load_ratio > 1.5:
            reasons.append(f"Acute load spike detected (load balance {load_ratio:.2f})")

    # Weighted total
    score = (
        readiness_pct * 30 + recovery_pct * 25 + pain_pct * 25 + compliance_pct * 10 + load_pct * 10
    )
    score = round(score, 1)

    if score >= 75:
        category = "High availability"
        category_color = "green"
    elif score >= 55:
        category = "Moderate availability"
        category_color = "yellow"
    else:
        category = "Reduced availability"
        category_color = "red"

    return {
        "percentage": score,
        "category": category,
        "category_color": category_color,
        "components": {
            "readiness": round(readiness_pct * 100, 0),
            "recovery": round(recovery_pct * 100, 0),
            "pain": round(pain_pct * 100, 0),
            "compliance": round(compliance_pct * 100, 0),
            "load": round(load_pct * 100, 0),
            "load_balance": round(load_ratio, 2),
        },
        "reasons": reasons,
        "disclaimer": "Descriptive indicator only. Does not replace clinical assessment or medical clearance.",
    }


# ============================================================
# 3) TREND DETECTION ENGINE
# ============================================================
async def detect_trends(db, athlete_id: str, lookback_days: int = 14) -> list:
    """
    Detect descriptive trends (NOT diagnoses) from athlete history.
    Returns list of {type, severity, message, days_observed}.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    readiness = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": cutoff}}, {"_id": 0}
    ).sort("date", 1).to_list(length=None)

    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": cutoff}}, {"_id": 0}
    ).sort("date_time_start", 1).to_list(length=None)

    trends = []

    def _consecutive_decline(values, min_streak=3):
        if len(values) < min_streak:
            return 0
        streak = 1
        for i in range(len(values) - 1, 0, -1):
            if values[i] < values[i - 1]:
                streak += 1
            else:
                break
        return streak

    # Sleep declining
    sleep_vals = [r.get("sleep_quality") for r in readiness if r.get("sleep_quality") is not None]
    streak = _consecutive_decline(sleep_vals)
    if streak >= 3:
        trends.append({
            "type": "sleep_decline",
            "severity": "yellow",
            "message": f"Sleep quality declining for {streak} consecutive days. May indicate accumulating stress or fatigue; interpret in context.",
            "days_observed": streak,
        })

    # Readiness declining
    read_vals = [r.get("readiness_score") for r in readiness if r.get("readiness_score") is not None]
    streak = _consecutive_decline(read_vals)
    if streak >= 4:
        trends.append({
            "type": "readiness_decline",
            "severity": "yellow",
            "message": f"Progressive readiness decline detected over the last {streak} days. Suggests close monitoring.",
            "days_observed": streak,
        })

    # Increasing pain (compare last 3d avg vs prior 3d avg)
    pain_by_date = {}
    for s in sessions:
        d = (s.get("date_time_start") or "")[:10]
        for p in s.get("pain_reports") or []:
            pain_by_date.setdefault(d, []).append(float(p.get("pain_level", 0)))
        if s.get("pain_after"):
            pain_by_date.setdefault(d, []).append(float(s["pain_after"]))
    sorted_dates = sorted(pain_by_date.keys())
    if len(sorted_dates) >= 6:
        recent_avg = statistics.mean(
            [v for d in sorted_dates[-3:] for v in pain_by_date[d]]
        )
        prior_avg = statistics.mean(
            [v for d in sorted_dates[-6:-3] for v in pain_by_date[d]]
        )
        if recent_avg > prior_avg + 1.0 and recent_avg >= 3:
            trends.append({
                "type": "pain_increase",
                "severity": "orange",
                "message": f"Increasing trend in residual pain (recent avg {recent_avg:.1f} vs prior {prior_avg:.1f}). Review load and recovery.",
                "days_observed": 6,
            })

    # Readiness drop after load spike
    if len(read_vals) >= 5 and len(sessions) >= 3:
        # Get last 3 days load sum
        recent_load = sum(float(s.get("internal_load") or 0) for s in sessions[-3:])
        prior_load = sum(float(s.get("internal_load") or 0) for s in sessions[-6:-3]) if len(sessions) >= 6 else 0
        if prior_load > 0 and recent_load > prior_load * 1.4:
            # Check if readiness dropped
            recent_read_avg = statistics.mean(read_vals[-3:]) if len(read_vals) >= 3 else 0
            prior_read_avg = statistics.mean(read_vals[-6:-3]) if len(read_vals) >= 6 else recent_read_avg
            if recent_read_avg < prior_read_avg - 0.5:
                trends.append({
                    "type": "readiness_drop_after_load",
                    "severity": "yellow",
                    "message": "Readiness dropping after an acute load increase. Consider a recovery day.",
                    "days_observed": 6,
                })

    # Recovery composite trend
    composite_vals = []
    for r in readiness:
        c = compute_recovery_composite(r)
        if c:
            composite_vals.append(c["score"])
    streak = _consecutive_decline(composite_vals)
    if streak >= 3:
        trends.append({
            "type": "recovery_decline",
            "severity": "yellow",
            "message": f"Low recovery pattern over the last {streak} days. Review sleep, fatigue and pain factors.",
            "days_observed": streak,
        })

    # CMJ progressive decline (if recent tests exist)
    cmj_tests = await db.cmj_tests.find(
        {"athlete_id": athlete_id}, {"_id": 0}
    ).sort("date", -1).to_list(5)
    if len(cmj_tests) >= 3:
        recent = [t.get("cmj_best") or 0 for t in cmj_tests[:3]]
        baseline_doc = await db.cmj_baselines.find_one(
            {"athlete_id": athlete_id}, {"_id": 0}
        )
        if baseline_doc and baseline_doc.get("jump_height_cm"):
            base = float(baseline_doc["jump_height_cm"])
            recent_avg = statistics.mean(recent)
            deviation = (recent_avg - base) / base * 100
            if deviation < -10:
                trends.append({
                    "type": "cmj_decline",
                    "severity": "orange",
                    "message": f"CMJ baseline deviation: {deviation:.1f}%. May suggest accumulated neuromuscular fatigue.",
                    "days_observed": len(recent),
                })

    return trends


# ============================================================
# 4) WEEKLY HEATMAP
# ============================================================
def _color_for_value(value, metric: str) -> str:
    """Return green/yellow/orange/red based on metric semantics."""
    if value is None:
        return "gray"
    v = float(value)
    if metric in ("readiness", "sleep", "recovery"):
        # Higher = better. 0-10 scale.
        if v >= 7.5:
            return "green"
        elif v >= 6:
            return "yellow"
        elif v >= 4:
            return "orange"
        else:
            return "red"
    if metric in ("pain", "fatigue", "soreness"):
        # Higher = worse. 0-10 scale.
        if v <= 2:
            return "green"
        elif v <= 4:
            return "yellow"
        elif v <= 6:
            return "orange"
        else:
            return "red"
    if metric == "load":
        # Internal load 0-1000+. Categorize by deciles.
        if v < 150:
            return "green"
        elif v < 350:
            return "yellow"
        elif v < 600:
            return "orange"
        else:
            return "red"
    return "gray"


async def get_weekly_heatmap(db, athlete_id: str) -> dict:
    """Last 7 days heatmap rows: readiness, sleep, pain, recovery, fatigue, load."""
    today = datetime.now(timezone.utc).date()
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]

    earliest = dates[0]
    readiness = await db.daily_readiness.find(
        {"athlete_id": athlete_id, "date": {"$gte": earliest}}, {"_id": 0}
    ).to_list(length=None)
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": earliest}}, {"_id": 0}
    ).to_list(length=None)

    r_by_date = {r["date"]: r for r in readiness}
    load_by_date = {}
    pain_by_date = {}
    for s in sessions:
        d = (s.get("date_time_start") or "")[:10]
        load_by_date[d] = load_by_date.get(d, 0) + float(s.get("internal_load") or 0)
        for p in s.get("pain_reports") or []:
            v = float(p.get("pain_level", 0))
            pain_by_date[d] = max(pain_by_date.get(d, 0), v)
        if s.get("pain_after"):
            pain_by_date[d] = max(pain_by_date.get(d, 0), float(s["pain_after"]))

    rows = {
        "readiness": [],
        "sleep": [],
        "pain": [],
        "recovery": [],
        "fatigue": [],
        "load": [],
    }

    for d in dates:
        r = r_by_date.get(d) or {}
        # readiness
        rs = r.get("readiness_score")
        rows["readiness"].append({"date": d, "value": rs, "color": _color_for_value(rs, "readiness")})
        # sleep
        sl = r.get("sleep_quality")
        rows["sleep"].append({"date": d, "value": sl, "color": _color_for_value(sl, "sleep")})
        # pain (from sessions; fallback to readiness pain_reports if any)
        pain_v = pain_by_date.get(d)
        if pain_v is None and r.get("pain_reports"):
            pain_v = max((float(p.get("pain_level", 0)) for p in r["pain_reports"]), default=None)
        rows["pain"].append({"date": d, "value": pain_v, "color": _color_for_value(pain_v, "pain")})
        # recovery composite
        c = compute_recovery_composite(r)
        rec_v = c["score"] if c else None
        rows["recovery"].append({"date": d, "value": rec_v, "color": _color_for_value(rec_v, "recovery")})
        # fatigue
        fat = r.get("fatigue_level") or r.get("morning_fatigue")
        rows["fatigue"].append({"date": d, "value": fat, "color": _color_for_value(fat, "fatigue")})
        # load
        load_v = load_by_date.get(d)
        rows["load"].append({"date": d, "value": round(load_v, 0) if load_v else None, "color": _color_for_value(load_v, "load")})

    return {
        "dates": dates,
        "rows": rows,
        "weekdays": [datetime.strptime(d, "%Y-%m-%d").strftime("%a") for d in dates],
    }


# ============================================================
# 5) FLAGGED ATHLETES PANEL
# ============================================================
async def get_flagged_athletes(db, team: Optional[str] = None) -> list:
    """List athletes with current concerning patterns. Descriptive only."""
    query = {"active": True, "status": {"$in": ["approved", None]}}
    if team:
        query["team"] = team

    athletes = await db.athletes.find(query, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(200)
    flagged = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for a in athletes:
        reasons = []
        severity = "yellow"
        # Last readiness
        last_r = await db.daily_readiness.find_one(
            {"athlete_id": a["id"]}, {"_id": 0}, sort=[("date", -1)]
        )
        if last_r:
            rs = last_r.get("readiness_score")
            if rs is not None and rs < 5:
                reasons.append({"type": "low_readiness", "label": f"Readiness baixa ({rs:.1f}/10)"})
                if rs < 4:
                    severity = "red"

        # Trends
        trends = await detect_trends(db, a["id"], lookback_days=10)
        for t in trends:
            reasons.append({"type": t["type"], "label": t["message"][:100]})
            if t["severity"] == "orange":
                severity = "orange" if severity != "red" else "red"
            elif t["severity"] == "red":
                severity = "red"

        # Availability
        avail = await compute_training_availability(db, a["id"])
        if avail["category_color"] == "red":
            reasons.append({"type": "low_availability", "label": f"Reduced availability ({avail['percentage']:.0f}%)"})
            severity = "red"

        if reasons:
            flagged.append({
                "athlete_id": a["id"],
                "name": a["name"],
                "team": a.get("team"),
                "reasons": reasons[:4],  # cap at 4 for UI
                "severity": severity,
                "severity_color": severity,
                "flagged_at": now_iso,
                "availability_pct": avail["percentage"],
            })

    # Sort by severity (red > orange > yellow) and availability
    sev_order = {"red": 0, "orange": 1, "yellow": 2}
    flagged.sort(key=lambda f: (sev_order.get(f["severity"], 3), f["availability_pct"]))
    return flagged


# ============================================================
# 6) PERFORMANCE SNAPSHOT (aggregator)
# ============================================================
async def get_performance_snapshot(db, athlete_id: str) -> dict:
    """High-level descriptive summary card data."""
    # Latest readiness
    last_r = await db.daily_readiness.find_one(
        {"athlete_id": athlete_id}, {"_id": 0}, sort=[("date", -1)]
    )
    readiness_score = (last_r or {}).get("readiness_score")

    # Recovery composite series
    recovery = await get_recovery_composite_series(db, athlete_id, days=14)

    # Availability
    availability = await compute_training_availability(db, athlete_id)

    # Trends
    trends = await detect_trends(db, athlete_id, lookback_days=14)

    # Load trend: last 7d vs previous 7d
    now = datetime.now(timezone.utc)
    last7_start = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    last14_start = (now - timedelta(days=14)).strftime("%Y-%m-%d")
    sessions = await db.training_sessions.find(
        {"athlete_id": athlete_id, "date_time_start": {"$gte": last14_start}}, {"_id": 0}
    ).to_list(length=None)
    last7_load = sum(float(s.get("internal_load") or 0) for s in sessions if (s.get("date_time_start") or "") >= last7_start)
    prev7_load = sum(float(s.get("internal_load") or 0) for s in sessions) - last7_load
    if prev7_load > 0:
        load_change_pct = round((last7_load - prev7_load) / prev7_load * 100, 1)
    else:
        load_change_pct = None
    load_trend = "stable"
    if load_change_pct is not None:
        if load_change_pct > 15:
            load_trend = "up"
        elif load_change_pct < -15:
            load_trend = "down"

    # CMJ deviation
    cmj_deviation = None
    baseline_doc = await db.cmj_baselines.find_one({"athlete_id": athlete_id}, {"_id": 0})
    if baseline_doc and baseline_doc.get("jump_height_cm"):
        recent_test = await db.cmj_tests.find_one(
            {"athlete_id": athlete_id}, {"_id": 0}, sort=[("date", -1)]
        )
        if recent_test and recent_test.get("cmj_best"):
            base = float(baseline_doc["jump_height_cm"])
            cur = float(recent_test["cmj_best"])
            cmj_deviation = {
                "deviation_pct": round((cur - base) / base * 100, 1),
                "baseline_cm": base,
                "current_cm": cur,
                "test_date": recent_test.get("date"),
            }

    # Compliance: last 7 days
    last7 = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    checkins_count = await db.daily_readiness.count_documents(
        {"athlete_id": athlete_id, "date": {"$gte": last7}}
    )
    compliance_pct = round((checkins_count / 7) * 100, 0)

    # Build descriptive narrative
    narrative_parts = []
    if availability["category"] == "High availability":
        narrative_parts.append("Athlete currently shows high availability")
    elif availability["category"] == "Moderate availability":
        narrative_parts.append("Athlete shows moderate availability")
    else:
        narrative_parts.append("Athlete shows indicators of reduced availability")

    if load_change_pct is not None:
        if load_trend == "up":
            narrative_parts.append(f"with a load increase ({load_change_pct:+.0f}%) over the last week")
        elif load_trend == "down":
            narrative_parts.append(f"with a load reduction ({load_change_pct:+.0f}%) over the last week")

    if recovery["delta_7d_vs_prev"] is not None and recovery["delta_7d_vs_prev"] < -0.5:
        narrative_parts.append(f"accompanied by a drop in recovery score (Δ {recovery['delta_7d_vs_prev']:+.1f})")

    if trends:
        narrative_parts.append(f"and {len(trends)} descriptive trend(s) observed")

    narrative = ". ".join(p.strip().rstrip(".") for p in narrative_parts if p.strip()) + "."

    return {
        "narrative": narrative,
        "readiness": {"current": readiness_score, "date": (last_r or {}).get("date")},
        "recovery_composite": {
            "current": recovery["current"],
            "avg_7d": recovery["avg_7d"],
            "delta_7d_vs_prev": recovery["delta_7d_vs_prev"],
        },
        "availability": availability,
        "load": {
            "last_7d_total": round(last7_load, 0),
            "prev_7d_total": round(prev7_load, 0),
            "change_pct": load_change_pct,
            "trend": load_trend,
        },
        "compliance": {"last_7d_pct": compliance_pct, "checkins": checkins_count},
        "cmj_deviation": cmj_deviation,
        "trends": trends,
        "trends_count": len(trends),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Descriptive summary. Does not constitute clinical diagnosis or injury prediction.",
    }


# ============================================================
# ROUTE REGISTRATION
# ============================================================
def register_clinical_intelligence_routes(api_router, db, get_current_user):
    @api_router.get("/clinical/athlete/{athlete_id}/snapshot")
    async def athlete_snapshot(athlete_id: str, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            # Allow athlete to view their own snapshot
            if not (current_user.get("user", {}).get("id") == athlete_id):
                raise HTTPException(status_code=403, detail="Acesso negado")
        return await get_performance_snapshot(db, athlete_id)

    @api_router.get("/clinical/athlete/{athlete_id}/heatmap")
    async def athlete_heatmap(athlete_id: str, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            if not (current_user.get("user", {}).get("id") == athlete_id):
                raise HTTPException(status_code=403, detail="Acesso negado")
        return await get_weekly_heatmap(db, athlete_id)

    @api_router.get("/clinical/athlete/{athlete_id}/recovery-composite")
    async def athlete_recovery(athlete_id: str, days: int = 14, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            if not (current_user.get("user", {}).get("id") == athlete_id):
                raise HTTPException(status_code=403, detail="Acesso negado")
        return await get_recovery_composite_series(db, athlete_id, days=days)

    @api_router.get("/clinical/athlete/{athlete_id}/availability")
    async def athlete_availability(athlete_id: str, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            if not (current_user.get("user", {}).get("id") == athlete_id):
                raise HTTPException(status_code=403, detail="Acesso negado")
        return await compute_training_availability(db, athlete_id)

    @api_router.get("/clinical/athlete/{athlete_id}/trends")
    async def athlete_trends(athlete_id: str, days: int = 14, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            if not (current_user.get("user", {}).get("id") == athlete_id):
                raise HTTPException(status_code=403, detail="Acesso negado")
        trends = await detect_trends(db, athlete_id, lookback_days=days)
        return {"trends": trends, "count": len(trends)}

    @api_router.get("/clinical/flagged-athletes")
    async def flagged_athletes(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        if current_user["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        flagged = await get_flagged_athletes(db, team=team)
        return {"flagged": flagged, "count": len(flagged), "generated_at": datetime.now(timezone.utc).isoformat()}
