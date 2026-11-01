"""Payload normalisation, permissions and projections for Injury & Illness Recording.

Pure Python (depends only on iir_taxonomy / iir_logic) so it can be unit-tested.
"""
import iir_logic as L
import iir_taxonomy as T

CLINICAL_ROLES = {"Admin", "Physio"}
MAX_TEXT = 5000


class ValidationError(Exception):
    def __init__(self, errors):
        super().__init__("; ".join(e["message"] for e in errors))
        self.errors = errors


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------
def access_level(current_user):
    """'clinical' | 'coach' | 'research' | None (athletes / unknown)."""
    if not current_user or current_user.get("user_type") != "staff":
        return None
    role = (current_user.get("user") or {}).get("role")
    if role in CLINICAL_ROLES:
        return "clinical"
    if role == "Coach":
        return "coach"
    if role == "Research":
        return "research"
    return None


def permissions(level):
    return {
        "level": level,
        "can_record": level == "clinical",
        "can_view_clinical": level == "clinical",
        "can_view_availability": level in ("clinical", "coach"),
        "can_view_reports": level in ("clinical", "research"),
        "can_export_identified": level == "clinical",
        "can_export_research": level in ("clinical", "research"),
        "can_manage_exposure": level == "clinical",
    }


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------
def _text(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    return s[:MAX_TEXT]


def all_field_keys(kind):
    keys = {f["key"] for f in T.fields_for(kind) + T.APP_FIELDS}
    keys.discard("athlete")
    keys.discard("report_by")
    keys.discard("compat_time_loss_days")  # calculated, never accepted from clients
    return keys


def normalize_episode(payload, kind, partial=False):
    """Validate and normalise a client payload. Returns (clean_dict, errors).

    Unknown keys are ignored. Option codes must exist in the dictionary; group
    titles of the workbook are not codes and are therefore rejected.
    """
    if kind not in ("injury", "illness"):
        raise ValidationError([{"field": "kind", "message": "kind must be 'injury' or 'illness'"}])
    errors = []
    clean = {}
    selects = T.select_fields(kind)
    keys = all_field_keys(kind)
    for k, v in (payload or {}).items():
        if k in ("athlete_id", "report_by_id", "pending_source"):
            clean[k] = _text(v) if not isinstance(v, dict) else v
            continue
        if k not in keys:
            continue
        if k in selects:
            opt_key, multiple = selects[k]
            if k == "imaging":
                clean[k] = _norm_imaging(v, errors)
                continue
            valid = T.option_codes(opt_key)
            if multiple:
                vals = v if isinstance(v, list) else ([v] if v else [])
                out = []
                for x in vals:
                    if x in valid and x not in out:
                        out.append(x)
                    elif x not in valid:
                        errors.append({"field": k, "message": f"Invalid option for {k}: {x!r}"})
                clean[k] = out
            else:
                if v in (None, ""):
                    clean[k] = None
                elif v in valid:
                    clean[k] = v
                else:
                    errors.append({"field": k, "message": f"Invalid option for {k}: {v!r}"})
            continue
        if k in T.DATE_FIELDS[kind] or k in T.DATE_FIELDS["common"]:
            try:
                d = L.parse_date(v)
                clean[k] = d.isoformat() if d else None
            except ValueError as e:
                errors.append({"field": k, "message": str(e)})
            continue
        if k == "game_day_offset":
            if v in (None, ""):
                clean[k] = None
            else:
                try:
                    clean[k] = int(v)
                except (TypeError, ValueError):
                    errors.append({"field": k, "message": "Days relative to game must be a whole number"})
            continue
        if k in ("event_id", "linked_episode_id"):
            clean[k] = _text(v)
            continue
        clean[k] = _text(v)

    if not partial:
        clean.setdefault("participant_type", "athlete")
        clean.setdefault("status", "draft")
    return clean, errors


def _norm_imaging(v, errors):
    """Imaging: list of {modality, date, result}. Accepts plain codes too."""
    valid = T.option_codes("imaging")
    items = v if isinstance(v, list) else ([v] if v else [])
    out = []
    for it in items:
        if isinstance(it, str):
            it = {"modality": it}
        if not isinstance(it, dict):
            continue
        m = it.get("modality")
        if m not in valid:
            errors.append({"field": "imaging", "message": f"Invalid imaging modality: {m!r}"})
            continue
        d = None
        if it.get("date"):
            try:
                d = L.parse_date(it["date"]).isoformat()
            except ValueError as e:
                errors.append({"field": "imaging", "message": str(e)})
        out.append({"modality": m, "date": d, "result": _text(it.get("result"))})
    if any(i["modality"] == "none" for i in out) and len(out) > 1:
        errors.append({"field": "imaging", "message": "'None' cannot be combined with an imaging modality"})
    return out


def check_status_requirements(ep):
    """Minimal requirements to leave draft. Drafts may be incomplete."""
    errors = []
    if ep.get("participant_type", "athlete") == "athlete" and not ep.get("athlete_id"):
        errors.append({"field": "athlete_id", "message": "Select the athlete"})
    if ep.get("participant_type") == "other" and not ep.get("other_participant_name"):
        errors.append({"field": "other_participant_name", "message": "Identify the participant"})
    if ep.get("status") in ("open", "closed", "lost_to_follow_up"):
        if not ep.get(L.event_date_key(ep.get("kind"))):
            errors.append({"field": L.event_date_key(ep.get("kind")),
                           "message": "The date of injury/onset is required to save as a record (save as draft otherwise)"})
    return errors


# ---------------------------------------------------------------------------
# Audit diff
# ---------------------------------------------------------------------------
AUDIT_IGNORE = {"updated_at", "updated_by", "_id"}


def diff(old, new):
    changes = []
    for k in sorted(set(old) | set(new)):
        if k in AUDIT_IGNORE:
            continue
        a, b = old.get(k), new.get(k)
        if a != b and not (a in (None, "", []) and b in (None, "", [])):
            changes.append({"field": k, "old": a, "new": b})
    return changes


# ---------------------------------------------------------------------------
# Computed / projected views
# ---------------------------------------------------------------------------
def computed(ep, cutoff=None):
    return {
        "compat_time_loss_days": L.compat_time_loss_days(ep),
        "effective_time_loss": L.effective_time_loss(ep, cutoff),
        "quality": L.quality_issues(ep),
    }


def coach_view(ep):
    return {k: ep.get(k) for k in T.COACH_VISIBLE_FIELDS}


def summary_label(ep):
    """Short human-readable label (diagnosis + region/system)."""
    if ep.get("kind") == "injury":
        regions = ", ".join(T.ui_label("body_location", c) or c for c in (ep.get("body_location") or []))
        types = ", ".join(T.ui_label("injury_type", c) or c for c in (ep.get("injury_type") or []))
        where = regions or "region not recorded"
        side = T.ui_label("laterality", ep.get("laterality")) if ep.get("laterality") else None
        return {"what": ep.get("final_diagnosis") or ep.get("initial_diagnosis") or types or "Injury",
                "where": f"{where}{' · ' + side if side else ''}"}
    system = T.ui_label("organ_system", ep.get("organ_system")) if ep.get("organ_system") else "system not recorded"
    return {"what": ep.get("final_diagnosis") or ep.get("initial_diagnosis") or "Illness", "where": system}
