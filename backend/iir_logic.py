"""Pure calculation / validation logic for Injury & Illness Recording.

Standard library only, so it can be unit-tested without the web stack.

Time-loss convention ``IIR-TL-1`` (documented for research)
-----------------------------------------------------------
* Effective time loss = ``full_return_date − unavailability_start`` in calendar
  days. The day of the injury/onset is day 0 and the day of full return is not
  counted, so a same-day return is **0 days** (a real zero, not "missing").
* If ``unavailability_start`` is missing on a time-loss episode the date of
  injury/onset is used and the value is flagged ``start_imputed``.
* Without a full return date the value is **never 0**: open episodes report the
  observed duration up to the cut-off date as *provisional*; closed / lost
  episodes without a return date are *unknown*.
* The estimated return date is never used in place of an actual return.
* ``compat_time_loss_days`` reproduces the workbook formula
  ``Actual RTP Date − Date of Injury/Onset`` only when both dates are valid.
"""
from datetime import date, datetime, timedelta

MIN_YEAR = 1990
MAX_YEAR = 2100
PARTICIPATION_ORDER = {"unavailable": 3, "modified": 2, "unknown": 1, "full": 0}


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------
def parse_date(value):
    """Parse an ISO date (YYYY-MM-DD or ISO datetime). Returns ``date`` or None.

    Raises ValueError for anything that is not a real calendar date, including
    Excel serial numbers (e.g. 0 or 46000), which must never become dates.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    elif isinstance(value, (int, float)):
        raise ValueError("Numeric values (spreadsheet serial numbers) are not accepted as dates")
    else:
        s = str(value).strip()
        try:
            d = date.fromisoformat(s[:10])
        except ValueError:
            raise ValueError(f"Invalid date: {s!r} (use YYYY-MM-DD)")
    if not (MIN_YEAR <= d.year <= MAX_YEAR):
        raise ValueError(f"Date out of plausible range: {d.isoformat()}")
    return d


def safe_date(value):
    try:
        return parse_date(value)
    except ValueError:
        return None


def event_date_key(kind):
    return "date_of_injury" if kind == "injury" else "date_of_onset"


# ---------------------------------------------------------------------------
# Time loss
# ---------------------------------------------------------------------------
def compat_time_loss_days(ep):
    """Workbook-compatible value: Actual RTP Date − Date of Injury/Onset."""
    start = safe_date(ep.get(event_date_key(ep.get("kind"))))
    end = safe_date(ep.get("actual_rtp_date"))
    if not start or not end:
        return {"value": None, "reason": "missing_dates"}
    if end < start:
        return {"value": None, "reason": "end_before_start"}
    return {"value": (end - start).days, "reason": None}


def effective_time_loss(ep, cutoff=None):
    """Effective time loss (IIR-TL-1). Returns dict with value/state/start/end."""
    cutoff = safe_date(cutoff) or date.today()
    tl = ep.get("time_loss")
    start = safe_date(ep.get("unavailability_start"))
    imputed = False
    if tl == "no" and not start:
        return {"value": None, "state": "not_applicable", "start": None, "end": None, "start_imputed": False}
    if not start and tl == "yes":
        start = safe_date(ep.get(event_date_key(ep.get("kind"))))
        imputed = start is not None
    if not start:
        state = "unknown" if tl == "unknown" else "not_filled"
        return {"value": None, "state": state, "start": None, "end": None, "start_imputed": False}

    end = safe_date(ep.get("full_return_date"))
    if end:
        if end < start:
            return {"value": None, "state": "invalid", "start": start.isoformat(), "end": end.isoformat(),
                    "start_imputed": imputed}
        days = (end - start).days
        return {"value": days, "state": "zero" if days == 0 else "final", "start": start.isoformat(),
                "end": end.isoformat(), "start_imputed": imputed}

    if ep.get("status") in ("closed", "lost_to_follow_up"):
        return {"value": None, "state": "unknown", "start": start.isoformat(), "end": None,
                "start_imputed": imputed}
    if cutoff < start:
        return {"value": None, "state": "not_started", "start": start.isoformat(), "end": None,
                "start_imputed": imputed}
    return {"value": (cutoff - start).days, "state": "provisional", "start": start.isoformat(),
            "end": None, "cutoff": cutoff.isoformat(), "start_imputed": imputed}


def unavailability_interval(ep, cutoff=None):
    """(start, end_exclusive, provisional) of the athlete's unavailability, or None."""
    tl = effective_time_loss(ep, cutoff)
    if tl["state"] not in ("final", "zero", "provisional"):
        return None
    start = date.fromisoformat(tl["start"])
    if tl["state"] == "provisional":
        end = (safe_date(cutoff) or date.today()) + timedelta(days=1)  # cut-off day counted as unavailable
        return start, end, True
    end = date.fromisoformat(tl["end"])
    return start, end, False


