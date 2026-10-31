"""
Backend tests for Nutrition & Hydration Calculator.
Covers: compute formulas, save plan (current/demotion), history ordering,
override (staff only), delete + promotion of next plan, authz for athletes.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cristina.velez@brasillacrosse.com"
ADMIN_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"


def H(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def athlete_auth():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ATHLETE_EMAIL, "password": ATHLETE_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    return j["token"], j["user"]["id"]


def _metrics_by_key(payload):
    return {m["key"]: m for m in payload["metrics"]}


# -------------------- Formulas / Calculate --------------------
class TestCalculate:
    def test_endurance_80kg(self, athlete_auth):
        tok, _ = athlete_auth
        r = requests.post(f"{API}/nutrition/calculate", headers=H(tok),
                          json={"body_weight_kg": 80, "athlete_type": "endurance"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["athlete_type"] == "endurance"
        assert j["post_hydration_factor"] == 1.5
        m = _metrics_by_key(j)
        # daily carbs 80*8..80*10
        assert m["daily_carbs"]["min"] == 640 and m["daily_carbs"]["max"] == 800
        # protein 80*1.4..80*1.8
        assert m["daily_protein"]["min"] == 112 and m["daily_protein"]["max"] == 144
        # pre34 carbs 80*1..80*4
        assert m["pre34_carbs"]["min"] == 80 and m["pre34_carbs"]["max"] == 320
        # pre34 protein 80*0.15..80*0.25
        assert m["pre34_protein"]["min"] == 12 and m["pre34_protein"]["max"] == 20
        # hydration 4h 80*5..80*7
        assert m["hyd4"]["min"] == 400 and m["hyd4"]["max"] == 560
        # hydration 2h 80*3..80*5
        assert m["hyd2"]["min"] == 240 and m["hyd2"]["max"] == 400

    def test_strength_82kg(self, athlete_auth):
        tok, _ = athlete_auth
        r = requests.post(f"{API}/nutrition/calculate", headers=H(tok),
                          json={"body_weight_kg": 82, "athlete_type": "strength"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["athlete_type"] == "strength"
        m = _metrics_by_key(j)
        assert m["daily_carbs"]["min"] == 410 and m["daily_carbs"]["max"] == 492
        assert m["hyd4"]["min"] == 410 and m["hyd4"]["max"] == 574

    def test_calculate_via_staff(self, admin_token):
        r = requests.post(f"{API}/nutrition/calculate", headers=H(admin_token),
                          json={"body_weight_kg": 70, "athlete_type": "endurance"}, timeout=15)
        assert r.status_code == 200, r.text
        m = _metrics_by_key(r.json())
        assert m["daily_carbs"]["min"] == 560 and m["daily_carbs"]["max"] == 700


# -------------------- Save Plan + history + current --------------------
class TestPlansLifecycle:
    def test_athlete_save_demotes_previous(self, athlete_auth):
        tok, _ = athlete_auth
        # save first
        r = requests.post(f"{API}/nutrition/plans", headers=H(tok),
                          json={"body_weight_kg": 78, "athlete_type": "endurance"}, timeout=15)
        assert r.status_code == 200, r.text
        first = r.json()
        assert first["is_current"] is True
        # save second
        r2 = requests.post(f"{API}/nutrition/plans", headers=H(tok),
                           json={"body_weight_kg": 79, "athlete_type": "endurance"}, timeout=15)
        assert r2.status_code == 200, r2.text
        second = r2.json()
        assert second["is_current"] is True
        # current returns second
        r3 = requests.get(f"{API}/nutrition/plans/current", headers=H(tok), timeout=15)
        assert r3.status_code == 200
        cur = r3.json()
        assert cur["id"] == second["id"] and cur["body_weight_kg"] == 79
        # history ordered newest first
        r4 = requests.get(f"{API}/nutrition/plans/history", headers=H(tok), timeout=15)
        assert r4.status_code == 200
        hist = r4.json()
        assert len(hist) >= 2
        assert hist[0]["id"] == second["id"]
        ids = [p["id"] for p in hist]
        assert ids.index(second["id"]) < ids.index(first["id"])
        # stash for downstream
        pytest.shared_first_id = first["id"]
        pytest.shared_second_id = second["id"]

    def test_staff_save_with_athlete_id(self, admin_token, athlete_auth):
        _, aid = athlete_auth
        r = requests.post(f"{API}/nutrition/plans", headers=H(admin_token),
                          json={"body_weight_kg": 85, "athlete_type": "strength",
                                "athlete_id": aid}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["athlete_id"] == aid
        assert j["is_current"] is True
        assert j["created_by_type"] == "staff"
        pytest.shared_staff_plan_id = j["id"]

    def test_staff_current_via_query(self, admin_token, athlete_auth):
        _, aid = athlete_auth
        r = requests.get(f"{API}/nutrition/plans/current", headers=H(admin_token),
                         params={"athlete_id": aid}, timeout=15)
        assert r.status_code == 200, r.text
        cur = r.json()
        assert cur["id"] == pytest.shared_staff_plan_id


# -------------------- Override --------------------
class TestOverride:
    def test_athlete_forbidden(self, athlete_auth):
        tok, _ = athlete_auth
        pid = pytest.shared_staff_plan_id
        r = requests.patch(f"{API}/nutrition/plans/{pid}/override",
                           headers=H(tok),
                           json={"overrides": {"daily_carbs": {"min": 500, "max": 600}}}, timeout=15)
        assert r.status_code == 403, r.text

    def test_staff_apply_override(self, admin_token):
        pid = pytest.shared_staff_plan_id
        r = requests.patch(f"{API}/nutrition/plans/{pid}/override",
                           headers=H(admin_token),
                           json={"overrides": {"daily_carbs": {"min": 500, "max": 600}},
                                 "note": "TEST_override"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["modified_by_staff"] is True
        assert j["modified_by_name"]
        m = _metrics_by_key(j)
        assert m["daily_carbs"]["override_min"] == 500
        assert m["daily_carbs"]["override_max"] == 600
        assert m["daily_carbs"]["is_overridden"] is True

    def test_override_ignores_non_editable_keys(self, admin_token):
        pid = pytest.shared_staff_plan_id
        r = requests.patch(f"{API}/nutrition/plans/{pid}/override",
                           headers=H(admin_token),
                           json={"overrides": {
                               "daily_fat": {"min": 1, "max": 2},  # not editable
                               "daily_carbs": {"min": 510, "max": 610},
                           }}, timeout=15)
        assert r.status_code == 200
        m = _metrics_by_key(r.json())
        assert m["daily_carbs"]["override_min"] == 510
        # daily_fat is not editable -> should not be overridden
        assert m["daily_fat"].get("is_overridden") in (False, None)


# -------------------- Delete + promotion --------------------
class TestDelete:
    def test_delete_current_promotes_previous(self, athlete_auth):
        tok, _ = athlete_auth
        # the staff-saved plan should still be current; delete it -> previous (second) becomes current
        pid = pytest.shared_staff_plan_id
        r = requests.delete(f"{API}/nutrition/plans/{pid}", headers=H(tok), timeout=15)
        assert r.status_code == 200, r.text
        # check current -> should be the second saved plan
        cur = requests.get(f"{API}/nutrition/plans/current", headers=H(tok), timeout=15).json()
        assert cur is not None
        assert cur["id"] == pytest.shared_second_id
        assert cur["is_current"] is True

    def test_athlete_cannot_delete_others(self, athlete_auth):
        # negative test: try deleting a random non-existent id -> 404
        tok, _ = athlete_auth
        r = requests.delete(f"{API}/nutrition/plans/nonexistent-id-xyz", headers=H(tok), timeout=15)
        assert r.status_code == 404


# -------------------- Cleanup --------------------
def test_cleanup_athlete_test_plans(athlete_auth):
    tok, _ = athlete_auth
    hist = requests.get(f"{API}/nutrition/plans/history", headers=H(tok), timeout=15).json()
    for p in hist:
        requests.delete(f"{API}/nutrition/plans/{p['id']}", headers=H(tok), timeout=15)
    assert requests.get(f"{API}/nutrition/plans/current", headers=H(tok), timeout=15).json() is None
