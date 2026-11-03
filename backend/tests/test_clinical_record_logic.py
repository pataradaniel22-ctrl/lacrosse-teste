"""Clinical Record rules (runs without a server).

    cd backend && python3 -m unittest tests.test_clinical_record_logic
"""
import unittest
from datetime import date

import clinical_record_logic as C

TODAY = date(2026, 11, 2)


class EntryTests(unittest.TestCase):
    def test_retroactive_date_ok_future_rejected(self):
        e = C.clean_entry({"title": "Ankle sprain", "occurred_on": "2026-10-20", "occurred_time": "17:30"}, TODAY)
        self.assertEqual(e["occurred_on"], "2026-10-20")
        self.assertEqual(e["occurred_time"], "17:30")
        with self.assertRaises(C.EntryError):
            C.clean_entry({"title": "x", "occurred_on": "2026-11-03"}, TODAY)
        self.assertEqual(C.clean_entry({"body": "x"}, TODAY)["occurred_on"], "2026-11-02")

    def test_soap_and_required_content(self):
        e = C.clean_entry({"soap": {"s": "Pain on landing", "o": "", "a": "Grade I", "p": "Ice"}}, TODAY)
        self.assertEqual(e["soap"]["a"], "Grade I")
        with self.assertRaises(C.EntryError):
            C.clean_entry({"soap": {"s": " "}}, TODAY)

    def test_validation(self):
        for bad in ({"body": "x", "pain": 11}, {"body": "x", "availability": "Maybe"}, {"body": "x", "occurred_time": "25:00"},
                    {"body": "x", "entry_type": "Surgery?"}, {"body": "x", "follow_up_on": "tomorrow"}):
            with self.assertRaises(C.EntryError):
                C.clean_entry(bad, TODAY)
        self.assertEqual(C.clean_entry({"body": "x", "category": "Weird"}, TODAY)["category"], "Other")

    def test_partial_and_diff(self):
        old = {"title": "A", "pain": 3, "body": "x"}
        new = C.clean_entry({"pain": 5}, TODAY, partial=True)
        self.assertEqual(new, {"pain": 5})
        self.assertEqual(C.diff(old, new), {"pain": 3})
        self.assertEqual(C.diff(old, {"pain": 3}), {})


class AccessTests(unittest.TestCase):
    def test_visibility(self):
        conf = {"confidential": True, "author_id": "coach1"}
        self.assertTrue(C.can_see_entry(conf, "Physio", "p"))
        self.assertTrue(C.can_see_entry(conf, "Admin", "a"))
        self.assertFalse(C.can_see_entry(conf, "Coach", "c2"))
        self.assertTrue(C.can_see_entry(conf, "Coach", "coach1"))
        self.assertFalse(C.can_see_entry({}, "Research", "r"))
        self.assertFalse(C.can_see_entry({"deleted_at": "x"}, "Admin", "a"))

    def test_edit(self):
        self.assertTrue(C.can_edit_entry({"author_id": "u1"}, "Coach", "u1"))
        self.assertFalse(C.can_edit_entry({"author_id": "u1"}, "Physio", "u2"))
        self.assertTrue(C.can_edit_entry({"author_id": "u1"}, "Admin", "u2"))
        self.assertFalse(C.can_edit_entry({}, "Coach", None))


class FollowUpTests(unittest.TestCase):
    def test_status(self):
        self.assertEqual(C.follow_up_status({"follow_up_on": "2026-10-30"}, TODAY), "overdue")
        self.assertEqual(C.follow_up_status({"follow_up_on": "2026-11-05"}, TODAY), "due")
        self.assertEqual(C.follow_up_status({"follow_up_on": "2026-12-05"}, TODAY), "planned")
        self.assertIsNone(C.follow_up_status({"follow_up_on": "2026-10-30", "follow_up_done": True}, TODAY))

    def test_legacy(self):
        e = C.normalise_legacy({"body": "old", "created_at": "2026-07-01T10:00:00-03:00"})
        self.assertEqual(e["occurred_on"], "2026-07-01")
        self.assertEqual(e["entry_type"], "Note")


if __name__ == "__main__":
    unittest.main()
