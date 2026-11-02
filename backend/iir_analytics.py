"""Reports, rates and exports for Injury & Illness Recording (pure, testable).

Indicator definitions (also written into every export's metadata)
----------------------------------------------------------------
* Game injury incidence  = injuries with activity "Game" ÷ athlete game hours × 1000
* Training injury incidence = injuries with activity "Training" ÷ athlete training hours × 1000
* Compatibility view (Super Sixes infographic style): ALL injuries ÷ match-player-hours × 1000.
  This uses the game denominator for every activity and is therefore NOT a
  training-specific incidence; it is labelled as such everywhere.
* Time-loss burden = effective time-loss days (IIR-TL-1) of the injuries of a context
  ÷ athlete hours of that context × 1000. Provisional days of open episodes are
  reported separately and are not included in the final burden.
* Illness incidence = illnesses ÷ monitored athlete-days × 1000.
* Athlete hours = Σ minutes of participation ÷ 60 (individual records preferred;
  a collective estimate is only used for sessions without individual records and
  its method is reported).
* Any rate whose denominator is missing or zero is "not calculable".
"""
import csv
import hashlib
import hmac
import io
import json
import secrets
import zipfile
from collections import Counter
from datetime import date, timedelta

import iir_logic as L
import iir_taxonomy as T

GAME_ACTIVITIES = {"game"}
TRAINING_ACTIVITIES = {"training"}

INDICATOR_DEFINITIONS = [
    ("game_injury_rate", "Injuries in games per 1,000 athlete game hours",
     "Injuries with Activity = Game ÷ Σ athlete game minutes/60 × 1000"),
    ("training_injury_rate", "Injuries in training per 1,000 athlete training hours",
     "Injuries with Activity = Training ÷ Σ athlete training minutes/60 × 1000"),
    ("all_injuries_per_match_player_hours", "All injuries per 1,000 match-player-hours (compatibility view)",
     "ALL injuries (any activity) ÷ match-player-hours × 1000 — game denominator for every activity; "
     "NOT a training-specific incidence"),
    ("time_loss_burden", "Time-loss days per 1,000 athlete hours of the corresponding context",
     "Σ effective time-loss days (IIR-TL-1, final values only) ÷ athlete hours × 1000"),
    ("illness_rate", "Illnesses per 1,000 monitored athlete-days",
     "Illnesses ÷ Σ monitored athlete-days × 1000"),
]


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------
LIST_FILTERS = {"body_location", "injury_type"}
SCALAR_FILTERS = ["athlete_id", "team", "category", "event_id", "activity", "organ_system", "aetiology",
                  "mechanism", "classification", "time_loss", "status"]


def apply_filters(eps, f):
    """Same filters are applied to numerators (here) and denominators (exposure)."""
    out = []
    frm = L.safe_date(f.get("from"))
    to = L.safe_date(f.get("to"))
    cutoff = L.safe_date(f.get("cutoff")) or to or L.today()
    for e in eps:
        if e.get("deleted") or e.get("status") == "draft":
            continue
        ok = True
        for k in SCALAR_FILTERS:
            if f.get(k) and f[k] != "all" and e.get(k) != f[k]:
                ok = False
                break
        if not ok:
            continue
        for k in LIST_FILTERS:
            if f.get(k) and f[k] not in (e.get(k) or []):
                ok = False
        if f.get("report_by") and (e.get("report_by") or {}).get("id") != f["report_by"]:
            ok = False
        if not ok:
            continue
        ev = L.safe_date(e.get(L.event_date_key(e.get("kind"))))
        if ev and ev > cutoff:
            continue  # occurred after the cut-off date
        e = dict(e)
        e["_incident"] = True
        if frm and ev and ev < frm:
            # pre-existing episode: include only if still active during the period
            end = L.safe_date(e.get("full_return_date"))
            if end and end < frm:
                continue
            e["_incident"] = False
        if to and ev and ev > to:
            continue
        if not ev:
            e["_incident"] = None  # unknown date
        out.append(e)
    return out


