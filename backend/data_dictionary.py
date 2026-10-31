"""Research data dictionary: description, type, unit, scale and reference for every exported column."""

REF_OSTRC = "Clarsen B, et al. Br J Sports Med 2020;54:390-396 (OSTRC-H2)"
REF_SRPE = "Foster C, et al. J Strength Cond Res 2001;15(1):109-115 (session-RPE)"
REF_NRS = "Numeric Rating Scale for pain (Hawker GA, et al. Arthritis Care Res 2011;63:S240-S252)"
REF_WELL = "Custom 0-10 wellness items (approach similar to McLean BD, et al. IJSPP 2010;5:367-383)"
REF_CMJ = "Countermovement jump; CV = SD/mean x 100 (Claudino JG, et al. J Sci Med Sport 2017;20:397-402)"

S010 = "0-10 integer"
ISO = "ISO 8601 (UTC unless an offset is shown)"

# column: (description, type, unit, scale/values, reference)
COMMON = {
    "athlete_code": ("Pseudonymous athlete identifier, stable across every sheet of the same export (assigned by registration order).", "string", "", "ATH-001, ATH-002, ...", ""),
    "athlete_name": ("Athlete full name (omitted when the export is anonymized).", "string", "", "", ""),
    "email": ("Athlete login e-mail (omitted when anonymized).", "string", "", "", ""),
    "team": ("Team / squad of the athlete.", "string", "", "e.g. Brazil Lacrosse Men, Brazil Lacrosse Women", ""),
    "position": ("Playing position.", "string", "", "", ""),
    "date": ("Calendar date the record refers to (local monitoring day).", "date", "", "YYYY-MM-DD", ""),
    "id": ("Unique record identifier.", "string", "", "UUID", ""),
    "created_at": ("Timestamp when the record was saved by the server.", "datetime", "", ISO, ""),
    "updated_at": ("Timestamp of the last update.", "datetime", "", ISO, ""),
    "archived": ("True if the record belongs to an archived data-collection period.", "boolean", "", "True / False", ""),
    "archived_event": ("Name of the archived data-collection period (event).", "string", "", "", ""),
    "archived_at": ("Timestamp when the record was archived.", "datetime", "", ISO, ""),
    "notes": ("Free-text notes written by the athlete.", "string", "", "", ""),
    "pain_reports_count": ("Number of pain locations reported in this record (details in the pain_reports sheet).", "integer", "count", ">= 0", ""),
    "team_id": ("Team at the time of submission.", "string", "", "", ""),
}

