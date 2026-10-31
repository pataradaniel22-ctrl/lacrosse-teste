"""Event Report — pure aggregation helpers & section builders.

Extracted from event_report_routes.py so each section can be reasoned about /
unit-tested in isolation. All functions are side-effect free and receive the
already-computed intermediate data. Behaviour is identical to the original
monolithic build_report().
"""
from datetime import datetime, timedelta
from statistics import mean

READINESS_RISK = 5.0          # <= is risk (app rule)
READINESS_GOOD = 6.5          # >= is good
RECOVERY_TARGET_DEFAULT = 100
PAIN_INTENSE = 7              # >= high pain
PAIN_MODERATE = 4            # 4-6 moderate

TEAM_LABELS = {
    "Brazil Lacrosse Men": "Men",
    "Brazil Lacrosse Women": "Women",
}

REGION_LABELS = {
    "Neck": "Neck", "Shoulder": "Shoulder", "Elbow": "Elbow", "WristHand": "Wrist/Hand",
    "LowBack": "Low Back", "HipGroin": "Hip/Groin", "Knee": "Knee", "AnkleFoot": "Ankle/Foot",
    "Other": "Other", "Unspecified": "Unspecified",
}


def _round(v, n=1):
    if v is None:
        return None
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


def _mean(vals, n=1):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return _round(mean(vals), n)


def date_range(start: str, end: str):
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    d1 = datetime.strptime(end, "%Y-%m-%d").date()
    if d1 < d0:
        d0, d1 = d1, d0
    out = []
    cur = d0
    while cur <= d1:
        out.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return out


def team_key(team_val):
    return TEAM_LABELS.get(team_val, team_val or "Unassigned")


def collect_pain(readiness, sessions, recovery):
    """Unified pain events from check-ins, training and recovery."""
    events = []

    def add(aid, date, pr, source):
        region = pr.get("body_region") or "Unspecified"
        note = pr.get("region_note")
        if region == "Other" and note and str(note).strip():
            region = f"Other — {str(note).strip()}"
        try:
            lvl = int(pr.get("pain_level", 0) or 0)
        except (TypeError, ValueError):
            lvl = 0
        events.append({
            "athlete_id": aid, "date": date, "region": region,
            "laterality": pr.get("laterality") or "N/A",
            "level": lvl, "source": source,
        })

    for r in readiness:
        for pr in (r.get("pain_reports") or []):
            add(r["athlete_id"], r.get("date"), pr, "Check-in")
    for s in sessions:
        d = (s.get("date_time_start") or "")[:10]
        for pr in (s.get("pain_reports") or []):
            add(s["athlete_id"], d, pr, "Training")
        if s.get("body_region") and s.get("pain_after"):
            add(s["athlete_id"], d, {
                "body_region": s["body_region"], "laterality": s.get("laterality"),
                "pain_level": s.get("pain_after"),
            }, "Training")
    for rc in recovery:
        for pr in (rc.get("pain_reports") or []):
            add(rc["athlete_id"], rc.get("date"), pr, "Recovery")
    return events


# ---------------------------------------------------------------- section builders

def build_rankings(pa_list, rank):
    return {
        "top_adherence": rank("compliance"),
        "top_readiness": rank("readiness"),
        "most_stable_readiness": [
            {"id": p["id"], "name": p["name"], "team": p["team"], "value": p["readiness_std"]}
            for p in sorted([p for p in pa_list if p["readiness_std"] is not None and p["days_monitored"] >= 2],
                            key=lambda x: x["readiness_std"])[:10]
        ],
        "best_sleep": rank("sleep"),
        "lowest_fatigue": rank("fatigue", reverse=False, filt=lambda p: p["fatigue"] is not None),
        "lowest_stress": rank("stress", reverse=False, filt=lambda p: p["stress"] is not None),
        "lowest_soreness": rank("soreness", reverse=False, filt=lambda p: p["soreness"] is not None),
        "best_recovery": rank("recovery"),
        "highest_load": rank("total_load"),
        "most_pain_days": rank("pain_days", filt=lambda p: p["pain_days"] > 0),
        "best_readiness_evolution": [
            {"id": p["id"], "name": p["name"], "team": p["team"], "value": p["readiness_first_last"]}
            for p in sorted([p for p in pa_list if p["readiness_first_last"] is not None],
                            key=lambda x: x["readiness_first_last"], reverse=True)[:10]
        ],
        "biggest_readiness_drop": [
            {"id": p["id"], "name": p["name"], "team": p["team"], "value": p["readiness_first_last"]}
            for p in sorted([p for p in pa_list if p["readiness_first_last"] is not None],
                            key=lambda x: x["readiness_first_last"])[:10]
        ],
    }