def unique_unavailable_days(episodes, cutoff=None):
    """Days an athlete was unavailable across episodes, without double counting overlaps."""
    intervals = []
    provisional = False
    for ep in episodes:
        iv = unavailability_interval(ep, cutoff)
        if iv:
            intervals.append(iv[:2])
            provisional = provisional or iv[2]
    intervals.sort()
    total = 0
    cur_s = cur_e = None
    for s, e in intervals:
        if e <= s:
            continue
        if cur_s is None:
            cur_s, cur_e = s, e
        elif s <= cur_e:
            cur_e = max(cur_e, e)
        else:
            total += (cur_e - cur_s).days
            cur_s, cur_e = s, e
    if cur_s is not None:
        total += (cur_e - cur_s).days
    return {"days": total, "provisional": provisional, "episodes_counted": len(intervals)}


# ---------------------------------------------------------------------------
# Participation
# ---------------------------------------------------------------------------
def is_active(ep):
    return ep.get("status") in ("open", "draft") and not ep.get("deleted")


def current_participation(episodes):
    """Worst participation across all active episodes. Closing one episode never
    releases an athlete who is still unavailable because of another one."""
    active = [e for e in episodes if is_active(e) and e.get("status") != "draft"]
    if not active:
        return {"participation": "full", "active_episodes": 0, "drivers": []}
    worst = "full"
    drivers = []
    for e in active:
        p = e.get("participation") or "unknown"
        if PARTICIPATION_ORDER.get(p, 1) > PARTICIPATION_ORDER[worst]:
            worst = p
    for e in active:
        if (e.get("participation") or "unknown") == worst:
            drivers.append(e.get("id"))
    return {"participation": worst, "active_episodes": len(active), "drivers": drivers}


# ---------------------------------------------------------------------------
# Validation and data quality
# ---------------------------------------------------------------------------
def date_errors(ep):
    """Blocking errors: unparseable dates and end-before-start pairs."""
    errors = []
    kind = ep.get("kind")
    keys = [event_date_key(kind), "estimated_rtp_date", "actual_rtp_date", "assessment_date",
            "symptom_onset_date", "unavailability_start", "partial_return_date", "full_return_date"]
    parsed = {}
    for k in keys:
        try:
            parsed[k] = parse_date(ep.get(k))
        except ValueError as e:
            errors.append({"field": k, "message": str(e)})
            parsed[k] = None
    ev = event_date_key(kind)
    pairs = [
        (ev, "actual_rtp_date"), (ev, "estimated_rtp_date"), (ev, "full_return_date"),
        (ev, "partial_return_date"), ("unavailability_start", "partial_return_date"),
        ("unavailability_start", "full_return_date"), ("partial_return_date", "full_return_date"),
        ("symptom_onset_date", "full_return_date"),
    ]
    for a, b in pairs:
        if parsed.get(a) and parsed.get(b) and parsed[b] < parsed[a]:
            errors.append({"field": b, "message": f"{b} cannot be before {a}"})
    for im in ep.get("imaging") or []:
        if isinstance(im, dict) and im.get("date"):
            try:
                parse_date(im["date"])
            except ValueError as e:
                errors.append({"field": "imaging", "message": str(e)})
    return errors


REQUIRED_FOR_COMPLETE = {
    "injury": ["date_of_injury", "position", "activity", "classification", "time_loss", "mode_of_onset",
               "mechanism", "body_location", "injury_type", "managed_by"],
    "illness": ["date_of_onset", "position", "classification", "time_loss", "mode_of_onset", "communicable",
                "organ_system", "aetiology", "managed_by"],
}


def _empty(v):
    return v is None or v == "" or v == []