DATASET_COLUMNS = {
    "athletes": {
        "status": ("Account approval status.", "string", "", "approved / pending / rejected", ""),
        "active": ("Whether the athlete is currently active in the roster.", "boolean", "", "True / False", ""),
        "registered_at": ("Account registration timestamp.", "datetime", "", ISO, ""),
    },
    "morning_checkin": {
        "sleep_quality": ("Self-reported sleep quality last night (higher = better).", "integer", "points", S010 + " (0 = very poor, 10 = excellent)", REF_WELL),
        "morning_fatigue": ("Self-reported fatigue on waking (higher = more fatigued).", "integer", "points", S010 + " (0 = none, 10 = extreme)", REF_WELL),
        "fatigue_level": ("Legacy duplicate of morning_fatigue.", "integer", "points", S010, REF_WELL),
        "muscle_soreness": ("Self-reported general muscle soreness (higher = more sore).", "integer", "points", S010 + " (0 = none, 10 = extreme)", REF_WELL),
        "stress": ("Self-reported psychological stress (higher = more stressed).", "integer", "points", S010 + " (0 = none, 10 = extreme)", REF_WELL),
        "stress_level": ("Legacy duplicate of stress.", "integer", "points", S010, REF_WELL),
        "readiness": ("Self-reported readiness to train (higher = better).", "integer", "points", S010 + " (0 = not ready, 10 = fully ready)", REF_WELL),
        "fatigue_score_10": ("Inverted fatigue so higher = better: 10 - morning_fatigue.", "integer", "points", S010, ""),
        "soreness_score_10": ("Inverted soreness so higher = better: 10 - muscle_soreness.", "integer", "points", S010, ""),
        "stress_score_10": ("Inverted stress so higher = better: 10 - stress.", "integer", "points", S010, ""),
        "readiness_score": ("Composite wellness score = mean(sleep_quality, fatigue_score_10, soreness_score_10, stress_score_10, readiness).", "number", "points", "0-10 (2 decimals; higher = better)", REF_WELL),
        "is_menstruating": ("Female athletes: currently menstruating.", "boolean", "", "True / False", ""),
        "menstrual_flow": ("Self-reported menstrual flow.", "string", "", "Light / Moderate / Heavy", ""),
        "menstrual_pain": ("Self-reported menstrual pain.", "string", "", "None / Mild / Moderate / Severe", ""),
        "menstrual_symptoms": ("List of menstrual symptoms reported.", "JSON list", "", "e.g. cramps, abdominal_pain, breast_tenderness", ""),
        "pain_regions": ("Summary of pain locations: region (side) level; 'Other — text' shows the athlete's own description.", "string", "", "region (side) 0-10; separated by ';'", REF_NRS),
    },
    "training_sessions": {
        "date_time_start": ("Session start date/time.", "datetime", "", ISO, ""),
        "date_time_end": ("Session end date/time.", "datetime", "", ISO, ""),
        "session_type": ("Type of session.", "string", "", "e.g. Technical, Strength, Conditioning, Match, Recovery", ""),
        "duration_min": ("Session duration.", "integer", "minutes", ">= 0", ""),
        "rpe": ("Session rating of perceived exertion (~30 min after the session).", "integer", "points", "0-10 (CR-10; 0 = rest, 10 = maximal)", REF_SRPE),
        "internal_load": ("Session-RPE internal training load = duration_min x rpe.", "integer", "arbitrary units (AU)", ">= 0", REF_SRPE),
        "pain_before": ("Pain intensity before the session.", "integer", "points", S010 + " (0 = no pain, 10 = worst imaginable)", REF_NRS),
        "pain_during": ("Pain intensity during the session.", "integer", "points", S010 + " (0 = no pain, 10 = worst imaginable)", REF_NRS),
        "pain_after": ("Pain intensity after the session.", "integer", "points", S010 + " (0 = no pain, 10 = worst imaginable)", REF_NRS),
        "end_fatigue": ("Fatigue at the end of the session.", "integer", "points", S010 + " (0 = none, 10 = exhausted)", ""),
        "session_notes": ("Athlete notes about the session.", "string", "", "", ""),
        "staff_note": ("Note added by staff to the session.", "string", "", "", ""),
        "staff_note_author": ("Staff member who wrote the note.", "string", "", "", ""),
        "staff_note_updated_at": ("Timestamp of the staff note.", "datetime", "", ISO, ""),
        "photo_id": ("Reference to the optional session photo.", "string", "", "UUID", ""),
        "body_region": ("Legacy single pain region (older records).", "string", "", "see pain_reports.body_region", ""),
        "laterality": ("Legacy single pain side (older records).", "string", "", "Left / Right / Both / N/A", ""),
    },
    "pain_reports": {
        "source": ("Form where the pain was reported.", "string", "", "Morning Check-in / Training / Recovery", ""),
        "source_record_id": ("ID of the originating record (morning_checkin.id, training_sessions.id or recovery_logs.id).", "string", "", "UUID", ""),
        "body_region": ("Body region of the pain (as selected by the athlete).", "string", "", "Neck, Shoulder, Elbow, WristHand, LowBack, HipGroin, Knee, AnkleFoot, Other", ""),
        "region_note": ("Athlete's free-text description of the location; mandatory when body_region = Other.", "string", "", "free text (max 200 chars)", ""),
        "region_display": ("Region label used on staff screens: 'Other — <region_note>' for Other, otherwise body_region.", "string", "", "", ""),
        "side": ("Side of the body.", "string", "", "Left / Right / Both / N/A", ""),
        "pain_level": ("Pain intensity.", "integer", "points", S010 + " (0 = no pain, 10 = worst imaginable)", REF_NRS),
        "pain_type": ("Pain type, when provided.", "string", "", "", ""),
    },
    "recovery_checks": {
        "overall_feeling": ("Overall feeling in the evening (higher = better).", "integer", "points", S010, ""),
        "recovery_quality": ("Perceived quality of recovery (higher = better).", "integer", "points", S010, ""),
        "sleep_after": ("Expected sleep quality tonight (higher = better).", "integer", "points", S010, ""),
        "residual_pain": ("Residual pain in the evening (higher = more pain).", "integer", "points", S010 + " (0 = no pain)", REF_NRS),
        "recovery_score": ("Composite = mean(overall_feeling, recovery_quality, sleep_after, 10 - residual_pain).", "number", "points", "0-10 (2 decimals; higher = better)", ""),
        "session_id": ("Linked training session, when applicable.", "string", "", "UUID", ""),
    },
    "recovery_logs": {
        "time": ("Local time the activity was logged.", "string", "", "HH:MM", ""),
        "activity_id": ("Recovery activity identifier.", "string", "", "UUID", ""),
        "activity_name": ("Recovery activity performed.", "string", "", "e.g. 8+ Hours Sleep, Ice Bath, Compression Boots", ""),
        "category": ("Activity tier.", "string", "", "Bronze / Silver / Gold", ""),
        "points": ("Recovery points awarded for the activity (daily target 100).", "integer", "points", ">= 0", ""),
        "tag": ("Activity group.", "string", "", "sleep, hydration, mobility, modality, nutrition, custom", ""),
        "status": ("Staff review status.", "string", "", "pending / approved / rejected", ""),
        "feedback": ("Staff feedback on the log.", "string", "", "", ""),
        "file_id": ("Reference to the proof photo.", "string", "", "UUID", ""),
        "reviewed_by": ("Staff ID who reviewed.", "string", "", "UUID", ""),
        "reviewed_at": ("Review timestamp.", "datetime", "", ISO, ""),
    },
    "ostrc_responses": {
        "date": ("End of the 7-day OSTRC-H2 reporting period (submission day).", "date", "", "YYYY-MM-DD", REF_OSTRC),
        "submission_id": ("Weekly submission ID (join with ostrc_submissions.id).", "string", "", "UUID", ""),
        "submitted_at": ("Submission timestamp.", "datetime", "", ISO, ""),
        "submission_status": ("On-time or late submission.", "string", "", "completed / completed_late", ""),
        "questionnaire_version": ("Questionnaire version.", "string", "", "OSTRC-H2-2020", REF_OSTRC),
        "has_health_problem": ("False = week without any health problem (one row, answers a/0).", "boolean", "", "True / False", REF_OSTRC),
        "problem_id": ("Health problem episode ID (join with health_problems.id).", "string", "", "UUID", ""),
        "problem_category": ("Type of health problem.", "string", "", "injury / illness / pain / psychological / other", REF_OSTRC),
        "body_region": ("Body region affected; 'Other — text' includes the athlete's description.", "string", "", "", ""),
        "body_side": ("Side affected.", "string", "", "left / right / both / na", ""),
        "description": ("Athlete description of the problem ('[confidential]' for psychological problems).", "string", "", "", ""),
        "Q1_answer": ("Q1 Participation: 'To what extent have you been able to participate in normal training or competition during the past 7 days?'", "string", "", "a = full participation without health problems; b = full participation with health problems; c = reduced participation; d = could not participate", REF_OSTRC),
        "Q1_answer_text": ("Displayed answer text for Q1.", "string", "", "", REF_OSTRC),
        "Q1_score": ("Q1 score.", "integer", "points", "a = 0, b = 8, c = 17, d = 100 (Q1 = d sets severity to 100 and skips Q2-Q4)", REF_OSTRC),
        "Q2_answer": ("Q2 Modification: 'To what extent have you reduced your training or competition during the past 7 days due to a health problem?'", "string", "", "a = no reduction; b = slight; c = moderate; d = considerable", REF_OSTRC),
        "Q2_answer_text": ("Displayed answer text for Q2.", "string", "", "", REF_OSTRC),
        "Q2_score": ("Q2 score.", "integer", "points", "a = 0, b = 8, c = 17, d = 25", REF_OSTRC),
        "Q3_answer": ("Q3 Performance: 'To what extent has your health problem affected your performance during the past 7 days?'", "string", "", "a = no effect; b = slightly; c = moderately; d = considerably", REF_OSTRC),
        "Q3_answer_text": ("Displayed answer text for Q3.", "string", "", "", REF_OSTRC),
        "Q3_score": ("Q3 score.", "integer", "points", "a = 0, b = 8, c = 17, d = 25", REF_OSTRC),
        "Q4_answer": ("Q4 Symptoms: 'To what extent have you experienced health symptoms during the past 7 days?'", "string", "", "a = none; b = mild; c = moderate; d = severe", REF_OSTRC),
        "Q4_answer_text": ("Displayed answer text for Q4.", "string", "", "", REF_OSTRC),
        "Q4_score": ("Q4 score.", "integer", "points", "a = 0, b = 8, c = 17, d = 25", REF_OSTRC),
        "severity_score": ("OSTRC-H2 severity score = Q1+Q2+Q3+Q4 (Q1 = a -> 0; Q1 = d -> 100).", "integer", "points", "0-100 (higher = more severe)", REF_OSTRC),
        "substantial_problem": ("Substantial health problem: Q1 = d, or Q2 = c/d, or Q3 = c/d.", "boolean", "", "True / False", REF_OSTRC),
        "availability": ("Training availability derived from Q1.", "string", "", "full (Q1 a/b) / modified (Q1 c) / unavailable (Q1 d)", REF_OSTRC),
        "problem_status": ("Current status of the problem episode.", "string", "", "new / ongoing / worsening / resolved / archived", ""),
        "problem_first_reported": ("Date the problem episode was first reported.", "date", "", "YYYY-MM-DD", ""),
    },
    "ostrc_submissions": {
        "date": ("End of the 7-day reporting period.", "date", "", "YYYY-MM-DD", REF_OSTRC),
        "submitted_at": ("Submission timestamp.", "datetime", "", ISO, ""),
        "started_at": ("Timestamp the athlete opened the questionnaire.", "datetime", "", ISO, ""),
        "completion_time_seconds": ("Time taken to complete the questionnaire.", "integer", "seconds", ">= 0", ""),
        "submission_status": ("On-time or late (submitted after the 24 h grace period).", "string", "", "completed / completed_late", ""),
        "submitted_late": ("True if submitted after it became mandatory.", "boolean", "", "True / False", ""),
        "questionnaire_version": ("Questionnaire version.", "string", "", "OSTRC-H2-2020", REF_OSTRC),
        "questionnaire_language": ("Language of the questionnaire.", "string", "", "en", ""),
        "offline_submission": ("True if answered offline and synced later.", "boolean", "", "True / False", ""),
        "reporting_period_start": ("Start of the 7-day recall period.", "date", "", "YYYY-MM-DD", REF_OSTRC),
        "reporting_period_end": ("End of the 7-day recall period.", "date", "", "YYYY-MM-DD", REF_OSTRC),
        "has_health_problem": ("At least one health problem with severity > 0 reported this week.", "boolean", "", "True / False", REF_OSTRC),
        "number_of_reported_problems": ("Number of health problems reported this week.", "integer", "count", ">= 0", REF_OSTRC),
        "highest_severity_score": ("Highest OSTRC-H2 severity among the week's problems.", "integer", "points", "0-100", REF_OSTRC),
        "total_problem_severity": ("Sum of severity scores of all problems this week.", "integer", "points", ">= 0", REF_OSTRC),
        "contains_substantial_problem": ("At least one substantial problem this week.", "boolean", "", "True / False", REF_OSTRC),
        "requires_medical_review": ("Flag: substantial problem or severity >= 17.", "boolean", "", "True / False", ""),
        "review_status": ("Medical staff review status.", "string", "", "not_reviewed / in_review / reviewed", ""),
        "reviewed_at": ("Review timestamp.", "datetime", "", ISO, ""),
        "reviewed_by": ("Staff member who reviewed.", "string", "", "", ""),
        "medical_notes": ("Staff notes on the submission.", "JSON list", "", "", ""),
        "correction_requested": ("Athlete asked to correct the submission.", "boolean", "", "True / False", ""),
        "correction_reason": ("Reason given for the correction.", "string", "", "", ""),
        "correction_requested_at": ("Timestamp of the correction request.", "datetime", "", ISO, ""),
    },
    "health_problems": {
        "date": ("Date the problem episode was first reported.", "date", "", "YYYY-MM-DD", ""),
        "first_submission_id": ("Submission where the problem was first reported.", "string", "", "UUID", ""),
        "current_submission_id": ("Most recent submission reporting the problem.", "string", "", "UUID", ""),
        "problem_type": ("Type of health problem (same as problem_category).", "string", "", "injury / illness / pain / psychological / other", REF_OSTRC),
        "problem_category": ("Type of health problem.", "string", "", "injury / illness / pain / psychological / other", REF_OSTRC),
        "body_region": ("Body region affected; 'Other — text' includes the athlete's description.", "string", "", "", ""),
        "body_side": ("Side affected.", "string", "", "left / right / both / na", ""),
        "athlete_description": ("Athlete description ('[confidential]' for psychological problems).", "string", "", "", ""),
        "onset_date": ("Date of onset, if provided.", "date", "", "YYYY-MM-DD", ""),
        "onset_type": ("Mechanism of onset.", "string", "", "sudden / gradual", REF_OSTRC),
        "context": ("Context of onset (training / match / other), if provided.", "string", "", "", ""),
        "first_reported_date": ("First week reported.", "date", "", "YYYY-MM-DD", ""),
        "last_reported_date": ("Last week reported.", "date", "", "YYYY-MM-DD", ""),
        "resolved_date": ("Week reported as resolved (severity 0).", "date", "", "YYYY-MM-DD", ""),
        "status": ("Episode status.", "string", "", "new / ongoing / worsening / resolved / archived", ""),
        "current_availability": ("Latest availability derived from Q1.", "string", "", "full / modified / unavailable", REF_OSTRC),
        "current_severity_score": ("Latest OSTRC-H2 severity.", "integer", "points", "0-100", REF_OSTRC),
        "highest_severity_score": ("Highest severity during the episode.", "integer", "points", "0-100", REF_OSTRC),
        "consecutive_weeks_reported": ("Consecutive weeks the problem was reported.", "integer", "weeks", ">= 1", ""),
        "total_weeks_reported": ("Total weeks the problem was reported (episode duration proxy).", "integer", "weeks", ">= 1", REF_OSTRC),
        "recurrence_count": ("Number of recurrences after resolution.", "integer", "count", ">= 0", ""),
        "substantial_problem": ("Latest week was a substantial problem (Q1 = d or Q2/Q3 = c/d).", "boolean", "", "True / False", REF_OSTRC),
        "requested_medical_contact": ("Athlete requested contact from medical staff.", "boolean", "", "True / False", ""),
        "medical_priority": ("Triage priority: high = substantial; moderate = severity >= 17; low otherwise.", "string", "", "high / moderate / low", ""),
        "confidential": ("Confidential (psychological) problem — description hidden.", "boolean", "", "True / False", ""),
    },
    "cmj_tests": {
        "context": ("Testing context.", "string", "", "pre_training / post_training / retest / baseline", ""),
        "event_id": ("Linked event, if any.", "string", "", "UUID", ""),
        "arms_used": ("Arm swing allowed.", "boolean", "", "True / False", REF_CMJ),
        "trials.trial_1": ("Jump height, trial 1.", "number", "cm", "> 0", REF_CMJ),
        "trials.trial_2": ("Jump height, trial 2.", "number", "cm", "> 0", REF_CMJ),
        "trials.trial_3": ("Jump height, trial 3.", "number", "cm", "> 0", REF_CMJ),
        "cmj_best": ("Best jump height of the trials.", "number", "cm", "> 0", REF_CMJ),
        "cmj_mean": ("Mean jump height of the trials.", "number", "cm", "> 0", REF_CMJ),
        "cv_percent": ("Within-session coefficient of variation = SD / mean x 100.", "number", "%", ">= 0", REF_CMJ),
        "delta_best_percent": ("Change of cmj_best vs the athlete's baseline = (best - baseline) / baseline x 100.", "number", "%", "negative = below baseline", REF_CMJ),
        "delta_mean_percent": ("Change of cmj_mean vs the athlete's baseline.", "number", "%", "negative = below baseline", REF_CMJ),
        "time_of_day": ("Time of day of the test.", "string", "", "morning / afternoon / evening", ""),
        "recorded_by": ("Staff ID who recorded the test.", "string", "", "UUID", ""),
    },
    "fittest_points": {
        "challenge_id": ("The Fittest challenge ID.", "string", "", "UUID", ""),
        "post_id": ("Feed post that generated the point.", "string", "", "UUID", ""),
        "source_type": ("What earned the point.", "string", "", "training_checkin / complete_recovery", ""),
        "source_id": ("Source reference (session ID or date).", "string", "", "", ""),
        "points": ("Points awarded.", "integer", "points", "1 per eligible action", ""),
        "reason": ("Human-readable reason.", "string", "", "", ""),
        "awarded_at": ("Timestamp the point was awarded.", "datetime", "", ISO, ""),
        "revoked": ("Point revoked by an admin.", "boolean", "", "True / False", ""),
        "revoke_reason": ("Reason for revocation.", "string", "", "", ""),
        "revoked_at": ("Revocation timestamp.", "datetime", "", ISO, ""),
        "revoked_by_admin_id": ("Admin who revoked.", "string", "", "UUID", ""),
    },
    "adherence_weekly": {
        "date": ("Week start (Monday); same as week_start.", "date", "", "YYYY-MM-DD", ""),
        "week_start": ("Monday of the ISO week.", "date", "", "YYYY-MM-DD", ""),
        "week_end": ("Sunday of the ISO week.", "date", "", "YYYY-MM-DD", ""),
        "days_in_period": ("Days of this week inside the selected period and not after today (denominator).", "integer", "days", "1-7", ""),
        "morning_days": ("Days with a morning check-in.", "integer", "days", "0-7", ""),
        "morning_pct": ("Morning check-in adherence = morning_days / days_in_period x 100.", "integer", "%", "0-100", ""),
        "ostrc_submitted": ("OSTRC-H2 weekly questionnaire submitted during this week.", "boolean", "", "True / False", REF_OSTRC),
        "ostrc_pct": ("OSTRC adherence for the week (100 if submitted, else 0).", "integer", "%", "0 / 100", ""),
        "training_sessions": ("Number of training sessions logged.", "integer", "count", ">= 0", ""),
        "training_days": ("Distinct days with at least one training log.", "integer", "days", "0-7", ""),
        "recovery_days": ("Days with an evening recovery check or a recovery activity log.", "integer", "days", "0-7", ""),
        "recovery_pct": ("Recovery adherence = recovery_days / days_in_period x 100.", "integer", "%", "0-100", ""),
        "overall_pct": ("Overall adherence = mean(morning_pct, ostrc_pct, recovery_pct). Training is not included (athletes do not train daily).", "integer", "%", "0-100", ""),
    },
}

HEADER = ["dataset", "column", "description", "type", "unit", "scale_or_values", "reference"]


def describe(dataset, column):
    d = DATASET_COLUMNS.get(dataset, {}).get(column) or COMMON.get(column)
    if d:
        return d
    if column.endswith("_at"):
        return ("Timestamp field.", "datetime", "", ISO, "")
    if column.endswith("_id"):
        return ("Reference identifier.", "string", "", "UUID", "")
    return ("Additional field stored by the app.", "string", "", "", "")


def dictionary_rows(columns_by_dataset):
    """columns_by_dataset: {dataset_key: [columns]} -> list of row lists matching HEADER."""
    rows = []
    for ds, cols in columns_by_dataset.items():
        if not cols:
            cols = ["athlete_code"] + list(DATASET_COLUMNS.get(ds, {}).keys())
        for c in cols:
            rows.append([ds, c, *describe(ds, c)])
    return rows
