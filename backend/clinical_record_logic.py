"""Clinical Record (athlete notes) rules — pure, unit-tested.

Entries keep a full revision history: edits never overwrite silently.
Confidential entries are visible only to Admin / Physio (and their author).
Research users never see the clinical record.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

ENTRY_TYPES = ["Assessment", "Treatment", "Follow-up", "Return to play", "Test / Imaging", "Medication", "Communication", "Note"]
DOMAINS = ["General", "Pain", "Injury", "Illness", "Mental Health", "Nutrition", "Performance", "Other"]
AVAILABILITY = ["Full", "Modified", "Out"]
CLINICAL_ROLES = {"Admin", "Physio"}
EDITABLE = ("entry_type", "category", "title", "body", "soap", "related", "occurred_on", "occurred_time",
            "pain", "availability", "follow_up_on", "follow_up_done", "confidential")


class EntryError(ValueError):
    pass


def can_read_record(role: Optional[str]) -> bool:
    return bool(role) and role != "Research"


def can_see_entry(entry: dict, role: Optional[str], user_id: Optional[str]) -> bool:
    if not can_read_record(role):
        return False
    if entry.get("deleted_at"):
        return False
    if entry.get("confidential"):
        return role in CLINICAL_ROLES or (user_id and entry.get("author_id") == user_id)
    return True


def can_edit_entry(entry: dict, role: Optional[str], user_id: Optional[str]) -> bool:
    return role == "Admin" or (user_id is not None and entry.get("author_id") == user_id)


def _date(v, label, allow_future=True, today: Optional[date] = None):
    if v in (None, ""):
        return None
    try:
        d = datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise EntryError(f"{label}: invalid date")
    if d.year < 1990:
        raise EntryError(f"{label}: date too old")
    if not allow_future and today and d > today:
        raise EntryError(f"{label} cannot be in the future")
    return d.isoformat()


def clean_entry(data: dict, today: date, partial: bool = False) -> dict:
    """Validate/normalise submitted fields. With partial=True only given keys are returned."""
    out = {}

    def has(k):
        return k in data

    if not partial or has("entry_type"):
        t = data.get("entry_type") or "Note"
        if t not in ENTRY_TYPES:
            raise EntryError("Unknown entry type")
        out["entry_type"] = t
    if not partial or has("category"):
        c = data.get("category") or "General"
        out["category"] = c if c in DOMAINS else "Other"
    if not partial or has("title"):
        out["title"] = (str(data.get("title") or "").strip()[:140]) or None
    if not partial or has("body"):
        out["body"] = str(data.get("body") or "").strip()[:20000]
    if not partial or has("soap"):
        soap = data.get("soap") or {}
        soap = {k: str(soap.get(k) or "").strip()[:8000] for k in ("s", "o", "a", "p")} if isinstance(soap, dict) else {}
        out["soap"] = soap if any(soap.values()) else None
    if not partial or has("related"):
        out["related"] = (str(data.get("related") or "").strip()[:120]) or None
    if not partial or has("occurred_on"):
        out["occurred_on"] = _date(data.get("occurred_on"), "Date", allow_future=False, today=today) or today.isoformat()
    if not partial or has("occurred_time"):
        tm = str(data.get("occurred_time") or "").strip()[:5]
        if tm and not (len(tm) == 5 and tm[2] == ":" and tm[:2].isdigit() and tm[3:].isdigit() and int(tm[:2]) < 24 and int(tm[3:]) < 60):
            raise EntryError("Time must be HH:MM")
        out["occurred_time"] = tm or None
    if not partial or has("pain"):
        p = data.get("pain")
        if p in (None, ""):
            out["pain"] = None
        else:
            try:
                p = int(p)
            except (TypeError, ValueError):
                raise EntryError("Pain must be 0–10")
            if not 0 <= p <= 10:
                raise EntryError("Pain must be 0–10")
            out["pain"] = p
    if not partial or has("availability"):
        a = data.get("availability") or None
        if a and a not in AVAILABILITY:
            raise EntryError("Availability must be Full, Modified or Out")
        out["availability"] = a
    if not partial or has("follow_up_on"):
        out["follow_up_on"] = _date(data.get("follow_up_on"), "Follow-up date")
    if not partial or has("follow_up_done"):
        out["follow_up_done"] = bool(data.get("follow_up_done"))
    if not partial or has("confidential"):
        out["confidential"] = bool(data.get("confidential"))
    if not partial:
        if not out["body"] and not out["soap"] and not out["title"]:
            raise EntryError("Write a title, a note or the SOAP fields")
    return out


def diff(old: dict, new: dict) -> dict:
    """Previous values of the fields that change (for the revision history)."""
    return {k: old.get(k) for k, v in new.items() if k in EDITABLE and old.get(k) != v}


def normalise_legacy(e: dict) -> dict:
    """Old notes (category/related/body only) shown with the new structure."""
    e = dict(e)
    e.setdefault("entry_type", "Note")
    e.setdefault("occurred_on", str(e.get("created_at") or "")[:10] or None)
    e.setdefault("attachments", [])
    e.setdefault("revisions", [])
    return e


def follow_up_status(entry: dict, today: date) -> Optional[str]:
    """'overdue' | 'due' (≤7 days) | 'planned' | None."""
    f = entry.get("follow_up_on")
    if not f or entry.get("follow_up_done"):
        return None
    try:
        d = datetime.strptime(f, "%Y-%m-%d").date()
    except ValueError:
        return None
    days = (d - today).days
    if days < 0:
        return "overdue"
    if days <= 7:
        return "due"
    return "planned"
