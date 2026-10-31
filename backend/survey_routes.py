"""
Admin-built quick surveys (polls) that gate an athlete's daily registrations.

- Admin (role == 'Admin') builds a survey with multiple questions (single-choice,
  multi-choice or free text), targeted to a date and (optionally) a team, and can
  mark it anonymous.
- On the active/target date, the athlete must answer the survey before the morning
  check-in and training log. Once answered that day, it is not asked again.
- Analysis endpoint aggregates responses (names hidden when the survey is anonymous).
"""
import logging
from datetime import datetime, timezone
from typing import Optional, List
from uuid import uuid4

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app_time import local_now

logger = logging.getLogger(__name__)


async def pending_mandatory_surveys(db, athlete_id: str, team: Optional[str], today: str):
    """Return active surveys targeted at `today` for this athlete's team that they
    haven't answered yet. Used both by the athlete endpoint and to hard-block the
    daily check-in / training log on the backend."""
    query = {"active": True, "target_date": today, "$or": [{"team": None}, {"team": team}]}
    surveys = await db.surveys.find(query, {"_id": 0}).sort("created_at", 1).to_list(50)
    pending = []
    for s in surveys:
        answered = await db.survey_responses.find_one(
            {"survey_id": s["id"], "athlete_id": athlete_id, "date": today})
        if not answered:
            pending.append(s)
    return pending


class SurveyQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    text: str
    type: str = "single"  # single | multi | text
    options: List[str] = []
    allow_other: bool = False
    required: bool = True


class SurveyCreate(BaseModel):
    title: str
    description: Optional[str] = None
    target_date: str  # YYYY-MM-DD
    team: Optional[str] = None  # None/"all" => all teams
    anonymous: bool = False
    active: bool = True
    questions: List[SurveyQuestion] = []


class SurveyAnswer(BaseModel):
    question_id: str
    selected: List[str] = []
    other_text: Optional[str] = None
    text: Optional[str] = None


class SurveyResponseCreate(BaseModel):
    answers: List[SurveyAnswer] = []


