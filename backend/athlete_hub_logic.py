"""Athlete Hub: pure rules (no web framework / database imports, unit-tested).

Field definitions are configurable by admins. Each field:
  key, label, type, section, options[{value,label,tone}], visibility ('admin'|'staff'),
  athlete_editable, athlete_visible, required, sensitive, builtin, alert_days (dates), hidden
Document types: key, label, visibility, athlete_can_upload, required, field (linked field key)
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

FIELD_TYPES = {"text", "email", "phone", "date", "select", "number", "textarea"}
TONES = {"green", "yellow", "red", "gray", "blue"}
SECTIONS = ["Personal", "Contact", "Documents", "Admin & Dues", "Certifications", "Other",
            "Body", "Emergency & Insurance", "Medical history", "Consents", "Nutrition & Diet", "Medical notes"]
MEDICAL_SECTIONS = {"Body", "Emergency & Insurance", "Medical history", "Consents", "Nutrition & Diet", "Medical notes"}
MEDICAL_ROLES = {"Admin", "Physio"}
_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
MAX_FIELDS = 60
MAX_DOC_TYPES = 20

S, A, M = "staff", "admin", "medical"   # M: admins + physios (clinical staff)
VISIBILITIES = {S, A, M}


def _opt(value, tone, label=None):
    return {"value": value, "label": label or value, "tone": tone}


DONE_OPTS = [_opt("Done", "green"), _opt("Missing", "red"), _opt("N/A", "gray")]

DEFAULT_FIELDS = [
    {"key": "first_name", "label": "First name", "type": "text", "section": "Personal", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "last_name", "label": "Last name", "type": "text", "section": "Personal", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "birth_date", "label": "Date of birth", "type": "date", "section": "Personal", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "contact_email", "label": "Email", "type": "email", "section": "Contact", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "phone", "label": "Phone", "type": "phone", "section": "Contact", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "address", "label": "Address", "type": "textarea", "section": "Contact", "visibility": A, "athlete_editable": True, "sensitive": True},
    {"key": "city_state", "label": "City / State", "type": "text", "section": "Contact", "visibility": S, "athlete_editable": True},
    {"key": "country", "label": "Country", "type": "text", "section": "Contact", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "passport_status", "label": "Brazilian passport", "type": "select", "section": "Documents", "visibility": S,
     "athlete_editable": True, "required": True,
     "options": [_opt("Valid", "green"), _opt("In Progress", "yellow"), _opt("Expired", "red"), _opt("Ineligible", "gray"), _opt("N/A", "gray")]},
    {"key": "passport_expiry", "label": "Passport expiration date", "type": "date", "section": "Documents", "visibility": S,
     "athlete_editable": True, "alert_days": 180},
    {"key": "cpf_status", "label": "CPF", "type": "select", "section": "Documents", "visibility": S, "athlete_editable": True,
     "options": [_opt("Yes", "green"), _opt("No", "red"), _opt("In Progress", "yellow")]},
    {"key": "cpf_number", "label": "CPF number", "type": "text", "section": "Documents", "visibility": A, "athlete_editable": True, "sensitive": True},
    {"key": "dues_2026", "label": "2026 Dues", "type": "select", "section": "Admin & Dues", "visibility": S, "athlete_editable": False, "required": True,
     "options": [_opt("Paid Full", "green"), _opt("Paid Half", "yellow", "Paid Half (1 of 2 × $60)"), _opt("Not Paid", "red"), _opt("N/A", "gray")]},
    {"key": "dues_plan", "label": "Payment plan", "type": "select", "section": "Admin & Dues", "visibility": S, "athlete_editable": True,
     "options": [_opt("1 × $100", "blue"), _opt("2 × $60", "blue")]},
    {"key": "safeguarding", "label": "WL Safeguarding Certificate", "type": "select", "section": "Certifications", "visibility": S,
     "athlete_editable": False, "required": True, "options": [_opt("Done", "green"), _opt("Not done", "red")],
     "help": "Free course: https://worldlacrosse.thinkific.com/courses/safeguarding"},
    {"key": "palsc_self", "label": "PALSC Self-eval", "type": "select", "section": "Certifications", "visibility": S, "athlete_editable": False, "options": DONE_OPTS},
    {"key": "palsc_coach", "label": "PALSC Coach-eval", "type": "select", "section": "Certifications", "visibility": S, "athlete_editable": False, "options": DONE_OPTS},
    {"key": "palsc_staff", "label": "PALSC Support Staff-eval", "type": "select", "section": "Certifications", "visibility": S, "athlete_editable": False, "options": DONE_OPTS},
    {"key": "staff_notes", "label": "Staff notes", "type": "textarea", "section": "Other", "visibility": S, "athlete_editable": False, "athlete_visible": False},
    {"key": "preferred_name", "label": "Preferred name", "type": "text", "section": "Personal", "visibility": S, "athlete_editable": True},
    # ---- Medical (separate area of the profile) ----
    {"key": "height_cm", "label": "Height (cm)", "type": "number", "section": "Body", "visibility": S, "athlete_editable": True},
    {"key": "weight_kg", "label": "Weight (kg)", "type": "number", "section": "Body", "visibility": M, "athlete_editable": True},
    {"key": "guardian", "label": "Legal guardian (minors)", "type": "text", "section": "Emergency & Insurance", "visibility": S, "athlete_editable": True},
    {"key": "emergency_contact", "label": "Emergency contact", "type": "text", "section": "Emergency & Insurance", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "emergency_phone", "label": "Emergency phone", "type": "phone", "section": "Emergency & Insurance", "visibility": S, "athlete_editable": True, "required": True},
    {"key": "health_plan", "label": "Health insurance", "type": "text", "section": "Emergency & Insurance", "visibility": M, "athlete_editable": True},
    {"key": "policy_number", "label": "Policy number", "type": "text", "section": "Emergency & Insurance", "visibility": M, "athlete_editable": True, "sensitive": True},
    {"key": "doctor_name", "label": "Primary doctor", "type": "text", "section": "Emergency & Insurance", "visibility": M, "athlete_editable": True},
    {"key": "doctor_phone", "label": "Doctor phone", "type": "phone", "section": "Emergency & Insurance", "visibility": M, "athlete_editable": True},
    {"key": "has_allergies", "label": "Allergies", "type": "select", "section": "Medical history", "visibility": S, "athlete_editable": True, "required": True,
     "options": [_opt("No", "green"), _opt("Yes", "red")]},
    {"key": "drug_allergies", "label": "Medication allergies", "type": "textarea", "section": "Medical history", "visibility": S, "athlete_editable": True},
    {"key": "food_allergies", "label": "Food / insect allergies", "type": "textarea", "section": "Medical history", "visibility": S, "athlete_editable": True},
    {"key": "medical_conditions", "label": "Medical conditions", "type": "textarea", "section": "Medical history", "visibility": M, "athlete_editable": True},
    {"key": "regular_medication", "label": "Regular medication", "type": "select", "section": "Medical history", "visibility": M, "athlete_editable": True,
     "options": [_opt("No", "green"), _opt("Yes", "yellow")]},
    {"key": "medication_details", "label": "Medication details", "type": "textarea", "section": "Medical history", "visibility": M, "athlete_editable": True},
    {"key": "surgery_5y", "label": "Surgery (last 5 years)", "type": "select", "section": "Medical history", "visibility": M, "athlete_editable": True,
     "options": [_opt("No", "green"), _opt("Yes", "yellow")]},
    {"key": "surgery_details", "label": "Surgery details", "type": "textarea", "section": "Medical history", "visibility": M, "athlete_editable": True},
    {"key": "injury_5y", "label": "Injury (last 5 years)", "type": "select", "section": "Medical history", "visibility": M, "athlete_editable": True,
     "options": [_opt("No", "green"), _opt("Yes", "yellow")]},
    {"key": "injury_details", "label": "Injury details", "type": "textarea", "section": "Medical history", "visibility": M, "athlete_editable": True},
    {"key": "scat6_baseline", "label": "SCAT6 baseline symptoms", "type": "textarea", "section": "Medical history", "visibility": M, "athlete_editable": True},
    {"key": "medical_clearance", "label": "Medical clearance", "type": "select", "section": "Consents", "visibility": S, "athlete_editable": True, "required": True,
     "options": [_opt("Yes", "green"), _opt("No", "red"), _opt("Pending", "yellow")]},
    {"key": "treatment_consent", "label": "Treatment authorization", "type": "select", "section": "Consents", "visibility": S, "athlete_editable": True, "required": True,
     "options": [_opt("Agreed", "green"), _opt("Not agreed", "red")]},
    {"key": "consent_signature", "label": "Signed by", "type": "text", "section": "Consents", "visibility": M, "athlete_editable": True},
    {"key": "dietary_restrictions", "label": "Dietary restrictions", "type": "textarea", "section": "Nutrition & Diet", "visibility": S, "athlete_editable": True},
    {"key": "diet_notes", "label": "Diet notes", "type": "textarea", "section": "Nutrition & Diet", "visibility": S, "athlete_editable": True},
    {"key": "medical_alerts", "label": "Medical alerts", "type": "text", "section": "Medical notes", "visibility": S, "athlete_editable": False, "athlete_visible": False,
     "help": "Separate alerts with ';' — e.g. Allergies (orange); Asthma (red); All clear (normal)"},
    {"key": "medical_staff_notes", "label": "Medical staff notes", "type": "textarea", "section": "Medical notes", "visibility": M, "athlete_editable": False, "athlete_visible": False},
]

DEFAULT_DOC_TYPES = [
    {"key": "passport", "label": "Passport (photo page)", "visibility": A, "athlete_can_upload": True, "required": False, "field": "passport_status"},
    {"key": "safeguarding_certificate", "label": "WL Safeguarding certificate", "visibility": S, "athlete_can_upload": True, "required": True, "field": "safeguarding"},
    {"key": "cpf_document", "label": "CPF document", "visibility": A, "athlete_can_upload": True, "required": False, "field": "cpf_status"},
    {"key": "other", "label": "Other document", "visibility": A, "athlete_can_upload": True, "required": False},
    {"key": "insurance_card", "label": "Health insurance card", "visibility": M, "athlete_can_upload": True, "required": False, "field": "health_plan"},
    {"key": "medical_clearance_doc", "label": "Medical clearance / physical", "visibility": M, "athlete_can_upload": True, "required": False, "field": "medical_clearance"},
    {"key": "medical_report", "label": "Medical exams / reports", "visibility": M, "athlete_can_upload": True, "required": False},
]

ALLOWED_DOC_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "image/heic": "heic", "image/heif": "heif"}
MAX_DOC_BYTES = 10 * 1024 * 1024


def _with_defaults(f: dict) -> dict:
    out = {"type": "text", "section": "Other", "visibility": S, "athlete_editable": False, "athlete_visible": True,
           "required": False, "sensitive": False, "hidden": False, "options": [], "alert_days": None, "help": ""}
    out.update(f)
    return out


def default_fields() -> list:
    return [dict(_with_defaults(f), builtin=True) for f in DEFAULT_FIELDS]


def default_doc_types() -> list:
    return [dict(d, builtin=True) for d in DEFAULT_DOC_TYPES]


def merge_defaults(stored: list, defaults: list) -> list:
    """Saved admin config + any built-in item added later (e.g. the medical fields)."""
    if not stored:
        return defaults
    keys = {x["key"] for x in stored}
    return list(stored) + [d for d in defaults if d["key"] not in keys]


def is_medical(field: dict) -> bool:
    return field.get("section") in MEDICAL_SECTIONS


class ConfigError(ValueError):
    pass


def slug_key(label: str) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    if not k or not k[0].isalpha():
        k = "f_" + k
    return k[:40]


def validate_fields(fields: list, previous: Optional[list] = None) -> list:
    if len(fields) > MAX_FIELDS:
        raise ConfigError(f"At most {MAX_FIELDS} fields")
    prev_builtin = {f["key"] for f in (previous or default_fields()) if f.get("builtin")}
    out, seen = [], set()
    for raw in fields:
        label = str(raw.get("label") or "").strip()
        if not 1 <= len(label) <= 60:
            raise ConfigError("Field names must have 1–60 characters")
        key = str(raw.get("key") or "").strip().lower() or slug_key(label)
        if not _KEY_RE.match(key):
            key = slug_key(label)
        base, n = key, 2
        while key in seen:
            key = f"{base[:36]}_{n}"
            n += 1
        seen.add(key)
        ftype = raw.get("type") if raw.get("type") in FIELD_TYPES else "text"
        options = []
        if ftype == "select":
            for o in raw.get("options") or []:
                v = str(o.get("value") or o.get("label") or "").strip()[:60]
                if not v or any(x["value"] == v for x in options):
                    continue
                options.append({"value": v, "label": str(o.get("label") or v).strip()[:80], "tone": o.get("tone") if o.get("tone") in TONES else "gray"})
            if not options:
                raise ConfigError(f"'{label}' needs at least one option")
        alert = raw.get("alert_days")
        try:
            alert = int(alert) if alert not in (None, "") and ftype == "date" else None
        except (TypeError, ValueError):
            alert = None
        out.append({
            "key": key, "label": label, "type": ftype,
            "section": raw.get("section") if raw.get("section") in SECTIONS else "Other",
            "options": options,
            "visibility": raw.get("visibility") if raw.get("visibility") in VISIBILITIES else S,
            "athlete_editable": bool(raw.get("athlete_editable")),
            "athlete_visible": raw.get("athlete_visible", True) is not False,
            "required": bool(raw.get("required")),
            "sensitive": bool(raw.get("sensitive")),
            "hidden": bool(raw.get("hidden")),
            "alert_days": alert,
            "help": str(raw.get("help") or "")[:300],
            "builtin": key in prev_builtin,
        })
    return out


def validate_doc_types(types: list, previous: Optional[list] = None) -> list:
    if len(types) > MAX_DOC_TYPES:
        raise ConfigError(f"At most {MAX_DOC_TYPES} document types")
    prev_builtin = {d["key"] for d in (previous or default_doc_types()) if d.get("builtin")}
    out, seen = [], set()
    for raw in types:
        label = str(raw.get("label") or "").strip()
        if not 1 <= len(label) <= 60:
            raise ConfigError("Document names must have 1–60 characters")
        key = str(raw.get("key") or "").strip().lower() or slug_key(label)
        if not _KEY_RE.match(key):
            key = slug_key(label)
        base, n = key, 2
        while key in seen:
            key = f"{base[:36]}_{n}"
            n += 1
        seen.add(key)
        out.append({"key": key, "label": label, "visibility": raw.get("visibility") if raw.get("visibility") in VISIBILITIES else S,
                    "athlete_can_upload": raw.get("athlete_can_upload", True) is not False,
                    "required": bool(raw.get("required")), "field": raw.get("field") or None,
                    "builtin": key in prev_builtin})
    return out


# ---------------------------------------------------------------- access
def can_see(item: dict, role: str, user_type: str) -> bool:
    """Visibility of a field / document type for a viewer."""
    if user_type == "athlete":
        return item.get("athlete_visible", True) is not False
    if role == "Admin":
        return True
    if role == "Research":
        return False
    vis = item.get("visibility", S)
    if vis == M:
        return role in MEDICAL_ROLES
    return vis == S


def visible_values(values: dict, fields: list, role: str, user_type: str) -> dict:
    keys = {f["key"] for f in fields if can_see(f, role, user_type)}
    return {k: v for k, v in (values or {}).items() if k in keys}


# ---------------------------------------------------------------- values
def _parse_date(v) -> Optional[date]:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def clean_value(field: dict, v):
    """Normalise one submitted value; raises ConfigError on invalid input."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    t = field["type"]
    if t == "date":
        d = _parse_date(v)
        if not d:
            raise ConfigError(f"{field['label']}: invalid date")
        return d.isoformat()
    if t == "number":
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise ConfigError(f"{field['label']}: must be a number")
        return int(n) if n.is_integer() else n
    s = str(v).strip()
    if t == "select":
        allowed = {o["value"] for o in field.get("options") or []}
        if s not in allowed:
            match = next((o["value"] for o in field.get("options") or [] if o["value"].lower() == s.lower() or o["label"].lower() == s.lower()), None)
            if not match:
                raise ConfigError(f"{field['label']}: '{s}' is not an option")
            s = match
        return s
    if t == "email":
        s = s.lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", s):
            raise ConfigError(f"{field['label']}: invalid e-mail")
    if t == "phone":
        s = clean_phone(s)
    limit = 2000 if t == "textarea" else 200
    return s[:limit]


