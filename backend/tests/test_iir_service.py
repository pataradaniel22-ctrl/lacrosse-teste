"""Permission and validation tests for iir_service (no server needed)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import iir_service as S  # noqa: E402


def user(user_type, role=None):
    return {"user_type": user_type, "user": {"id": "u", "role": role}}


class TestPermissions(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(S.access_level(user("staff", "Admin")), "clinical")
        self.assertEqual(S.access_level(user("staff", "Physio")), "clinical")
        self.assertEqual(S.access_level(user("staff", "Coach")), "coach")
        self.assertEqual(S.access_level(user("staff", "Research")), "research")
        self.assertIsNone(S.access_level(user("athlete")))

    def test_coach_and_research_cannot_record_or_see_clinical(self):
        for lvl in ("coach", "research", None):
            p = S.permissions(lvl)
            self.assertFalse(p["can_record"])
            self.assertFalse(p["can_view_clinical"])
            self.assertFalse(p["can_export_identified"])
        self.assertTrue(S.permissions("coach")["can_view_availability"])
        self.assertFalse(S.permissions("research")["can_view_availability"])
        self.assertTrue(S.permissions("research")["can_export_research"])

    def test_coach_view_hides_clinical_fields(self):
        ep = {"id": "e", "kind": "injury", "athlete_id": "a", "participation": "modified", "status": "open",
              "initial_diagnosis": "secret", "final_diagnosis": "secret", "treatment_notes": "secret",
              "body_location": ["knee"], "injury_type": ["concussion"], "additional_notes": "secret"}
        v = S.coach_view(ep)
        self.assertNotIn("secret", repr(v))
        self.assertNotIn("knee", repr(v))
        self.assertEqual(v["participation"], "modified")


class TestNormalize(unittest.TestCase):
    def test_group_titles_rejected(self):
        _, errors = S.normalize_episode({"occurrence": "pick_below_for_contact"}, "injury")
        self.assertTrue(errors)

    def test_calculated_field_ignored(self):
        clean, _ = S.normalize_episode({"compat_time_loss_days": 99}, "injury")
        self.assertNotIn("compat_time_loss_days", clean)

    def test_imaging_none_not_combined(self):
        _, errors = S.normalize_episode({"imaging": [{"modality": "none"}, {"modality": "mri"}]}, "injury")
        self.assertTrue(errors)

    def test_draft_needs_only_athlete(self):
        clean, errors = S.normalize_episode({"athlete_id": "a"}, "illness")
        clean["kind"] = "illness"
        self.assertEqual(errors, [])
        self.assertEqual(S.check_status_requirements(clean), [])

    def test_open_needs_date(self):
        clean, _ = S.normalize_episode({"athlete_id": "a", "status": "open"}, "illness")
        clean["kind"] = "illness"
        self.assertTrue(S.check_status_requirements(clean))


if __name__ == "__main__":
    unittest.main()
