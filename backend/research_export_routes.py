"""Research data center: tabulated datasets, OSTRC period analytics and Excel/CSV export."""
import csv
import io
import json
import secrets
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from app_time import today_str
from data_dictionary import HEADER as DICT_HEADER, dictionary_rows

HEAD_FILL = PatternFill("solid", fgColor="0F172A")


def _csv_bytes(cols, rows, bom=True):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    w.writerows(rows)
    return (("\ufeff" if bom else "") + buf.getvalue()).encode("utf-8")


def _cell(v):
    return json.dumps(v, default=str) if isinstance(v, (dict, list)) else v


def _write_sheet(wb, title, cols, rows, widths=None, wrap=False):
    ws = wb.create_sheet(title[:31])
    ws.append(cols)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(vertical="center")
    for r in rows:
        ws.append([_cell(v) for v in r])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for i, c in enumerate(cols, 1):
        width = (widths or {}).get(c) or max([len(str(c))] + [len(str(r[i - 1] or "")) for r in rows[:200]])
        ws.column_dimensions[get_column_letter(i)].width = min(max(10, width + 2), 60 if wrap else 48)
    if wrap:
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical="top")
    return ws


DICT_WIDTHS = {"dataset": 20, "column": 26, "description": 58, "type": 10, "unit": 14, "scale_or_values": 46, "reference": 50}


def _add_dictionary(wb, cols_by_key):
    _write_sheet(wb, "Data Dictionary", DICT_HEADER, dictionary_rows(cols_by_key), widths=DICT_WIDTHS, wrap=True)

OSTRC_Q = ["OSTRC_Q1_PARTICIPATION", "OSTRC_Q2_MODIFICATION", "OSTRC_Q3_PERFORMANCE", "OSTRC_Q4_SYMPTOMS"]
DROP_FIELDS = {"_id", "password_hash", "client_submission_id", "athlete_id"}
STAFF_DATASETS = {"ostrc_responses", "ostrc_submissions", "health_problems"}

DATASETS = {
    "athletes": ("Athletes (roster)", "One row per athlete: team, position, status."),
    "morning_checkin": ("Morning check-in (wellness)", "Daily wellness: sleep, fatigue, soreness, stress, readiness score."),
    "training_sessions": ("Training sessions", "Session type, duration, RPE, internal load (sRPE), pain during/after."),
    "pain_reports": ("Pain reports (all sources)", "One row per reported pain: morning check-in, training and recovery."),
    "recovery_checks": ("Recovery check (evening)", "Recovery quality, sleep expectation, residual pain, recovery score."),
    "recovery_logs": ("Recovery activities", "Recovery activities logged by athletes with points and review status."),
    "ostrc_responses": ("OSTRC-H2 responses (long format)", "One row per weekly submission x health problem with Q1-Q4 answers and severity score (0-100)."),
    "ostrc_submissions": ("OSTRC-H2 weekly submissions", "One row per weekly submission: compliance, number of problems, highest severity."),
    "health_problems": ("Health problems (OSTRC)", "One row per health problem episode: category, region, onset, duration, status."),
    "cmj_tests": ("CMJ tests", "Countermovement jump trials, best, mean, CV and delta vs baseline."),
    "fittest_points": ("The Fittest points", "Points awarded in The Fittest challenges."),
    "adherence_weekly": ("Questionnaire adherence (weekly)", "One row per athlete x week: morning check-in days/7, OSTRC submitted, training logs, recovery days/7, overall %."),
}


def _flat(d, prefix=""):
    out = {}
    for k, v in (d or {}).items():
        if k in DROP_FIELDS:
            continue
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flat(v, f"{key}."))
        elif isinstance(v, list):
            out[key] = json.dumps(v, ensure_ascii=False, default=str) if v else None
        else:
            out[key] = v
    return out


def _region(p):
    r = p.get("body_region")
    note = (p.get("region_note") or "").strip()
    return f"{r} — {note}" if r == "Other" and note else r


def _in(d, start, end):
    if not d:
        return not (start or end)
    d = str(d)[:10]
    return (not start or d >= start) and (not end or d <= end)


