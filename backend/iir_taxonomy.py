"""Injury & Illness Recording (IIR) — versioned form definition and category dictionary.

Reference: the "Brasil_W_InjSurv_PALA_Sixes_2026" surveillance workbook
(sheets Team_Injuries, Team_Illnesses, Inj_Roster ID, Ill_Roster ID) and the
World Lacrosse Super Sixes Canada 2025 surveillance infographic.

This module is *inspired by* those references. It is NOT validated or certified
by World Lacrosse.

Design rules
------------
* Every option has a stable internal ``code``, a UI ``label`` (may fix typos or
  translate) and the ``original`` label exactly as written in the workbook. The
  compatibility export always uses ``original``.
* Group titles from the workbook (e.g. "**Pick below for TRAINING**") are kept
  only as ``group`` metadata — they are never valid answers.
* Options added by the app (not in the workbook) carry ``extension: True``.
* Fields are flagged ``source: "reference"`` (one of the 30 / 21 workbook
  columns) or ``source: "app"`` (additional structured fields).
* ``FORM_VERSION`` / ``DICTIONARY_VERSION`` are stored on every record so that a
  future change of options never silently changes the meaning of historical data.
  Never edit or remove an existing option code; add new codes instead and bump
  the version.
"""
import re

FORM_VERSION = "IIR-form-1.0"
DICTIONARY_VERSION = "IIR-dict-1.0"
TIME_LOSS_CONVENTION = "IIR-TL-1"
REFERENCE_NAME = "PALA Sixes 2026 injury/illness surveillance workbook (Team_Injuries / Team_Illnesses)"
DISCLAIMER = (
    "Module inspired by the PALA Sixes 2026 surveillance workbook and the World Lacrosse "
    "Super Sixes Canada 2025 infographic. Not validated or certified by World Lacrosse."
)


def _slug(text):
    s = re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")
    return s or "x"


def _opts(originals, labels=None, groups=None, codes=None, extensions=()):
    """Build option dicts. ``labels``/``codes`` map original -> override."""
    labels = labels or {}
    groups = groups or {}
    codes = codes or {}
    out = []
    for orig in originals:
        out.append({
            "code": codes.get(orig) or _slug(orig),
            "label": labels.get(orig, orig.strip()),
            "original": orig,
            **({"group": groups[orig]} if orig in groups else {}),
        })
    for ext in extensions:
        out.append({"code": ext["code"], "label": ext["label"], "original": None, "extension": True,
                    **({"group": ext["group"]} if "group" in ext else {})})
    return out


TIME_SLOTS = [
    "6am-7am", "7am-8am", "8am-9am", "9am-10am", "10am-11am", "11am-12pm", "12pm-1pm",
    "1pm-2pm", "2pm-3pm", "3pm-4pm", "4pm-5pm", "5pm-6pm", "6pm-7pm", "7pm-8pm", "8pm-9pm",
    "9pm-10pm", "10pm-11pm", "11pm-12am", "12am-1am", "1am-2am", "2am-3am", "3am-4am",
    "4am-5am", "5am-6am",
]

