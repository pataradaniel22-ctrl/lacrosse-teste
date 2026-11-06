"""Staff notification centre rules (runs without a server).

    cd backend && python3 -m unittest tests.test_staff_notifications_logic
"""
import unittest

import staff_notifications_logic as N

ALERTS = [
    {"id": "a1", "athlete_id": "x", "athlete_name": "Ana", "alert_type": "LOW_READINESS", "severity": "Yellow",
     "message": "Low readiness 2 days", "created_at": "2026-11-05T10:00:00+00:00"},
    {"id": "overload-x-2026-11-06", "athlete_id": "x", "athlete_name": "Ana", "type": "HIGH_LOAD_SPIKE", "severity": "Red",
     "message": "Load +70%", "created_at": "2026-11-06", "auto": True},
]
CONVS = [{"id": "c1", "athlete_name": "Bia", "is_pain_related": True, "last_message_at": "2026-11-06T12:00:00+00:00", "last_message_preview": "My knee"}]


class BuildTests(unittest.TestCase):
    def test_shapes_and_order(self):
        items = N.build_items(ALERTS, CONVS, follow_ups=[{"id": "n1", "athlete_id": "x", "athlete_name": "Ana", "follow_up_on": "2026-11-04", "status": "overdue"}])
        self.assertEqual([i["kind"] for i in items], ["message", "alert", "alert", "follow_up"])
        alert = next(i for i in items if i["ref"] == "a1")
        self.assertEqual(alert["title"], "Low readiness · Ana")
        self.assertEqual(alert["severity"], "yellow")
        self.assertTrue(alert["resolvable"])
        auto = next(i for i in items if i["ref"].startswith("overload"))
        self.assertFalse(auto["resolvable"])
        self.assertEqual(auto["severity"], "red")
        self.assertEqual(items[0]["severity"], "red")  # pain message
        self.assertEqual(items[-1]["severity"], "yellow")

    def test_new_message_in_same_conversation_is_new_item(self):
        a = N.build_items(conversations=[dict(CONVS[0])])[0]["id"]
        b = N.build_items(conversations=[dict(CONVS[0], last_message_at="2026-11-07T08:00:00+00:00")])[0]["id"]
        self.assertNotEqual(a, b)


class StateTests(unittest.TestCase):
    def test_unread_and_seen(self):
        items = N.build_items(ALERTS, CONVS)
        self.assertEqual(N.apply_state(items, None, [])["unread"], 3)
        st = N.apply_state(items, "2026-11-05T23:00:00+00:00", [])
        self.assertEqual(st["unread"], 2)          # message + today's overload
        self.assertEqual(st["red_unread"], 2)
        self.assertEqual(N.apply_state(items, "2026-11-07T00:00:00+00:00", [])["unread"], 0)

    def test_dismissed_hidden(self):
        items = N.build_items(ALERTS, CONVS)
        out = N.apply_state(items, None, ["alert:a1"])
        self.assertNotIn("alert:a1", [i["id"] for i in out["items"]])
        self.assertEqual(out["unread"], 2)


if __name__ == "__main__":
    unittest.main()
