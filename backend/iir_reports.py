"""Injury & Illness Recording — exposure, monitoring, reports and exports routes."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response

import iir_analytics as A
import iir_logic as L
import iir_service as S
import iir_taxonomy as T

CONTEXTS = {"game", "training"}
PARTICIPATION = {"full", "partial", "absent"}
DATA_SOURCES = {"measured", "reported", "estimated"}
FILTER_KEYS = ["from", "to", "cutoff", "athlete_id", "team", "category", "event_id", "activity", "body_location",
               "injury_type", "organ_system", "aetiology", "mechanism", "classification", "time_loss", "status",
               "report_by"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def register_iir_report_routes(api_router, db, get_current_user, _require, _audit, _enrich, _athlete_map):

    # ---------------------------------------------------------------- exposure
    def _norm_session(p):
        errors = []
        out = {}
        try:
            d = L.parse_date(p.get("date"))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not d:
            errors.append("Session date is required")
        out["date"] = d.isoformat() if d else None
        ctx = p.get("context")
        if ctx not in CONTEXTS:
            errors.append("Session type must be game or training")
        out["context"] = ctx
        for k in ("event_id", "team", "session_label", "estimation_method", "coverage_note"):
            out[k] = S._text(p.get(k))
        out["data_source"] = p.get("data_source") if p.get("data_source") in DATA_SOURCES else None
        try:
            out["duration_min"] = float(p["duration_min"]) if p.get("duration_min") not in (None, "") else None
            if out["duration_min"] is not None and not (0 < out["duration_min"] <= 600):
                raise ValueError
        except (TypeError, ValueError):
            errors.append("Duration must be between 1 and 600 minutes")
        ind = []
        seen = set()
        for r in p.get("individual") or []:
            aid = r.get("athlete_id")
            if not aid or aid in seen:
                continue
            seen.add(aid)
            part = r.get("participation") if r.get("participation") in PARTICIPATION else None
            mins = r.get("minutes")
            try:
                mins = float(mins) if mins not in (None, "") else None
                if mins is not None and (mins < 0 or (out.get("duration_min") and mins > out["duration_min"] + 30)):
                    raise ValueError
            except (TypeError, ValueError):
                errors.append("Athlete minutes must be ≥ 0 and not exceed the session duration")
                continue
            if part == "absent":
                mins = 0.0
            ind.append({"athlete_id": aid, "minutes": mins, "participation": part,
                        "source": r.get("source") if r.get("source") in DATA_SOURCES else out["data_source"]})
        out["individual"] = ind
        col = p.get("collective")
        if col and not ind:
            try:
                n = int(col.get("athletes"))
                m = float(col.get("minutes_each"))
                if n <= 0 or m <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                errors.append("Collective estimate needs number of athletes and minutes each")
                n = m = None
            method = S._text(col.get("method"))
            if not method:
                errors.append("Describe the estimation method of the collective estimate")
            out["collective"] = {"athletes": n, "minutes_each": m, "method": method}
            out["data_source"] = "estimated"
        else:
            out["collective"] = None  # individual records take precedence; never both
        if errors:
            raise HTTPException(status_code=400, detail=[{"message": e} for e in errors])
        return out

    @api_router.get("/iir/exposure/sessions")
    async def iir_sessions(event_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        lvl = _require(current_user, "clinical", "research")
        q = {"deleted": {"$ne": True}}
        if event_id:
            q["event_id"] = event_id
        docs = await db.iir_exposure.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
        exp = L.merge_exposure_records(docs)
        for d in docs:
            d["athlete_hours"] = L.merge_exposure_records([d])["hours"].get(d.get("context"), 0)
            if lvl != "clinical":
                d["individual"] = [{"minutes": r.get("minutes"), "participation": r.get("participation")}
                                   for r in d.get("individual") or []]
        return {"sessions": docs, "totals": exp}

    @api_router.post("/iir/exposure/sessions")
    async def iir_create_session(payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        s = _norm_session(payload)
        s.update({"id": str(uuid.uuid4()), "created_at": _now()})
        s["created_by"] = {"id": current_user["user"].get("id"), "name": current_user["user"].get("name")}
        await db.iir_exposure.insert_one(dict(s))
        await _audit("exposure_create", current_user, extra={"session_id": s["id"], "date": s["date"]})
        s.pop("_id", None)
        return s

    @api_router.put("/iir/exposure/sessions/{session_id}")
    async def iir_update_session(session_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        old = await db.iir_exposure.find_one({"id": session_id, "deleted": {"$ne": True}}, {"_id": 0})
        if not old:
            raise HTTPException(status_code=404, detail="Session not found")
        s = _norm_session(payload)
        await db.iir_exposure.update_one({"id": session_id}, {"$set": {**s, "updated_at": _now()}})
        await _audit("exposure_update", current_user, changes=S.diff(old, {**old, **s}), extra={"session_id": session_id})
        return await db.iir_exposure.find_one({"id": session_id}, {"_id": 0})

    @api_router.delete("/iir/exposure/sessions/{session_id}")
    async def iir_delete_session(session_id: str, reason: str, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        await db.iir_exposure.update_one({"id": session_id}, {"$set": {
            "deleted": True, "deleted_at": _now(), "deletion_reason": reason}})
        await _audit("exposure_delete", current_user, extra={"session_id": session_id, "reason": reason})
        return {"message": "Session removed"}

    # -------------------------------------------------------------- monitoring
    @api_router.get("/iir/monitoring")
    async def iir_monitoring(event_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
        lvl = _require(current_user, "clinical", "research")
        q = {"deleted": {"$ne": True}}
        if event_id:
            q["event_id"] = event_id
        docs = await db.iir_monitoring.find(q, {"_id": 0}).sort("start_date", -1).to_list(5000)
        if lvl == "clinical":
            amap = await _athlete_map({d["athlete_id"] for d in docs if d.get("athlete_id")})
            for d in docs:
                d["athlete_name"] = (amap.get(d.get("athlete_id")) or {}).get("name")
        else:
            for d in docs:
                d.pop("athlete_id", None)
        return docs

    @api_router.post("/iir/monitoring")
    async def iir_add_monitoring(payload: dict, current_user: dict = Depends(get_current_user)):
        """Monitoring periods (athlete-days). Accepts one athlete or a list."""
        _require(current_user, "clinical")
        try:
            s = L.parse_date(payload.get("start_date"))
            e = L.parse_date(payload.get("end_date"))
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
        if not s or not e:
            raise HTTPException(status_code=400, detail="Start and end dates are required")
        if e < s:
            raise HTTPException(status_code=400, detail="End date cannot be before start date")
        ids = payload.get("athlete_ids") or ([payload["athlete_id"]] if payload.get("athlete_id") else [])
        if not ids:
            raise HTTPException(status_code=400, detail="Select at least one athlete")
        amap = await _athlete_map(set(ids))
        docs = []
        for aid in ids:
            if aid not in amap:
                continue
            docs.append({"id": str(uuid.uuid4()), "athlete_id": aid, "team": amap[aid].get("team"),
                         "event_id": S._text(payload.get("event_id")), "start_date": s.isoformat(),
                         "end_date": e.isoformat(), "note": S._text(payload.get("note")), "created_at": _now()})
        if docs:
            await db.iir_monitoring.insert_many([dict(d) for d in docs])
        await _audit("monitoring_add", current_user, extra={"count": len(docs), "start": s.isoformat(), "end": e.isoformat()})
        return {"added": len(docs)}

    @api_router.delete("/iir/monitoring/{mon_id}")
    async def iir_delete_monitoring(mon_id: str, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        await db.iir_monitoring.update_one({"id": mon_id}, {"$set": {"deleted": True, "deleted_at": _now()}})
        await _audit("monitoring_delete", current_user, extra={"monitoring_id": mon_id})
        return {"message": "Removed"}

    # ------------------------------------------------------------------ data
    def _filters(request: Request):
        return {k: request.query_params.get(k) for k in FILTER_KEYS if request.query_params.get(k)}

    async def _dataset(f):
        eps = await db.iir_episodes.find({"deleted": {"$ne": True}, "status": {"$ne": "draft"}}, {"_id": 0}).to_list(20000)
        sessions = await db.iir_exposure.find({"deleted": {"$ne": True}}, {"_id": 0}).to_list(20000)
        monitoring = await db.iir_monitoring.find({"deleted": {"$ne": True}}, {"_id": 0}).to_list(20000)
        events = await db.iir_events.find({}, {"_id": 0}).to_list(500)
        return eps, sessions, monitoring, events

    @api_router.get("/iir/reports/summary")
    async def iir_report(request: Request, current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical", "research")
        f = _filters(request)
        eps, sessions, monitoring, events = await _dataset(f)
        rep = A.build_report(eps, sessions, monitoring, f, events)
        return rep

    async def _pseudonym_key():
        doc = await db.app_settings.find_one({"_id": "iir_pseudonym_key"})
        if not doc:
            doc = {"_id": "iir_pseudonym_key", "key": A.new_pseudonym_key(), "created_at": _now(),
                   "note": "Correspondence key for research pseudonyms. Never exported."}
            try:
                await db.app_settings.insert_one(doc)
            except Exception:
                doc = await db.app_settings.find_one({"_id": "iir_pseudonym_key"})
        return doc["key"]

    @api_router.get("/iir/export")
    async def iir_export(request: Request, dataset: str = "scientific", mode: str = "pseudonymized",
                         fmt: str = "xlsx", include_free_text: bool = False, free_text_reviewed: bool = False,
                         date_mode: str = "exact", current_user: dict = Depends(get_current_user)):
        """dataset: compat | scientific | report · mode: identified | pseudonymized | anonymized ·
        fmt: xlsx | csv | pdf. The transformation happens here; stored records keep the identity."""
        lvl = _require(current_user, "clinical", "research")
        if dataset not in ("compat", "scientific", "report"):
            raise HTTPException(status_code=400, detail="Unknown dataset")
        if mode not in ("identified", "pseudonymized", "anonymized"):
            raise HTTPException(status_code=400, detail="Unknown export mode")
        if fmt not in ("xlsx", "csv", "pdf"):
            raise HTTPException(status_code=400, detail="Unknown format")
        if mode == "identified" and lvl != "clinical":
            raise HTTPException(status_code=403, detail="Identified exports are restricted to the health team")
        if mode != "identified" and include_free_text and not free_text_reviewed:
            raise HTTPException(status_code=400, detail="Free text can only be included after review "
                                                        "(it may contain names or identifying details)")
        f = _filters(request)
        eps, sessions, monitoring, events = await _dataset(f)
        cutoff = L.safe_date(f.get("cutoff")) or L.safe_date(f.get("to")) or L.today()
        selected = A.apply_filters(eps, f)
        sel_ids = {e["id"] for e in selected}
        if mode != "identified":
            selected = [e for e in selected if e.get("participant_type", "athlete") == "athlete"]
        sess = A.filter_sessions(sessions, f)
        mon = [m for m in monitoring if (not f.get("athlete_id") or m.get("athlete_id") == f["athlete_id"])
               and (not f.get("event_id") or m.get("event_id") == f["event_id"])]
        followups = await db.iir_followups.find({"episode_id": {"$in": list(sel_ids)}}, {"_id": 0}).to_list(50000)
        amap = await _athlete_map() if mode == "identified" else {}
        anchor = None
        if date_mode == "relative":
            ev = next((e for e in events if e.get("id") == f.get("event_id")), None)
            anchor = (ev or {}).get("start_date") or f.get("from")
            if not anchor:
                raise HTTPException(status_code=400, detail="Relative dates need an event or a 'from' date as anchor")
        key = await _pseudonym_key() if mode == "pseudonymized" else None
        idt = A.Identity(mode, key=key, athletes=amap, date_mode=date_mode, anchor=anchor)
        free = include_free_text if mode != "identified" else True

        report = A.build_report(eps, sessions, monitoring, f, events)
        meta = {
            "generated_at": _now(), "generated_by_role": current_user["user"].get("role"),
            "dataset": dataset, "mode": mode, "format": fmt, "date_mode": idt.date_mode,
            "date_anchor": anchor if idt.date_mode == "relative" else None,
            "free_text_included": free, "filters": f, "cutoff": cutoff.isoformat(),
            "form_version": T.FORM_VERSION, "dictionary_version": T.DICTIONARY_VERSION,
            "time_loss_convention": T.TIME_LOSS_CONVENTION,
            "inclusion_criteria": "Saved records (drafts and deleted records excluded); episodes with date of "
                                  "injury/onset up to the cut-off; pre-existing episodes included when still active "
                                  "in the period" + ("; non-athlete participants excluded" if mode != "identified" else ""),
            "episodes": len(selected),
            "reference": T.REFERENCE_NAME, "disclaimer": T.DISCLAIMER,
            "anonymisation_note": ("Direct identifiers removed. Anonymity is NOT guaranteed: rare combinations "
                                   "(team, dates, diagnosis) may still allow re-identification." if mode == "anonymized"
                                   else ("Pseudonymised: codes are stable within the study; the correspondence key "
                                         "is kept on the server and is not included." if mode == "pseudonymized" else
                                         "Identified clinical export — restricted to authorised health professionals.")),
        }
        stamp = L.today().strftime("%Y%m%d")
        if fmt == "pdf":
            body = A.to_pdf(report, title=f"Injury & Illness Report ({mode})")
            media, ext = "application/pdf", "pdf"
        else:
            if dataset == "compat":
                tables = A.compat_tables(selected, idt, include_free_text=free)
            else:
                tables = A.scientific_tables(selected, followups, sess, mon, idt, include_free_text=free, cutoff=cutoff)
            tables.update(A.dictionary_tables())
            tables.update(A.metadata_table(meta))
            if fmt == "xlsx":
                body = A.to_xlsx(tables)
                media, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
            else:
                body = A.to_csv_zip(tables)
                media, ext = "application/zip", "zip"
        await db.iir_export_log.insert_one({"id": str(uuid.uuid4()), "at": _now(),
                                            "by": {"id": current_user["user"].get("id"),
                                                   "name": current_user["user"].get("name"),
                                                   "role": current_user["user"].get("role")},
                                            "dataset": dataset, "mode": mode, "format": fmt, "filters": f,
                                            "free_text_included": free, "episodes": len(selected)})
        await _audit("export", current_user, extra={"dataset": dataset, "mode": mode, "format": fmt, "filters": f,
                                                    "episodes": len(selected)})
        fname = f"injury_illness_{dataset}_{mode}_{stamp}.{ext}"
        return Response(content=body, media_type=media,
                        headers={"Content-Disposition": f'attachment; filename="{fname}"',
                                 "Cache-Control": "no-store"})

    @api_router.get("/iir/export/log")
    async def iir_export_log(current_user: dict = Depends(get_current_user)):
        _require(current_user, "clinical")
        return await db.iir_export_log.find({}, {"_id": 0}).sort("at", -1).to_list(200)