def filter_sessions(sessions, f):
    frm, to = L.safe_date(f.get("from")), L.safe_date(f.get("to"))
    out = []
    for s in sessions:
        d = L.safe_date(s.get("date"))
        if frm and d and d < frm:
            continue
        if to and d and d > to:
            continue
        if f.get("team") and f["team"] != "all" and s.get("team") and s.get("team") != f["team"]:
            continue
        if f.get("event_id") and s.get("event_id") != f["event_id"]:
            continue
        s = dict(s)
        if f.get("athlete_id"):
            s["individual"] = [r for r in (s.get("individual") or []) if r.get("athlete_id") == f["athlete_id"]]
            s["collective"] = None  # collective estimates cannot be attributed to one athlete
        out.append(s)
    return out


def monitored_athlete_days(monitoring, f):
    frm, to = L.safe_date(f.get("from")), L.safe_date(f.get("to"))
    total = 0
    for m in monitoring:
        if f.get("athlete_id") and m.get("athlete_id") != f["athlete_id"]:
            continue
        if f.get("team") and f["team"] != "all" and m.get("team") and m["team"] != f["team"]:
            continue
        if f.get("event_id") and m.get("event_id") != f["event_id"]:
            continue
        s, e = L.safe_date(m.get("start_date")), L.safe_date(m.get("end_date"))
        if not s or not e or e < s:
            continue
        if frm:
            s = max(s, frm)
        if to:
            e = min(e, to)
        if e >= s:
            total += (e - s).days + 1
    return total


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def _count(eps, key, opt_key, multiple=False):
    c = Counter()
    for e in eps:
        vals = e.get(key) if multiple else [e.get(key)]
        for v in (vals or []):
            if v:
                c[v] += 1
        if not vals or (not multiple and not e.get(key)):
            c["__not_filled__"] += 1
    rows = []
    for code, n in c.most_common():
        label = "Not filled" if code == "__not_filled__" else (T.ui_label(opt_key, code) or code)
        rows.append({"code": code, "label": label, "count": n})
    return rows


def _pct(rows, denom):
    for r in rows:
        r["pct"] = round(r["count"] / denom * 100, 1) if denom else None
    return rows


def _days_summary(eps, cutoff):
    final_days, final_n, prov_days, prov_n, unknown_n, zero_n, na_n, nf_n = 0, 0, 0, 0, 0, 0, 0, 0
    for e in eps:
        tl = L.effective_time_loss(e, cutoff)
        st = tl["state"]
        if st in ("final", "zero"):
            final_days += tl["value"]
            final_n += 1
            zero_n += st == "zero"
        elif st == "provisional":
            prov_days += tl["value"]
            prov_n += 1
        elif st == "unknown":
            unknown_n += 1
        elif st == "not_applicable":
            na_n += 1
        else:
            nf_n += 1
    return {"final_days": final_days, "final_episodes": final_n, "zero_day_episodes": zero_n,
            "provisional_days": prov_days, "open_episodes_provisional": prov_n, "unknown": unknown_n,
            "not_applicable_medical_attention": na_n, "not_filled": nf_n}


def _rate(n, denom, unit):
    v = L.rate_per_1000(n, denom)
    return {"cases": n, "exposure": round(denom, 2) if denom else denom, "unit": unit,
            "rate_per_1000": v, "calculable": v is not None}


