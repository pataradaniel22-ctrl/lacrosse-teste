"""Scenario tests for reports and exports (fictitious data, no database).

Covers the delivery criteria: medical-attention-only injury, open time-loss
injury with estimated return only, same-day return, recurrent illness linked to
a previous one, multi-region/multi-type injury, two simultaneous time-loss
episodes, case without exposure, pre-existing case, research export without
names, compatibility export with 30 + 21 columns.
"""
import io
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import iir_analytics as A  # noqa: E402
import iir_logic as L  # noqa: E402

ATH = {"a1": {"id": "a1", "name": "Fictitious Athlete One", "team": "W"},
       "a2": {"id": "a2", "name": "Fictitious Athlete Two", "team": "W"}}
ME = {"id": "u1", "name": "Dr Fictitious", "role": "Physio"}


def ep(id_, kind, athlete, **kw):
    base = {"id": id_, "kind": kind, "athlete_id": athlete, "participant_type": "athlete", "status": "open",
            "team": "W", "report_by": ME, "created_at": "2026-10-10T10:00:00", "updated_at": "2026-10-10T10:00:00"}
    base.update(kw)
    return base


EPISODES = [
    # 1. medical attention only (no time loss)
    ep("e1", "injury", "a1", date_of_injury="2026-10-10", activity="game", time_loss="no", mechanism="contact",
       source="stick", body_location=["facial"], injury_type=["laceration"], classification="new", status="closed",
       initial_diagnosis="Cut above the eye of Fictitious Athlete One"),
    # 2. open time-loss, only estimated return
    ep("e2", "injury", "a1", date_of_injury="2026-10-11", activity="training", time_loss="yes",
       unavailability_start="2026-10-11", estimated_rtp_date="2026-10-20", participation="unavailable",
       body_location=["ankle"], injury_type=["joint_sprain_ligament_tear"], classification="new"),
    # 3. same-day return
    ep("e3", "injury", "a2", date_of_injury="2026-10-11", activity="game", time_loss="yes",
       unavailability_start="2026-10-11", full_return_date="2026-10-11", actual_rtp_date="2026-10-11",
       body_location=["knee"], injury_type=["contusion_bruise"], classification="new", status="closed"),
    # 5. multi region / multi type
    ep("e5", "injury", "a2", date_of_injury="2026-10-12", activity="game", time_loss="no",
       body_location=["hand_finger_thumb", "forearm"], injury_type=["bone_fracture", "abrasion"],
       classification="exacerbation", linked_episode_id="e3", prior_full_recovery="no"),
    # 4. illness + recurrent illness linked
    ep("i1", "illness", "a2", date_of_onset="2026-09-01", time_loss="yes", unavailability_start="2026-09-01",
       full_return_date="2026-09-04", organ_system="respiratory_system", aetiology="infectious_disease",
       communicable="communicable", classification="new", status="closed"),
    ep("i2", "illness", "a2", date_of_onset="2026-10-12", time_loss="yes", unavailability_start="2026-10-12",
       full_return_date="2026-10-15", organ_system="respiratory_system", aetiology="infectious_disease",
       communicable="communicable", classification="recurrent", linked_episode_id="i1",
       prior_full_recovery="yes", status="closed"),
    # 6. simultaneous with e2 (same athlete a1)
    ep("i3", "illness", "a1", date_of_onset="2026-10-13", time_loss="yes", unavailability_start="2026-10-13",
       full_return_date="2026-10-16", organ_system="gastrointestinal", aetiology="infectious_disease",
       communicable="unknown", classification="new", status="closed"),
    # 8. pre-existing (before the event period, still open)
    ep("e8", "injury", "a1", date_of_injury="2026-09-20", activity="training", time_loss="yes",
       unavailability_start="2026-09-20", body_location=["posterior_thigh"],
       injury_type=["muscle_strain_rupture_tear"], classification="new"),
    # draft must be excluded
    ep("d1", "injury", "a1", status="draft"),
    # non-athlete
    {**ep("o1", "injury", None, date_of_injury="2026-10-11", activity="game", time_loss="no"),
     "participant_type": "other", "other_participant_name": "Fictitious Referee"},
]
SESSIONS = [
    {"id": "s1", "date": "2026-10-10", "context": "game", "team": "W",
     "individual": [{"athlete_id": "a1", "minutes": 32, "participation": "full"},
                    {"athlete_id": "a2", "minutes": 16, "participation": "partial"}]},
    {"id": "s2", "date": "2026-10-11", "context": "game", "team": "W",
     "collective": {"athletes": 12, "minutes_each": 32, "method": "roster × match duration"}},
]
FILTERS = {"from": "2026-10-10", "to": "2026-10-16", "cutoff": "2026-10-16"}


