"""Tests for Notification Center: athlete custom reminders + staff notifications."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://performance-fueling.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

STAFF_EMAIL = "cristina.velez@brasillacrosse.com"
STAFF_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"


def _login(email, password, user_type):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password, "user_type": user_type}, timeout=30)
    assert r.status_code == 200, f"login {user_type} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def staff_token():
    return _login(STAFF_EMAIL, STAFF_PASSWORD, "staff")


@pytest.fixture(scope="module")
def athlete_token():
    return _login(ATHLETE_EMAIL, ATHLETE_PASSWORD, "athlete")


@pytest.fixture(scope="module")
def h_staff(staff_token):
    return {"Authorization": f"Bearer {staff_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def h_ath(athlete_token):
    return {"Authorization": f"Bearer {athlete_token}", "Content-Type": "application/json"}


# ---- Cleanup tracking ----
_created_reminders = []
_created_notifs = []


# ================= Athlete Custom Reminders =================
class TestCustomReminders:
    def test_create_reminder(self, h_ath):
        payload = {"title": "TEST_Hydrate", "body": "Drink water", "time": "08:30",
                   "days": [0, 2, 4], "url": "/athlete/nutrition", "enabled": True}
        r = requests.post(f"{API}/notifications/reminders", json=payload, headers=h_ath, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"] == "TEST_Hydrate"
        assert data["time"] == "08:30"
        assert data["days"] == [0, 2, 4]
        assert "id" in data
        _created_reminders.append(data["id"])

    def test_list_reminders(self, h_ath):
        r = requests.get(f"{API}/notifications/reminders", headers=h_ath, timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert any(x["id"] == _created_reminders[0] for x in items)

    def test_update_reminder(self, h_ath):
        rid = _created_reminders[0]
        payload = {"title": "TEST_Hydrate_Updated", "body": "Drink more water", "time": "09:00",
                   "days": [], "url": "/athlete", "enabled": False}
        r = requests.put(f"{API}/notifications/reminders/{rid}", json=payload, headers=h_ath, timeout=30)
        assert r.status_code == 200, r.text
        # Verify via GET
        items = requests.get(f"{API}/notifications/reminders", headers=h_ath, timeout=30).json()
        updated = next(x for x in items if x["id"] == rid)
        assert updated["title"] == "TEST_Hydrate_Updated"
        assert updated["time"] == "09:00"
        assert updated["enabled"] is False

    def test_staff_forbidden_on_reminders(self, h_staff):
        r = requests.get(f"{API}/notifications/reminders", headers=h_staff, timeout=30)
        assert r.status_code == 403
        r2 = requests.post(f"{API}/notifications/reminders",
                           json={"title": "x", "time": "08:00"}, headers=h_staff, timeout=30)
        assert r2.status_code == 403

    def test_delete_reminder(self, h_ath):
        rid = _created_reminders[0]
        r = requests.delete(f"{API}/notifications/reminders/{rid}", headers=h_ath, timeout=30)
        assert r.status_code == 200
        # Verify gone
        items = requests.get(f"{API}/notifications/reminders", headers=h_ath, timeout=30).json()
        assert not any(x["id"] == rid for x in items)


# ================= Staff Notifications =================
class TestStaffNotifications:
    def test_athlete_forbidden(self, h_ath):
        r = requests.post(f"{API}/staff/notifications",
                          json={"title": "x", "target_type": "all"}, headers=h_ath, timeout=30)
        assert r.status_code == 403

    def test_send_now_all(self, h_staff):
        payload = {"title": "TEST_All Now", "body": "Hello team", "target_type": "all"}
        r = requests.post(f"{API}/staff/notifications", json=payload, headers=h_staff, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "sent"
        assert data["target_count"] == 16, f"expected 16 approved athletes, got {data['target_count']}"
        assert "delivered_count" in data
        _created_notifs.append(data["id"])

    def test_send_now_specific_athletes(self, h_staff):
        # Get one athlete id
        r = requests.get(f"{API}/staff/athletes", headers=h_staff, timeout=30)
        assert r.status_code == 200
        athletes = r.json()
        assert len(athletes) > 0
        aid = athletes[0].get("id") or athletes[0].get("athlete_id")
        payload = {"title": "TEST_Specific", "target_type": "athletes", "target_athlete_ids": [aid]}
        r2 = requests.post(f"{API}/staff/notifications", json=payload, headers=h_staff, timeout=30)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data["status"] == "sent"
        assert data["target_count"] == 1
        _created_notifs.append(data["id"])

    def test_schedule_future_and_cancel(self, h_staff):
        payload = {"title": "TEST_Scheduled", "body": "Future push",
                   "target_type": "team", "target_team": "Brazil Lacrosse Men",
                   "scheduled_at": "2030-01-01T10:00:00Z"}
        r = requests.post(f"{API}/staff/notifications", json=payload, headers=h_staff, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "scheduled"
        nid = data["id"]
        _created_notifs.append(nid)
        # Cancel
        r2 = requests.delete(f"{API}/staff/notifications/{nid}", headers=h_staff, timeout=30)
        assert r2.status_code == 200
        # Verify in list
        items = requests.get(f"{API}/staff/notifications", headers=h_staff, timeout=30).json()
        cancelled = next(x for x in items if x["id"] == nid)
        assert cancelled["status"] == "cancelled"

    def test_cannot_cancel_sent(self, h_staff):
        # Use the first sent notification
        assert _created_notifs, "need a sent notif"
        sent_id = _created_notifs[0]
        r = requests.delete(f"{API}/staff/notifications/{sent_id}", headers=h_staff, timeout=30)
        assert r.status_code == 400

    def test_history_sorted(self, h_staff):
        r = requests.get(f"{API}/staff/notifications", headers=h_staff, timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 3
        # newest first
        created = [x["created_at"] for x in items]
        assert created == sorted(created, reverse=True)

    def test_analytics(self, h_staff):
        r = requests.get(f"{API}/staff/notifications/analytics", headers=h_staff, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["total_athletes", "active_subscribers", "coverage_pct",
                  "notifications_sent", "notifications_scheduled",
                  "total_delivered", "total_targeted", "delivery_rate_pct"]:
            assert k in data, f"missing {k}"
        assert data["total_athletes"] >= 16
        assert data["notifications_sent"] >= 2


# ================= Cleanup =================
def test_zzz_cleanup(h_staff, h_ath):
    """Clean up test data: staff notifications + any leftover reminders."""
    # Delete staff-created notifications directly via mongo would be ideal; use API where possible
    # Only 'scheduled' can be cancelled via API; sent ones will remain unless we hit DB
    # Reminders: leftover ones cleaned up
    items = requests.get(f"{API}/notifications/reminders", headers=h_ath, timeout=30).json()
    for r in items:
        if r.get("title", "").startswith("TEST_"):
            requests.delete(f"{API}/notifications/reminders/{r['id']}", headers=h_ath, timeout=30)
    print(f"Note: {len(_created_notifs)} test staff_notifications may remain (only 'scheduled' can be cancelled via API).")