def clean_phone(s) -> str:
    s = str(s).strip()
    if re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    return re.sub(r"[^\d+()\-\s]", "", s)[:30].strip()


def age_on(birth_iso: Optional[str], today: date) -> Optional[int]:
    d = _parse_date(birth_iso)
    if not d:
        return None
    return today.year - d.year - ((today.month, today.day) < (d.month, d.day))


def tone_of(field: dict, value) -> Optional[str]:
    for o in field.get("options") or []:
        if o["value"] == value:
            return o.get("tone")
    return None


def date_alert(field: dict, value, today: date) -> Optional[str]:
    """'expired' | 'soon' | None for date fields with alert_days."""
    if field.get("type") != "date" or not field.get("alert_days"):
        return None
    d = _parse_date(value)
    if not d:
        return None
    days = (d - today).days
    if days < 0:
        return "expired"
    if days <= field["alert_days"]:
        return "soon"
    return None


def missing_items(values: dict, docs_by_type: dict, fields: list, doc_types: list) -> list:
    """Required fields without a value and required documents not uploaded."""
    out = []
    for f in fields:
        if f.get("required") and not f.get("hidden") and values.get(f["key"]) in (None, ""):
            out.append({"kind": "field", "key": f["key"], "label": f["label"]})
    for d in doc_types:
        if d.get("required") and not docs_by_type.get(d["key"]):
            out.append({"kind": "doc", "key": d["key"], "label": d["label"]})
    return out


def prefill_from_athlete(athlete: dict) -> dict:
    """First/last name + e-mail suggestions from the app account."""
    name = (athlete.get("name") or "").strip()
    parts = name.split()
    out = {}
    if parts:
        out["first_name"] = parts[0]
        if len(parts) > 1:
            out["last_name"] = " ".join(parts[1:])
    if athlete.get("email"):
        out["contact_email"] = athlete["email"].strip().lower()
    return out