def build_team_profiles(team_metrics, recovery_target):
    def team_profile(tm):
        strengths, attention_pts, recs = [], [], []
        if tm["adherence"] is not None:
            (strengths if tm["adherence"] >= 80 else attention_pts).append(
                f"Monitoring adherence {tm['adherence']}%")
        if tm["readiness"] is not None:
            (strengths if tm["readiness"] >= READINESS_GOOD else attention_pts).append(
                f"Average readiness {tm['readiness']}/10")
        if tm["avg_pain"] is not None and tm["avg_pain"] >= PAIN_MODERATE:
            attention_pts.append(f"Average reported pain {tm['avg_pain']}/10")
            recs.append("Prioritize physiotherapy screening for pain-affected athletes.")
        if tm["fatigue"] is not None and tm["fatigue"] >= 6:
            attention_pts.append(f"Elevated fatigue ({tm['fatigue']}/10)")
            recs.append("Review training load distribution and recovery windows.")
        if tm["recovery"] is not None and tm["recovery"] >= recovery_target * 0.8:
            strengths.append(f"Consistent recovery ({tm['recovery']} pts avg)")
        if not recs:
            recs.append("Maintain current monitoring routine and daily feedback.")
        return {"label": tm["label"], "metrics": tm,
                "strengths": strengths or ["Insufficient data"],
                "attention": attention_pts or ["No major attention points"],
                "recommendations": recs}

    return [team_profile(t) for t in team_metrics]


def build_insights(compliance, readiness_section, team_metrics, pain_section,
                   load_section, recovery_section, availability, daily,
                   num_days, actual_total, expected_total, recovery_target):
    insights = []

    def add_insight(title, text, metric, priority, category, action, ref=None):
        insights.append({"title": title, "text": text, "metric": metric,
                         "priority": priority, "category": category, "action": action, "ref": ref})

    if compliance["rate"] is not None:
        pr = "low" if compliance["rate"] >= 80 else ("high" if compliance["rate"] < 60 else "moderate")
        add_insight("Overall monitoring adherence",
                    f"Overall check-in completion was {compliance['rate']}% across {num_days} days.",
                    f"{actual_total}/{expected_total} check-ins", pr, "Adherence",
                    "Maintain reminders and daily feedback to athletes.")
    if readiness_section["trend_first"] is not None and readiness_section["trend_last"] is not None:
        delta = _round(readiness_section["trend_last"] - readiness_section["trend_first"], 1)
        if delta is not None and delta <= -0.5:
            add_insight("Readiness declined over the event",
                        f"Average readiness fell from {readiness_section['trend_first']} to {readiness_section['trend_last']} (Δ {delta}).",
                        "Daily readiness average", "high", "Readiness",
                        "Reinforce sleep, hydration and recovery in final days.")
        elif delta is not None and delta >= 0.5:
            add_insight("Readiness improved over the event",
                        f"Average readiness rose from {readiness_section['trend_first']} to {readiness_section['trend_last']} (Δ +{delta}).",
                        "Daily readiness average", "low", "Readiness",
                        "Keep the current load/recovery balance.")
    if len(team_metrics) == 2:
        a, b = team_metrics
        if a["readiness"] is not None and b["readiness"] is not None:
            hi, lo = (a, b) if a["readiness"] >= b["readiness"] else (b, a)
            diff = _round(hi["readiness"] - lo["readiness"], 1)
            add_insight("Team readiness difference",
                        f"{hi['label']} showed higher average readiness than {lo['label']} (Δ {diff}).",
                        "Readiness by team", "moderate", "Team comparison",
                        "Investigate load and recovery differences between teams.")
    if pain_section["regions"]:
        top_r = pain_section["regions"][0]
        add_insight("Most reported pain region",
                    f"{top_r['region']} was the most reported area ({top_r['count']} reports).",
                    "Pain by region", "moderate", "Pain",
                    f"Plan targeted screening for {top_r['region'].lower()}.")
    if pain_section["prevalence"] is not None and pain_section["prevalence"] >= 30:
        add_insight("Notable pain prevalence",
                    f"{pain_section['prevalence']}% of athletes reported pain at least once.",
                    "Pain prevalence", "high", "Pain",
                    "Coordinate with medical/physio for follow-up.")
    if load_section["peak_day"]:
        add_insight("Training load peak",
                    f"Highest team load occurred on {load_section['peak_day']}.",
                    "Load by day", "moderate", "Perceived load",
                    "Ensure adequate recovery around peak-load days.")
    if recovery_section["avg"] is not None:
        pr = "low" if recovery_section["avg"] >= recovery_target * 0.8 else "moderate"
        add_insight("Recovery adherence",
                    f"Average daily recovery was {recovery_section['avg']} pts (target {recovery_target}).",
                    "Recovery by day", pr, "Recovery",
                    "Keep encouraging daily recovery logging.")
    if availability["availability_pct"] is not None:
        add_insight("Squad availability",
                    f"{availability['availability_pct']}% of athletes ended the event with no active risk factors.",
                    "Risk distribution", "low" if availability["availability_pct"] >= 70 else "high", "Availability",
                    "Give individual attention to flagged athletes.")
    sleep_trend = [d["sleep"] for d in daily if d["sleep"] is not None]
    if len(sleep_trend) >= 2 and sleep_trend[-1] < sleep_trend[0] - 0.5:
        add_insight("Sleep as an attention point",
                    f"Average sleep dropped from {sleep_trend[0]} to {sleep_trend[-1]} during the event.",
                    "Sleep by day", "high", "Sleep",
                    "Reinforce sleep hygiene and schedule education.")
    if compliance["low_count"] > 0:
        add_insight("Athletes with low adherence",
                    f"{compliance['low_count']} athlete(s) completed fewer than half of the check-ins.",
                    "Compliance per athlete", "moderate", "Data quality",
                    "Follow up individually to improve completion.")
    if not insights:
        add_insight("Insufficient data", "Not enough records to generate insights for this period.",
                    "—", "low", "Data quality", "Increase check-in completion.")
    priority_rank = {"high": 0, "moderate": 1, "low": 2}
    insights.sort(key=lambda x: priority_rank.get(x["priority"], 3))
    return insights


