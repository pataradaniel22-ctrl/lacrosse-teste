"""Backend tests for Web Push notification endpoints (/api/push/*) and scheduler."""
import os
import base64
import secrets
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:3000"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cristina.velez@brasillacrosse.com"
ADMIN_PASS = "123456"
ATHLETE_EMAIL = "ana.oliveira@email.com"
ATHLETE_PASS = "demo123"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(s, email, password):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def athlete_auth(http):
    data = _login(http, ATHLETE_EMAIL, ATHLETE_PASS)
    return {"token": data["token"], "headers": {"Authorization": f"Bearer {data['token']}"}}


@pytest.fixture(scope="module")
def staff_auth(http):
    data = _login(http, ADMIN_EMAIL, ADMIN_PASS)
    return {"token": data["token"], "headers": {"Authorization": f"Bearer {data['token']}"}}


def _b64(n):
    return base64.urlsafe_b64encode(secrets.token_bytes(n)).rstrip(b"=").decode()


def _fake_subscription(unique=False):
    suffix = uuid.uuid4().hex[:12] if unique else "fake-token"
    return {
        "endpoint": f"https://fcm.googleapis.com/fcm/send/{suffix}",
        "keys": {"p256dh": _b64(65), "auth": _b64(16)},
        "timezone": "America/Sao_Paulo",
    }


# Ensure cleanup before each test class run
@pytest.fixture(scope="module", autouse=True)
def cleanup_push(http, athlete_auth):
    http.delete(f"{API}/push/unsubscribe", headers=athlete_auth["headers"], timeout=10)
    yield
    http.delete(f"{API}/push/unsubscribe", headers=athlete_auth["headers"], timeout=10)