def register_survey_routes(api_router, db, get_current_user):

    def _require_admin(current_user: dict):
        if current_user['user_type'] != 'staff':
            raise HTTPException(status_code=403, detail="Staff only")
        if current_user['user'].get('role') != 'Admin':
            raise HTTPException(status_code=403, detail="Admin only")

    async def _survey_or_404(survey_id: str) -> dict:
        s = await db.surveys.find_one({"id": survey_id}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Survey not found")
        return s

    # ---------- Admin: build & manage ----------
    @api_router.post("/admin/surveys")
    async def create_survey(data: SurveyCreate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        if not data.questions:
            raise HTTPException(status_code=400, detail="Add at least one question")
        doc = data.model_dump()
        doc["id"] = str(uuid4())
        doc["team"] = None if (data.team in (None, "all", "")) else data.team
        doc["created_by"] = current_user['user'].get('id')
        doc["created_by_name"] = current_user['user'].get('name')
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.surveys.insert_one(doc)
        doc.pop("_id", None)
        return {"success": True, "survey": doc}

    @api_router.get("/admin/surveys")
    async def list_surveys(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        surveys = await db.surveys.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        for s in surveys:
            s["response_count"] = await db.survey_responses.count_documents({"survey_id": s["id"]})
        return surveys

    @api_router.get("/admin/surveys/{survey_id}")
    async def get_survey_admin(survey_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        return await _survey_or_404(survey_id)

    @api_router.put("/admin/surveys/{survey_id}")
    async def update_survey(survey_id: str, data: SurveyCreate, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        await _survey_or_404(survey_id)
        upd = data.model_dump()
        upd["team"] = None if (data.team in (None, "all", "")) else data.team
        await db.surveys.update_one({"id": survey_id}, {"$set": upd})
        return {"success": True}

    @api_router.put("/admin/surveys/{survey_id}/toggle")
    async def toggle_survey(survey_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        s = await _survey_or_404(survey_id)
        new_active = not s.get("active", True)
        await db.surveys.update_one({"id": survey_id}, {"$set": {"active": new_active}})
        return {"success": True, "active": new_active}

    @api_router.delete("/admin/surveys/{survey_id}")
    async def delete_survey(survey_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        await _survey_or_404(survey_id)
        await db.surveys.delete_one({"id": survey_id})
        await db.survey_responses.delete_many({"survey_id": survey_id})
        return {"success": True}

    @api_router.get("/admin/surveys/{survey_id}/analysis")
    async def survey_analysis(survey_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        survey = await _survey_or_404(survey_id)
        responses = await db.survey_responses.find({"survey_id": survey_id}, {"_id": 0}).sort("submitted_at", -1).to_list(1000)
        anonymous = survey.get("anonymous", False)

        # Target audience size (active athletes in team) for a response rate
        aq = {"active": True}
        if survey.get("team"):
            aq["team"] = survey["team"]
        target_total = await db.athletes.count_documents(aq)

        questions_out = []
        for q in survey.get("questions", []):
            qid = q["id"]
            entry = {"question_id": qid, "text": q["text"], "type": q["type"]}
            if q["type"] in ("single", "multi"):
                counts = {opt: 0 for opt in q.get("options", [])}
                other_texts = []
                for r in responses:
                    for a in r.get("answers", []):
                        if a.get("question_id") != qid:
                            continue
                        for sel in a.get("selected", []):
                            if sel in counts:
                                counts[sel] += 1
                            else:
                                counts[sel] = counts.get(sel, 0) + 1
                        if a.get("other_text"):
                            other_texts.append(a["other_text"])
                entry["options"] = [{"label": k, "count": v} for k, v in counts.items()]
                entry["other_texts"] = other_texts
            else:  # text
                texts = []
                for r in responses:
                    for a in r.get("answers", []):
                        if a.get("question_id") == qid and a.get("text"):
                            item = {"text": a["text"]}
                            if not anonymous:
                                item["athlete_name"] = r.get("athlete_name")
                            texts.append(item)
                entry["texts"] = texts
            questions_out.append(entry)

        respondents = None
        if not anonymous:
            respondents = [{"athlete_name": r.get("athlete_name"),
                            "athlete_id": r.get("athlete_id"),
                            "submitted_at": r.get("submitted_at")} for r in responses]

        return {
            "survey": {k: survey[k] for k in ("id", "title", "description", "target_date", "team", "anonymous", "active", "questions") if k in survey},
            "anonymous": anonymous,
            "response_count": len(responses),
            "target_total": target_total,
            "questions": questions_out,
            "respondents": respondents,
        }

    # ---------- Athlete: pending & respond ----------
    async def _athlete_ctx(current_user: dict):
        if current_user['user_type'] != 'athlete':
            raise HTTPException(status_code=403, detail="Athletes only")
        a = current_user['user']
        return a.get('id'), a.get('team')

    @api_router.get("/surveys/pending")
    async def pending_surveys(current_user: dict = Depends(get_current_user)):
        """Active surveys targeted at today for this athlete's team that they haven't answered today."""
        athlete_id, team = await _athlete_ctx(current_user)
        today = local_now().strftime("%Y-%m-%d")
        pending = await pending_mandatory_surveys(db, athlete_id, team, today)
        return {"count": len(pending), "surveys": pending}

    @api_router.post("/surveys/{survey_id}/respond")
    async def respond_survey(survey_id: str, data: SurveyResponseCreate, current_user: dict = Depends(get_current_user)):
        athlete_id, team = await _athlete_ctx(current_user)
        survey = await _survey_or_404(survey_id)
        today = local_now().strftime("%Y-%m-%d")

        existing = await db.survey_responses.find_one(
            {"survey_id": survey_id, "athlete_id": athlete_id, "date": today})
        if existing:
            return {"success": True, "message": "Already answered"}

        # Validate required questions are answered
        answers_by_q = {a.question_id: a for a in data.answers}
        for q in survey.get("questions", []):
            if not q.get("required", True):
                continue
            a = answers_by_q.get(q["id"])
            has = a and ((a.selected and len(a.selected) > 0) or (a.other_text and a.other_text.strip()) or (a.text and a.text.strip()))
            if not has:
                raise HTTPException(status_code=400, detail=f"Please answer: {q['text']}")

        doc = {
            "id": str(uuid4()),
            "survey_id": survey_id,
            "athlete_id": athlete_id,
            "athlete_name": current_user['user'].get('name'),
            "team": team,
            "date": today,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "answers": [a.model_dump() for a in data.answers],
        }
        await db.survey_responses.insert_one(doc)
        return {"success": True}