def build_data_quality(pa_list, daily, compliance, sessions_count,
                       approved_recovery_count, pain_section):
    no_checkin = [p for p in pa_list if p["days_monitored"] == 0]
    low_days = [d["date"] for d in daily if d["adherence"] is not None and d["adherence"] < 50]
    rate = compliance["rate"] or 0
    confidence = "high" if rate >= 75 else ("moderate" if rate >= 50 else "low")
    dq = {
        "confidence": confidence,
        "athletes_without_checkin": len(no_checkin),
        "low_collection_days": low_days,
        "no_load_data": sessions_count == 0,
        "no_recovery_data": approved_recovery_count == 0,
        "no_pain_data": pain_section["total_reports"] == 0,
        "notes": [],
    }
    if dq["no_load_data"]:
        dq["notes"].append("No training/load records in this period.")
    if dq["no_recovery_data"]:
        dq["notes"].append("No approved recovery records in this period.")
    if dq["athletes_without_checkin"]:
        dq["notes"].append(f"{len(no_checkin)} athlete(s) with no check-in.")
    return dq


def build_executive_summary(start, end, n_ath, num_days, teams, compliance,
                            overall, team_metrics, pain_section, readiness_section, actual_total):
    parts = []
    team_txt = f"{len(teams)} team(s)" if teams else "a single group"
    parts.append(
        f"During the analysed period ({start} to {end}), {n_ath} athletes were monitored across {team_txt} over {num_days} day(s).")
    if compliance["rate"] is not None:
        parts.append(f"Overall daily check-in adherence was {compliance['rate']}%.")
    if overall["readiness"] is not None:
        parts.append(f"Average readiness was {overall['readiness']}/10.")
    if len(team_metrics) == 2 and team_metrics[0]["readiness"] is not None and team_metrics[1]["readiness"] is not None:
        a, b = team_metrics
        hi = a if a["readiness"] >= b["readiness"] else b
        parts.append(f"{hi['label']} showed the most stable readiness profile.")
    if pain_section["prevalence"] is not None:
        parts.append(f"Pain was reported by {pain_section['prevalence']}% of athletes.")
    if actual_total > 0 and overall["readiness"] is not None:
        positive = "high monitoring adherence" if (compliance["rate"] or 0) >= 75 else "consistent daily data collection"
        attention_point = "declining readiness toward the final days" if (
            readiness_section["trend_last"] is not None and readiness_section["trend_first"] is not None
            and readiness_section["trend_last"] < readiness_section["trend_first"]
        ) else ("pain management for flagged athletes" if (pain_section["prevalence"] or 0) >= 30 else "maintaining recovery consistency")
        parts.append(f"The main positive was {positive}; the key attention point for future events is {attention_point}.")
    else:
        parts.append("Insufficient monitoring data was collected in this period to draw conclusions.")
    return " ".join(parts)


def build_recommendations(pain_section):
    return {
        "technical": [
            "Adjust training load around identified peak-load days.",
            "Schedule lighter sessions after days with elevated fatigue.",
            "Reinforce recovery strategies on high-load days.",
            "Keep clear communication of daily readiness with athletes.",
        ],
        "medical": [
            "Individually follow up athletes with recurrent or intense pain.",
            "Focus screening on the most reported region"
            + (f" ({pain_section['regions'][0]['region']})." if pain_section["regions"] else "."),
            "Monitor athletes with persistent low readiness.",
            "Emphasise prevention and athlete education on pain reporting.",
        ],
        "event": [
            "Improve check-in completion on low-adherence days.",
            "Standardise collection times for consistency.",
            "Ensure complete data entry across all categories.",
            "Automate final report export at event close.",
        ],
        "future": [
            "Maintain the daily questionnaire routine.",
            "Improve reminders and daily staff feedback.",
            "Flag attention athletes before the next event.",
            "Build a per-athlete and per-team readiness baseline for comparison.",
        ],
    }