OPTIONS = {
    # ---- shared ------------------------------------------------------------
    "time_slot": _opts(TIME_SLOTS),
    "time_loss": _opts(
        ["No (Medical Attention Only)", "Yes (Time-loss)", "Unknown at this time"],
        codes={"No (Medical Attention Only)": "no", "Yes (Time-loss)": "yes", "Unknown at this time": "unknown"},
    ),
    "mode_of_onset": _opts(
        ["Sudden- acute trauma", "Sudden- no acute trauma", "Gradual onset", "Mixed"],
        labels={"Sudden- acute trauma": "Sudden – acute trauma", "Sudden- no acute trauma": "Sudden – no acute trauma"},
        codes={"Sudden- acute trauma": "sudden_trauma", "Sudden- no acute trauma": "sudden_no_trauma",
               "Gradual onset": "gradual", "Mixed": "mixed"},
    ),
    "managed_by": _opts(["Team Medical", "Tournament Medical", "Ambulance/Hospital Transfer", "Other"]),
    "imaging": _opts(["None", "MRI", "X-Ray", "Ultrasound", "CT Scan", "Other"]),
    "seriousness": _opts(["Has returned to sport", "Likely to return to sport", "Permanent Disability",
                          "Fatality", "Other"]),

    # ---- injuries (Inj_Roster ID) -------------------------------------------
    "inj_position": _opts(["Draw Specialist", "Field Player", "Goalie", "Coach", "Support Staff", "Referee",
                           "Field Official", "Spectator", "Other"]),
    "surface": _opts(["Field 1 ", "Field 2"], codes={"Field 1 ": "field_1", "Field 2": "field_2"}),
    "surface_type": _opts([], extensions=[
        {"code": "natural_grass", "label": "Natural grass"},
        {"code": "artificial_turf", "label": "Artificial turf"},
        {"code": "hybrid", "label": "Hybrid turf"},
        {"code": "indoor", "label": "Indoor surface"},
        {"code": "other", "label": "Other"},
        {"code": "unknown", "label": "Unknown"},
    ]),
    "activity": _opts(["Warm-up", "Training", "Game", "Qtr Break 1/2", "Halftime", "Qtr Break 3/4",
                       "Post-game", "Other"]),
    "activity_segment": _opts(
        ["Attacking Drills", "Transition Drills", "Defending Drills", "Other (Training)",
         "1st Qtr. (0-8mins)", "2nd Qtr. (8-16mins)", "3rd Qtr. (16-24mins)", "4th Qtr. (24-32mins)",
         "Overtime 1 (32-35mins)", "Overtime 2 (35-38mins)", "Overtime ++ (38 - _mins)", "Other (Game)",
         "Other (Non-Lax)"],
        labels={
            "1st Qtr. (0-8mins)": "1st Qtr.", "2nd Qtr. (8-16mins)": "2nd Qtr.",
            "3rd Qtr. (16-24mins)": "3rd Qtr.", "4th Qtr. (24-32mins)": "4th Qtr.",
            "Overtime 1 (32-35mins)": "Overtime 1", "Overtime 2 (35-38mins)": "Overtime 2",
            "Overtime ++ (38 - _mins)": "Overtime ++",
        },
        codes={
            "1st Qtr. (0-8mins)": "q1", "2nd Qtr. (8-16mins)": "q2", "3rd Qtr. (16-24mins)": "q3",
            "4th Qtr. (24-32mins)": "q4", "Overtime 1 (32-35mins)": "ot1", "Overtime 2 (35-38mins)": "ot2",
            "Overtime ++ (38 - _mins)": "ot_plus", "Other (Training)": "other_training",
            "Other (Game)": "other_game", "Other (Non-Lax)": "other_non_lax",
        },
        groups={
            "Attacking Drills": "Training", "Transition Drills": "Training", "Defending Drills": "Training",
            "Other (Training)": "Training",
            "1st Qtr. (0-8mins)": "Game", "2nd Qtr. (8-16mins)": "Game", "3rd Qtr. (16-24mins)": "Game",
            "4th Qtr. (24-32mins)": "Game", "Overtime 1 (32-35mins)": "Game", "Overtime 2 (35-38mins)": "Game",
            "Overtime ++ (38 - _mins)": "Game", "Other (Game)": "Game",
            "Other (Non-Lax)": "Other",
        },
    ),
    "inj_game_day": _opts(
        ["Training", "GD 1", "GD 2", "GD 3", "GD 4", "Other"],
        codes={"Training": "training", "Other": "other"},
        extensions=[{"code": f"gd_{i}", "label": f"GD {i}"} for i in range(5, 11)],
    ),
    "inj_classification": _opts(
        ["New INJ", "Recurrent INJ after full recovery & RTS", "Exacerbation INJ", "Unknown specification INJ"],
        codes={"New INJ": "new", "Recurrent INJ after full recovery & RTS": "recurrent",
               "Exacerbation INJ": "exacerbation", "Unknown specification INJ": "unknown"},
    ),
    "mechanism": _opts(["Not sport related", "Contact", "Non-contact"]),
    "source": _opts(["Not Applicable (non-contact)", "Ground", "Player", "Stick", "Ball", "Accidental Collision",
                     "Other", "Unknown"],
                    codes={"Not Applicable (non-contact)": "not_applicable"}),
    "occurrence": _opts(
        ["Sprinting", "Cutting/COD", "Jumping", "Other", "Unknown", "Ground Ball", "Receiving Stick Check",
         "Initiating Stick Check", "Receiving Body Hit", "Initiating Body Hit", "GK from Diver", "Diving",
         "Shooting", "Defending/Blocking Shot", "Passing", "Defending/Blocking Pass"],
        groups={**{k: "Non-contact" for k in ["Sprinting", "Cutting/COD", "Jumping", "Other", "Unknown"]},
                **{k: "Contact" for k in ["Ground Ball", "Receiving Stick Check", "Initiating Stick Check",
                                          "Receiving Body Hit", "Initiating Body Hit", "GK from Diver", "Diving",
                                          "Shooting", "Defending/Blocking Shot", "Passing",
                                          "Defending/Blocking Pass"]}},
    ),
    "phase_of_play": _opts(["Attacking", "Defending", "Riding", "Clearing", "Substituting", "Draw", "Other"]),
    "phase_numbers": _opts(["Full Strength", "Player Up", "Player Down", "Not Applicable"]),
    "penalty": _opts(["None", "Minor Awarded", "Minor Received", "Major Awarded", "Major Received",
                      "Not Applicable"]),
    "body_location": _opts(["Head", "Facial", "Neck", "Mid-back (thoracic)", "Low-back (lumbar)", "Chest", "Ribs",
                            "Abdominals", "Clavicle", "Shoulder", "Upper Arm", "Elbow", "Forearm", "Wrist",
                            "Hand/Finger/Thumb", "Pelvis/Buttocks", "Hip/Groin", "Anterior Thigh",
                            "Posterior Thigh", "Knee", "Calf", "Lower Leg (Tib/Fib)", "Ankle", "Foot/Toes",
                            "Other Location"]),
    "injury_type": _opts(["Abrasion", "Arthritis", "Avascular Necrosis", "Bone Contusion", "Bone Fracture",
                          "Bone Stress Injury", "Bursitis", "Cartilage Injury", "Chronic Instability", "Concussion",
                          "Contusion / Bruise", "Dislocation / Subluxation", "Internal Organ Trauma",
                          "Joint Sprain / Ligament Tear", "Laceration", "Muscle Compartment Syndrome",
                          "Muscle Contusion", "Muscle Strain / Rupture / Tear", "Other", "Peripheral Nerve Injury",
                          "Physis Injury", "Spinal Cord Injury", "Stump Injury", "Synovitis / Capsulitis",
                          "Tendinopathy", "Tendon Rupture", "Unknown specification", "Vascular Damage"]),

    # ---- illnesses (Ill_Roster ID) ------------------------------------------
    "ill_position": _opts(["FOGO", "Attack", "Middie", "Defender", "Goalie", "Coach", "Support Staff", "Referee",
                           "Field Official", "Spectator", "Other"]),
    "ill_game_day": _opts(
        ["Training", "GD 1", "GD 2", "GD 3", "GD 4", "GD 5", "GD 6", "GD 7", "GD 8", "Other"],
        codes={"Training": "training", "Other": "other"},
        extensions=[{"code": f"gd_{i}", "label": f"GD {i}"} for i in range(9, 13)],
    ),
    "ill_classification": _opts(
        ["New ILL", "Recurrent ILL after full recovery & RTS", "Exacerbation ILL", "Unknown ILL specification"],
        codes={"New ILL": "new", "Recurrent ILL after full recovery & RTS": "recurrent",
               "Exacerbation ILL": "exacerbation", "Unknown ILL specification": "unknown"},
    ),
    "communicable": _opts(["Communicable", "Non-Communicable"],
                          extensions=[{"code": "unknown", "label": "Unknown (app extension)"}]),
    "organ_system": _opts(
        ["Cardiovascular", "Dermatological", "Dental", "Endocrinology", "Gastrointestinal", "Genitourinary",
         "Hematologic", "Musculoskeletal", "Neurological", "Opthalmological", "Otological",
         "Psychiatri / Psychological", "Respiratory System", "Thermoregulatory System", "Unknown specification"],
        labels={"Opthalmological": "Ophthalmological", "Psychiatri / Psychological": "Psychiatric / Psychological"},
        codes={"Opthalmological": "ophthalmological", "Psychiatri / Psychological": "psychiatric_psychological"},
    ),
    "aetiology": _opts(
        ["COVID-19", "Allergic", "Environmental - Exercise related", "Environmental - Non-Exercise",
         "Immunological / Inflammatory", "Infectious Disease", "Neoplasm", "Metabolic / Nutritional", "Vascular",
         "Degenerative or Chronic Condition", "Developmental Anomally", "Drug-related / Poisoning",
         "Unknown specification"],
        labels={"Developmental Anomally": "Developmental Anomaly",
                "Environmental - Exercise related": "Environmental – exercise related",
                "Environmental - Non-Exercise": "Environmental – non-exercise"},
        codes={"Developmental Anomally": "developmental_anomaly"},
    ),

    # ---- app extensions (not in the workbook) -------------------------------
    "laterality": _opts([], extensions=[
        {"code": "right", "label": "Right"}, {"code": "left", "label": "Left"},
        {"code": "bilateral", "label": "Bilateral"}, {"code": "central", "label": "Central / midline"},
        {"code": "not_applicable", "label": "Not applicable"}, {"code": "unknown", "label": "Unknown"},
    ]),
    "diagnosis_status": _opts([], extensions=[
        {"code": "provisional", "label": "Provisional"}, {"code": "confirmed", "label": "Confirmed"},
    ]),
    "status": _opts([], extensions=[
        {"code": "draft", "label": "Draft"}, {"code": "open", "label": "Under follow-up"},
        {"code": "closed", "label": "Closed"}, {"code": "lost_to_follow_up", "label": "Lost to follow-up"},
    ]),
    "participation": _opts([], extensions=[
        {"code": "full", "label": "Full participation"}, {"code": "modified", "label": "Modified participation"},
        {"code": "unavailable", "label": "Unavailable"}, {"code": "unknown", "label": "Unknown"},
    ]),
    "prior_recovery": _opts([], extensions=[
        {"code": "yes", "label": "Yes — full recovery and RTS before this episode"},
        {"code": "no", "label": "No — not fully recovered"},
        {"code": "unknown", "label": "Unknown"},
        {"code": "history_unavailable", "label": "Previous history not available"},
    ]),
    "participant_type": _opts([], extensions=[
        {"code": "athlete", "label": "Athlete (registered)"},
        {"code": "other", "label": "Other participant (coach, staff, official, spectator…)"},
    ]),
    "category": _opts([], extensions=[
        {"code": "senior", "label": "Senior"}, {"code": "u20", "label": "U20"}, {"code": "u18", "label": "U18"},
        {"code": "u16", "label": "U16"}, {"code": "masters", "label": "Masters"}, {"code": "other", "label": "Other"},
    ]),
    "followup_kind": _opts([], extensions=[
        {"code": "reassessment", "label": "Reassessment"},
        {"code": "diagnosis_update", "label": "Diagnosis update"},
        {"code": "treatment", "label": "Treatment / management"},
        {"code": "imaging_referral", "label": "Imaging / referral"},
        {"code": "participation_change", "label": "Participation change"},
        {"code": "rtp_revision", "label": "Return-to-play estimate revised"},
        {"code": "partial_return", "label": "Partial return"},
        {"code": "full_return", "label": "Full return"},
        {"code": "closure", "label": "Closure"},
        {"code": "lost_to_follow_up", "label": "Lost to follow-up"},
    ]),
}