# ---------- VAPID public key (no auth) ----------
class TestVapidKey:
    def test_public_key_no_auth(self, http):
        r = http.get(f"{API}/push/vapid-public-key", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "public_key" in data
        assert isinstance(data["public_key"], str)
        assert len(data["public_key"]) > 30  # VAPID keys are ~87 chars base64url


# ---------- Auth gating ----------
class TestAuthGating:
    def test_preferences_no_auth(self, http):
        r = http.get(f"{API}/push/preferences", timeout=10)
        assert r.status_code in (401, 403)

    def test_preferences_staff_forbidden(self, http, staff_auth):
        r = http.get(f"{API}/push/preferences", headers=staff_auth["headers"], timeout=10)
        assert r.status_code == 403
        assert "athlete" in r.text.lower()

    def test_subscribe_staff_forbidden(self, http, staff_auth):
        r = http.post(
            f"{API}/push/subscribe",
            json=_fake_subscription(unique=True),
            headers=staff_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 403

    def test_unsubscribe_staff_forbidden(self, http, staff_auth):
        r = http.delete(f"{API}/push/unsubscribe", headers=staff_auth["headers"], timeout=10)
        assert r.status_code == 403

    def test_test_staff_forbidden(self, http, staff_auth):
        r = http.post(f"{API}/push/test", headers=staff_auth["headers"], timeout=10)
        assert r.status_code == 403


# ---------- Defaults + full lifecycle ----------
class TestPreferencesLifecycle:
    def test_defaults_when_no_subscription(self, http, athlete_auth):
        # cleanup already removed subs
        r = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["subscribed"] is False
        assert d["enabled"] is False
        assert d["morning_time"] == "08:00"
        assert d["evening_time"] == "21:00"
        assert d["recovery_time"] == "19:00"
        assert d["recovery_enabled"] is True
        assert d["timezone"] == "America/Sao_Paulo"

    def test_test_endpoint_400_when_no_subscription(self, http, athlete_auth):
        r = http.post(f"{API}/push/test", headers=athlete_auth["headers"], timeout=10)
        assert r.status_code == 400
        assert "subscription" in r.text.lower() or "inscri" in r.text.lower()

    def test_put_prefs_400_when_no_subscription(self, http, athlete_auth):
        r = http.put(
            f"{API}/push/preferences",
            json={"enabled": True, "morning_time": "08:00", "evening_time": "21:00",
                  "timezone": "America/Sao_Paulo"},
            headers=athlete_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 400

    def test_subscribe_creates_sub(self, http, athlete_auth):
        sub = _fake_subscription(unique=True)
        r = http.post(f"{API}/push/subscribe", json=sub, headers=athlete_auth["headers"], timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("subscribed") is True

        # Verify via GET
        g = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10).json()
        assert g["subscribed"] is True
        assert g["enabled"] is True
        assert g["morning_time"] == "08:00"
        assert g["evening_time"] == "21:00"
        assert g["recovery_time"] == "19:00"
        assert g["recovery_enabled"] is True

    def test_subscribe_twice_replaces_no_duplicate(self, http, athlete_auth):
        # Subscribe again with different endpoint
        sub2 = _fake_subscription(unique=True)
        r = http.post(f"{API}/push/subscribe", json=sub2, headers=athlete_auth["headers"], timeout=10)
        assert r.status_code == 200
        # Still 'subscribed' true; the implementation deletes old subs first
        g = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10).json()
        assert g["subscribed"] is True

    def test_put_prefs_updates_values(self, http, athlete_auth):
        r = http.put(
            f"{API}/push/preferences",
            json={
                "enabled": True,
                "morning_time": "07:30",
                "evening_time": "20:00",
                "recovery_enabled": True,
                "recovery_time": "18:30",
                "timezone": "America/Sao_Paulo",
            },
            headers=athlete_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 200, r.text
        g = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10).json()
        assert g["morning_time"] == "07:30"
        assert g["evening_time"] == "20:00"
        assert g["recovery_time"] == "18:30"
        assert g["recovery_enabled"] is True
        assert g["enabled"] is True

    def test_put_prefs_recovery_disable_persists(self, http, athlete_auth):
        r = http.put(
            f"{API}/push/preferences",
            json={
                "enabled": True,
                "morning_time": "07:30",
                "evening_time": "20:00",
                "recovery_enabled": False,
                "recovery_time": "18:30",
                "timezone": "America/Sao_Paulo",
            },
            headers=athlete_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 200, r.text
        g = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10).json()
        assert g["recovery_enabled"] is False
        assert g["recovery_time"] == "18:30"

    def test_put_prefs_disable_persists(self, http, athlete_auth):
        r = http.put(
            f"{API}/push/preferences",
            json={"enabled": False, "morning_time": "07:30", "evening_time": "20:00",
                  "timezone": "America/Sao_Paulo"},
            headers=athlete_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 200
        g = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10).json()
        assert g["enabled"] is False
        # subscribed should remain true (preference toggled, not unsubscribed)
        assert g["subscribed"] is True

    def test_put_prefs_invalid_time_short(self, http, athlete_auth):
        r = http.put(
            f"{API}/push/preferences",
            json={"enabled": True, "morning_time": "7:30", "evening_time": "20:00",
                  "timezone": "America/Sao_Paulo"},
            headers=athlete_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 422

    def test_put_prefs_invalid_time_text(self, http, athlete_auth):
        r = http.put(
            f"{API}/push/preferences",
            json={"enabled": True, "morning_time": "abc", "evening_time": "20:00",
                  "timezone": "America/Sao_Paulo"},
            headers=athlete_auth["headers"],
            timeout=10,
        )
        assert r.status_code == 422

    def test_unsubscribe_removes_all(self, http, athlete_auth):
        r = http.delete(f"{API}/push/unsubscribe", headers=athlete_auth["headers"], timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("success") is True
        assert d.get("deleted", 0) >= 1

        # Subsequent GET shows default subscribed:false
        g = http.get(f"{API}/push/preferences", headers=athlete_auth["headers"], timeout=10).json()
        assert g["subscribed"] is False
        assert g["enabled"] is False