def build_report(episodes, sessions, monitoring, f, events=None):
    cutoff = L.safe_date(f.get("cutoff")) or L.safe_date(f.get("to")) or L.today()
    eps_all = apply_filters(episodes, f)
    athletes_only = [e for e in eps_all if e.get("participant_type", "athlete") == "athlete"]
    non_athletes = [e for e in eps_all if e.get("participant_type") == "other"]
    inj = [e for e in athletes_only if e["kind"] == "injury"]
    ill = [e for e in athletes_only if e["kind"] == "illness"]
    exp = L.merge_exposure_records(filter_sessions(sessions, f))
    hours = exp["hours"]
    game_h, train_h = hours.get("game"), hours.get("training")

    def injury_section():
        n = len(inj)
        incident = [e for e in inj if e["_incident"] is not False]
        pre = [e for e in inj if e["_incident"] is False]
        game_inj = [e for e in incident if e.get("activity") in GAME_ACTIVITIES]
        train_inj = [e for e in incident if e.get("activity") in TRAINING_ACTIVITIES]
        other_inj = [e for e in incident if e.get("activity") not in GAME_ACTIVITIES | TRAINING_ACTIVITIES]

        def burden(group, denom):
            days = sum(L.effective_time_loss(e, cutoff)["value"] or 0 for e in group
                       if L.effective_time_loss(e, cutoff)["state"] in ("final", "zero"))
            return {"days": days, "exposure_hours": denom, "rate_per_1000": L.rate_per_1000(days, denom)}

        qual = [L.quality_issues(e) for e in inj]
        return {
            "episodes": n,
            "incident_in_period": len(incident),
            "preexisting_in_follow_up": len(pre),
            "athletes_affected": len({e.get("athlete_id") for e in inj}),
            "classification": _pct(_count(inj, "classification", "inj_classification"), n),
            "activity": _pct(_count(inj, "activity", "activity"), n),
            "activity_segment": _pct(_count(inj, "activity_segment", "activity_segment"), n),
            "mechanism": _pct(_count(inj, "mechanism", "mechanism"), n),
            "source": _pct(_count(inj, "source", "source"), n),
            "occurrence": _pct(_count(inj, "occurrence", "occurrence"), n),
            "body_location": _pct(_count(inj, "body_location", "body_location", multiple=True), n),
            "injury_type": _pct(_count(inj, "injury_type", "injury_type", multiple=True), n),
            "multi_select_note": "Body location and injury type allow several selections per episode: "
                                 "percentages use the number of episodes as denominator and can exceed 100%.",
            "time_loss": _pct(_count(inj, "time_loss", "time_loss"), n),
            "days": _days_summary(inj, cutoff),
            "rates": {
                "game": _rate(len(game_inj), game_h, "athlete game hours"),
                "training": _rate(len(train_inj), train_h, "athlete training hours"),
                "other_activities_cases": len(other_inj),
                "compat_all_per_match_player_hours": {
                    **_rate(len(incident), game_h, "match-player-hours"),
                    "note": "Compatibility with the Super Sixes infographic: all injuries ÷ match-player-hours. "
                            "Not a training-specific incidence.",
                },
                "time_loss_burden_game": burden(game_inj, game_h),
                "time_loss_burden_training": burden(train_inj, train_h),
                "by_activity_per_match_player_hours": [
                    {**r, "rate_per_1000_mph": L.rate_per_1000(r["count"], game_h)}
                    for r in _count(incident, "activity", "activity")],
            },
            "completeness": {
                "complete_records": sum(q["complete"] for q in qual),
                "records_with_warnings": sum(bool(q["warnings"]) for q in qual),
                "pending_fields": Counter(p for q in qual for p in q["pending"]).most_common(),
            },
        }

    def illness_section():
        n = len(ill)
        days = monitored_athlete_days(monitoring, f)
        return {
            "episodes": n,
            "incident_in_period": len([e for e in ill if e["_incident"] is not False]),
            "preexisting_in_follow_up": len([e for e in ill if e["_incident"] is False]),
            "athletes_affected": len({e.get("athlete_id") for e in ill}),
            "organ_system": _pct(_count(ill, "organ_system", "organ_system"), n),
            "aetiology": _pct(_count(ill, "aetiology", "aetiology"), n),
            "communicable": _pct(_count(ill, "communicable", "communicable"), n),
            "classification": _pct(_count(ill, "classification", "ill_classification"), n),
            "time_loss": _pct(_count(ill, "time_loss", "time_loss"), n),
            "status": _pct(_count(ill, "status", "status"), n),
            "days": _days_summary(ill, cutoff),
            "rates": {"athlete_days": _rate(len([e for e in ill if e["_incident"] is not False]),
                                            days or None, "monitored athlete-days")},
        }

    # unique unavailable days per athlete (injuries + illnesses together)
    by_ath = {}
    for e in athletes_only:
        by_ath.setdefault(e.get("athlete_id"), []).append(e)
    unique_days = {a: L.unique_unavailable_days(v, cutoff) for a, v in by_ath.items()}

    excluded_teams = []
    for ev in events or []:
        if f.get("event_id") and ev.get("id") != f["event_id"]:
            continue
        for t in ev.get("teams") or []:
            if not t.get("included", True):
                excluded_teams.append({"event": ev.get("name"), "team": t["name"], "reason": t.get("exclusion_reason")})

    return {
        "filters": {k: v for k, v in f.items() if v not in (None, "", "all")},
        "cutoff": cutoff.isoformat(),
        "form_version": T.FORM_VERSION,
        "dictionary_version": T.DICTIONARY_VERSION,
        "time_loss_convention": T.TIME_LOSS_CONVENTION,
        "population": "Registered athletes (participant type = athlete)",
        "injuries": injury_section(),
        "illnesses": illness_section(),
        "exposure": {"hours": hours, "collective_estimates_used": exp["estimates"]},
        "unique_unavailable_days": {
            "total": sum(v["days"] for v in unique_days.values()),
            "any_provisional": any(v["provisional"] for v in unique_days.values()),
            "athletes": len([v for v in unique_days.values() if v["days"] > 0]),
        },
        "exclusions": {
            "drafts_and_deleted": "always excluded",
            "non_athlete_participants": len(non_athletes),
            "non_athlete_note": "Non-athlete participants are reported separately and excluded from athlete denominators.",
            "teams_excluded": excluded_teams,
        },
        "indicator_definitions": [{"key": k, "name": n, "definition": d} for k, n, d in INDICATOR_DEFINITIONS],
        "disclaimer": T.DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# Export: identification modes
# ---------------------------------------------------------------------------
class Identity:
    """Applies identified / pseudonymised / anonymised transformation at export
    time. Internal records keep the real identity."""

    def __init__(self, mode, key=None, athletes=None, date_mode="exact", anchor=None):
        self.mode = mode
        self.key = (key or "").encode()
        self.athletes = athletes or {}
        self.date_mode = date_mode if mode == "anonymized" else "exact"
        self.anchor = L.safe_date(anchor)
        self._subjects = {}
        self._records = {}

    def person(self, athlete_id, other_name=None):
        if not athlete_id:
            if self.mode == "identified":
                return {"athlete_id": None, "athlete_name": other_name}
            return {"subject_code": "NON-ATHLETE"}
        if self.mode == "identified":
            a = self.athletes.get(athlete_id) or {}
            return {"athlete_id": athlete_id, "athlete_name": a.get("name")}
        if self.mode == "pseudonymized":
            h = hmac.new(self.key, athlete_id.encode(), hashlib.sha256).hexdigest()[:10].upper()
            return {"subject_code": f"P-{h}"}
        if athlete_id not in self._subjects:
            self._subjects[athlete_id] = f"S{len(self._subjects) + 1:03d}"
        return {"subject_code": self._subjects[athlete_id]}

    def record_id(self, rid):
        if not rid or self.mode == "identified":
            return rid
        if self.mode == "pseudonymized":
            return "E-" + hmac.new(self.key, rid.encode(), hashlib.sha256).hexdigest()[:12].upper()
        if rid not in self._records:
            self._records[rid] = f"R{len(self._records) + 1:05d}"
        return self._records[rid]

    def date(self, value):
        d = L.safe_date(value)
        if not d:
            return None
        if self.date_mode == "month":
            return d.strftime("%Y-%m")
        if self.date_mode == "relative":
            return (d - self.anchor).days if self.anchor else None
        return d.isoformat()

    def professional(self, who):
        who = who or {}
        if self.mode == "identified":
            return who.get("name")
        return who.get("role") or "Health professional"


def _orig(key, code):
    return T.original_label(key, code) if code else None


def _join_orig(key, codes, sep=", "):
    return sep.join(filter(None, (_orig(key, c) for c in (codes or []))))


def compat_tables(episodes, idt, include_free_text=True, staff_names=None):
    """Team_Injuries (30 columns) and Team_Illnesses (21 columns) with the
    workbook's exact headers and original option labels."""
    tables = {}
    for kind, sheet in (("injury", "Team_Injuries"), ("illness", "Team_Illnesses")):
        fields = T.fields_for(kind)
        header = [f["original_header"] for f in fields]
        rows = []
        for e in [x for x in episodes if x["kind"] == kind]:
            row = []
            for f in fields:
                k = f["key"]
                if k == "report_by":
                    row.append(idt.professional(e.get("report_by")))
                elif k == "athlete":
                    p = idt.person(e.get("athlete_id"), e.get("other_participant_name"))
                    row.append(p.get("athlete_name") or p.get("subject_code"))
                elif k == "compat_time_loss_days":
                    row.append(L.compat_time_loss_days(e)["value"])
                elif f["type"] == "date":
                    row.append(idt.date(e.get(k)))
                elif k == "imaging":
                    row.append(_join_orig("imaging", [i.get("modality") for i in e.get("imaging") or []]) or None)
                elif f.get("options"):
                    row.append(_join_orig(f["options"], e.get(k)) if f.get("multiple") else _orig(f["options"], e.get(k)))
                elif k in T.FREE_TEXT_FIELDS:
                    row.append(e.get(k) if include_free_text else None)
                else:
                    row.append(e.get(k))
            rows.append(row)
        tables[sheet] = {"header": header, "rows": rows}
    return tables


def scientific_tables(episodes, followups, sessions, monitoring, idt, include_free_text=False, cutoff=None):
    """Related tables keyed by identifiers (no concatenated multi-values)."""
    ep_cols = ["episode_id", "subject", "kind", "participant_type", "team", "category", "event_id", "season",
               "event_date", "time_slot", "position", "surface", "surface_type", "activity", "activity_segment",
               "game_day", "game_day_offset", "classification", "linked_episode_id", "prior_full_recovery",
               "time_loss", "mode_of_onset", "mechanism", "source", "occurrence", "phase_of_play", "phase_numbers",
               "penalty", "laterality", "communicable", "organ_system", "aetiology", "managed_by",
               "diagnosis_status", "status", "participation", "assessment_date", "symptom_onset_date",
               "unavailability_start", "estimated_rtp_date", "partial_return_date", "full_return_date",
               "actual_rtp_date", "seriousness", "compat_time_loss_days", "effective_time_loss_days",
               "effective_time_loss_state", "start_imputed", "reported_by", "created_at", "updated_at",
               "form_version", "dictionary_version"]
    if include_free_text:
        ep_cols += ["initial_diagnosis", "final_diagnosis", "treatment_notes", "additional_notes"]
    ep_rows, loc_rows, type_rows, img_rows = [], [], [], []
    for e in episodes:
        k = e["kind"]
        p = idt.person(e.get("athlete_id"), e.get("other_participant_name"))
        eid = idt.record_id(e["id"])
        tl = L.effective_time_loss(e, cutoff)
        val = {
            "episode_id": eid, "subject": p.get("athlete_name") or p.get("subject_code"),
            "kind": k, "event_date": idt.date(e.get(L.event_date_key(k))),
            "time_slot": e.get("time_of_injury") or e.get("time_of_onset"),
            "linked_episode_id": idt.record_id(e.get("linked_episode_id")),
            "compat_time_loss_days": L.compat_time_loss_days(e)["value"],
            "effective_time_loss_days": tl["value"], "effective_time_loss_state": tl["state"],
            "start_imputed": tl.get("start_imputed"),
            "reported_by": idt.professional(e.get("report_by")),
            "created_at": idt.date(e.get("created_at")), "updated_at": idt.date(e.get("updated_at")),
        }
        for c in ep_cols:
            if c in val:
                continue
            if c in ("assessment_date", "symptom_onset_date", "unavailability_start", "estimated_rtp_date",
                     "partial_return_date", "full_return_date", "actual_rtp_date"):
                val[c] = idt.date(e.get(c))
            elif c == "event_id" and idt.mode == "anonymized":
                val[c] = None
            else:
                val[c] = e.get(c)
        ep_rows.append([val.get(c) for c in ep_cols])
        for i, c in enumerate(e.get("body_location") or []):
            loc_rows.append([eid, i + 1, c, _orig("body_location", c)])
        for i, c in enumerate(e.get("injury_type") or []):
            type_rows.append([eid, i + 1, c, _orig("injury_type", c)])
        for i, im in enumerate(e.get("imaging") or []):
            img_rows.append([eid, i + 1, im.get("modality"), _orig("imaging", im.get("modality")), idt.date(im.get("date")),
                             im.get("result") if include_free_text else None])

    fu_cols = ["followup_id", "episode_id", "date", "kind", "participation", "by"] + \
              (["symptoms", "diagnosis", "treatment", "exams_referrals", "notes"] if include_free_text else []) + \
              ["applied_changes"]
    fu_rows = []
    for f in followups:
        row = [idt.record_id(f["id"]), idt.record_id(f["episode_id"]), idt.date(f.get("date")), f.get("kind"),
               f.get("participation"), idt.professional(f.get("by"))]
        if include_free_text:
            row += [f.get("symptoms"), f.get("diagnosis"), f.get("treatment"), f.get("exams_referrals"), f.get("notes")]
        applied = {k: (idt.date(v) if k.endswith("_date") or k == "unavailability_start" else v)
                   for k, v in (f.get("applied") or {}).items()
                   if include_free_text or k not in ("final_diagnosis",)}
        row.append(json.dumps(applied, ensure_ascii=False) if applied else None)
        fu_rows.append(row)

    s_cols = ["session_id", "event_id", "team", "date", "context", "session_label", "duration_min",
              "data_source", "estimation_method", "coverage_note", "collective_athletes", "collective_minutes_each"]
    s_rows, ind_rows = [], []
    for s in sessions:
        sid = idt.record_id(s["id"])
        c = s.get("collective") or {}
        s_rows.append([sid, None if idt.mode == "anonymized" else s.get("event_id"), s.get("team"), idt.date(s.get("date")),
                       s.get("context"), s.get("session_label"), s.get("duration_min"), s.get("data_source"),
                       s.get("estimation_method") or c.get("method"), s.get("coverage_note"),
                       c.get("athletes"), c.get("minutes_each")])
        for r in s.get("individual") or []:
            p = idt.person(r.get("athlete_id"))
            ind_rows.append([sid, p.get("athlete_name") or p.get("subject_code"), r.get("minutes"),
                             r.get("participation"), r.get("source")])
    m_rows = []
    for m in monitoring:
        p = idt.person(m.get("athlete_id"))
        s, e = L.safe_date(m.get("start_date")), L.safe_date(m.get("end_date"))
        m_rows.append([p.get("athlete_name") or p.get("subject_code"), m.get("team"),
                       None if idt.mode == "anonymized" else m.get("event_id"),
                       idt.date(m.get("start_date")), idt.date(m.get("end_date")),
                       (e - s).days + 1 if s and e and e >= s else None])
    return {
        "episodes": {"header": ep_cols, "rows": ep_rows},
        "episode_body_locations": {"header": ["episode_id", "order", "code", "original_label"], "rows": loc_rows},
        "episode_injury_types": {"header": ["episode_id", "order", "code", "original_label"], "rows": type_rows},
        "episode_imaging": {"header": ["episode_id", "order", "code", "original_label", "date", "result"], "rows": img_rows},
        "followups": {"header": fu_cols, "rows": fu_rows},
        "exposure_sessions": {"header": s_cols, "rows": s_rows},
        "exposure_participation": {"header": ["session_id", "subject", "minutes", "participation", "source"],
                                   "rows": ind_rows},
        "monitoring_periods": {"header": ["subject", "team", "event_id", "start_date", "end_date", "athlete_days"],
                               "rows": m_rows},
    }


def dictionary_tables():
    f_rows = []
    for kind, fields in (("injury", T.INJURY_FIELDS), ("illness", T.ILLNESS_FIELDS), ("both", T.APP_FIELDS)):
        for i, f in enumerate(fields, 1):
            f_rows.append([kind, f["key"], f["label"], (f.get("original_header") or "").replace("\n", " "),
                           f.get("column"), i if f["source"] == "reference" else None, f["source"], f["type"],
                           f.get("options"), "yes" if f.get("multiple") else "no",
                           "days" if "days" in f["key"] else ("YYYY-MM-DD" if f["type"] == "date" else None),
                           f.get("notes")])
    o_rows = []
    for key, opts in T.OPTIONS.items():
        for o in opts:
            o_rows.append([key, o["code"], o["label"], o.get("original"), o.get("group"),
                           "app extension" if o.get("extension") else "reference"])
    i_rows = [[k, n, d] for k, n, d in INDICATOR_DEFINITIONS]
    return {
        "dictionary_fields": {"header": ["form", "key", "label", "original_header", "workbook_column",
                                         "reference_number", "source", "type", "options_key", "multiple", "unit",
                                         "notes"], "rows": f_rows},
        "dictionary_categories": {"header": ["options_key", "code", "label", "original_label", "group", "origin"],
                                  "rows": o_rows},
        "indicator_definitions": {"header": ["key", "name", "definition"], "rows": i_rows},
    }


def metadata_table(meta):
    rows = [[k, v if isinstance(v, (str, int, float)) or v is None else json.dumps(v, ensure_ascii=False)]
            for k, v in meta.items()]
    return {"metadata": {"header": ["item", "value"], "rows": rows}}


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------
def to_xlsx(tables):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    wb = Workbook()
    wb.remove(wb.active)
    for name, t in tables.items():
        ws = wb.create_sheet(name[:31])
        ws.append(t["header"])
        for c in ws[1]:
            c.font = Font(bold=True)
            c.alignment = Alignment(wrap_text=True, vertical="top")
        for r in t["rows"]:
            ws.append([v if not isinstance(v, (list, dict)) else json.dumps(v, ensure_ascii=False) for v in r])
        for i, h in enumerate(t["header"], 1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = min(40, max(12, len(str(h).split("\n")[0]) + 2))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_csv_zip(tables):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, t in tables.items():
            s = io.StringIO()
            w = csv.writer(s)
            w.writerow(t["header"])
            for r in t["rows"]:
                w.writerow(["" if v is None else (json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v)
                            for v in r])
            z.writestr(f"{name}.csv", "﻿" + s.getvalue())
    return buf.getvalue()


def to_pdf(report, title="Injury & Illness Report"):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=title, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    ss = getSampleStyleSheet()
    small = ss["BodyText"].clone("small", fontSize=8, leading=10)
    els = [Paragraph(title, ss["Title"]),
           Paragraph(f"Cut-off date: {report['cutoff']} · Form {report['form_version']} · "
                     f"Dictionary {report['dictionary_version']} · Time-loss convention {report['time_loss_convention']}", small),
           Paragraph(f"Filters: {json.dumps(report['filters'], ensure_ascii=False) or 'none'}", small),
           Paragraph(f"Population: {report['population']}", small), Spacer(1, 8)]

    def tbl(rows, widths=None):
        t = Table(rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
                               ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                               ("FONTSIZE", (0, 0), (-1, -1), 8),
                               ("GRID", (0, 0), (-1, -1), 0.25, colors.grey)]))
        return t

    def rate_txt(r):
        return f"{r['rate_per_1000']} /1000 {r['unit']}" if r["calculable"] else "not calculable (no exposure)"

    inj, ill = report["injuries"], report["illnesses"]
    els.append(Paragraph("Injuries", ss["Heading2"]))
    els.append(tbl([["Indicator", "Value"],
                    ["Episodes / athletes affected", f"{inj['episodes']} / {inj['athletes_affected']}"],
                    ["Incident in period / pre-existing in follow-up", f"{inj['incident_in_period']} / {inj['preexisting_in_follow_up']}"],
                    ["Game injuries", f"{inj['rates']['game']['cases']} · {rate_txt(inj['rates']['game'])}"],
                    ["Training injuries", f"{inj['rates']['training']['cases']} · {rate_txt(inj['rates']['training'])}"],
                    ["All injuries per match-player-hours (compatibility)", rate_txt(inj['rates']['compat_all_per_match_player_hours'])],
                    ["Time-loss days (final) / provisional (open)", f"{inj['days']['final_days']} / {inj['days']['provisional_days']} ({inj['days']['open_episodes_provisional']} open)"],
                    ], widths=[260, 260]))
    for key, title_ in (("classification", "Classification"), ("activity", "Activity"), ("mechanism", "Mechanism"),
                        ("source", "Source"), ("body_location", "Body location *"), ("injury_type", "Injury type *"),
                        ("time_loss", "Time-loss")):
        rows = [[title_, "n", "% of episodes"]] + [[r["label"], r["count"], r["pct"]] for r in inj[key]]
        if len(rows) > 1:
            els += [Spacer(1, 6), tbl(rows, widths=[300, 60, 100])]
    els.append(Paragraph("* " + inj["multi_select_note"], small))
    els.append(Paragraph("Illnesses", ss["Heading2"]))
    els.append(tbl([["Indicator", "Value"],
                    ["Episodes / athletes affected", f"{ill['episodes']} / {ill['athletes_affected']}"],
                    ["Illness rate", rate_txt(ill['rates']['athlete_days'])],
                    ["Time-loss days (final) / provisional", f"{ill['days']['final_days']} / {ill['days']['provisional_days']}"]],
                   widths=[260, 260]))
    for key, title_ in (("organ_system", "Organ system"), ("aetiology", "Aetiology"), ("communicable", "Communicable")):
        rows = [[title_, "n", "%"]] + [[r["label"], r["count"], r["pct"]] for r in ill[key]]
        if len(rows) > 1:
            els += [Spacer(1, 6), tbl(rows, widths=[300, 60, 100])]
    els.append(Paragraph("Exposure and exclusions", ss["Heading2"]))
    els.append(Paragraph(f"Athlete hours: {json.dumps(report['exposure']['hours'])}. Collective estimates used: "
                         f"{len(report['exposure']['collective_estimates_used'])}.", small))
    els.append(Paragraph(f"Non-athlete participants excluded from denominators: {report['exclusions']['non_athlete_participants']}. "
                         f"Teams excluded: {json.dumps(report['exclusions']['teams_excluded'], ensure_ascii=False)}", small))
    els.append(Paragraph("Indicator definitions", ss["Heading2"]))
    for d in report["indicator_definitions"]:
        els.append(Paragraph(f"<b>{d['name']}</b>: {d['definition']}", small))
    els += [Spacer(1, 8), Paragraph(report["disclaimer"], small)]
    doc.build(els)
    return buf.getvalue()


def new_pseudonym_key():
    return secrets.token_hex(32)