# Activities that count towards game vs training exposure denominators.
ACTIVITY_CONTEXT = {
    "game": "game", "training": "training",
    "warm_up": "other", "qtr_break_1_2": "game_break", "halftime": "game_break",
    "qtr_break_3_4": "game_break", "post_game": "other", "other": "other",
}
SEGMENT_CONTEXT = {o["code"]: (o.get("group") or "Other").lower() for o in OPTIONS["activity_segment"]}

# Default period configuration of the reference (Sixes). Configurable per event.
SIXES_PERIODS = {"format": "sixes", "period_minutes": 8, "periods": 4, "overtime_minutes": 3}


def option_codes(key):
    return {o["code"] for o in OPTIONS[key]}


def option_by_code(key, code):
    for o in OPTIONS[key]:
        if o["code"] == code:
            return o
    return None


def original_label(key, code):
    o = option_by_code(key, code)
    if not o:
        return None
    return o["original"] if o.get("original") is not None else o["label"]


def ui_label(key, code):
    o = option_by_code(key, code)
    return o["label"] if o else None


# ---------------------------------------------------------------------------
# Field definitions. ``column``/``header`` are the workbook's exact values.
# ---------------------------------------------------------------------------
def _f(key, label, header, column, ftype, options=None, source="reference", multiple=False, notes=None):
    d = {"key": key, "label": label, "original_header": header, "column": column, "type": ftype,
         "source": source}
    if options:
        d["options"] = options
    if multiple:
        d["multiple"] = True
    if notes:
        d["notes"] = notes
    return d


