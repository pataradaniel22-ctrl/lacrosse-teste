"""Tests for (1) Boston-timezone day boundary and (2) same-day recovery delete."""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
assert BASE_URL

ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"
BOSTON = ZoneInfo("America/New_York")


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ATHLETE_EMAIL, "password": ATHLETE_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


def _first_activity_id(headers):
    r = requests.get(f"{BASE_URL}/api/recovery/catalog", headers=headers)
    assert r.status_code == 200
    d = r.json()

    def find(o):
        if isinstance(o, dict):
            if "id" in o and "points" in o:
                return o["id"]
            for v in o.values():
                res = find(v)
                if res:
                    return res
        if isinstance(o, list):
            for v in o:
                res = find(v)
                if res:
                    return res
        return None

    aid = find(d)
    assert aid, "no activity in catalog"
    return aid


def test_new_log_uses_boston_date():
    headers = {"Authorization": f"Bearer {_login()}"}
    act = _first_activity_id(headers)
    r = requests.post(f"{BASE_URL}/api/recovery/logs", headers=headers,
                      data={"activity_id": act})
    assert r.status_code == 200, r.text
    log = r.json()["log"]
    boston_today = datetime.now(BOSTON).strftime("%Y-%m-%d")
    assert log["date"] == boston_today, f"date {log['date']} != Boston today {boston_today}"
    # cleanup
    requests.delete(f"{BASE_URL}/api/recovery/logs/{log['id']}", headers=headers)


def test_delete_today_then_404_on_repeat():
    headers = {"Authorization": f"Bearer {_login()}"}
    act = _first_activity_id(headers)
    log = requests.post(f"{BASE_URL}/api/recovery/logs", headers=headers,
                        data={"activity_id": act}).json()["log"]
    # delete same-day -> success
    r = requests.delete(f"{BASE_URL}/api/recovery/logs/{log['id']}", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["deleted_id"] == log["id"]
    # delete again -> 404 (already gone)
    r2 = requests.delete(f"{BASE_URL}/api/recovery/logs/{log['id']}", headers=headers)
    assert r2.status_code == 404


def test_delete_nonexistent_is_404():
    headers = {"Authorization": f"Bearer {_login()}"}
    r = requests.delete(f"{BASE_URL}/api/recovery/logs/does-not-exist", headers=headers)
    assert r.status_code == 404