def quality_issues(ep, today=None):
    """Non-blocking pending items and inconsistencies shown to the clinician."""
    today = safe_date(today) or date.today()
    kind = ep.get("kind")
    pending, warnings = [], []
    if ep.get("participant_type", "athlete") == "athlete" and not ep.get("athlete_id"):
        pending.append("athlete")
    for k in REQUIRED_FOR_COMPLETE.get(kind, []):
        if _empty(ep.get(k)):
            pending.append(k)

    ev = safe_date(ep.get(event_date_key(kind)))
    if ev and ev > today + timedelta(days=1):
        warnings.append(f"{event_date_key(kind)} is in the future")
    tl = ep.get("time_loss")
    if tl == "no" and (ep.get("unavailability_start") or ep.get("participation") == "unavailable"):
        warnings.append("Time-loss is 'No (Medical Attention Only)' but unavailability is recorded")
    if tl == "yes" and not ep.get("unavailability_start"):
        warnings.append("Time-loss episode without unavailability start date (date of injury/onset used)")
    if ep.get("classification") in ("recurrent", "exacerbation"):
        if not ep.get("linked_episode_id") and ep.get("prior_full_recovery") != "history_unavailable":
            warnings.append("Recurrent/exacerbation without a linked previous episode "
                            "(link it or record that the history is not available)")
        if _empty(ep.get("prior_full_recovery")):
            pending.append("prior_full_recovery")
    if ep.get("status") == "closed":
        if tl == "yes" and not ep.get("full_return_date"):
            warnings.append("Closed time-loss episode without full return date")
    if ep.get("actual_rtp_date") and ep.get("full_return_date") and \
            ep.get("actual_rtp_date") != ep.get("full_return_date"):
        warnings.append("Actual RTP Date (workbook) differs from full return date (app)")
    if ep.get("diagnosis_status") == "confirmed" and _empty(ep.get("final_diagnosis")):
        warnings.append("Diagnosis marked confirmed but Final Diagnosis is empty")

    if kind == "injury":
        mech, src = ep.get("mechanism"), ep.get("source")
        if mech == "non_contact" and src and src != "not_applicable":
            warnings.append("Mechanism is Non-contact but a contact source is selected")
        if mech == "contact" and src == "not_applicable":
            warnings.append("Mechanism is Contact but Source is 'Not Applicable (non-contact)'")
        act, seg = ep.get("activity"), ep.get("activity_segment")
        if act == "training" and seg and seg in ("q1", "q2", "q3", "q4", "ot1", "ot2", "ot_plus", "other_game"):
            warnings.append("Activity is Training but a game segment is selected")
        if act == "game" and seg in ("attacking_drills", "transition_drills", "defending_drills", "other_training"):
            warnings.append("Activity is Game but a training segment is selected")
    return {"pending": pending, "warnings": warnings, "complete": not pending}


# ---------------------------------------------------------------------------
# Rates
# ---------------------------------------------------------------------------
def rate_per_1000(count, exposure):
    """count / exposure × 1000, or None ("not calculable") when exposure is missing/zero."""
    if exposure is None or exposure <= 0:
        return None
    return round(count / exposure * 1000, 2)


def merge_exposure_records(sessions):
    """Athlete-hours per session context, avoiding double counting.

    ``sessions`` items: {"id", "context": "game"|"training"|..., "duration_min",
    "individual": [{"athlete_id", "minutes", "participation"}], "collective":
    {"athletes": n, "minutes_each": m, "method": str} or None}.
    Individual records take precedence; a collective estimate is used only for
    sessions without any individual record.
    """
    totals = {}
    used_estimates = []
    for s in sessions:
        ctx = s.get("context") or "other"
        minutes = 0.0
        ind = [r for r in (s.get("individual") or []) if r.get("minutes") is not None]
        if ind:
            minutes = sum(float(r["minutes"]) for r in ind if r.get("participation") != "absent")
        elif s.get("collective"):
            c = s["collective"]
            try:
                minutes = float(c.get("athletes") or 0) * float(c.get("minutes_each") or 0)
            except (TypeError, ValueError):
                minutes = 0.0
            used_estimates.append({"session_id": s.get("id"), "method": c.get("method")})
        totals[ctx] = totals.get(ctx, 0.0) + minutes / 60.0
    return {"hours": {k: round(v, 3) for k, v in totals.items()}, "estimates": used_estimates}