INJURY_FIELDS = [
    _f("report_by", "Report by", "Report by [Open]", "A", "user"),
    _f("athlete", "Athlete", "Anynomous ID#", "B", "athlete",
       notes="Linked to the athlete record. The workbook used an anonymous roster ID; codes are generated only at export."),
    _f("date_of_injury", "Date of Injury", "Date of Injury\n(double click for calendar)", "C", "date"),
    _f("time_of_injury", "Time of Injury (local)", "Time of Injury (local)", "D", "select", "time_slot"),
    _f("position", "Position", "Position", "E", "select", "inj_position"),
    _f("surface", "Surface (field)", "Surface", "F", "select", "surface",
       notes="Field identification (Field 1 / Field 2). Surface type is a separate app field."),
    _f("activity", "Activity", "Activity", "G", "select", "activity"),
    _f("activity_segment", "Activity Segment", "Activity Segment", "H", "select", "activity_segment",
       notes="Game segment durations follow the event's period configuration; the reference values are the Sixes format."),
    _f("game_day", "Game Day +/−", "Game Day\n+/-", "I", "select", "inj_game_day"),
    _f("match_number", "Match #", "Match #", "J", "text"),
    _f("classification", "New, Recurrent, Exacerbation", "New,\nRecurrent, Exacerbation", "K", "select",
       "inj_classification"),
    _f("time_loss", "Time-Loss", "Time-Loss\n(Y/N)", "L", "select", "time_loss"),
    _f("mode_of_onset", "Mode of Onset", "Mode of Onset", "M", "select", "mode_of_onset"),
    _f("mechanism", "Mechanism", "Mechanism", "N", "select", "mechanism"),
    _f("source", "Source", "Source", "O", "select", "source"),
    _f("occurrence", "Occurrence (specific)", "Occurrence (specific)", "P", "select", "occurrence"),
    _f("phase_of_play", "Phase of Play", "Phase of Play", "Q", "select", "phase_of_play"),
    _f("phase_numbers", "Phase #'s", "Phase #'s", "R", "select", "phase_numbers"),
    _f("penalty", "Penalty", "Penalty", "S", "select", "penalty"),
    _f("body_location", "Body Location", "Body Location (Multiple Selection Typed)", "T", "select",
       "body_location", multiple=True),
    _f("injury_type", "Injury Type", "Injury Type\n(Multiple Selection)", "U", "select", "injury_type",
       multiple=True),
    _f("managed_by", "Managed by", "Managed by", "V", "select", "managed_by"),
    _f("initial_diagnosis", "Initial Diagnosis", "Initial Diagnosis\n[OPEN]", "W", "text"),
    _f("treatment_notes", "Treatment/Resolution Notes", "Treatment/Resolution Notes [OPEN]", "X", "text"),
    _f("estimated_rtp_date", "Estimated RTP Date", "Estimated\nRTP Date\n(double click for calendar)", "Y", "date"),
    _f("final_diagnosis", "Final Diagnosis", "Final Diagnosis\n(side, region, nature, tissue etc) [OPEN]", "Z", "text"),
    _f("actual_rtp_date", "Actual RTP Date", "Actual\nRTP Date\n(double click for calendar)", "AA", "date"),
    _f("imaging", "Imaging", "Imaging\n(Y/N)", "AB", "imaging", "imaging", multiple=True,
       notes="The header says Y/N but the workbook list holds modalities; several exams with date/result allowed."),
    _f("seriousness", "Seriousness", "Seriousness", "AC", "select", "seriousness"),
    _f("compat_time_loss_days", "Time-Loss (days)", "Time-Loss (days)\n**DO NOT EDIT**", "AD", "calculated",
       notes="Workbook formula: Actual RTP Date − Date of Injury. Calculated only from valid dates; never edited."),
]

