"""Weekly Health Surveillance — OSTRC-H2 (Phase 1: athlete core).

Implements the official OSTRC-H2 questionnaire (English only), per-athlete
weekly cycle with a 24h "Later" grace, official scoring, multiple health
problems per week, and longitudinal problem records. Nothing is overwritten;
missed data is never imputed as a healthy zero.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app_time import local_now
import health_report_service

logger = logging.getLogger(__name__)

# ---- Official OSTRC-H2 content (do NOT paraphrase the four questions) ----
OSTRC_VERSION = "OSTRC-H2-2020"

OSTRC_QUESTIONS = [
    {
        "code": "OSTRC_Q1_PARTICIPATION",
        "order": 1,
        "text": "To what extent have you been able to participate in normal training or competition during the past 7 days?",
        "options": [
            {"code": "a", "text": "Full participation without health problems", "score": 0},
            {"code": "b", "text": "Full participation but with health problems", "score": 8},
            {"code": "c", "text": "Reduced participation due to health problems", "score": 17},
            {"code": "d", "text": "Could not participate due to health problems", "score": 100},
        ],
    },
    {
        "code": "OSTRC_Q2_MODIFICATION",
        "order": 2,
        "text": "To what extent have you reduced your training or competition during the past 7 days due to a health problem?",
        "options": [
            {"code": "a", "text": "No reduction", "score": 0},
            {"code": "b", "text": "Slight reduction", "score": 8},
            {"code": "c", "text": "Moderate reduction", "score": 17},
            {"code": "d", "text": "Considerable reduction", "score": 25},
        ],
    },
    {
        "code": "OSTRC_Q3_PERFORMANCE",
        "order": 3,
        "text": "To what extent has your health problem affected your performance during the past 7 days?",
        "options": [
            {"code": "a", "text": "No effect", "score": 0},
            {"code": "b", "text": "Slightly", "score": 8},
            {"code": "c", "text": "Moderately", "score": 17},
            {"code": "d", "text": "Considerably", "score": 25},
        ],
    },
    {
        "code": "OSTRC_Q4_SYMPTOMS",
        "order": 4,
        "text": "To what extent have you experienced health symptoms during the past 7 days?",
        "options": [
            {"code": "a", "text": "No health symptoms / problems", "score": 0},
            {"code": "b", "text": "To a mild extent", "score": 8},
            {"code": "c", "text": "To a moderate extent", "score": 17},
            {"code": "d", "text": "To a severe extent", "score": 25},
        ],
    },
]

_SCORE = {q["code"]: {o["code"]: o["score"] for o in q["options"]} for q in OSTRC_QUESTIONS}

PROBLEM_CATEGORIES = ["injury", "illness", "pain", "psychological", "other"]

CYCLE_DAYS = 7
GRACE_HOURS = 24


def _score_submission(ans: dict):
    """Return (severity_score, substantial, item_rows) for one problem.

    ans = {"OSTRC_Q1_PARTICIPATION": "a".."d", ...}
    Official logic: Q1=a -> 0 (skip). Q1=d -> 100 (skip). Otherwise sum.
    Substantial = Q1==d OR Q2 in (c,d) OR Q3 in (c,d).
    """
    q1 = ans.get("OSTRC_Q1_PARTICIPATION")
    if q1 not in _SCORE["OSTRC_Q1_PARTICIPATION"]:
        raise HTTPException(status_code=400, detail="Invalid OSTRC Q1 answer")
    s1 = _SCORE["OSTRC_Q1_PARTICIPATION"][q1]

    def row(code, ans_code):
        opt = next(o for o in next(q for q in OSTRC_QUESTIONS if q["code"] == code)["options"] if o["code"] == ans_code)
        return {"question_code": code, "answer_code": ans_code,
                "displayed_answer_text": opt["text"], "score_value": opt["score"]}

    items = [row("OSTRC_Q1_PARTICIPATION", q1)]

    if s1 == 0:
        return 0, False, items
    if s1 == 100:
        return 100, True, items

    total = s1
    substantial = False
    for code in ["OSTRC_Q2_MODIFICATION", "OSTRC_Q3_PERFORMANCE", "OSTRC_Q4_SYMPTOMS"]:
        a = ans.get(code)
        if a not in _SCORE[code]:
            raise HTTPException(status_code=400, detail=f"Invalid answer for {code}")
        total += _SCORE[code][a]
        items.append(row(code, a))
        if code in ("OSTRC_Q2_MODIFICATION", "OSTRC_Q3_PERFORMANCE") and a in ("c", "d"):
            substantial = True
    return total, substantial, items


def register_health_routes(api_router: APIRouter, db, get_current_user):

    def _athlete_id(current_user):
        if current_user.get("user_type") != "athlete":
            raise HTTPException(status_code=403, detail="Athletes only")
        return current_user["user"]["id"]

    async def _compute_status(athlete_id):
        now = local_now()
        last = await db.health_weekly_submissions.find(
            {"athlete_id": athlete_id, "submission_status": {"$in": ["completed", "completed_late"]}},
            {"_id": 0}
        ).sort("submitted_at", -1).limit(1).to_list(1)
        last_sub = last[0] if last else None
        last_date = last_sub["submitted_at"][:10] if last_sub else None

        due = True
        next_available = None
        if last_sub:
            last_dt = datetime.fromisoformat(last_sub["submitted_at"])
            days_since = (now - last_dt).days
            due = days_since >= CYCLE_DAYS
            if not due:
                next_available = (last_dt + timedelta(days=CYCLE_DAYS)).strftime("%Y-%m-%d")

        active_problems = await db.health_problems.count_documents(
            {"athlete_id": athlete_id, "status": {"$nin": ["resolved", "archived"]}}
        )

        if not due:
            return {"state": "completed", "is_mandatory": False, "last_submission_date": last_date,
                    "next_available_date": next_available, "active_problems": active_problems,
                    "postponed_until": None}

        meta = await db.health_status_meta.find_one({"athlete_id": athlete_id}, {"_id": 0}) or {}
        first_due = meta.get("first_seen_due_at")
        if not first_due:
            first_due = now.isoformat()
            await db.health_status_meta.update_one(
                {"athlete_id": athlete_id},
                {"$set": {"athlete_id": athlete_id, "first_seen_due_at": first_due, "postpone_count": 0}},
                upsert=True,
            )
        postponed_until = meta.get("postponed_until")
        if postponed_until and now < datetime.fromisoformat(postponed_until):
            return {"state": "postponed", "is_mandatory": False, "last_submission_date": last_date,
                    "next_available_date": None, "active_problems": active_problems,
                    "postponed_until": postponed_until, "can_postpone": False}

        been_due_h = (now - datetime.fromisoformat(first_due)).total_seconds() / 3600
        mandatory = (meta.get("postpone_count", 0) > 0) or (been_due_h >= GRACE_HOURS)
        return {"state": "overdue" if mandatory else "ready", "is_mandatory": mandatory,
                "last_submission_date": last_date, "next_available_date": None,
                "active_problems": active_problems, "postponed_until": None,
                "can_postpone": not mandatory}

    @api_router.get("/health/questionnaire")
    async def get_questionnaire(current_user: dict = Depends(get_current_user)):
        return {"version": OSTRC_VERSION, "questions": OSTRC_QUESTIONS, "categories": PROBLEM_CATEGORIES}

    @api_router.get("/health/status")
    async def health_status(current_user: dict = Depends(get_current_user)):
        status = await _compute_status(_athlete_id(current_user))
        # The daily check-in is locked every week until the OSTRC health check is completed.
        status["blocks_daily"] = status.get("state") != "completed"
        return status

    @api_router.post("/health/postpone")
    async def health_postpone(current_user: dict = Depends(get_current_user)):
        athlete_id = _athlete_id(current_user)
        status = await _compute_status(athlete_id)
        if status["state"] == "completed":
            raise HTTPException(status_code=400, detail="No pending health check")
        if status.get("is_mandatory"):
            raise HTTPException(status_code=400, detail="This health check is now mandatory and can no longer be postponed")
        now = local_now()
        await db.health_status_meta.update_one(
            {"athlete_id": athlete_id},
            {"$set": {"postponed_until": (now + timedelta(hours=GRACE_HOURS)).isoformat()},
             "$inc": {"postpone_count": 1}},
            upsert=True,
        )
        return {"success": True, "postponed_until": (now + timedelta(hours=GRACE_HOURS)).isoformat()}

    @api_router.get("/health/my-problems")
    async def my_active_problems(current_user: dict = Depends(get_current_user)):
        athlete_id = _athlete_id(current_user)
        problems = await db.health_problems.find(
            {"athlete_id": athlete_id, "status": {"$nin": ["archived"]}}, {"_id": 0}
        ).sort("last_reported_date", -1).to_list(100)
        return problems

    @api_router.get("/health/my-history")
    async def my_history(current_user: dict = Depends(get_current_user)):
        athlete_id = _athlete_id(current_user)
        subs = await db.health_weekly_submissions.find(
            {"athlete_id": athlete_id}, {"_id": 0}
        ).sort("submitted_at", -1).to_list(200)
        return subs

    @api_router.post("/health/submit")
    async def submit_health_check(payload: dict, current_user: dict = Depends(get_current_user)):
        athlete_id = _athlete_id(current_user)
        # Offline idempotency: if this client submission was already stored, return it.
        client_sid = payload.get("client_submission_id")
        if client_sid:
            existing = await db.health_weekly_submissions.find_one(
                {"athlete_id": athlete_id, "client_submission_id": client_sid}, {"_id": 0}
            )
            if existing:
                return {"success": True, "submission_id": existing["id"], "duplicate": True,
                        "no_problem": not existing.get("has_health_problem"),
                        "problems": [], "highest_severity_score": existing.get("highest_severity_score", 0),
                        "contains_substantial_problem": existing.get("contains_substantial_problem", False)}
        athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "team": 1})
        team = (athlete or {}).get("team")
        now = local_now()
        now_iso = now.isoformat()

        status = await _compute_status(athlete_id)
        submitted_late = bool(status.get("is_mandatory"))

        problems_in = payload.get("problems") or []
        no_problem = bool(payload.get("no_problem")) or len(problems_in) == 0
        started_at = payload.get("started_at")
        completion_time = payload.get("completion_time_seconds")

        submission_id = str(uuid.uuid4())
        period_start = (now - timedelta(days=CYCLE_DAYS)).strftime("%Y-%m-%d")
        period_end = now.strftime("%Y-%m-%d")

        submission = {
            "id": submission_id,
            "athlete_id": athlete_id,
            "team_id": team,
            "submitted_at": now_iso,
            "started_at": started_at,
            "completion_time_seconds": completion_time,
            "submission_status": "completed_late" if submitted_late else "completed",
            "submitted_late": submitted_late,
            "questionnaire_version": OSTRC_VERSION,
            "questionnaire_language": "en",
            "client_submission_id": payload.get("client_submission_id"),
            "offline_submission": bool(payload.get("offline_submission")),
            "reporting_period_start": period_start,
            "reporting_period_end": period_end,
            "has_health_problem": not no_problem,
            "number_of_reported_problems": 0,
            "highest_severity_score": 0,
            "total_problem_severity": 0,
            "contains_substantial_problem": False,
            "requires_medical_review": False,
            "review_status": "not_reviewed",
            "created_at": now_iso,
        }

        highest = 0
        total_sev = 0
        contains_substantial = False
        problem_summaries = []

        if not no_problem:
            for p in problems_in:
                ans = p.get("ostrc") or {}
                severity, substantial, items = _score_submission(ans)
                category = p.get("category") if p.get("category") in PROBLEM_CATEGORIES else "other"
                existing_id = p.get("existing_problem_id")

                # Q1=a (full participation, no health problem) -> severity 0 and no link.
                # Do not create a spurious health-problem record.
                if severity == 0 and not existing_id:
                    continue

                if existing_id:
                    prob = await db.health_problems.find_one({"id": existing_id, "athlete_id": athlete_id}, {"_id": 0})
                    if prob:
                        problem_id = existing_id
                        new_status = "resolved" if severity == 0 else ("worsening" if severity > (prob.get("current_severity_score") or 0) else "ongoing")
                        await db.health_problems.update_one(
                            {"id": existing_id},
                            {"$set": {
                                "current_submission_id": submission_id,
                                "last_reported_date": period_end,
                                "current_severity_score": severity,
                                "status": new_status,
                                "current_availability": _availability(ans),
                                "substantial_problem": substantial,
                                "updated_at": now_iso,
                                "resolved_date": period_end if severity == 0 else prob.get("resolved_date"),
                            },
                             "$max": {"highest_severity_score": severity},
                             "$inc": {"consecutive_weeks_reported": 1, "total_weeks_reported": 1}},
                        )
                    else:
                        existing_id = None

                if not existing_id:
                    problem_id = str(uuid.uuid4())
                    await db.health_problems.insert_one({
                        "id": problem_id,
                        "athlete_id": athlete_id,
                        "team_id": team,
                        "first_submission_id": submission_id,
                        "current_submission_id": submission_id,
                        "problem_type": category,
                        "problem_category": category,
                        "body_region": p.get("body_region"),
                        "body_side": p.get("body_side"),
                        "athlete_description": p.get("description"),
                        "onset_date": p.get("onset_date"),
                        "onset_type": p.get("onset_type"),
                        "context": p.get("context"),
                        "first_reported_date": period_end,
                        "last_reported_date": period_end,
                        "resolved_date": None,
                        "status": "resolved" if severity == 0 else "new",
                        "current_availability": _availability(ans),
                        "current_severity_score": severity,
                        "highest_severity_score": severity,
                        "consecutive_weeks_reported": 1,
                        "total_weeks_reported": 1,
                        "recurrence_count": 0,
                        "substantial_problem": substantial,
                        "requested_medical_contact": bool(p.get("request_contact")),
                        "medical_priority": "high" if substantial else ("moderate" if severity >= 17 else "low"),
                        "confidential": category == "psychological",
                        "created_at": now_iso,
                        "updated_at": now_iso,
                    })

                # Weekly observation + response items (longitudinal)
                await db.health_problem_observations.insert_one({
                    "id": str(uuid.uuid4()),
                    "health_problem_id": problem_id,
                    "submission_id": submission_id,
                    "athlete_id": athlete_id,
                    "severity_score": severity,
                    "substantial_problem": substantial,
                    "availability_status": _availability(ans),
                    "reporting_period_end": period_end,
                    "response_items": items,
                    "created_at": now_iso,
                })

                highest = max(highest, severity)
                total_sev += severity
                contains_substantial = contains_substantial or substantial
                problem_summaries.append({"problem_id": problem_id, "category": category,
                                          "severity_score": severity, "substantial": substantial})

        submission.update({
            "number_of_reported_problems": len(problem_summaries),
            "highest_severity_score": highest,
            "total_problem_severity": total_sev,
            "contains_substantial_problem": contains_substantial,
            "has_health_problem": len(problem_summaries) > 0,
            "requires_medical_review": contains_substantial or highest >= 17,
        })
        await db.health_weekly_submissions.insert_one(submission)
        await db.health_status_meta.delete_one({"athlete_id": athlete_id})

        return {"success": True, "submission_id": submission_id,
                "no_problem": len(problem_summaries) == 0, "problems": problem_summaries,
                "highest_severity_score": highest,
                "contains_substantial_problem": contains_substantial}

    logger.info("Health surveillance routes registered (OSTRC-H2 %s)", OSTRC_VERSION)

    # ---------------------------------------------------------------
    # Phase 2 — Staff Health Dashboard
    # ---------------------------------------------------------------
    def _require_staff(current_user):
        if current_user.get("user_type") != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        return current_user["user"]

    def _severity_band(score):
        if score >= 50:
            return "high"
        if score >= 17:
            return "moderate"
        if score >= 1:
            return "minimal"
        return "none"

    async def _athlete_health_summary(athlete):
        aid = athlete["id"]
        subs = await db.health_weekly_submissions.find(
            {"athlete_id": aid}, {"_id": 0}
        ).sort("submitted_at", -1).limit(5).to_list(5)
        active = await db.health_problems.find(
            {"athlete_id": aid, "status": {"$nin": ["resolved", "archived"]}}, {"_id": 0}
        ).sort("current_severity_score", -1).to_list(50)
        status = await _compute_status(aid)

        current_severity = max([p.get("current_severity_score", 0) for p in active], default=0)
        substantial = any(p.get("substantial_problem") for p in active)
        contact_requested = any(p.get("requested_medical_contact") for p in active)
        # last 3 highest-severity trend (oldest->newest)
        trend = [s.get("highest_severity_score", 0) for s in subs[:3]][::-1]

        # availability from worst active problem
        avail_rank = {"unavailable": 3, "modified": 2, "full": 1}
        availability = "not_updated"
        if status["state"] == "completed":
            availability = "full"
            worst = 0
            for p in active:
                r = avail_rank.get(p.get("current_availability"), 0)
                if r > worst:
                    worst = r
                    availability = p.get("current_availability")
            if not active:
                availability = "full"

        return {
            "athlete_id": aid,
            "name": athlete.get("name"),
            "team": athlete.get("team"),
            "position": athlete.get("position"),
            "status": status["state"],
            "is_mandatory": status.get("is_mandatory", False),
            "last_submission_date": status.get("last_submission_date"),
            "active_problems": len(active),
            "current_severity": current_severity,
            "severity_band": _severity_band(current_severity),
            "substantial": substantial,
            "contact_requested": contact_requested,
            "availability": availability,
            "trend": trend,
        }

    async def _team_athletes(team):
        q = {"active": True}
        if team and team not in ("all", None, ""):
            q["team"] = team
        return await db.athletes.find(q, {"_id": 0, "id": 1, "name": 1, "team": 1, "position": 1, "email": 1}).to_list(1000)

    @api_router.get("/health/staff/overview")
    async def staff_health_overview(team: str = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athletes = await _team_athletes(team)
        summaries = [await _athlete_health_summary(a) for a in athletes]
        total = len(summaries)
        submitted = sum(1 for s in summaries if s["status"] == "completed")
        overdue = sum(1 for s in summaries if s["status"] == "overdue")
        with_problems = sum(1 for s in summaries if s["active_problems"] > 0)
        substantial = sum(1 for s in summaries if s["substantial"])
        contact = sum(1 for s in summaries if s["contact_requested"])
        bands = {"none": 0, "minimal": 0, "moderate": 0, "high": 0}
        avail = {"full": 0, "modified": 0, "unavailable": 0, "not_updated": 0}
        for s in summaries:
            if s["active_problems"] > 0:
                bands[s["severity_band"]] = bands.get(s["severity_band"], 0) + 1
            avail[s["availability"]] = avail.get(s["availability"], 0) + 1
        return {
            "total_athletes": total,
            "submitted_this_week": submitted,
            "overdue": overdue,
            "response_rate": round(100 * submitted / total) if total else 0,
            "athletes_with_problems": with_problems,
            "substantial_problems": substantial,
            "contact_requests": contact,
            "severity_distribution": bands,
            "availability_distribution": avail,
        }

    @api_router.get("/health/staff/athletes")
    async def staff_health_athletes(team: str = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athletes = await _team_athletes(team)
        summaries = [await _athlete_health_summary(a) for a in athletes]
        # sort: substantial first, then severity desc, then overdue
        summaries.sort(key=lambda s: (s["substantial"], s["current_severity"], s["is_mandatory"]), reverse=True)
        return summaries

    @api_router.get("/health/staff/substantial")
    async def staff_substantial_problems(team: str = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athletes = {a["id"]: a for a in await _team_athletes(team)}
        problems = await db.health_problems.find(
            {"athlete_id": {"$in": list(athletes.keys())}, "status": {"$nin": ["resolved", "archived"]},
             "$or": [{"substantial_problem": True}, {"current_severity_score": {"$gte": 17}}]},
            {"_id": 0}
        ).sort("current_severity_score", -1).to_list(200)
        for p in problems:
            a = athletes.get(p["athlete_id"], {})
            p["athlete_name"] = a.get("name")
            p["team"] = a.get("team")
        return problems

    @api_router.get("/health/staff/athlete/{athlete_id}")
    async def staff_athlete_health_profile(athlete_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athlete = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "id": 1, "name": 1, "team": 1, "position": 1})
        if not athlete:
            raise HTTPException(status_code=404, detail="Athlete not found")
        submissions = await db.health_weekly_submissions.find(
            {"athlete_id": athlete_id}, {"_id": 0}
        ).sort("submitted_at", -1).to_list(200)
        problems = await db.health_problems.find(
            {"athlete_id": athlete_id}, {"_id": 0}
        ).sort("last_reported_date", -1).to_list(200)
        for p in problems:
            obs = await db.health_problem_observations.find(
                {"health_problem_id": p["id"]}, {"_id": 0}
            ).sort("reporting_period_end", 1).to_list(200)
            p["observations"] = obs
        summary = await _athlete_health_summary(athlete)
        return {"athlete": athlete, "summary": summary, "submissions": submissions, "problems": problems}

    @api_router.get("/health/staff/combined-risk")
    async def staff_combined_risk(team: str = None, days: int = 7, current_user: dict = Depends(get_current_user)):
        """Cross-reference training load with weekly health surveillance.

        Flags athletes who are BOTH carrying an elevated training load (above the
        team high-load threshold = mean + 1 SD, or mean*1.3 with <3 athletes) AND
        currently reporting an elevated/substantial health problem (severity >= 17
        or an OSTRC-H2 substantial problem). Descriptive/associative only — never
        implies the load caused the health problem.
        """
        _require_staff(current_user)
        athletes = await _team_athletes(team)
        ids = [a["id"] for a in athletes]

        # ---- Training load over the window (same method as load-monitoring) ----
        start_iso = (local_now() - timedelta(days=days)).isoformat()
        sessions = await db.training_sessions.find(
            {"athlete_id": {"$in": ids}, "date_time_start": {"$gte": start_iso}},
            {"_id": 0, "athlete_id": 1, "internal_load": 1},
        ).to_list(5000)
        load_by_athlete = {}
        for s in sessions:
            aid = s["athlete_id"]
            load_by_athlete[aid] = load_by_athlete.get(aid, 0) + int(s.get("internal_load", 0) or 0)

        loads = [v for v in load_by_athlete.values() if v > 0]
        n = len(loads)
        team_mean = round(sum(loads) / n, 1) if n else None
        threshold = None
        threshold_method = None
        if n >= 3:
            mean_v = sum(loads) / n
            sd_v = (sum((x - mean_v) ** 2 for x in loads) / n) ** 0.5
            threshold = round(mean_v + sd_v, 1)
            threshold_method = "mean+1sd"
        elif n >= 1:
            threshold = round(team_mean * 1.3, 1)
            threshold_method = "mean*1.3"

        # ---- Health summaries + combine ----
        rows = []
        for a in athletes:
            aid = a["id"]
            summary = await _athlete_health_summary(a)
            total_load = load_by_athlete.get(aid, 0)
            high_load = bool(threshold is not None and total_load > 0 and total_load > threshold)
            pct_above = round(100 * (total_load - team_mean) / team_mean) if (team_mean and total_load > 0) else None
            elevated_health = bool(summary["substantial"] or summary["current_severity"] >= 17)
            combined_risk = bool(high_load and elevated_health)

            factors = []
            if high_load:
                factors.append(
                    f"Training load {('+' + str(pct_above)) if pct_above and pct_above > 0 else pct_above}% vs team average"
                    if pct_above is not None else "Elevated training load"
                )
            if summary["substantial"]:
                factors.append("Substantial health problem reported")
            elif summary["current_severity"] >= 17:
                factors.append(f"Elevated severity score ({summary['current_severity']}/100)")

            rows.append({
                "athlete_id": aid,
                "name": a.get("name"),
                "team": a.get("team"),
                "total_load": total_load,
                "high_load": high_load,
                "pct_above": pct_above,
                "current_severity": summary["current_severity"],
                "severity_band": summary["severity_band"],
                "substantial": summary["substantial"],
                "availability": summary["availability"],
                "active_problems": summary["active_problems"],
                "health_status": summary["status"],
                "elevated_health": elevated_health,
                "combined_risk": combined_risk,
                "factors": factors,
            })

        # combined-risk athletes first, then high-load, then elevated-health, by load desc
        rows.sort(key=lambda r: (r["combined_risk"], r["high_load"], r["elevated_health"], r["total_load"]), reverse=True)
        combined = [r for r in rows if r["combined_risk"]]

        return {
            "days": days,
            "team_mean": team_mean,
            "threshold": threshold,
            "threshold_method": threshold_method,
            "athletes_with_sessions": n,
            "combined_risk_count": len(combined),
            "combined_risk_athletes": combined,
            "athletes": rows,
            "disclaimer": "Associative view only. A high training load is not stated to cause the reported health problem; interpret with clinical context.",
        }

    # ---------------------------------------------------------------
    # Phase 4 (E) — Health PDF Reports (individual + team)
    # ---------------------------------------------------------------
    def _trend_label(scores):
        # scores oldest->newest; improving if latest below previous, worsening if above
        if len(scores) < 2:
            return "stable"
        if scores[-1] < scores[-2]:
            return "improving"
        if scores[-1] > scores[-2]:
            return "worsening"
        return "stable"

    async def _athlete_context(aid):
        cutoff = (local_now() - timedelta(days=7)).strftime("%Y-%m-%d")
        readiness = await db.daily_readiness.find(
            {"athlete_id": aid, "date": {"$gte": cutoff}}, {"_id": 0, "readiness_score": 1, "pain_reports": 1}
        ).to_list(50)
        r_scores = [r["readiness_score"] for r in readiness if r.get("readiness_score") is not None]
        avg_read = round(sum(r_scores) / len(r_scores), 1) if r_scores else None
        cutoff_iso = (local_now() - timedelta(days=7)).isoformat()
        sessions = await db.training_sessions.find(
            {"athlete_id": aid, "date_time_start": {"$gte": cutoff_iso}}, {"_id": 0, "internal_load": 1, "pain_reports": 1}
        ).to_list(200)
        weekly_load = sum(int(s.get("internal_load", 0) or 0) for s in sessions)
        pain_count = sum(len(s.get("pain_reports") or []) for s in sessions) + \
            sum(len(r.get("pain_reports") or []) for r in readiness)
        cmj = "—"
        baseline = await db.cmj_baselines.find_one({"athlete_id": aid}, {"_id": 0, "jump_height_cm": 1})
        latest = await db.cmj_tests.find_one({"athlete_id": aid}, {"_id": 0, "cmj_best": 1, "date": 1}, sort=[("date", -1)])
        if latest and latest.get("cmj_best"):
            cmj = f'{round(float(latest["cmj_best"]), 1)} cm'
            if baseline and baseline.get("jump_height_cm"):
                dev = round((float(latest["cmj_best"]) - float(baseline["jump_height_cm"])) / float(baseline["jump_height_cm"]) * 100, 1)
                cmj += f' ({"+" if dev >= 0 else ""}{dev}% vs baseline)'
        return {
            "readiness": f'{avg_read}/10' if avg_read is not None else "No data",
            "pain_reports": pain_count,
            "weekly_load": f'{weekly_load} AU' if weekly_load else "0 AU",
            "cmj": cmj,
        }

    @api_router.get("/health/staff/report/athlete/{athlete_id}")
    async def athlete_health_report(athlete_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athlete = await db.athletes.find_one(
            {"id": athlete_id}, {"_id": 0, "id": 1, "name": 1, "team": 1, "position": 1})
        if not athlete:
            raise HTTPException(status_code=404, detail="Athlete not found")
        summary = await _athlete_health_summary(athlete)
        subs = await db.health_weekly_submissions.find(
            {"athlete_id": athlete_id}, {"_id": 0}
        ).sort("submitted_at", 1).to_list(400)
        problems = await db.health_problems.find({"athlete_id": athlete_id}, {"_id": 0}).to_list(400)

        # severity trend from submissions (last 12)
        trend_points = []
        for s in subs[-12:]:
            label = (s.get("reporting_period_end") or s.get("submitted_at", "")[:10] or "")[5:]
            trend_points.append({"label": label, "score": int(s.get("highest_severity_score", 0) or 0)})
        trend_scores = [p["score"] for p in trend_points]

        # participation from submissions' highest severity band -> weeks
        part = {"full": 0, "modified": 0, "unable": 0}
        for s in subs:
            sev = int(s.get("highest_severity_score", 0) or 0)
            if sev >= 100:
                part["unable"] += 1
            elif sev >= 17:
                part["modified"] += 1
            else:
                part["full"] += 1

        new_p = sum(1 for p in problems if p.get("status") == "new")
        ongoing_p = sum(1 for p in problems if p.get("status") in ("ongoing", "worsening", "stable", "improving", "recurrent"))
        resolved_p = sum(1 for p in problems if p.get("status") == "resolved")
        substantial_p = sum(1 for p in problems if p.get("substantial_problem"))
        active = [p for p in problems if p.get("status") not in ("resolved", "archived")]

        insights = []
        if summary["substantial"]:
            insights.append("At least one substantial health problem is currently active and requires medical review.")
        if _trend_label(trend_scores) == "worsening":
            insights.append("The severity trend has been worsening across recent weekly submissions.")
        elif _trend_label(trend_scores) == "improving":
            insights.append("The severity trend has been improving across recent weekly submissions.")
        if summary["active_problems"] == 0:
            insights.append("No active health problems are currently reported.")
        if len(subs) < 2:
            insights.append("More weekly submissions are needed for a reliable longitudinal trend.")

        data = {
            "athlete": athlete,
            "period": f'{(subs[0].get("reporting_period_start") if subs else "—")} to {local_now().strftime("%Y-%m-%d")}',
            "generated_at": local_now().strftime("%b %d, %Y %H:%M"),
            "current": {
                "availability": summary["availability"],
                "highest_severity": summary["current_severity"],
                "trend": _trend_label(trend_scores),
                "active_problems": summary["active_problems"],
                "last_submission": summary["last_submission_date"],
                "compliance": summary["status"].title(),
            },
            "weekly_summary": {
                "reported": len(problems), "new": new_p, "ongoing": ongoing_p,
                "resolved": resolved_p, "substantial": substantial_p, "submissions": len(subs),
            },
            "severity_trend": trend_points,
            "participation": part,
            "context": await _athlete_context(athlete_id),
            "insights": insights or ["No notable health findings for this period."],
        }
        pdf = health_report_service.build_athlete_health_pdf(data)
        fname = f'health_report_{athlete.get("name","athlete").replace(" ", "_")}.pdf'
        return StreamingResponse(pdf, media_type="application/pdf",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    @api_router.get("/health/staff/report/team")
    async def team_health_report(team: str = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athletes = await _team_athletes(team)
        summaries = [await _athlete_health_summary(a) for a in athletes]
        total = len(summaries)
        submitted = sum(1 for s in summaries if s["status"] == "completed")
        with_problems = sum(1 for s in summaries if s["active_problems"] > 0)
        substantial = sum(1 for s in summaries if s["substantial"])
        sev_scores = [s["current_severity"] for s in summaries if s["active_problems"] > 0]
        avg_sev = round(sum(sev_scores) / len(sev_scores)) if sev_scores else 0
        bands = {"none": 0, "minimal": 0, "moderate": 0, "high": 0}
        for s in summaries:
            if s["active_problems"] > 0:
                bands[s["severity_band"]] = bands.get(s["severity_band"], 0) + 1

        ids = [a["id"] for a in athletes]
        active_problems = await db.health_problems.find(
            {"athlete_id": {"$in": ids}, "status": {"$nin": ["resolved", "archived"]}}, {"_id": 0}
        ).to_list(1000)
        cat_dist = {}
        for p in active_problems:
            c = p.get("problem_category") or "other"
            cat_dist[c] = cat_dist.get(c, 0) + 1
        new_problems = sum(1 for p in active_problems if p.get("status") == "new")
        recovered = await db.health_problems.count_documents(
            {"athlete_id": {"$in": ids}, "status": "resolved"})

        summaries.sort(key=lambda s: (s["substantial"], s["current_severity"]), reverse=True)
        arrow = {"improving": "Down", "worsening": "Up", "stable": "Stable"}
        priority_rows = []
        for s in summaries[:20]:
            tr = _trend_label(s.get("trend") or [])
            priority_rows.append([
                s["name"], s["availability"].replace("_", " ").title(),
                f'{s["current_severity"]}/100', str(s["active_problems"]),
                "Yes" if s["substantial"] else "No", arrow.get(tr, "Stable"),
            ])

        insights = []
        if with_problems:
            insights.append(f'{with_problems} of {total} athletes reported at least one active health problem.')
        if substantial:
            insights.append(f'{substantial} athlete(s) currently have a substantial health problem requiring review.')
        if cat_dist:
            top_cat = max(cat_dist, key=cat_dist.get)
            insights.append(f'The most frequently reported problem category is "{top_cat}".')
        insights.append(f'Weekly response rate is {round(100*submitted/total) if total else 0}%.')

        team_label = team if (team and team not in ("all", "", None)) else "All Teams"
        data = {
            "team_label": team_label,
            "generated_at": local_now().strftime("%b %d, %Y %H:%M"),
            "overview": {
                "response_rate": round(100 * submitted / total) if total else 0,
                "with_problems": with_problems, "substantial": substantial,
                "new_problems": new_problems, "recovered": recovered, "avg_severity": avg_sev,
            },
            "severity_distribution": bands,
            "category_distribution": cat_dist,
            "priority_rows": priority_rows or [["No athletes", "—", "—", "—", "—", "—"]],
            "insights": insights,
        }
        pdf = health_report_service.build_team_health_pdf(data)
        fname = f'team_health_report_{team_label.replace(" ", "_")}.pdf'
        return StreamingResponse(pdf, media_type="application/pdf",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    # ---------------------------------------------------------------
    # Health alerts + medical follow-up queue + athlete messages
    # ---------------------------------------------------------------
    def _reviewer_name(current_user):
        u = current_user.get("user") or {}
        return u.get("name") or u.get("email") or "Medical staff"

    def _mk_alert(athlete, submission, atype, message, severity, reviewed):
        return {
            "id": f'{athlete["id"]}:{atype}:{submission.get("id","")}',
            "athlete_id": athlete["id"],
            "athlete_name": athlete.get("name"),
            "team": athlete.get("team"),
            "athlete_email": athlete.get("email"),
            "type": atype,
            "message": message,
            "severity": severity,
            "submission_id": submission.get("id"),
            "created_at": submission.get("submitted_at"),
            "handled": bool(reviewed),
        }

    async def _latest_submissions(aid, limit=3):
        return await db.health_weekly_submissions.find(
            {"athlete_id": aid}, {"_id": 0}
        ).sort("submitted_at", -1).to_list(limit)

    @api_router.get("/health/staff/alerts")
    async def health_alerts(team: str = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athletes = await _team_athletes(team)
        alerts = []
        for a in athletes:
            subs = await _latest_submissions(a["id"], 3)
            if not subs:
                continue
            latest = subs[0]
            reviewed = latest.get("review_status") == "reviewed"
            if latest.get("contains_substantial_problem"):
                alerts.append(_mk_alert(a, latest, "substantial",
                    "Substantial health problem reported this week", "high", reviewed))
            probs = await db.health_problems.find(
                {"athlete_id": a["id"], "status": {"$nin": ["resolved", "archived"]}},
                {"_id": 0, "requested_medical_contact": 1}).to_list(50)
            if any(p.get("requested_medical_contact") for p in probs):
                alerts.append(_mk_alert(a, latest, "contact",
                    "Athlete requested contact with the medical team", "high", reviewed))
            scores = [int(s.get("highest_severity_score", 0) or 0) for s in subs][::-1]
            if len(scores) >= 3 and scores[-1] > scores[-2] > scores[-3] and scores[-1] > 0:
                alerts.append(_mk_alert(a, latest, "worsening",
                    "Severity worsening for 2+ consecutive weeks", "medium", reviewed))
            for cs in subs:
                if cs.get("correction_requested"):
                    msg = "Athlete reported an error in a submission"
                    if cs.get("correction_reason"):
                        msg += f': "{cs["correction_reason"]}"'
                    alerts.append(_mk_alert(a, cs, "correction", msg, "high", False))
                    break
        sev_rank = {"high": 0, "medium": 1, "low": 2}
        alerts.sort(key=lambda x: (x["handled"], sev_rank.get(x["severity"], 3)))
        return {"alerts": alerts, "active_count": sum(1 for x in alerts if not x["handled"])}

    @api_router.get("/health/staff/review-queue")
    async def review_queue(team: str = None, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        athletes = await _team_athletes(team)
        items = []
        for a in athletes:
            subs = await _latest_submissions(a["id"], 1)
            if not subs:
                continue
            latest = subs[0]
            if not latest.get("has_health_problem"):
                continue
            items.append({
                "submission_id": latest.get("id"),
                "athlete_id": a["id"],
                "athlete_name": a.get("name"),
                "team": a.get("team"),
                "athlete_email": a.get("email"),
                "submitted_at": latest.get("submitted_at"),
                "highest_severity_score": latest.get("highest_severity_score", 0),
                "contains_substantial_problem": latest.get("contains_substantial_problem", False),
                "number_of_reported_problems": latest.get("number_of_reported_problems", 0),
                "review_status": latest.get("review_status", "not_reviewed"),
                "notes_count": len(latest.get("medical_notes", [])),
            })
        status_rank = {"not_reviewed": 0, "in_review": 1, "reviewed": 2}
        items.sort(key=lambda x: (status_rank.get(x["review_status"], 0),
                                  -int(x["highest_severity_score"] or 0)))
        return {"items": items,
                "pending_count": sum(1 for x in items if x["review_status"] != "reviewed")}

    @api_router.post("/health/staff/review/{submission_id}")
    async def review_submission(submission_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        sub = await db.health_weekly_submissions.find_one({"id": submission_id}, {"_id": 0})
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        note_text = (payload.get("note") or "").strip()
        if note_text:
            note = {
                "id": str(uuid.uuid4()),
                "author": _reviewer_name(current_user),
                "text": note_text,
                "visible_to_athlete": bool(payload.get("visible_to_athlete")),
                "created_at": local_now().isoformat(),
            }
            await db.health_weekly_submissions.update_one(
                {"id": submission_id}, {"$push": {"medical_notes": note}})
        if payload.get("mark_reviewed"):
            await db.health_weekly_submissions.update_one({"id": submission_id}, {"$set": {
                "review_status": "reviewed",
                "reviewed_by": _reviewer_name(current_user),
                "reviewed_at": local_now().isoformat(),
            }})
        elif note_text and sub.get("review_status", "not_reviewed") == "not_reviewed":
            await db.health_weekly_submissions.update_one(
                {"id": submission_id}, {"$set": {"review_status": "in_review"}})
        fresh = await db.health_weekly_submissions.find_one({"id": submission_id}, {"_id": 0})
        return {"success": True, "review_status": fresh.get("review_status", "not_reviewed"),
                "reviewed_by": fresh.get("reviewed_by"), "reviewed_at": fresh.get("reviewed_at"),
                "medical_notes": fresh.get("medical_notes", [])}

    @api_router.get("/health/athlete/messages")
    async def athlete_messages(current_user: dict = Depends(get_current_user)):
        aid = _athlete_id(current_user)
        subs = await db.health_weekly_submissions.find(
            {"athlete_id": aid, "medical_notes.visible_to_athlete": True},
            {"_id": 0, "id": 1, "medical_notes": 1}
        ).to_list(100)
        msgs = []
        for s in subs:
            for n in s.get("medical_notes", []):
                if n.get("visible_to_athlete"):
                    msgs.append({
                        "id": n["id"],
                        "submission_id": s["id"],
                        "text": n["text"],
                        "from": n.get("author", "Medical team"),
                        "from_athlete": bool(n.get("from_athlete")),
                        "date": n.get("created_at"),
                        "read_at": n.get("read_at"),
                    })
        msgs.sort(key=lambda m: m["date"] or "", reverse=True)
        return {"messages": msgs}

    @api_router.post("/health/athlete/messages/{note_id}/read")
    async def athlete_mark_message_read(note_id: str, current_user: dict = Depends(get_current_user)):
        aid = _athlete_id(current_user)
        res = await db.health_weekly_submissions.update_one(
            {"athlete_id": aid, "medical_notes.id": note_id},
            {"$set": {"medical_notes.$[n].read_at": local_now().isoformat()}},
            array_filters=[{"n.id": note_id, "n.read_at": {"$exists": False}}],
        )
        return {"success": True, "updated": res.modified_count}

    @api_router.post("/health/athlete/messages/reply")
    async def athlete_reply_message(payload: dict, current_user: dict = Depends(get_current_user)):
        aid = _athlete_id(current_user)
        text = (payload.get("text") or "").strip()
        submission_id = payload.get("submission_id")
        if not text:
            raise HTTPException(status_code=400, detail="Reply text is required")
        athlete_name = current_user["user"].get("name", "Athlete")
        sub = None
        if submission_id:
            sub = await db.health_weekly_submissions.find_one({"id": submission_id, "athlete_id": aid}, {"_id": 0, "id": 1})
        if not sub:
            sub = await db.health_weekly_submissions.find_one(
                {"athlete_id": aid}, {"_id": 0, "id": 1}, sort=[("submitted_at", -1)])
        if not sub:
            raise HTTPException(status_code=404, detail="No submission to reply to")
        note = {
            "id": str(uuid.uuid4()),
            "author": athlete_name,
            "text": text,
            "visible_to_athlete": True,
            "from_athlete": True,
            "created_at": local_now().isoformat(),
        }
        await db.health_weekly_submissions.update_one(
            {"id": sub["id"]}, {"$push": {"medical_notes": note}, "$set": {"review_status": "not_reviewed"}})
        return {"success": True, "note": note}

    @api_router.post("/health/athlete/report-error")
    async def athlete_report_error(payload: dict, current_user: dict = Depends(get_current_user)):
        aid = _athlete_id(current_user)
        submission_id = payload.get("submission_id")
        reason = (payload.get("reason") or "").strip()
        sub = await db.health_weekly_submissions.find_one({"id": submission_id, "athlete_id": aid}, {"_id": 0, "id": 1})
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        await db.health_weekly_submissions.update_one({"id": submission_id}, {"$set": {
            "correction_requested": True,
            "correction_reason": reason,
            "correction_requested_at": local_now().isoformat(),
        }})
        return {"success": True}

    @api_router.delete("/health/staff/submission/{submission_id}")
    async def staff_delete_submission(submission_id: str, current_user: dict = Depends(get_current_user)):
        _require_staff(current_user)
        sub = await db.health_weekly_submissions.find_one({"id": submission_id}, {"_id": 0, "athlete_id": 1})
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        athlete_id = sub["athlete_id"]
        await db.health_weekly_submissions.delete_one({"id": submission_id})
        await db.health_problem_observations.delete_many({"submission_id": submission_id})
        # remove health problems that were CREATED by this submission
        await db.health_problems.delete_many({"first_submission_id": submission_id})
        # force health status recompute
        await db.health_status_meta.delete_one({"athlete_id": athlete_id})
        return {"success": True, "athlete_id": athlete_id}



def _availability(ans: dict):
    q1 = ans.get("OSTRC_Q1_PARTICIPATION")
    if q1 == "a":
        return "full"
    if q1 == "b":
        return "full"
    if q1 == "c":
        return "modified"
    if q1 == "d":
        return "unavailable"
    return "not_updated"
