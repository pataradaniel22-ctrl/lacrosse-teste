"""
Tests for PUT /api/auth/change-password.

Uses a throwaway athlete account (registered and approved by the demo admin
during the test) so no real account's password is changed.
"""
import os
import uuid

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "cristina.velez@brasillacrosse.com", "password": "123456"}


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=60)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _make_athlete():
    """Register a throwaway athlete and approve it with the admin account."""
    email = f"test.changepw.{uuid.uuid4().hex[:8]}@example.com"
    password = "Original123"
    r = requests.post(f"{API}/auth/register/athlete", json={
        "name": "Test ChangePw", "email": email, "password": password,
        "team": "Brazil Lacrosse Men",
    }, timeout=60)
    assert r.status_code in (200, 201), r.text
    admin_token = _login(**ADMIN).json()["token"]
    pending = requests.get(f"{API}/admin/pending-athletes", headers=_auth(admin_token), timeout=60).json()
    athlete_id = next(a["id"] for a in pending if a["email"] == email)
    r = requests.put(f"{API}/admin/athlete/{athlete_id}/approve", headers=_auth(admin_token), timeout=60)
    assert r.status_code == 200, r.text
    return email, password


def test_requires_login():
    r = requests.put(f"{API}/auth/change-password",
                     json={"current_password": "x", "new_password": "yyyyyyyy"}, timeout=60)
    assert r.status_code in (401, 403)


def test_change_password_flow():
    email, password = _make_athlete()
    token = _login(email, password).json()["token"]
    url = f"{API}/auth/change-password"

    # Wrong current password
    r = requests.put(url, headers=_auth(token),
                     json={"current_password": "wrong-pass", "new_password": "NewPass123"}, timeout=60)
    assert r.status_code == 400 and "incorrect" in r.json()["detail"].lower()

    # Too short
    r = requests.put(url, headers=_auth(token),
                     json={"current_password": password, "new_password": "short"}, timeout=60)
    assert r.status_code == 400 and "at least" in r.json()["detail"]

    # Same as current
    r = requests.put(url, headers=_auth(token),
                     json={"current_password": password, "new_password": password}, timeout=60)
    assert r.status_code == 400 and "different" in r.json()["detail"]

    # Success
    r = requests.put(url, headers=_auth(token),
                     json={"current_password": password, "new_password": "NewPass123"}, timeout=60)
    assert r.status_code == 200, r.text
    assert "password_hash" not in r.text

    # Old password no longer works, new one does
    assert _login(email, password).status_code == 401
    assert _login(email, "NewPass123").status_code == 200