ILLNESS_FIELDS = [
    _f("report_by", "Report by", "Report by [Open]", "A", "user"),
    _f("athlete", "Athlete", "Anynomous ID#", "B", "athlete",
       notes="Linked to the athlete record. Codes are generated only at export."),
    _f("date_of_onset", "Date of Onset", "Date of Onset\n(double click for calendar)", "C", "date"),
    _f("time_of_onset", "Time of Onset (local)", "Time of Onset (local)", "D", "select", "time_slot"),
    _f("position", "Position", "Position", "E", "select", "ill_position"),
    _f("game_day", "Game Day +/−", "Game Day\n+/-", "F", "select", "ill_game_day"),
    _f("classification", "New, Recurrent, Exacerbation", "New,\nRecurrent, Exacerbation", "G", "select",
       "ill_classification"),
    _f("time_loss", "Time-Loss", "Time-Loss\n(Y/N)", "H", "select", "time_loss"),
    _f("mode_of_onset", "Mode of Onset", "Mode of Onset", "I", "select", "mode_of_onset"),
    _f("communicable", "Communicable / Non-Communicable", "Communicable/Non-", "J", "select", "communicable"),
    _f("organ_system", "Organ System", "Organ System", "K", "select", "organ_system"),
    _f("aetiology", "Aetiology", "Aetiology", "L", "select", "aetiology"),
    _f("managed_by", "Managed by", "Managed by", "M", "select", "managed_by"),
    _f("initial_diagnosis", "Initial Diagnosis", "Initial Diagnosis [OPEN]", "N", "text"),
    _f("treatment_notes", "Treatment/Resolution Notes", "Treatment/Resolution Notes\n[OPEN]", "O", "text"),
    _f("estimated_rtp_date", "Estimated RTP Date", "Estimated\nRTP Date\n(double click for calendar)", "P", "date"),
    _f("final_diagnosis", "Final Diagnosis", "Final Diagnosis\n(side, region, nature, tissue etc) [OPEN]", "Q", "text"),
    _f("actual_rtp_date", "Actual RTP Date", "Actual RTP Date\n(double click for calendar)", "R", "date"),
    _f("imaging", "Imaging", "Imaging\n(Y/N)", "S", "imaging", "imaging", multiple=True),
    _f("seriousness", "Seriousness", "Seriousness", "T", "select", "seriousness"),
    _f("compat_time_loss_days", "Time-Loss (days)", "Time-Loss (days)\n**DO NOT EDIT**", "U", "calculated",
       notes="Workbook formula: Actual RTP Date − Date of Onset. Calculated only from valid dates; never edited."),
]

