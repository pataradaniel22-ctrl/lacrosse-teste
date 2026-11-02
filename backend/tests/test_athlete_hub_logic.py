"""Athlete Hub rules (runs without a server).

    cd backend && python3 -m unittest tests.test_athlete_hub_logic
"""
import unittest
from datetime import date

import athlete_hub_logic as L


def field(key):
    return next(f for f in L.default_fields() if f["key"] == key)


class VisibilityTests(unittest.TestCase):
    def test_roles(self):
        cpf = field("cpf_number")
        passport = field("passport_status")
        notes = field("staff_notes")
        self.assertTrue(L.can_see(cpf, "Admin", "staff"))
        self.assertFalse(L.can_see(cpf, "Coach", "staff"))
        self.assertTrue(L.can_see(passport, "Coach", "staff"))
        self.assertFalse(L.can_see(passport, "Research", "staff"))
        self.assertTrue(L.can_see(cpf, None, "athlete"))      # athletes see their own CPF
        self.assertFalse(L.can_see(notes, None, "athlete"))   # but not staff notes

    def test_visible_values(self):
        vals = {"cpf_number": "123", "passport_status": "Valid", "address": "x"}
        out = L.visible_values(vals, L.default_fields(), "Physio", "staff")
        self.assertEqual(out, {"passport_status": "Valid"})


class ValueTests(unittest.TestCase):
    def test_select_case_insensitive(self):
        self.assertEqual(L.clean_value(field("passport_status"), "expired"), "Expired")
        self.assertEqual(L.clean_value(field("dues_2026"), "Paid Half (1 of 2 × $60)"), "Paid Half")
        with self.assertRaises(L.ConfigError):
            L.clean_value(field("passport_status"), "Lost")

    def test_dates_phone_email(self):
        self.assertEqual(L.clean_value(field("birth_date"), "2001-08-01 00:00:00"), "2001-08-01")
        self.assertEqual(L.clean_value(field("birth_date"), "01/08/2001"), "2001-08-01")
        self.assertEqual(L.clean_value(field("phone"), "9529134971.0"), "9529134971")
        self.assertEqual(L.clean_value(field("contact_email"), " A@B.com "), "a@b.com")
        self.assertIsNone(L.clean_value(field("phone"), "  "))
        with self.assertRaises(L.ConfigError):
            L.clean_value(field("contact_email"), "nope")

    def test_age_and_alerts(self):
        today = date(2026, 11, 2)
        self.assertEqual(L.age_on("2001-08-01", today), 25)
        self.assertEqual(L.age_on("2001-12-01", today), 24)
        exp = field("passport_expiry")
        self.assertEqual(L.date_alert(exp, "2026-10-01", today), "expired")
        self.assertEqual(L.date_alert(exp, "2027-02-01", today), "soon")
        self.assertIsNone(L.date_alert(exp, "2028-02-01", today))

    def test_missing(self):
        m = L.missing_items({"first_name": "A"}, {}, L.default_fields(), L.default_doc_types())
        keys = {x["key"] for x in m}
        self.assertIn("passport_status", keys)
        self.assertIn("safeguarding_certificate", keys)
        self.assertNotIn("first_name", keys)
        m2 = L.missing_items({}, {"safeguarding_certificate": 1}, [], L.default_doc_types())
        self.assertEqual(m2, [])

    def test_prefill(self):
        self.assertEqual(L.prefill_from_athlete({"name": " Trevor Lucas Santos Hall ", "email": "T@x.com"}),
                         {"first_name": "Trevor", "last_name": "Lucas Santos Hall", "contact_email": "t@x.com"})


class ConfigTests(unittest.TestCase):
    def test_defaults_roundtrip(self):
        out = L.validate_fields(L.default_fields())
        self.assertEqual([f["key"] for f in out], [f["key"] for f in L.default_fields()])
        self.assertTrue(all(f["builtin"] for f in out))

    def test_custom_field(self):
        out = L.validate_fields([{"label": "Jersey size", "type": "select", "options": [{"value": "M", "tone": "blue"}, {"value": "M"}, {"value": "L", "tone": "pink"}]}])
        f = out[0]
        self.assertEqual(f["key"], "jersey_size")
        self.assertEqual([o["value"] for o in f["options"]], ["M", "L"])
        self.assertEqual(f["options"][1]["tone"], "gray")
        self.assertFalse(f["builtin"])

    def test_bad_config(self):
        with self.assertRaises(L.ConfigError):
            L.validate_fields([{"label": "X", "type": "select", "options": []}])
        with self.assertRaises(L.ConfigError):
            L.validate_fields([{"label": ""}])
        with self.assertRaises(L.ConfigError):
            L.validate_doc_types([{"label": "x" * 61}])


if __name__ == "__main__":
    unittest.main()
