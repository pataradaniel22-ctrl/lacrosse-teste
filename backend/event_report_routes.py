"""Event Report — comprehensive AMS event analytics for Staff/Admin.

Aggregates raw monitoring data (readiness/wellness, pain, perceived load,
recovery points, availability/risk, alerts) into an executive + technical
report for a selected event / date range. NO physical-testing / CMJ data.

Never fabricates data: metrics without enough underlying records return null
(the frontend renders "Insufficient data").
"""
import logging
from datetime import datetime, timezone
from statistics import mean, pstdev

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from app_time import local_now
from event_report_sections import (
    RECOVERY_TARGET_DEFAULT, READINESS_RISK, READINESS_GOOD, PAIN_INTENSE, PAIN_MODERATE,
    REGION_LABELS, _round, _mean, date_range, team_key, collect_pain,
    build_rankings, build_team_profiles, build_insights, build_data_quality,
    build_executive_summary, build_recommendations,
)

logger = logging.getLogger(__name__)


def register_event_report_routes(api_router: APIRouter, db, get_current_user):

    def _require_staff(user):
        if user.get("user_type") != "staff":
            raise HTTPException(status_code=403, detail="Staff only")

    async def _load_raw(start, end, team, athlete_id, archive_event_id=None):
        """Fetch athletes + all monitoring records for the window.

        When ``archive_event_id`` is set, records are read from the
        ``*_archive`` collections (filtered only by ``archived_event_id`` +
        athlete), ignoring the date window — the caller derives the real range
        from the archived data itself. The athlete roster is always live.
        """
        aq = {"active": True}
        if team and team not in ("all", None):
            aq["team"] = team
        athletes = await db.athletes.find(
            aq, {"_id": 0, "id": 1, "name": 1, "team": 1, "position": 1}
        ).to_list(1000)
        if athlete_id:
            athletes = [a for a in athletes if a["id"] == athlete_id]
        ids = [a["id"] for a in athletes]
        amap = {a["id"]: a for a in athletes}

        if archive_event_id:
            aid_q = {"athlete_id": {"$in": ids}, "archived_event_id": archive_event_id}
            readiness = await db.daily_readiness_archive.find(aid_q, {"_id": 0}).to_list(50000)
            recovery = await db.recovery_logs_archive.find(aid_q, {"_id": 0}).to_list(50000)
            sessions = await db.training_sessions_archive.find(aid_q, {"_id": 0}).to_list(50000)
            alerts = await db.alerts_archive.find(aid_q, {"_id": 0}).to_list(50000)
            return athletes, ids, amap, readiness, recovery, sessions, alerts

        date_q = {"$gte": start, "$lte": end}
        readiness = await db.daily_readiness.find(
            {"athlete_id": {"$in": ids}, "date": date_q}, {"_id": 0}
        ).to_list(50000)
        recovery = await db.recovery_logs.find(
            {"athlete_id": {"$in": ids}, "date": date_q}, {"_id": 0}
        ).to_list(50000)
        # Training sessions store an ISO datetime in date_time_start -> filter by day prefix
        sessions = await db.training_sessions.find(
            {"athlete_id": {"$in": ids}}, {"_id": 0}
        ).to_list(50000)
        sessions = [s for s in sessions if start <= (s.get("date_time_start") or "")[:10] <= end]
        alerts = await db.alerts.find(
            {"athlete_id": {"$in": ids}}, {"_id": 0}
        ).to_list(50000)
        alerts = [
            a for a in alerts
            if start <= (a.get("created_at") or a.get("date") or "")[:10] <= end
        ]
        return athletes, ids, amap, readiness, recovery, sessions, alerts

    async def build_report(start, end, team, athlete_id, archive_event_id=None):
        athletes, ids, amap, readiness, recovery, sessions, alerts = await _load_raw(
            start, end, team, athlete_id, archive_event_id
        )
        if archive_event_id:
            # Derive the real reporting window from the archived data itself.
            day_vals = [r.get("date") for r in readiness if r.get("date")]
            day_vals += [r.get("date") for r in recovery if r.get("date")]
            day_vals += [(s.get("date_time_start") or "")[:10] for s in sessions if s.get("date_time_start")]
            day_vals = [d for d in day_vals if d]
            if day_vals:
                start, end = min(day_vals), max(day_vals)
        dates = date_range(start, end)
        num_days = len(dates)
        n_ath = len(ids)

        # recovery target
        rs = await db.recovery_settings.find_one({"id": "global"}, {"_id": 0})
        recovery_target = int(rs.get("daily_target", RECOVERY_TARGET_DEFAULT)) if rs else RECOVERY_TARGET_DEFAULT

        pain_events = collect_pain(readiness, sessions, recovery)

        # ---- indexes ----
        approved_recovery = [r for r in recovery if r.get("status") == "approved"]
        # recovery points per athlete/day
        rec_by_ad = {}
        for r in approved_recovery:
            rec_by_ad.setdefault((r["athlete_id"], r["date"]), 0)
            rec_by_ad[(r["athlete_id"], r["date"])] += int(r.get("points", 0) or 0)

        # teams present
        team_vals = sorted({a.get("team") for a in athletes if a.get("team")})
        teams = [{"value": tv, "label": team_key(tv),
                  "athlete_ids": [a["id"] for a in athletes if a.get("team") == tv]}
                 for tv in team_vals]

        # ---------- Daily timeseries ----------
        daily = []
        for d in dates:
            r_day = [r for r in readiness if r.get("date") == d]
            s_day = [s for s in sessions if (s.get("date_time_start") or "")[:10] == d]
            pain_day = [p for p in pain_events if p.get("date") == d]
            al_day = [a for a in alerts if (a.get("created_at") or a.get("date") or "")[:10] == d]
            rec_pts_day = [v for (aid, dd), v in rec_by_ad.items() if dd == d]
            daily.append({
                "date": d,
                "checkins": len(r_day),
                "adherence": _round(100 * len(r_day) / n_ath, 0) if n_ath else None,
                "readiness": _mean([r.get("readiness_score") for r in r_day]),
                "sleep": _mean([r.get("sleep_quality") for r in r_day]),
                "fatigue": _mean([r.get("morning_fatigue") for r in r_day]),
                "stress": _mean([r.get("stress") for r in r_day]),
                "soreness": _mean([r.get("muscle_soreness") for r in r_day]),
                "disposition": _mean([r.get("readiness") for r in r_day]),
                "recovery": _mean(rec_pts_day, 0),
                "load": _mean([s.get("internal_load") for s in s_day], 0),
                "athletes_with_pain": len({p["athlete_id"] for p in pain_day if p["level"] > 0}),
                "alerts": len(al_day),
            })

        # ---------- helpers over an athlete subset ----------
        def subset_metrics(subset_ids):
            r_sub = [r for r in readiness if r["athlete_id"] in subset_ids]
            s_sub = [s for s in sessions if s["athlete_id"] in subset_ids]
            p_sub = [p for p in pain_events if p["athlete_id"] in subset_ids]
            rec_sub = {k: v for k, v in rec_by_ad.items() if k[0] in subset_ids}
            al_sub = [a for a in alerts if a["athlete_id"] in subset_ids]
            n = len(subset_ids)
            expected = n * num_days
            pain_ath = {p["athlete_id"] for p in p_sub if p["level"] > 0}
            total_load = sum(int(s.get("internal_load", 0) or 0) for s in s_sub)
            return {
                "athletes": n,
                "adherence": _round(100 * len(r_sub) / expected, 1) if expected else None,
                "readiness": _mean([r.get("readiness_score") for r in r_sub]),
                "sleep": _mean([r.get("sleep_quality") for r in r_sub]),
                "fatigue": _mean([r.get("morning_fatigue") for r in r_sub]),
                "stress": _mean([r.get("stress") for r in r_sub]),
                "soreness": _mean([r.get("muscle_soreness") for r in r_sub]),
                "disposition": _mean([r.get("readiness") for r in r_sub]),
                "recovery": _mean(list(rec_sub.values()), 0) if rec_sub else None,
                "total_load": total_load if s_sub else None,
                "load_per_athlete": _round(total_load / n, 0) if n and s_sub else None,
                "athletes_with_pain": len(pain_ath),
                "pain_prevalence": _round(100 * len(pain_ath) / n, 0) if n else None,
                "avg_pain": _mean([p["level"] for p in p_sub if p["level"] > 0]),
                "alerts_yellow": sum(1 for a in al_sub if a.get("severity") == "Yellow"),
                "alerts_red": sum(1 for a in al_sub if a.get("severity") == "Red"),
                "alerts_total": len(al_sub),
            }

        overall = subset_metrics(set(ids))
        team_metrics = [{"value": t["value"], "label": t["label"],
                         **subset_metrics(set(t["athlete_ids"]))} for t in teams]

        # ---------- per-athlete aggregates ----------
        per_ath = {}
        for a in athletes:
            aid = a["id"]
            r_a = sorted([r for r in readiness if r["athlete_id"] == aid], key=lambda x: x.get("date", ""))
            s_a = [s for s in sessions if s["athlete_id"] == aid]
            p_a = [p for p in pain_events if p["athlete_id"] == aid and p["level"] > 0]
            rec_a = {dd: v for (ai, dd), v in rec_by_ad.items() if ai == aid}
            al_a = [al for al in alerts if al["athlete_id"] == aid]
            r_scores = [r.get("readiness_score") for r in r_a if r.get("readiness_score") is not None]
            pain_days = sorted({p["date"] for p in p_a})
            first_last = None
            if len(r_scores) >= 2:
                first_last = _round(r_scores[-1] - r_scores[0], 1)
            per_ath[aid] = {
                "id": aid, "name": a.get("name", "Unknown"),
                "team": team_key(a.get("team")), "team_value": a.get("team"),
                "position": a.get("position"),
                "days_monitored": len(r_a),
                "compliance": _round(100 * len(r_a) / num_days, 0) if num_days else None,
                "readiness": _mean(r_scores),
                "readiness_std": _round(pstdev(r_scores), 2) if len(r_scores) >= 2 else None,
                "readiness_first_last": first_last,
                "sleep": _mean([r.get("sleep_quality") for r in r_a]),
                "fatigue": _mean([r.get("morning_fatigue") for r in r_a]),
                "stress": _mean([r.get("stress") for r in r_a]),
                "soreness": _mean([r.get("muscle_soreness") for r in r_a]),
                "disposition": _mean([r.get("readiness") for r in r_a]),
                "recovery": _mean(list(rec_a.values()), 0) if rec_a else None,
                "recovery_days": len(rec_a),
                "total_load": sum(int(s.get("internal_load", 0) or 0) for s in s_a) if s_a else None,
                "pain_reports": len(p_a),
                "pain_days": len(pain_days),
                "max_pain": max([p["level"] for p in p_a], default=0),
                "alerts": len(al_a),
                "alerts_red": sum(1 for al in al_a if al.get("severity") == "Red"),
                "readiness_series": [
                    {"date": r.get("date"), "value": r.get("readiness_score")} for r in r_a
                ],
                "pain_regions": {},
            }
            for p in p_a:
                lbl = REGION_LABELS.get(p["region"], p["region"])
                per_ath[aid]["pain_regions"][lbl] = per_ath[aid]["pain_regions"].get(lbl, 0) + 1

        pa_list = list(per_ath.values())

        # ---------- Compliance ----------
        expected_total = n_ath * num_days
        actual_total = len(readiness)
        perfect = [p for p in pa_list if p["compliance"] == 100]
        low_adh = [p for p in pa_list if (p["compliance"] or 0) < 50]

        def rank(key, reverse=True, filt=None, limit=10):
            arr = [p for p in pa_list if p.get(key) is not None and (filt(p) if filt else True)]
            arr.sort(key=lambda x: x[key], reverse=reverse)
            return [{"id": p["id"], "name": p["name"], "team": p["team"], "value": p[key]}
                    for p in arr[:limit]]

        compliance = {
            "expected": expected_total,
            "actual": actual_total,
            "rate": _round(100 * actual_total / expected_total, 1) if expected_total else None,
            "by_team": [{"label": t["label"], "rate": t["adherence"]} for t in team_metrics],
            "by_day": [{"date": d["date"], "adherence": d["adherence"]} for d in daily],
            "perfect_count": len(perfect),
            "low_count": len(low_adh),
            "worst_day": min([d for d in daily if d["adherence"] is not None],
                             key=lambda x: x["adherence"], default={}).get("date"),
            "top_adherence": rank("compliance"),
            "bottom_adherence": rank("compliance", reverse=False),
            "recovery_registered": len(approved_recovery),
        }

        # ---------- Readiness ----------
        good = [p for p in pa_list if p["readiness"] is not None and p["readiness"] >= READINESS_GOOD]
        attention = [p for p in pa_list if p["readiness"] is not None and READINESS_RISK < p["readiness"] < READINESS_GOOD]
        risk = [p for p in pa_list if p["readiness"] is not None and p["readiness"] <= READINESS_RISK]
        r_days_valid = [d for d in daily if d["readiness"] is not None]
        biggest_drop = min([p for p in pa_list if p["readiness_first_last"] is not None],
                           key=lambda x: x["readiness_first_last"], default=None)
        most_stable = min([p for p in pa_list if p["readiness_std"] is not None and p["days_monitored"] >= 2],
                          key=lambda x: x["readiness_std"], default=None)
        readiness_section = {
            "avg": overall["readiness"],
            "by_team": [{"label": t["label"], "value": t["readiness"]} for t in team_metrics],
            "by_day": [{"date": d["date"], "value": d["readiness"]} for d in daily],
            "best_day": max(r_days_valid, key=lambda x: x["readiness"], default={}).get("date") if r_days_valid else None,
            "worst_day": min(r_days_valid, key=lambda x: x["readiness"], default={}).get("date") if r_days_valid else None,
            "zones": {"good": len(good), "attention": len(attention), "risk": len(risk)},
            "pct_below": _round(100 * len(risk) / n_ath, 0) if n_ath else None,
            "trend_first": r_days_valid[0]["readiness"] if r_days_valid else None,
            "trend_last": r_days_valid[-1]["readiness"] if r_days_valid else None,
            "biggest_drop": {"name": biggest_drop["name"], "value": biggest_drop["readiness_first_last"]} if biggest_drop else None,
            "most_stable": {"name": most_stable["name"], "value": most_stable["readiness_std"]} if most_stable else None,
            "top": rank("readiness"),
            "bottom": rank("readiness", reverse=False),
            "low_persistent": [{"id": p["id"], "name": p["name"], "team": p["team"], "value": p["readiness"]}
                               for p in risk if p["days_monitored"] >= max(2, num_days // 2)],
        }

        # ---------- Pain ----------
        region_counts = {}
        for p in pain_events:
            if p["level"] > 0:
                lbl = REGION_LABELS.get(p["region"], p["region"])
                region_counts[lbl] = region_counts.get(lbl, 0) + 1
        pain_ath_ids = {p["athlete_id"] for p in pain_events if p["level"] > 0}
        recurrent = [p for p in pa_list if p["pain_days"] >= 2]
        intense = [p for p in pa_list if p["max_pain"] >= PAIN_INTENSE]
        pain_by_day = []
        for d in dates:
            lv = [p["level"] for p in pain_events if p["date"] == d and p["level"] > 0]
            pain_by_day.append({"date": d, "avg": _mean(lv), "reports": len(lv),
                                "athletes": len({p["athlete_id"] for p in pain_events if p["date"] == d and p["level"] > 0})})
        # Body-map aggregation (per anatomical region code) + detailed complaint log
        region_agg = {}
        for p in pain_events:
            if p["level"] > 0:
                code = p["region"]
                agg = region_agg.setdefault(code, {"count": 0, "levels": [], "aths": set()})
                agg["count"] += 1
                agg["levels"].append(p["level"])
                agg["aths"].add(p["athlete_id"])
        body_map = sorted(
            [{"region": code, "label": REGION_LABELS.get(code, code),
              "count": v["count"], "avg": _mean(v["levels"]), "athletes": len(v["aths"])}
             for code, v in region_agg.items()],
            key=lambda x: x["count"], reverse=True,
        )
        complaints = []
        for p in sorted([p for p in pain_events if p["level"] > 0],
                        key=lambda x: (x.get("date") or "", x["level"]), reverse=True):
            a = amap.get(p["athlete_id"], {})
            complaints.append({
                "name": a.get("name", "Unknown"),
                "team": team_key(a.get("team")),
                "region": REGION_LABELS.get(p["region"], p["region"]),
                "laterality": p.get("laterality"),
                "level": p["level"],
                "date": p.get("date"),
                "source": p.get("source"),
            })
        pain_section = {
            "total_reports": sum(1 for p in pain_events if p["level"] > 0),
            "athletes_reporting": len(pain_ath_ids),
            "prevalence": _round(100 * len(pain_ath_ids) / n_ath, 0) if n_ath else None,
            "avg_pain": _mean([p["level"] for p in pain_events if p["level"] > 0]),
            "by_team": [{"label": t["label"], "value": t["avg_pain"], "prevalence": t["pain_prevalence"]} for t in team_metrics],
            "by_day": pain_by_day,
            "regions": sorted([{"region": k, "count": v} for k, v in region_counts.items()],
                              key=lambda x: x["count"], reverse=True),
            "body_map": body_map,
            "complaints": complaints[:300],
            "recurrent": [{"id": p["id"], "name": p["name"], "team": p["team"], "days": p["pain_days"]} for p in recurrent],
            "intense": [{"id": p["id"], "name": p["name"], "team": p["team"], "max": p["max_pain"]} for p in intense],
        }

        # ---------- Training load ----------
        loads_by_day = [d["load"] for d in daily if d["load"] is not None]
        monotony = None
        strain = None
        total_load = overall["total_load"]
        if len([l for l in loads_by_day if l]) >= 3:
            sd = pstdev(loads_by_day)
            if sd and sd > 0:
                monotony = _round(mean(loads_by_day) / sd, 2)
                if total_load and monotony:
                    strain = _round(total_load * monotony, 0)
        valid_load_days = [d for d in daily if d["load"] is not None]
        load_section = {
            "total": total_load,
            "avg_per_day": _mean(loads_by_day, 0) if loads_by_day else None,
            "avg_per_athlete": overall["load_per_athlete"],
            "by_team": [{"label": t["label"], "total": t["total_load"], "per_athlete": t["load_per_athlete"]} for t in team_metrics],
            "by_day": [{"date": d["date"], "load": d["load"]} for d in daily],
            "peak_day": max(valid_load_days, key=lambda x: x["load"], default={}).get("date") if valid_load_days else None,
            "low_day": min(valid_load_days, key=lambda x: x["load"], default={}).get("date") if valid_load_days else None,
            "monotony": monotony,
            "strain": strain,
            "top": rank("total_load"),
            "readiness_vs_load": [{"date": d["date"], "readiness": d["readiness"], "load": d["load"]} for d in daily],
        }

        # ---------- Recovery ----------
        rec_days_valid = [d for d in daily if d["recovery"] is not None]
        rec_expected = n_ath * num_days
        rec_actual = len(rec_by_ad)
        # Recovery proof submission report (who uploaded a proof vs who didn't)
        proof_by_ath = {}
        for r in recovery:
            if r.get("file_id") or r.get("has_proof"):
                proof_by_ath[r["athlete_id"]] = proof_by_ath.get(r["athlete_id"], 0) + 1
        proofs_submitted = sorted(
            [{"id": a["id"], "name": a["name"], "team": team_key(a.get("team")),
              "count": proof_by_ath[a["id"]]} for a in athletes if a["id"] in proof_by_ath],
            key=lambda x: x["count"], reverse=True,
        )
        proofs_missing = [{"id": a["id"], "name": a["name"], "team": team_key(a.get("team"))}
                          for a in athletes if a["id"] not in proof_by_ath]
        recovery_section = {
            "avg": overall["recovery"],
            "target": recovery_target,
            "by_team": [{"label": t["label"], "value": t["recovery"]} for t in team_metrics],
            "by_day": [{"date": d["date"], "value": d["recovery"]} for d in daily],
            "total_points": sum(rec_by_ad.values()),
            "compliance": _round(100 * rec_actual / rec_expected, 0) if rec_expected else None,
            "best_day": max(rec_days_valid, key=lambda x: x["recovery"], default={}).get("date") if rec_days_valid else None,
            "worst_day": min(rec_days_valid, key=lambda x: x["recovery"], default={}).get("date") if rec_days_valid else None,
            "top": rank("recovery"),
            "bottom": rank("recovery", reverse=False, filt=lambda p: p["recovery_days"] > 0),
            "proofs": {
                "submitted": proofs_submitted,
                "not_submitted": proofs_missing,
                "submitted_count": len(proofs_submitted),
                "not_submitted_count": len(proofs_missing),
                "proof_rate": _round(100 * len(proofs_submitted) / n_ath, 0) if n_ath else None,
            },
        }

        # ---------- Availability & Risk ----------
        def athlete_risk(p):
            factors = []
            if p["readiness"] is not None and p["readiness"] <= READINESS_RISK:
                factors.append("Low readiness")
            if p["max_pain"] >= PAIN_INTENSE:
                factors.append("High pain")
            elif p["pain_days"] >= 2:
                factors.append("Recurrent pain")
            if p["recovery"] is not None and p["recovery"] < recovery_target * 0.5:
                factors.append("Low recovery")
            if p["sleep"] is not None and p["sleep"] <= READINESS_RISK:
                factors.append("Low sleep")
            if p["fatigue"] is not None and p["fatigue"] >= 7:
                factors.append("High fatigue")
            if p["stress"] is not None and p["stress"] >= 7:
                factors.append("High stress")
            if p["alerts_red"] > 0:
                factors.append("Red alerts")
            n = len(factors)
            if n == 0:
                level = "green"
            elif n == 1:
                level = "yellow"
            elif n == 2:
                level = "orange"
            else:
                level = "red"
            return level, factors

        risk_rows = []
        risk_dist = {"green": 0, "yellow": 0, "orange": 0, "red": 0}
        for p in pa_list:
            lvl, factors = athlete_risk(p)
            risk_dist[lvl] += 1
            if lvl != "green":
                risk_rows.append({"id": p["id"], "name": p["name"], "team": p["team"],
                                  "level": lvl, "factors": factors})
        risk_rows.sort(key=lambda x: {"red": 0, "orange": 1, "yellow": 2}.get(x["level"], 3))
        availability = {
            "distribution": risk_dist,
            "no_alerts": risk_dist["green"],
            "availability_pct": _round(100 * risk_dist["green"] / n_ath, 0) if n_ath else None,
            "attention_rows": risk_rows,
            "high_risk_days": sorted(
                [{"date": d["date"], "alerts": d["alerts"], "with_pain": d["athletes_with_pain"]} for d in daily],
                key=lambda x: (x["alerts"], x["with_pain"]), reverse=True
            )[:3],
        }

        # ---------- Rankings / profiles / insights / quality / summary / recs ----------
        rankings = build_rankings(pa_list, rank)
        team_profiles = build_team_profiles(team_metrics, recovery_target)
        insights = build_insights(compliance, readiness_section, team_metrics, pain_section,
                                  load_section, recovery_section, availability, daily,
                                  num_days, actual_total, expected_total, recovery_target)
        data_quality = build_data_quality(pa_list, daily, compliance, len(sessions),
                                          len(approved_recovery), pain_section)
        executive_summary = build_executive_summary(start, end, n_ath, num_days, teams, compliance,
                                                     overall, team_metrics, pain_section,
                                                     readiness_section, actual_total)
        recommendations = build_recommendations(pain_section)

        return {
            "meta": {
                "start_date": start, "end_date": end, "num_days": num_days,
                "team_filter": team or "all", "athlete_filter": athlete_id,
                "generated_at": local_now().isoformat(),
                "organization": "Brazil Lacrosse",
                "teams": [{"label": t["label"], "value": t["value"], "count": len(t["athlete_ids"])} for t in teams],
            },
            "header": {
                "athletes": n_ath, "teams": len(teams), "days": num_days,
                "expected_checkins": expected_total, "actual_checkins": actual_total,
                "adherence": compliance["rate"],
                "pain_reports": pain_section["total_reports"],
                "training_records": len(sessions),
                "recovery_records": len(approved_recovery),
                "alerts": len(alerts),
            },
            "kpis": overall,
            "executive_summary": executive_summary,
            "daily": daily,
            "team_comparison": team_metrics,
            "team_profiles": team_profiles,
            "compliance": compliance,
            "readiness": readiness_section,
            "pain": pain_section,
            "load": load_section,
            "recovery": recovery_section,
            "availability": availability,
            "rankings": rankings,
            "insights": insights,
            "recommendations": recommendations,
            "data_quality": data_quality,
            "athletes": pa_list,
        }

    @api_router.get("/staff/event-report")
    async def event_report(
        start_date: str = Query(...),
        end_date: str = Query(...),
        team: Optional[str] = None,
        athlete_id: Optional[str] = None,
        event_id: Optional[str] = None,
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        event = None
        archive_event_id = None
        if event_id:
            event = await db.events.find_one({"id": event_id}, {"_id": 0})
            if event:
                start_date = event.get("start_date", start_date)
                end_date = event.get("end_date", end_date)
                if not team and event.get("team"):
                    team = event["team"]
                if event.get("archived"):
                    archive_event_id = event["id"]
        report = await build_report(start_date, end_date, team, athlete_id, archive_event_id)
        if event:
            report["meta"]["event_name"] = event.get("name")
            report["meta"]["event_type"] = event.get("event_type")
            report["meta"]["archived"] = bool(event.get("archived"))
        return report

    @api_router.get("/staff/event-report/athlete/{aid}")
    async def event_report_athlete(
        aid: str,
        start_date: str = Query(...),
        end_date: str = Query(...),
        current_user: dict = Depends(get_current_user),
    ):
        _require_staff(current_user)
        report = await build_report(start_date, end_date, None, aid)
        athletes = report.get("athletes", [])
        if not athletes:
            raise HTTPException(status_code=404, detail="No data for this athlete in the selected period")
        a = athletes[0]
        # individual auto summary
        parts = [
            f"During the event, {a['name']} completed {a['compliance']}% of check-ins"
            if a["compliance"] is not None else f"{a['name']} had no check-ins recorded",
        ]
        if a["readiness"] is not None:
            parts.append(f"with an average readiness of {a['readiness']}/10")
        if a["total_load"]:
            parts.append(f"and accumulated {a['total_load']} AU of internal load")
        summary = ", ".join(parts) + "."
        if a["pain_reports"]:
            top_region = max(a["pain_regions"].items(), key=lambda x: x[1])[0] if a["pain_regions"] else "unspecified"
            summary += f" {a['pain_reports']} pain report(s) were logged, mainly in {top_region}."
        a["summary"] = summary
        return {"athlete": a, "meta": report["meta"]}

    ARCHIVE_COLLECTIONS = [
        "daily_readiness", "training_sessions", "recovery_logs",
        "recovery_checks", "alerts",
    ]

    @api_router.get("/staff/archive/live-counts")
    async def archive_live_counts(current_user: dict = Depends(get_current_user)):
        """Return the number of live monitoring records per collection (Admin)."""
        if current_user.get("user", {}).get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        counts = {c: await db[c].count_documents({}) for c in ARCHIVE_COLLECTIONS}
        counts["total"] = sum(counts.values())
        return counts

    @api_router.post("/staff/archive-collection")
    async def archive_collection(payload: dict, current_user: dict = Depends(get_current_user)):
        """Archive all current monitoring data under a named event and zero the
        live app for a new collection period (Admin only).

        Moves every record from the live monitoring collections into their
        ``*_archive`` counterparts, tagged with the new event id, then clears
        the live collections. Athlete profiles / roster are untouched.
        """
        import uuid
        if current_user.get("user", {}).get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")

        event_name = (payload.get("event_name") or "").strip()
        confirm = (payload.get("confirm_name") or "").strip()
        if not event_name:
            raise HTTPException(status_code=400, detail="event_name is required")
        if confirm != event_name:
            raise HTTPException(status_code=400, detail="Confirmation name does not match the event name")

        start_date = (payload.get("start_date") or "").strip()
        end_date = (payload.get("end_date") or "").strip()
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date are required")

        live_total = 0
        for c in ARCHIVE_COLLECTIONS:
            live_total += await db[c].count_documents({})
        if live_total == 0:
            raise HTTPException(status_code=400, detail="There is no live data to archive")

        eid = str(uuid.uuid4())
        now_iso = local_now().isoformat()
        counts = {}
        for c in ARCHIVE_COLLECTIONS:
            docs = await db[c].find({}).to_list(200000)
            moved = 0
            if docs:
                for d in docs:
                    d.pop("_id", None)
                    d["archived_event_id"] = eid
                    d["archived_at"] = now_iso
                await db[f"{c}_archive"].insert_many(docs)
                await db[c].delete_many({})
                moved = len(docs)
            counts[c] = moved

        event_doc = {
            "id": eid,
            "name": event_name,
            "event_type": "training_camp",
            "team": None,
            "start_date": start_date,
            "end_date": end_date,
            "description": "Archived data collection period",
            "archived": True,
            "archived_at": now_iso,
            "record_counts": counts,
            "created_by": current_user.get("user", {}).get("id"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True,
        }
        await db.events.insert_one(event_doc)
        logger.info("Archived %s records into event '%s' (%s)", sum(counts.values()), event_name, eid)
        return {
            "success": True,
            "event_id": eid,
            "event_name": event_name,
            "counts": counts,
            "total": sum(counts.values()),
        }