# Additional structured fields (app). Shared by injuries and illnesses unless noted.
APP_FIELDS = [
    _f("participant_type", "Participant type", None, None, "select", "participant_type", source="app",
       notes="Non-athletes are kept separately and excluded from athlete denominators."),
    _f("other_participant_name", "Other participant (name / role)", None, None, "text", source="app"),
    _f("event_id", "Event / camp / competition", None, None, "event", source="app"),
    _f("season", "Season", None, None, "text", source="app"),
    _f("team", "Team", None, None, "text", source="app"),
    _f("category", "Category", None, None, "select", "category", source="app"),
    _f("exact_time", "Exact local time (optional)", None, None, "time", source="app"),
    _f("surface_type", "Surface type", None, None, "select", "surface_type", source="app"),
    _f("game_day_offset", "Days relative to game (−/+)", None, None, "number", source="app"),
    _f("laterality", "Laterality", None, None, "select", "laterality", source="app"),
    _f("assessment_date", "Assessment date", None, None, "date", source="app"),
    _f("symptom_onset_date", "Symptom onset date", None, None, "date", source="app"),
    _f("diagnosis_status", "Diagnosis status", None, None, "select", "diagnosis_status", source="app"),
    _f("linked_episode_id", "Linked previous episode", None, None, "episode", source="app"),
    _f("prior_full_recovery", "Full recovery & RTS before this episode?", None, None, "select", "prior_recovery",
       source="app"),
    _f("status", "Status", None, None, "select", "status", source="app"),
    _f("participation", "Current participation", None, None, "select", "participation", source="app"),
    _f("unavailability_start", "Unavailability start date", None, None, "date", source="app"),
    _f("partial_return_date", "Partial return date", None, None, "date", source="app"),
    _f("full_return_date", "Full return date", None, None, "date", source="app"),
    _f("additional_notes", "Additional observations", None, None, "text", source="app"),
]