class TestReport(unittest.TestCase):
    def setUp(self):
        self.r = A.build_report(EPISODES, SESSIONS, [], FILTERS)

    def test_counts_and_preexisting(self):
        inj = self.r["injuries"]
        self.assertEqual(inj["episodes"], 5)  # e1,e2,e3,e5 + pre-existing e8; draft & non-athlete excluded
        self.assertEqual(inj["preexisting_in_follow_up"], 1)
        self.assertEqual(inj["incident_in_period"], 4)
        self.assertEqual(inj["athletes_affected"], 2)
        self.assertEqual(self.r["exclusions"]["non_athlete_participants"], 1)

    def test_multi_select_can_exceed_100(self):
        locs = self.r["injuries"]["body_location"]
        self.assertGreater(sum(x["count"] for x in locs if x["code"] != "__not_filled__"), self.r["injuries"]["episodes"])

    def test_rates(self):
        game = self.r["injuries"]["rates"]["game"]
        self.assertEqual(game["cases"], 3)  # e1, e3, e5
        self.assertAlmostEqual(game["exposure"], 0.8 + 6.4, places=2)  # 48min individual + 12×32 estimated
        self.assertTrue(game["calculable"])
        self.assertFalse(self.r["injuries"]["rates"]["training"]["calculable"])  # no training exposure
        self.assertEqual(len(self.r["exposure"]["collective_estimates_used"]), 1)

    def test_no_exposure_not_calculable(self):
        r = A.build_report(EPISODES, [], [], FILTERS)
        self.assertIsNone(r["injuries"]["rates"]["game"]["rate_per_1000"])
        self.assertIsNone(r["illnesses"]["rates"]["athlete_days"]["rate_per_1000"])

    def test_days(self):
        d = self.r["injuries"]["days"]
        self.assertEqual(d["not_applicable_medical_attention"], 2)  # e1, e5
        self.assertEqual(d["zero_day_episodes"], 1)  # e3
        self.assertEqual(d["open_episodes_provisional"], 2)  # e2, e8

    def test_unique_days_simultaneous(self):
        # a1: e8 (Sep 20 → cutoff) and e2/i3 overlap — counted once
        self.assertTrue(self.r["unique_unavailable_days"]["any_provisional"])


class TestExports(unittest.TestCase):
    def test_compat_columns(self):
        idt = A.Identity("identified", athletes=ATH)
        t = A.compat_tables([e for e in EPISODES if e["status"] != "draft"], idt)
        self.assertEqual(len(t["Team_Injuries"]["header"]), 30)
        self.assertEqual(len(t["Team_Illnesses"]["header"]), 21)
        self.assertEqual(t["Team_Injuries"]["header"][1], "Anynomous ID#")
        row = t["Team_Injuries"]["rows"][0]
        self.assertEqual(row[1], "Fictitious Athlete One")
        self.assertIn("No (Medical Attention Only)", row)
        ill = t["Team_Illnesses"]["rows"][0]
        self.assertIsNone(ill[20])  # no Actual RTP Date → never a fabricated value

    def test_compat_time_loss_formula(self):
        idt = A.Identity("identified", athletes=ATH)
        t = A.compat_tables([EPISODES[2]], idt)
        self.assertEqual(t["Team_Injuries"]["rows"][0][29], 0)

    def test_research_export_has_no_names(self):
        idt = A.Identity("pseudonymized", key="k" * 64, athletes=ATH)
        tabs = A.scientific_tables([e for e in EPISODES if e["status"] != "draft"], [], SESSIONS, [], idt)
        tabs.update(A.compat_tables([e for e in EPISODES if e["status"] != "draft"], idt, include_free_text=False))
        blob = repr(tabs)
        for name in ("Fictitious Athlete One", "Fictitious Athlete Two", "Dr Fictitious", "Fictitious Referee"):
            self.assertNotIn(name, blob)
        self.assertIn("P-", blob)

    def test_pseudonym_stable(self):
        a = A.Identity("pseudonymized", key="abc").person("a1")
        b = A.Identity("pseudonymized", key="abc").person("a1")
        self.assertEqual(a, b)

    def test_anonymized_month_dates(self):
        idt = A.Identity("anonymized", date_mode="month")
        self.assertEqual(idt.date("2026-10-11"), "2026-10")

    def test_writers(self):
        idt = A.Identity("identified", athletes=ATH)
        tabs = A.compat_tables(EPISODES[:3], idt)
        tabs.update(A.dictionary_tables())
        x = A.to_xlsx(tabs)
        self.assertTrue(x[:2] == b"PK")
        z = zipfile.ZipFile(io.BytesIO(A.to_csv_zip(tabs)))
        self.assertIn("Team_Injuries.csv", z.namelist())
        pdf = A.to_pdf(A.build_report(EPISODES, SESSIONS, [], FILTERS))
        self.assertTrue(pdf.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
