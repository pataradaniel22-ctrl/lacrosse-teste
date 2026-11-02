"""Injury & Illness Recording (IIR) — API routes.

Collections
-----------
iir_episodes     one document per injury / illness episode (identified, linked to athlete)
iir_followups    longitudinal follow-up entries of an episode
iir_audit        every create / update / delete / follow-up / attachment / export
iir_events       events / camps / competitions (period configuration, teams in/out)
iir_attachments  metadata of restricted clinical attachments (bytes in object storage)
iir_triage       decisions on pending assessments raised by Pain Map / Readiness / OSTRC
iir_exposure     exposure sessions (games / trainings) — see stage 4
iir_monitoring   athlete monitoring periods (athlete-days, for illness rates)

Access (enforced here, never only in the UI)
--------------------------------------------
clinical (Admin, Physio)  record, edit, view identified clinical data
coach                     participation / availability only
research                  aggregated reports and pseudonymised / anonymised exports
"""
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

import iir_logic as L
import iir_service as S
import iir_taxonomy as T

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _actor(current_user):
    u = current_user.get("user") or {}
    return {"id": u.get("id"), "name": u.get("name") or u.get("email"), "role": u.get("role")}


def register_iir_routes(api_router, db, get_current_user):

    # ------------------------------------------------------------------ guards
    def _level(cu):
        return S.access_level(cu)

    def _require(cu, *levels):
        lvl = _level(cu)
        if lvl not in levels:
            raise HTTPException(status_code=403, detail="You do not have access to this information")
        return lvl

    async def _audit(action, cu, episode_id=None, changes=None, extra=None):
        await db.iir_audit.insert_one({
            "id": str(uuid.uuid4()), "action": action, "episode_id": episode_id, "at": _now(),
            "by": _actor(cu), "changes": changes or [], **({"extra": extra} if extra else {}),
        })

    async def _athlete_map(ids=None):
        q = {"id": {"$in": list(ids)}} if ids is not None else {}
        docs = await db.athletes.find(q, {"_id": 0, "id": 1, "name": 1, "team": 1, "status": 1}).to_list(5000)
        return {a["id"]: a for a in docs}

    async def _enrich(eps, cutoff=None):
        amap = await _athlete_map({e.get("athlete_id") for e in eps if e.get("athlete_id")})
        out = []
        for e in eps:
            e = dict(e)
            e.pop("_id", None)
            a = amap.get(e.get("athlete_id"))
            if a:
                e["athlete_name"] = a.get("name")
                e.setdefault("team", a.get("team"))
            e["computed"] = S.computed(e, cutoff)
            e["summary"] = S.summary_label(e)
            out.append(e)
        return out

    async def _get_episode(episode_id):
        ep = await db.iir_episodes.find_one({"id": episode_id, "deleted": {"$ne": True}}, {"_id": 0})
        if not ep:
            raise HTTPException(status_code=404, detail="Episode not found")
        return ep

    async def _validate_refs(clean, kind, episode_id=None):
        if clean.get("athlete_id"):
            a = await db.athletes.find_one({"id": clean["athlete_id"]}, {"_id": 0, "id": 1, "team": 1})
            if not a:
                raise HTTPException(status_code=400, detail="Athlete not found")
            if not clean.get("team"):
                clean["team"] = a.get("team")
        if clean.get("linked_episode_id"):
            if clean["linked_episode_id"] == episode_id:
                raise HTTPException(status_code=400, detail="An episode cannot be linked to itself")
            prev = await db.iir_episodes.find_one({"id": clean["linked_episode_id"], "deleted": {"$ne": True}},
                                                  {"_id": 0, "id": 1, "athlete_id": 1})
            if not prev:
                raise HTTPException(status_code=400, detail="Linked previous episode not found")
        if clean.get("event_id"):
            if not await db.iir_events.find_one({"id": clean["event_id"]}, {"_id": 0, "id": 1}):
                raise HTTPException(status_code=400, detail="Event not found")
        if clean.get("report_by_id"):
            st = await db.staff_users.find_one({"id": clean["report_by_id"]}, {"_id": 0, "id": 1, "name": 1})
            if not st:
                raise HTTPException(status_code=400, detail="Reporting professional not found")
            clean["report_by"] = {"id": st["id"], "name": st.get("name")}
        clean.pop("report_by_id", None)

    # ---------------------------------------------------------- taxonomy etc.
    @api_router.get("/iir/taxonomy")
    async def iir_taxonomy(current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical", "coach", "research")
        return T.taxonomy_payload()

    @api_router.get("/iir/me")
    async def iir_me(current_user: dict = Depends(get_current_user)):
        return S.permissions(_level(current_user))

    @api_router.get("/iir/staff")
    async def iir_staff(current_user: dict = Depends(get_current_user)):
        """Professionals that can be chosen as 'Report by'."""
        _require(current_user, "clinical")
        docs = await db.staff_users.find({"active": {"$ne": False}, "status": {"$in": ["approved", None]}},
                                         {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
        return docs

    @api_router.get("/iir/athletes")
    async def iir_athletes(current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical", "coach")
        docs = await db.athletes.find({"status": {"$nin": ["rejected", "pending"]}},
                                      {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(5000)
        return sorted(docs, key=lambda a: (a.get("name") or "").lower())

    # ----------------------------------------------------------------- events
    @api_router.get("/iir/events")
    async def iir_events(current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical", "research", "coach")
        return await db.iir_events.find({}, {"_id": 0}).sort("start_date", -1).to_list(500)

    def _norm_event(p):
        out = {}
        for k in ("name", "season", "team", "location", "format", "notes"):
            if k in p:
                out[k] = (str(p[k]).strip() or None) if p[k] is not None else None
        for k in ("start_date", "end_date"):
            if k in p:
                try:
                    d = L.parse_date(p[k])
                    out[k] = d.isoformat() if d else None
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
        if out.get("start_date") and out.get("end_date") and out["end_date"] < out["start_date"]:
            raise HTTPException(status_code=400, detail="Event end date cannot be before start date")
        for k in ("period_minutes", "periods", "overtime_minutes", "game_days"):
            if k in p and p[k] not in (None, ""):
                try:
                    v = int(p[k])
                    if v < 0 or v > 200:
                        raise ValueError
                    out[k] = v
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"{k} must be a positive whole number")
        if "teams" in p:
            teams = []
            for t in p.get("teams") or []:
                name = str(t.get("name") or "").strip()
                if not name:
                    continue
                included = bool(t.get("included", True))
                reason = (str(t.get("exclusion_reason") or "").strip() or None)
                if not included and not reason:
                    raise HTTPException(status_code=400, detail=f"Give the reason for excluding team {name}")
                teams.append({"name": name, "included": included, "exclusion_reason": reason})
            out["teams"] = teams
        return out

    @api_router.post("/iir/events")
    async def iir_create_event(payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        ev = _norm_event(payload)
        if not ev.get("name"):
            raise HTTPException(status_code=400, detail="Event name is required")
        ev.setdefault("format", "sixes")
        for k, v in T.SIXES_PERIODS.items():
            if k != "format":
                ev.setdefault(k, v)
        ev.update({"id": str(uuid.uuid4()), "created_at": _now(), "created_by": _actor(current_user)})
        await db.iir_events.insert_one(dict(ev))
        await _audit("event_create", current_user, extra={"event_id": ev["id"], "name": ev["name"]})
        ev.pop("_id", None)
        return ev

    @api_router.put("/iir/events/{event_id}")
    async def iir_update_event(event_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        old = await db.iir_events.find_one({"id": event_id}, {"_id": 0})
        if not old:
            raise HTTPException(status_code=404, detail="Event not found")
        upd = _norm_event(payload)
        await db.iir_events.update_one({"id": event_id}, {"$set": {**upd, "updated_at": _now()}})
        await _audit("event_update", current_user, changes=S.diff(old, {**old, **upd}),
                     extra={"event_id": event_id})
        return await db.iir_events.find_one({"id": event_id}, {"_id": 0})

    # --------------------------------------------------------------- episodes
    def _filters_to_query(kind=None, status=None, athlete_id=None, team=None, event_id=None,
                          include_drafts=True):
        q = {"deleted": {"$ne": True}}
        if kind in ("injury", "illness"):
            q["kind"] = kind
        if status:
            q["status"] = {"$in": status.split(",")}
        elif not include_drafts:
            q["status"] = {"$ne": "draft"}
        if athlete_id:
            q["athlete_id"] = athlete_id
        if team and team != "all":
            q["team"] = team
        if event_id:
            q["event_id"] = event_id
        return q

    @api_router.get("/iir/episodes")
    async def iir_list_episodes(kind: Optional[str] = None, status: Optional[str] = None,
                                athlete_id: Optional[str] = None, team: Optional[str] = None,
                                event_id: Optional[str] = None, cutoff: Optional[str] = None,
                                current_user: dict = Depends(get_current_user)):
        lvl = _require(current_user, "clinical", "coach")
        q = _filters_to_query(kind, status, athlete_id, team, event_id, include_drafts=(lvl == "clinical"))
        eps = await db.iir_episodes.find(q, {"_id": 0}).sort("updated_at", -1).to_list(5000)
        eps = await _enrich(eps, cutoff)
        if lvl == "coach":
            return [S.coach_view(e) for e in eps]
        return eps

    @api_router.post("/iir/episodes")
    async def iir_create_episode(payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        kind = payload.get("kind")
        try:
            clean, errors = S.normalize_episode(payload, kind)
        except S.ValidationError as e:
            raise HTTPException(status_code=400, detail=e.errors)
        clean["kind"] = kind
        errors += L.date_errors(clean)
        errors += S.check_status_requirements(clean)
        if errors:
            raise HTTPException(status_code=400, detail=errors)
        await _validate_refs(clean, kind)
        actor = _actor(current_user)
        now = _now()
        ep = {
            **clean,
            "id": str(uuid.uuid4()),
            "form_version": T.FORM_VERSION,
            "dictionary_version": T.DICTIONARY_VERSION,
            "created_at": now, "created_by": actor,
            "updated_at": now, "updated_by": actor,
            "report_by": clean.get("report_by") or {"id": actor["id"], "name": actor["name"]},
            "deleted": False,
        }
        if ep.get("status") != "draft" and not ep.get("participation"):
            ep["participation"] = "unknown"
        await db.iir_episodes.insert_one(dict(ep))
        await _audit("create", current_user, ep["id"],
                     changes=[{"field": k, "old": None, "new": v} for k, v in clean.items()])
        src = clean.get("pending_source")
        if isinstance(src, dict) and src.get("source") and src.get("source_id"):
            await db.iir_triage.update_one(
                {"source": src["source"], "source_id": src["source_id"]},
                {"$set": {"decision": "recorded", "episode_id": ep["id"], "at": now, "by": actor}},
                upsert=True)
        return (await _enrich([ep]))[0]

    @api_router.get("/iir/episodes/{episode_id}")
    async def iir_get_episode(episode_id: str, cutoff: Optional[str] = None,
                              current_user: dict = Depends(get_current_user)):
        lvl = _require(current_user, "clinical", "coach")
        ep = await _get_episode(episode_id)
        if lvl == "coach":
            if ep.get("status") == "draft":
                raise HTTPException(status_code=404, detail="Episode not found")
            return S.coach_view((await _enrich([ep], cutoff))[0])
        ep = (await _enrich([ep], cutoff))[0]
        ep["followups"] = await db.iir_followups.find({"episode_id": episode_id}, {"_id": 0}) \
            .sort([("date", 1), ("created_at", 1)]).to_list(1000)
        ep["attachments"] = await db.iir_attachments.find({"episode_id": episode_id, "deleted": {"$ne": True}},
                                                          {"_id": 0}).to_list(200)
        if ep.get("linked_episode_id"):
            prev = await db.iir_episodes.find_one({"id": ep["linked_episode_id"]}, {"_id": 0})
            if prev:
                ep["linked_episode"] = {"id": prev["id"], "kind": prev.get("kind"),
                                        "summary": S.summary_label(prev),
                                        "date": prev.get(L.event_date_key(prev.get("kind"))),
                                        "status": prev.get("status")}
        return ep

    @api_router.patch("/iir/episodes/{episode_id}")
    async def iir_update_episode(episode_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        old = await _get_episode(episode_id)
        kind = old["kind"]
        try:
            clean, errors = S.normalize_episode(payload, kind, partial=True)
        except S.ValidationError as e:
            raise HTTPException(status_code=400, detail=e.errors)
        merged = {**old, **clean}
        errors += L.date_errors(merged)
        errors += S.check_status_requirements(merged)
        if errors:
            raise HTTPException(status_code=400, detail=errors)
        await _validate_refs(clean, kind, episode_id)
        if clean.get("athlete_id") and clean["athlete_id"] != old.get("athlete_id") and old.get("status") != "draft":
            raise HTTPException(status_code=400,
                                detail="The athlete of a saved record cannot be changed. Delete it (with reason) and record it again.")
        merged = {**old, **clean}
        if merged.get("status") != "draft" and not merged.get("participation"):
            clean["participation"] = "unknown"
        changes = S.diff(old, {**old, **clean})
        if not changes:
            return (await _enrich([old]))[0]
        clean.update({"updated_at": _now(), "updated_by": _actor(current_user)})
        await db.iir_episodes.update_one({"id": episode_id}, {"$set": clean})
        await _audit("update", current_user, episode_id, changes)
        return (await _enrich([await _get_episode(episode_id)]))[0]

    @api_router.delete("/iir/episodes/{episode_id}")
    async def iir_delete_episode(episode_id: str, reason: str, current_user: dict = Depends(get_current_user)):
        """Soft delete: the record is kept (hidden) with the reason, for traceability."""
        _require(current_user, "clinical")
        await _get_episode(episode_id)
        reason = (reason or "").strip()
        if len(reason) < 3:
            raise HTTPException(status_code=400, detail="Give the reason for deleting this record")
        actor = _actor(current_user)
        await db.iir_episodes.update_one({"id": episode_id}, {"$set": {
            "deleted": True, "deleted_at": _now(), "deleted_by": actor, "deletion_reason": reason}})
        await _audit("delete", current_user, episode_id, extra={"reason": reason})
        return {"message": "Record deleted (kept in the audit trail)"}

    @api_router.get("/iir/episodes/{episode_id}/audit")
    async def iir_episode_audit(episode_id: str, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        return await db.iir_audit.find({"episode_id": episode_id}, {"_id": 0}).sort("at", -1).to_list(2000)

    # -------------------------------------------------------------- follow-up
    FOLLOWUP_APPLY = {
        "participation": "participation",
        "estimated_rtp_date": "estimated_rtp_date",
        "partial_return_date": "partial_return_date",
        "full_return_date": "full_return_date",
        "diagnosis": "final_diagnosis",
        "diagnosis_status": "diagnosis_status",
        "unavailability_start": "unavailability_start",
    }

    @api_router.post("/iir/episodes/{episode_id}/followups")
    async def iir_add_followup(episode_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
        """A new assessment of the same episode. Never creates a new injury/illness."""
        _require(current_user, "clinical")
        ep = await _get_episode(episode_id)
        if ep.get("status") == "draft":
            raise HTTPException(status_code=400, detail="Save the record (not draft) before adding follow-ups")
        kind_code = payload.get("kind") or "reassessment"
        if kind_code not in T.option_codes("followup_kind"):
            raise HTTPException(status_code=400, detail="Invalid follow-up type")
        try:
            fdate = L.parse_date(payload.get("date")) or L.today()
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        ev_date = L.safe_date(ep.get(L.event_date_key(ep["kind"])))
        if ev_date and fdate < ev_date:
            raise HTTPException(status_code=400, detail="Follow-up date cannot be before the date of injury/onset")

        updates = {}
        errors = []
        for src_key, ep_key in FOLLOWUP_APPLY.items():
            if payload.get(src_key) in (None, ""):
                continue
            v = payload[src_key]
            if ep_key in ("participation",):
                if v not in T.option_codes("participation"):
                    errors.append({"field": src_key, "message": "Invalid participation"})
                    continue
            elif ep_key == "diagnosis_status":
                if v not in T.option_codes("diagnosis_status"):
                    errors.append({"field": src_key, "message": "Invalid diagnosis status"})
                    continue
            elif ep_key.endswith("_date") or ep_key == "unavailability_start":
                try:
                    v = L.parse_date(v).isoformat()
                except ValueError as e:
                    errors.append({"field": src_key, "message": str(e)})
                    continue
            else:
                v = S._text(v)
            updates[ep_key] = v
        if kind_code == "full_return":
            updates.setdefault("full_return_date", fdate.isoformat())
            updates.setdefault("participation", "full")
        if kind_code == "partial_return":
            updates.setdefault("partial_return_date", fdate.isoformat())
            updates.setdefault("participation", "modified")
        if kind_code == "closure":
            updates["status"] = "closed"
        if kind_code == "lost_to_follow_up":
            updates["status"] = "lost_to_follow_up"
        if payload.get("set_actual_rtp") and updates.get("full_return_date"):
            updates["actual_rtp_date"] = updates["full_return_date"]
        merged = {**ep, **updates}
        errors += L.date_errors(merged)
        if errors:
            raise HTTPException(status_code=400, detail=errors)

        fu = {
            "id": str(uuid.uuid4()), "episode_id": episode_id, "kind": kind_code,
            "date": fdate.isoformat(), "created_at": _now(), "by": _actor(current_user),
            "symptoms": S._text(payload.get("symptoms")),
            "diagnosis": S._text(payload.get("diagnosis")),
            "treatment": S._text(payload.get("treatment")),
            "exams_referrals": S._text(payload.get("exams_referrals")),
            "notes": S._text(payload.get("notes")),
            "participation": updates.get("participation"),
            # previous values are preserved so the history of diagnoses/estimates is never lost
            "previous": {k: ep.get(k) for k in updates},
            "applied": updates,
        }
        await db.iir_followups.insert_one(dict(fu))
        if updates:
            await db.iir_episodes.update_one({"id": episode_id}, {"$set": {
                **updates, "updated_at": _now(), "updated_by": _actor(current_user)}})
        await _audit("followup", current_user, episode_id,
                     changes=[{"field": k, "old": ep.get(k), "new": v} for k, v in updates.items()],
                     extra={"followup_id": fu["id"], "kind": kind_code})
        fu.pop("_id", None)
        return fu

    # ----------------------------------------------------------- availability
    @api_router.get("/iir/availability")
    async def iir_availability(team: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        """Current participation of every athlete, considering all active episodes."""
        _require(current_user, "clinical", "coach")
        aq = {"status": {"$nin": ["rejected", "pending"]}}
        if team and team != "all":
            aq["team"] = team
        athletes = await db.athletes.find(aq, {"_id": 0, "id": 1, "name": 1, "team": 1}).to_list(5000)
        eps = await db.iir_episodes.find({"deleted": {"$ne": True}, "status": "open",
                                          "athlete_id": {"$in": [a["id"] for a in athletes]}},
                                         {"_id": 0}).to_list(5000)
        by_ath = {}
        for e in eps:
            by_ath.setdefault(e["athlete_id"], []).append(e)
        out = []
        for a in athletes:
            mine = by_ath.get(a["id"], [])
            cp = L.current_participation(mine)
            est = sorted([e.get("estimated_rtp_date") for e in mine if e.get("estimated_rtp_date")])
            out.append({"athlete_id": a["id"], "name": a.get("name"), "team": a.get("team"),
                        "participation": cp["participation"], "active_episodes": cp["active_episodes"],
                        "latest_estimated_return": est[-1] if est else None})
        out.sort(key=lambda r: (-L.PARTICIPATION_ORDER.get(r["participation"], 0), (r["name"] or "").lower()))
        return out

    # -------------------------------------------------------- athlete history
    @api_router.get("/iir/athletes/{athlete_id}/history")
    async def iir_athlete_history(athlete_id: str, current_user: dict = Depends(get_current_user)):
        lvl = _require(current_user, "clinical", "coach")
        q = {"athlete_id": athlete_id, "deleted": {"$ne": True}}
        if lvl != "clinical":
            q["status"] = {"$ne": "draft"}
        eps = await db.iir_episodes.find(q, {"_id": 0}).to_list(1000)
        eps = await _enrich(eps)
        eps.sort(key=lambda e: e.get(L.event_date_key(e["kind"])) or "", reverse=True)
        cp = L.current_participation(eps)
        if lvl == "coach":
            return {"participation": cp, "episodes": [S.coach_view(e) for e in eps if e.get("status") == "open"]}
        fus = await db.iir_followups.find({"episode_id": {"$in": [e["id"] for e in eps]}}, {"_id": 0}) \
            .sort("date", 1).to_list(5000)
        by_ep = {}
        for f in fus:
            by_ep.setdefault(f["episode_id"], []).append(f)
        for e in eps:
            e["followups"] = by_ep.get(e["id"], [])
        return {
            "participation": cp,
            "unique_unavailable_days": L.unique_unavailable_days(
                [e for e in eps if e.get("status") != "draft"]),
            "active": [e for e in eps if e.get("status") in ("open", "draft")],
            "previous": [e for e in eps if e.get("status") in ("closed", "lost_to_follow_up")],
        }

    # ------------------------------------------------------------ attachments
    ALLOWED_ATTACHMENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}
    MAX_ATTACHMENT = 10 * 1024 * 1024

    @api_router.post("/iir/episodes/{episode_id}/attachments")
    async def iir_upload_attachment(episode_id: str, file: UploadFile = File(...),
                                    current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        await _get_episode(episode_id)
        ctype = file.content_type
        if ctype not in ALLOWED_ATTACHMENT_TYPES:
            raise HTTPException(status_code=400, detail="Only JPG, PNG or PDF files are accepted")
        data = await file.read()
        if len(data) > MAX_ATTACHMENT:
            raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
        from recovery_storage import put_object, APP_NAME
        aid = str(uuid.uuid4())
        path = f"{APP_NAME}/iir/{episode_id}/{aid}.{ALLOWED_ATTACHMENT_TYPES[ctype]}"
        await put_object(path, data, ctype)
        doc = {"id": aid, "episode_id": episode_id, "storage_path": path, "content_type": ctype,
               "filename": (file.filename or f"attachment.{ALLOWED_ATTACHMENT_TYPES[ctype]}")[:200],
               "size": len(data), "uploaded_at": _now(), "uploaded_by": _actor(current_user)}
        await db.iir_attachments.insert_one(dict(doc))
        await _audit("attachment_add", current_user, episode_id, extra={"attachment_id": aid,
                                                                        "filename": doc["filename"]})
        doc.pop("_id", None)
        doc.pop("storage_path", None)
        return doc

    @api_router.get("/iir/attachments/{attachment_id}")
    async def iir_get_attachment(attachment_id: str, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        doc = await db.iir_attachments.find_one({"id": attachment_id, "deleted": {"$ne": True}}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Attachment not found")
        from recovery_storage import get_object
        try:
            data, _ = await get_object(doc["storage_path"])
        except Exception:
            raise HTTPException(status_code=404, detail="Attachment unavailable")
        return Response(content=data, media_type=doc["content_type"],
                        headers={"Cache-Control": "private, no-store",
                                 "Content-Disposition": f'inline; filename="{doc["filename"]}"'})

    @api_router.delete("/iir/attachments/{attachment_id}")
    async def iir_delete_attachment(attachment_id: str, reason: str, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        doc = await db.iir_attachments.find_one({"id": attachment_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Attachment not found")
        await db.iir_attachments.update_one({"id": attachment_id}, {"$set": {
            "deleted": True, "deleted_at": _now(), "deleted_by": _actor(current_user), "deletion_reason": reason}})
        await _audit("attachment_delete", current_user, doc["episode_id"],
                     extra={"attachment_id": attachment_id, "reason": reason})
        return {"message": "Attachment removed"}

    # ------------------------------------------------- pending assessments
    PAIN_THRESHOLD = 5

    @api_router.get("/iir/pending")
    async def iir_pending(days: int = 14, current_user: dict = Depends(get_current_user)):
        """Complaints from Pain Map / Daily Readiness / OSTRC that may need a clinical
        assessment. They become records only after a clinician confirms them."""
        _require(current_user, "clinical")
        since = (L.today() - timedelta(days=max(1, min(days, 90)))).isoformat()
        decided = await db.iir_triage.find({}, {"_id": 0, "source": 1, "source_id": 1}).to_list(20000)
        done = {(d["source"], d["source_id"]) for d in decided}
        items = []
        amap = await _athlete_map()

        async for r in db.daily_readiness.find({"date": {"$gte": since}, "pain_reports.0": {"$exists": True}},
                                               {"_id": 0, "id": 1, "athlete_id": 1, "date": 1, "pain_reports": 1}):
            for i, p in enumerate(r.get("pain_reports") or []):
                sid = f"{r.get('id')}:{i}"
                if (p.get("pain_level") or 0) >= PAIN_THRESHOLD and ("readiness", sid) not in done:
                    items.append({"source": "readiness", "source_id": sid, "athlete_id": r["athlete_id"],
                                  "date": r.get("date"), "body_region": p.get("body_region"),
                                  "laterality": p.get("laterality"), "pain_level": p.get("pain_level"),
                                  "description": p.get("region_note")})
        async for s in db.training_sessions.find({"date": {"$gte": since}, "pain_reports.0": {"$exists": True}},
                                                 {"_id": 0, "id": 1, "athlete_id": 1, "date": 1,
                                                  "pain_reports": 1}):
            for i, p in enumerate(s.get("pain_reports") or []):
                sid = f"{s.get('id')}:{i}"
                if (p.get("pain_level") or 0) >= PAIN_THRESHOLD and ("pain_map", sid) not in done:
                    items.append({"source": "pain_map", "source_id": sid, "athlete_id": s["athlete_id"],
                                  "date": s.get("date"), "body_region": p.get("body_region"),
                                  "laterality": p.get("laterality"), "pain_level": p.get("pain_level"),
                                  "description": p.get("region_note")})
        async for hp in db.health_problems.find({"last_reported_date": {"$gte": since},
                                                 "status": {"$ne": "resolved"}}, {"_id": 0}):
            if ("ostrc", hp["id"]) in done:
                continue
            items.append({"source": "ostrc", "source_id": hp["id"], "athlete_id": hp.get("athlete_id"),
                          "date": hp.get("onset_date") or hp.get("first_reported_date"),
                          "problem_type": hp.get("problem_type"), "body_region": hp.get("body_region"),
                          "laterality": hp.get("body_side"), "severity": hp.get("current_severity_score"),
                          "availability": hp.get("current_availability"),
                          "description": hp.get("athlete_description")})
        for it in items:
            a = amap.get(it.get("athlete_id")) or {}
            it["athlete_name"] = a.get("name")
            it["team"] = a.get("team")
        items.sort(key=lambda x: x.get("date") or "", reverse=True)
        return items

    @api_router.post("/iir/pending/dismiss")
    async def iir_pending_dismiss(payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        src, sid = payload.get("source"), payload.get("source_id")
        if src not in ("readiness", "pain_map", "ostrc") or not sid:
            raise HTTPException(status_code=400, detail="Invalid pending item")
        reason = S._text(payload.get("reason")) or "Assessed — no clinical record needed"
        await db.iir_triage.update_one({"source": src, "source_id": sid}, {"$set": {
            "source": src, "source_id": sid, "decision": "dismissed", "reason": reason,
            "at": _now(), "by": _actor(current_user)}}, upsert=True)
        await _audit("pending_dismiss", current_user, extra={"source": src, "source_id": sid, "reason": reason})
        return {"message": "Marked as assessed"}

    # Stage 4/5 routes (exposure, reports, exports) live in iir_reports.py
    from iir_reports import register_iir_report_routes
    register_iir_report_routes(api_router, db, get_current_user, _require, _audit, _enrich, _athlete_map)

    logger.info("Injury & Illness Recording routes registered (%s / %s)", T.FORM_VERSION, T.DICTIONARY_VERSION)