DATE_FIELDS = {
    "injury": ["date_of_injury", "estimated_rtp_date", "actual_rtp_date"],
    "illness": ["date_of_onset", "estimated_rtp_date", "actual_rtp_date"],
    "common": ["assessment_date", "symptom_onset_date", "unavailability_start", "partial_return_date",
               "full_return_date"],
}

FREE_TEXT_FIELDS = ["initial_diagnosis", "treatment_notes", "final_diagnosis", "additional_notes",
                    "other_participant_name", "match_number"]

# Fields the coaching staff may see (participation / availability only).
COACH_VISIBLE_FIELDS = ["id", "kind", "athlete_id", "athlete_name", "team", "status", "participation",
                        "unavailability_start", "partial_return_date", "full_return_date", "estimated_rtp_date"]


def fields_for(kind):
    return INJURY_FIELDS if kind == "injury" else ILLNESS_FIELDS


def select_fields(kind):
    """{field_key: (options_key, multiple)} for every select-type field of a kind."""
    out = {}
    for f in fields_for(kind) + APP_FIELDS:
        if f["type"] in ("select", "imaging") and f.get("options"):
            out[f["key"]] = (f["options"], bool(f.get("multiple")))
    return out


def taxonomy_payload():
    return {
        "form_version": FORM_VERSION,
        "dictionary_version": DICTIONARY_VERSION,
        "time_loss_convention": TIME_LOSS_CONVENTION,
        "reference": REFERENCE_NAME,
        "disclaimer": DISCLAIMER,
        "options": OPTIONS,
        "fields": {"injury": INJURY_FIELDS, "illness": ILLNESS_FIELDS, "app": APP_FIELDS},
        "activity_context": ACTIVITY_CONTEXT,
        "sixes_periods": SIXES_PERIODS,
    }
