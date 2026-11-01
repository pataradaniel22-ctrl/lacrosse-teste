"""Unit tests for iir_logic (no server or database needed).

Run: python -m pytest backend/tests/test_iir_logic.py   (or python -m unittest)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import iir_logic as L  # noqa: E402


def inj(**kw):
    base = {"kind": "injury", "status": "open"}
    base.update(kw)
    return base


class TestDates(unittest.TestCase):
    def test_excel_serial_rejected(self):
        with self.assertRaises(ValueError):
            L.parse_date(0)
        with self.assertRaises(ValueError):
            L.parse_date(46000.0)

    def test_out_of_range(self):
        with self.assertRaises(ValueError):
            L.parse_date("1899-12-30")

    def test_end_before_start_blocked(self):
        errs = L.date_errors(inj(date_of_injury="2026-10-10", actual_rtp_date="2026-10-01"))
        self.assertTrue(any(e["field"] == "actual_rtp_date" for e in errs))


class TestTimeLoss(unittest.TestCase):
    def test_medical_attention_only(self):
        ep = inj(date_of_injury="2026-10-04", time_loss="no")
        self.assertEqual(L.effective_time_loss(ep)["state"], "not_applicable")

    def test_estimated_never_replaces_actual_and_no_zero(self):
        ep = inj(date_of_injury="2026-10-04", time_loss="yes", unavailability_start="2026-10-04",
                 estimated_rtp_date="2026-10-10")
        r = L.effective_time_loss(ep, cutoff="2026-10-07")
        self.assertEqual(r["state"], "provisional")
        self.assertEqual(r["value"], 3)
        self.assertIsNone(L.compat_time_loss_days(ep)["value"])

    def test_same_day_return_is_zero(self):
        ep = inj(date_of_injury="2026-10-04", time_loss="yes", unavailability_start="2026-10-04",
                 full_return_date="2026-10-04", actual_rtp_date="2026-10-04")
        r = L.effective_time_loss(ep)
        self.assertEqual((r["value"], r["state"]), (0, "zero"))
        self.assertEqual(L.compat_time_loss_days(ep)["value"], 0)

    def test_closed_without_return_is_unknown(self):
        ep = inj(date_of_injury="2026-10-04", time_loss="yes", unavailability_start="2026-10-04",
                 status="closed")
        self.assertEqual(L.effective_time_loss(ep)["state"], "unknown")

    def test_not_filled_vs_unknown(self):
        self.assertEqual(L.effective_time_loss(inj())["state"], "not_filled")
        self.assertEqual(L.effective_time_loss(inj(time_loss="unknown"))["state"], "unknown")

    def test_compat_formula(self):
        ep = inj(date_of_injury="2026-10-04", actual_rtp_date="2026-10-05")
        self.assertEqual(L.compat_time_loss_days(ep)["value"], 1)

    def test_imputed_start(self):
        ep = inj(date_of_injury="2026-10-04", time_loss="yes", full_return_date="2026-10-09")
        r = L.effective_time_loss(ep)
        self.assertEqual(r["value"], 5)
        self.assertTrue(r["start_imputed"])


class TestUniqueDays(unittest.TestCase):
    def test_overlapping_episodes_not_double_counted(self):
        a = inj(id="a", time_loss="yes", unavailability_start="2026-10-01", full_return_date="2026-10-11")
        b = {"kind": "illness", "id": "b", "status": "open", "time_loss": "yes",
             "unavailability_start": "2026-10-05", "full_return_date": "2026-10-15"}
        r = L.unique_unavailable_days([a, b])
        self.assertEqual(r["days"], 14)  # Oct 1..14 (return on 15th not counted)
        self.assertFalse(r["provisional"])

    def test_provisional_open(self):
        a = inj(time_loss="yes", unavailability_start="2026-10-01")
        r = L.unique_unavailable_days([a], cutoff="2026-10-03")
        self.assertEqual(r["days"], 3)
        self.assertTrue(r["provisional"])


class TestParticipation(unittest.TestCase):
    def test_closing_one_does_not_release(self):
        a = inj(id="a", status="closed", participation="full")
        b = {"kind": "illness", "id": "b", "status": "open", "participation": "unavailable"}
        r = L.current_participation([a, b])
        self.assertEqual(r["participation"], "unavailable")
        self.assertEqual(r["drivers"], ["b"])

    def test_no_active(self):
        self.assertEqual(L.current_participation([])["participation"], "full")


class TestQuality(unittest.TestCase):
    def test_recurrent_requires_link_or_limitation(self):
        q = L.quality_issues(inj(classification="recurrent"))
        self.assertTrue(any("linked previous episode" in w for w in q["warnings"]))
        q2 = L.quality_issues(inj(classification="recurrent", prior_full_recovery="history_unavailable"))
        self.assertFalse(any("linked previous episode" in w for w in q2["warnings"]))

    def test_contact_inconsistency(self):
        q = L.quality_issues(inj(mechanism="non_contact", source="stick"))
        self.assertTrue(q["warnings"])


class TestRates(unittest.TestCase):
    def test_not_calculable(self):
        self.assertIsNone(L.rate_per_1000(3, 0))
        self.assertIsNone(L.rate_per_1000(3, None))
        self.assertEqual(L.rate_per_1000(9, 121.6), 74.01)

    def test_individual_beats_collective(self):
        s = [{"id": "s1", "context": "game", "individual": [{"athlete_id": "a", "minutes": 30},
                                                             {"athlete_id": "b", "minutes": 30}],
              "collective": {"athletes": 20, "minutes_each": 32, "method": "roster x duration"}},
             {"id": "s2", "context": "game", "collective": {"athletes": 10, "minutes_each": 30, "method": "est"}}]
        r = L.merge_exposure_records(s)
        self.assertEqual(r["hours"]["game"], 6.0)  # 1h individual + 5h estimated
        self.assertEqual(len(r["estimates"]), 1)


if __name__ == "__main__":
    unittest.main()