def _session_date(s):
    return s.get("date") or (s.get("date_time_start") or s.get("created_at") or "")[:10] or None


def register_research_routes(api_router: APIRouter, db, get_current_user):

    def _guard(current_user, keys):
        if current_user.get("user_type") != "staff":
            raise HTTPException(status_code=403, detail="Staff only")
        if current_user["user"].get("role") != "Admin" and not set(keys) <= STAFF_DATASETS:
            raise HTTPException(status_code=403, detail="Admin only")
        bad = [k for k in keys if k not in DATASETS]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown dataset: {', '.join(bad)}")

    async def _athletes(team, athlete_id):
        all_a = await db.athletes.find({}, {"_id": 0, "password_hash": 0}).to_list(5000)
        all_a.sort(key=lambda a: (a.get("created_at") or "", a["id"]))
        for i, a in enumerate(all_a, 1):
            a["athlete_code"] = f"ATH-{i:03d}"
        sel = [a for a in all_a
               if (not team or team == "all" or a.get("team") == team)
               and (not athlete_id or a["id"] == athlete_id)]
        return {a["id"]: a for a in sel}

    async def _docs(coll, ids, include_archived):
        docs = await db[coll].find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(200000)
        for d in docs:
            d["archived"] = False
        if include_archived and coll + "_archive" in await db.list_collection_names():
            arch = await db[coll + "_archive"].find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(200000)
            for d in arch:
                d["archived"] = True
            docs += arch
        return docs

    async def _event_names():
        evs = await db.events.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        return {e["id"]: e["name"] for e in evs}

    def _base(a, date, anonymize):
        row = {"athlete_code": a.get("athlete_code")}
        if not anonymize:
            row["athlete_name"] = a.get("name")
        row.update({"team": a.get("team"), "position": a.get("position"), "date": date})
        return row

    async def build(key, f):
        A = await _athletes(f["team"], f["athlete_id"])
        ids = list(A.keys())
        s, e, anon, arch = f["start"], f["end"], f["anonymize"], f["include_archived"]
        events = await _event_names()
        rows = []

        def add(a_id, date, extra):
            a = A.get(a_id)
            if not a or not _in(date, s, e):
                return
            r = _base(a, str(date)[:10] if date else None, anon)
            ev = extra.pop("archived_event_id", None)
            r.update(extra)
            if "archived" in r:
                r["archived_event"] = events.get(ev) if ev else None
            rows.append(r)

        if key == "athletes":
            for a in A.values():
                r = {"athlete_code": a["athlete_code"]}
                if not anon:
                    r.update({"athlete_name": a.get("name"), "email": a.get("email")})
                r.update({"team": a.get("team"), "position": a.get("position"), "status": a.get("status"),
                          "active": a.get("active"), "registered_at": a.get("created_at")})
                rows.append(r)
            return rows

        if key == "morning_checkin":
            for d in await _docs("daily_readiness", ids, arch):
                pr = d.pop("pain_reports", None) or []
                x = _flat(d)
                x["pain_reports_count"] = len(pr)
                x["pain_regions"] = "; ".join(f"{_region(p)} ({p.get('laterality') or p.get('body_side') or '-'}) {p.get('pain_level', '')}" for p in pr) or None
                add(d["athlete_id"], d.get("date"), x)

        elif key == "training_sessions":
            for d in await _docs("training_sessions", ids, arch):
                pr = d.pop("pain_reports", None) or []
                x = _flat(d)
                x["pain_reports_count"] = len(pr)
                add(d["athlete_id"], _session_date(d), x)

        elif key == "pain_reports":
            sources = [("daily_readiness", "Morning Check-in", lambda d: d.get("date")),
                       ("training_sessions", "Training", _session_date),
                       ("recovery_logs", "Recovery", lambda d: d.get("date"))]
            for coll, label, dfn in sources:
                for d in await _docs(coll, ids, arch):
                    for p in d.get("pain_reports") or []:
                        add(d["athlete_id"], dfn(d), {
                            "source": label, "source_record_id": d.get("id"),
                            "body_region": p.get("body_region"), "region_note": p.get("region_note"),
                            "region_display": _region(p),
                            "side": p.get("laterality") or p.get("body_side"),
                            "pain_level": p.get("pain_level") if p.get("pain_level") is not None else p.get("intensity"),
                            "pain_type": p.get("pain_type"), "notes": p.get("notes"),
                            "archived": d.get("archived"), "archived_event_id": d.get("archived_event_id"),
                        })

        elif key in ("recovery_checks", "recovery_logs", "cmj_tests"):
            for d in await _docs(key, ids, arch):
                pr = d.pop("pain_reports", None) or []
                x = _flat(d)
                if key == "recovery_logs":
                    x["pain_reports_count"] = len(pr)
                add(d["athlete_id"], d.get("date"), x)

        elif key == "fittest_points":
            for d in await db.the_fittest_points.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(100000):
                add(d["athlete_id"], d.get("date"), _flat(d))

        elif key == "ostrc_submissions":
            for d in await db.health_weekly_submissions.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(100000):
                add(d["athlete_id"], d.get("reporting_period_end") or (d.get("submitted_at") or "")[:10], _flat(d))

        elif key == "health_problems":
            for d in await db.health_problems.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(100000):
                if s and (d.get("last_reported_date") or "") < s:
                    continue
                if e and (d.get("first_reported_date") or "") > e:
                    continue
                x = _flat(d)
                if d.get("confidential"):
                    x["athlete_description"] = "[confidential]"
                if d.get("body_region") == "Other" and d.get("athlete_description") and not d.get("confidential"):
                    x["body_region"] = f"Other — {d['athlete_description']}"
                a = A[d["athlete_id"]]
                r = _base(a, d.get("first_reported_date"), anon)
                r.update(x)
                rows.append(r)

        elif key == "ostrc_responses":
            subs = await db.health_weekly_submissions.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(100000)
            obs = await db.health_problem_observations.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(200000)
            probs = {p["id"]: p for p in await db.health_problems.find({"athlete_id": {"$in": ids}}, {"_id": 0}).to_list(100000)}
            by_sub = defaultdict(list)
            for o in obs:
                by_sub[o.get("submission_id")].append(o)
            for sub in subs:
                date = sub.get("reporting_period_end") or (sub.get("submitted_at") or "")[:10]
                common = {"submission_id": sub.get("id"), "submitted_at": sub.get("submitted_at"),
                          "submission_status": sub.get("submission_status"),
                          "questionnaire_version": sub.get("questionnaire_version")}
                items = by_sub.get(sub.get("id")) or []
                if not items:
                    r = {**common, "has_health_problem": False, "problem_id": None, "problem_category": None,
                         "body_region": None, "body_side": None, "description": None}
                    for q in OSTRC_Q:
                        short = q.split("_")[1]
                        r[f"{short}_answer"] = "a"
                        r[f"{short}_score"] = 0
                    r.update({"severity_score": 0, "substantial_problem": False, "availability": "full"})
                    add(sub["athlete_id"], date, r)
                    continue
                for o in items:
                    p = probs.get(o.get("health_problem_id"), {})
                    conf = p.get("confidential")
                    region = p.get("body_region")
                    if region == "Other" and p.get("athlete_description") and not conf:
                        region = f"Other — {p['athlete_description']}"
                    r = {**common, "has_health_problem": True, "problem_id": p.get("id"),
                         "problem_category": p.get("problem_category"), "body_region": region,
                         "body_side": p.get("body_side"),
                         "description": "[confidential]" if conf else p.get("athlete_description")}
                    resp = {it.get("question_code"): it for it in o.get("response_items") or []}
                    for q in OSTRC_Q:
                        short = q.split("_")[1]
                        it = resp.get(q) or {}
                        r[f"{short}_answer"] = it.get("answer_code")
                        r[f"{short}_answer_text"] = it.get("displayed_answer_text")
                        r[f"{short}_score"] = it.get("score_value")
                    r.update({"severity_score": o.get("severity_score"), "substantial_problem": o.get("substantial_problem"),
                              "availability": o.get("availability_status"),
                              "problem_status": p.get("status"), "problem_first_reported": p.get("first_reported_date")})
                    add(sub["athlete_id"], date, r)

        elif key == "adherence_weekly":
            rows = await _adherence(A, ids, s, e, arch, anon)

        rows.sort(key=lambda r: (r.get("date") or "", r.get("athlete_code") or ""))
        return rows

    async def _adherence(A, ids, s, e, arch, anon):
        kinds = defaultdict(lambda: defaultdict(set))
        sessions = defaultdict(list)
        for d in await _docs("daily_readiness", ids, arch):
            if d.get("date"):
                kinds[d["athlete_id"]]["morning"].add(d["date"][:10])
        for d in await _docs("training_sessions", ids, arch):
            dt = _session_date(d)
            if dt:
                sessions[d["athlete_id"]].append(dt[:10])
        for coll in ("recovery_checks", "recovery_logs"):
            for d in await _docs(coll, ids, arch):
                if d.get("date"):
                    kinds[d["athlete_id"]]["recovery"].add(d["date"][:10])
        for d in await db.health_weekly_submissions.find(
                {"athlete_id": {"$in": ids}, "submission_status": {"$in": ["completed", "completed_late"]}},
                {"_id": 0, "athlete_id": 1, "submitted_at": 1}).to_list(100000):
            kinds[d["athlete_id"]]["ostrc"].add((d.get("submitted_at") or "")[:10])

        today = today_str()
        end_d = min(e or today, today)
        if s:
            start_d = s
        else:
            all_dates = [x for k in kinds.values() for v in k.values() for x in v] + [x for v in sessions.values() for x in v]
            start_d = min(all_dates) if all_dates else end_d
        if start_d > end_d:
            return []
        sd = datetime.strptime(start_d, "%Y-%m-%d")
        ed_ = datetime.strptime(end_d, "%Y-%m-%d")
        wk = sd - timedelta(days=sd.weekday())
        weeks = []
        while wk <= ed_:
            all_days = [(wk + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
            weeks.append((all_days, [d for d in all_days if start_d <= d <= end_d]))
            wk += timedelta(days=7)

        rows = []
        for aid, a in A.items():
            k = kinds.get(aid, {})
            for all_days, days in weeks:
                n = len(days)
                m = sum(1 for d in days if d in k.get("morning", ()))
                rc = sum(1 for d in days if d in k.get("recovery", ()))
                ost = 1 if any(d in k.get("ostrc", ()) for d in all_days) else 0
                tr = [d for d in sessions.get(aid, []) if d in days]
                mp, rp = round(100 * m / n), round(100 * rc / n)
                r = _base(a, all_days[0], anon)
                r.update({"week_start": all_days[0], "week_end": all_days[-1], "days_in_period": n,
                          "morning_days": m, "morning_pct": mp, "ostrc_submitted": bool(ost), "ostrc_pct": 100 * ost,
                          "training_sessions": len(tr), "training_days": len(set(tr)),
                          "recovery_days": rc, "recovery_pct": rp,
                          "overall_pct": round((mp + 100 * ost + rp) / 3)})
                rows.append(r)
        return rows

    def _filters(start, end, team, athlete_id, anonymize, include_archived):
        return {"start": start or None, "end": end or None, "team": team or None,
                "athlete_id": athlete_id or None, "anonymize": anonymize, "include_archived": include_archived}

    def _columns(rows):
        cols = []
        for r in rows:
            for k in r.keys():
                if k not in cols:
                    cols.append(k)
        return cols

    @api_router.get("/research/datasets")
    async def research_datasets(start: str = None, end: str = None, team: str = None, athlete_id: str = None,
                                include_archived: bool = True, current_user: dict = Depends(get_current_user)):
        is_admin = current_user.get("user_type") == "staff" and current_user["user"].get("role") == "Admin"
        keys = list(DATASETS) if is_admin else sorted(STAFF_DATASETS)
        _guard(current_user, keys)
        f = _filters(start, end, team, athlete_id, False, include_archived)
        out = []
        for k in keys:
            out.append({"key": k, "label": DATASETS[k][0], "description": DATASETS[k][1],
                        "count": len(await build(k, f))})
        teams = sorted({a.get("team") for a in await db.athletes.find({}, {"_id": 0, "team": 1}).to_list(5000) if a.get("team")})
        return {"datasets": out, "teams": teams}

    @api_router.get("/research/preview/{key}")
    async def research_preview(key: str, start: str = None, end: str = None, team: str = None, athlete_id: str = None,
                               anonymize: bool = False, include_archived: bool = True, limit: int = 100,
                               current_user: dict = Depends(get_current_user)):
        _guard(current_user, [key])
        rows = await build(key, _filters(start, end, team, athlete_id, anonymize, include_archived))
        return {"key": key, "label": DATASETS[key][0], "total": len(rows), "columns": _columns(rows),
                "rows": rows[: max(1, min(limit, 500))]}

    @api_router.get("/research/export")
    async def research_export(datasets: str = Query(...), format: str = "xlsx", start: str = None, end: str = None,
                              team: str = None, athlete_id: str = None, anonymize: bool = False,
                              include_archived: bool = True, current_user: dict = Depends(get_current_user)):
        keys = [k.strip() for k in datasets.split(",") if k.strip()]
        if keys == ["all"]:
            keys = list(DATASETS)
        _guard(current_user, keys)
        f = _filters(start, end, team, athlete_id, anonymize, include_archived)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
        period = f"{start or 'start'}_to_{end or 'today'}"
        data = {k: await build(k, f) for k in keys}

        cols_by_key = {k: _columns(data[k]) for k in keys}
        if format == "csv":
            def to_csv(k):
                cols = cols_by_key[k]
                return _csv_bytes(cols, [[r.get(c) for c in cols] for r in data[k]])
            if len(keys) == 1:
                name = f"{keys[0]}_{period}.csv"
                return StreamingResponse(io.BytesIO(to_csv(keys[0])), media_type="text/csv",
                                         headers={"Content-Disposition": f'attachment; filename="{name}"'})
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                for k in keys:
                    z.writestr(f"{k}.csv", to_csv(k))
                z.writestr("data_dictionary.csv", _csv_bytes(DICT_HEADER, dictionary_rows(cols_by_key)))
            zbuf.seek(0)
            return StreamingResponse(zbuf, media_type="application/zip",
                                     headers={"Content-Disposition": f'attachment; filename="research_data_{period}_{stamp}.zip"'})

        wb = Workbook()
        info = wb.active
        info.title = "README"
        info.append(["Athlete Monitoring — Research Data Export"])
        info["A1"].font = Font(bold=True, size=14)
        meta = [("Generated (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")),
                ("Generated by", current_user["user"].get("name")),
                ("Period", f"{start or 'all'} → {end or 'all'}"), ("Team", team or "All teams"),
                ("Anonymized", "Yes (athlete codes only)" if anonymize else "No"),
                ("Includes archived collections", "Yes" if include_archived else "No"),
                ("OSTRC-H2 scoring", "Per-question scores are included (Qn_score); severity = sum of Q1-Q4 (0-100). "
                                     "Substantial problem = Q1 d, or Q2/Q3 answer c/d. Weeks without a problem appear as one row with all answers 'a'."),
                ("Data dictionary", "See the 'Data Dictionary' sheet: description, type, unit, scale and reference for every column.")]
        for m in meta:
            info.append(list(m))
        info.append([])
        info.append(["Sheet", "Rows", "Description"])
        for c in ("A", "B", "C"):
            info[f"{c}{info.max_row}"].font = Font(bold=True)
        for k in keys:
            info.append([k[:31], len(data[k]), DATASETS[k][1]])
        info.column_dimensions["A"].width = 32
        info.column_dimensions["B"].width = 28
        info.column_dimensions["C"].width = 90

        _add_dictionary(wb, cols_by_key)
        for k in keys:
            cols = cols_by_key[k] or ["no_data"]
            _write_sheet(wb, k, cols, [[r.get(c) for c in cols] for r in data[k]])

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        name = f"{keys[0] if len(keys) == 1 else 'research_data'}_{period}_{stamp}.xlsx"
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @api_router.get("/research/dictionary")
    async def research_dictionary(datasets: str = "all", format: str = "xlsx", anonymize: bool = False,
                                  current_user: dict = Depends(get_current_user)):
        keys = [k.strip() for k in datasets.split(",") if k.strip()]
        if keys == ["all"]:
            is_admin = current_user.get("user_type") == "staff" and current_user["user"].get("role") == "Admin"
            keys = list(DATASETS) if is_admin else sorted(STAFF_DATASETS)
        _guard(current_user, keys)
        f = _filters(None, None, None, None, anonymize, True)
        cols_by_key = {k: _columns(await build(k, f)) for k in keys}
        rows = dictionary_rows(cols_by_key)
        if format == "csv":
            return StreamingResponse(io.BytesIO(_csv_bytes(DICT_HEADER, rows)), media_type="text/csv",
                                     headers={"Content-Disposition": 'attachment; filename="data_dictionary.csv"'})
        wb = Workbook()
        wb.remove(wb.active)
        _write_sheet(wb, "Data Dictionary", DICT_HEADER, rows, widths=DICT_WIDTHS, wrap=True)
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": 'attachment; filename="data_dictionary.xlsx"'})

    def _require_admin(current_user):
        if current_user.get("user_type") != "staff" or current_user["user"].get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")

    @api_router.get("/research/adherence")
    async def research_adherence(start: str = None, end: str = None, team: str = None, include_archived: bool = True,
                                 current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        rows = await build("adherence_weekly", _filters(start, end, team, None, False, include_archived))
        weeks = sorted({r["week_start"] for r in rows})
        metrics = ["overall_pct", "morning_pct", "ostrc_pct", "recovery_pct", "training_sessions"]
        by_a = {}
        for r in rows:
            a = by_a.setdefault(r["athlete_code"], {"athlete_code": r["athlete_code"], "athlete_name": r.get("athlete_name"),
                                                     "team": r.get("team"), "weeks": {}})
            a["weeks"][r["week_start"]] = {m: r[m] for m in metrics + ["morning_days", "recovery_days", "training_days", "days_in_period", "ostrc_submitted"]}
        athletes = list(by_a.values())
        for a in athletes:
            vals = list(a["weeks"].values())
            a["avg"] = {m: round(sum(v[m] for v in vals) / len(vals), 1) if vals else 0 for m in metrics}
        athletes.sort(key=lambda a: a["avg"]["overall_pct"])
        team_weekly = []
        for w in weeks:
            wr = [r for r in rows if r["week_start"] == w]
            team_weekly.append({"week_start": w, **{m: round(sum(r[m] for r in wr) / len(wr), 1) for m in metrics}})
        overall = {m: round(sum(a["avg"][m] for a in athletes) / len(athletes), 1) if athletes else 0 for m in metrics}
        return {"weeks": weeks, "athletes": athletes, "team_weekly": team_weekly, "overall": overall}

    # ---- Google Sheets live links (IMPORTDATA CSV feeds) ----
    def _feed_out(f):
        f.pop("_id", None)
        f["path"] = f"/api/research/feed/{f['token']}.csv"
        f["label"] = DATASETS.get(f["dataset"], (f["dataset"],))[0]
        return f

    @api_router.post("/research/feeds")
    async def create_feed(payload: dict, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        ds = payload.get("dataset")
        if ds not in DATASETS:
            raise HTTPException(status_code=400, detail="Unknown dataset")
        days = payload.get("period_days")
        feed = {"id": str(uuid.uuid4()), "token": secrets.token_urlsafe(24), "dataset": ds,
                "team": payload.get("team") or None, "anonymize": bool(payload.get("anonymize", True)),
                "include_archived": bool(payload.get("include_archived", True)),
                "period_days": int(days) if days else None, "name": (payload.get("name") or "").strip() or None,
                "created_by": current_user["user"].get("name"), "created_at": datetime.now(timezone.utc).isoformat(),
                "revoked": False, "access_count": 0, "last_accessed_at": None}
        await db.research_feeds.insert_one(dict(feed))
        return _feed_out(feed)

    @api_router.get("/research/feeds")
    async def list_feeds(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        feeds = await db.research_feeds.find({"revoked": False}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return [_feed_out(f) for f in feeds]

    @api_router.delete("/research/feeds/{feed_id}")
    async def revoke_feed(feed_id: str, current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        res = await db.research_feeds.update_one({"id": feed_id, "revoked": False},
                                                 {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc).isoformat()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Link not found")
        return {"success": True}

    @api_router.get("/research/feed/{token}.csv")
    async def public_feed(token: str):
        feed = await db.research_feeds.find_one({"token": token, "revoked": False}, {"_id": 0})
        if not feed:
            raise HTTPException(status_code=404, detail="Link not found or revoked")
        start = None
        if feed.get("period_days"):
            start = (datetime.strptime(today_str(), "%Y-%m-%d") - timedelta(days=feed["period_days"] - 1)).strftime("%Y-%m-%d")
        rows = await build(feed["dataset"], _filters(start, None, feed.get("team"), None, feed.get("anonymize", True),
                                                     feed.get("include_archived", True)))
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=_columns(rows) or ["no_data"], extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
        await db.research_feeds.update_one({"token": token}, {"$set": {"last_accessed_at": datetime.now(timezone.utc).isoformat()},
                                                              "$inc": {"access_count": 1}})
        return Response(content=buf.getvalue().encode("utf-8"), media_type="text/csv; charset=utf-8",
                        headers={"Cache-Control": "no-store"})

    @api_router.get("/health/staff/period-stats")
    async def health_period_stats(start: str = None, end: str = None, team: str = None, group: str = "week",
                                  current_user: dict = Depends(get_current_user)):
        _guard(current_user, ["ostrc_responses"])
        f = _filters(start, end, team, None, False, True)
        rows = await build("ostrc_responses", f)
        A = await _athletes(team, None)
        roster = sum(1 for a in A.values() if a.get("active", True))

        def bucket(d):
            dt = datetime.strptime(d[:10], "%Y-%m-%d")
            if group == "month":
                return dt.strftime("%Y-%m")
            return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")

        G = defaultdict(lambda: {"resp": set(), "prob": set(), "subst": set(), "sev": [], "cats": defaultdict(int)})
        for r in rows:
            if not r.get("date"):
                continue
            g = G[bucket(r["date"])]
            g["resp"].add(r["athlete_code"])
            if r.get("has_health_problem") and (r.get("severity_score") or 0) > 0:
                g["prob"].add(r["athlete_code"])
                g["sev"].append(r["severity_score"])
                g["cats"][r.get("problem_category") or "other"] += 1
                if r.get("substantial_problem"):
                    g["subst"].add(r["athlete_code"])
        periods = []
        for k in sorted(G):
            g = G[k]
            n = len(g["resp"])
            periods.append({
                "period": k, "respondents": n, "roster": roster,
                "response_rate": round(100 * n / roster) if roster else 0,
                "athletes_with_problems": len(g["prob"]),
                "prevalence_all": round(100 * len(g["prob"]) / n, 1) if n else 0,
                "prevalence_substantial": round(100 * len(g["subst"]) / n, 1) if n else 0,
                "mean_severity": round(sum(g["sev"]) / len(g["sev"]), 1) if g["sev"] else 0,
                "by_category": dict(g["cats"]),
            })
        probs = [r for r in rows if r.get("has_health_problem")]
        return {
            "group": group, "periods": periods,
            "totals": {
                "submissions": len({r["submission_id"] for r in rows}),
                "athletes_responding": len({r["athlete_code"] for r in rows}),
                "problem_reports": len(probs),
                "substantial_reports": sum(1 for r in probs if r.get("substantial_problem")),
                "mean_prevalence_all": round(sum(p["prevalence_all"] for p in periods) / len(periods), 1) if periods else 0,
                "mean_prevalence_substantial": round(sum(p["prevalence_substantial"] for p in periods) / len(periods), 1) if periods else 0,
                "mean_response_rate": round(sum(p["response_rate"] for p in periods) / len(periods)) if periods else 0,
            },
        }
