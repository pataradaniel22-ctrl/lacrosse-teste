"""Tests for P0 seed-demo (bulk insert, idempotency) and P1 dashboard athlete_id filter."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # Fall back to reading frontend/.env directly
    try:
        with open('/app/frontend/.env') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                    break
    except Exception:
        pass

assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_EMAIL = "cristina.velez@brasillacrosse.com"
ADMIN_PASSWORD = "123456"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "user_type": "staff"})
    if r.status_code != 200:
        # try without user_type
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    assert token, f"No token in response: {r.json()}"
    return token


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ============ P0: SEED DEMO ============
class TestSeedDemo:
    def test_seed_demo_first_run_under_30s(self, api):
        t0 = time.time()
        r = api.get(f"{BASE_URL}/api/seed-demo", timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200, f"Status {r.status_code}: {r.text[:500]}"
        data = r.json()
        assert data.get("success") is True, f"success != True: {data}"
        assert "staff" in data
        assert "athletes" in data
        assert "data_created" in data
        assert elapsed < 30, f"seed-demo took {elapsed:.1f}s (>30s threshold)"
        print(f"seed-demo first run: {elapsed:.2f}s, data_created={data['data_created']}")

    def test_seed_demo_idempotent_no_duplicates(self, api, auth_headers):
        # Capture athlete count before rerun
        r0 = api.get(f"{BASE_URL}/api/staff/dashboard/stats", headers=auth_headers)
        assert r0.status_code == 200
        count_before = r0.json()["total_athletes"]

        # Run seed again
        t0 = time.time()
        r = api.get(f"{BASE_URL}/api/seed-demo", timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        # All staff/athletes should be "exists" on second run (no duplicate accounts created)
        for entry in data["athletes"]:
            assert entry.startswith("exists:"), f"Unexpected athlete on rerun: {entry}"
        for entry in data["staff"]:
            assert entry.startswith("exists:"), f"Unexpected staff on rerun: {entry}"
        # Athlete count must be unchanged after rerun (no duplicate athletes).
        # Note: seed-demo performs a deliberate "fresh reseed" of historical time-series
        # data (check-ins/sessions/recovery) each run — it wipes and re-inserts, so the
        # totals stay stable rather than zero. We validate stability, not zero creation.
        r2 = api.get(f"{BASE_URL}/api/staff/dashboard/stats", headers=auth_headers)
        assert r2.status_code == 200
        count_after = r2.json()["total_athletes"]
        assert count_after == count_before, \
            f"Athlete count changed on rerun ({count_before} -> {count_after}); duplicates created"
        assert count_after >= 16, f"Expected >=16, got {count_after}"
        print(f"seed-demo rerun: {elapsed:.2f}s, idempotent (no duplicate accounts) ✓")


# ============ P1: ATHLETE FILTER ON DASHBOARD ENDPOINTS ============
@pytest.fixture(scope="module")
def athletes_list(api, auth_headers):
    r = api.get(f"{BASE_URL}/api/staff/athletes", headers=auth_headers)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def women_athlete(athletes_list):
    for a in athletes_list:
        if a.get("team") == "Brazil Lacrosse Women":
            return a
    pytest.skip("No women athlete found")


@pytest.fixture(scope="module")
def men_athlete(athletes_list):
    for a in athletes_list:
        if a.get("team") == "Brazil Lacrosse Men":
            return a
    pytest.skip("No men athlete found")


class TestAthleteFilterStats:
    def test_stats_no_filter_returns_all(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/staff/dashboard/stats", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["total_athletes"] >= 16

    def test_stats_with_athlete_id_returns_single(self, api, auth_headers, women_athlete):
        r = api.get(f"{BASE_URL}/api/staff/dashboard/stats",
                    headers=auth_headers, params={"athlete_id": women_athlete["id"]})
        assert r.status_code == 200
        data = r.json()
        assert data["total_athletes"] == 1, f"Expected 1, got {data['total_athletes']}"

    def test_stats_team_plus_athlete_in_scope(self, api, auth_headers, women_athlete):
        r = api.get(f"{BASE_URL}/api/staff/dashboard/stats",
                    headers=auth_headers,
                    params={"team": "Brazil Lacrosse Women", "athlete_id": women_athlete["id"]})
        assert r.status_code == 200
        assert r.json()["total_athletes"] == 1

    def test_stats_team_plus_athlete_out_of_scope_empty(self, api, auth_headers, women_athlete):
        # Women athlete + Men team => empty
        r = api.get(f"{BASE_URL}/api/staff/dashboard/stats",
                    headers=auth_headers,
                    params={"team": "Brazil Lacrosse Men", "athlete_id": women_athlete["id"]})
        assert r.status_code == 200
        assert r.json()["total_athletes"] == 0, f"Expected 0 (out of scope), got {r.json()['total_athletes']}"


class TestAthleteFilterCharts:
    def test_charts_no_filter_lists_all_athletes(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/staff/dashboard/charts",
                    headers=auth_headers, params={"days": 14})
        assert r.status_code == 200
        data = r.json()
        assert "athletes" in data
        assert len(data["athletes"]) >= 1

    def test_charts_with_athlete_id_returns_single_name(self, api, auth_headers, women_athlete):
        r = api.get(f"{BASE_URL}/api/staff/dashboard/charts",
                    headers=auth_headers,
                    params={"athlete_id": women_athlete["id"], "days": 14})
        assert r.status_code == 200
        data = r.json()
        assert data["athletes"] == [women_athlete["name"]], \
            f"Expected [{women_athlete['name']}], got {data['athletes']}"
        # readiness rows should only contain date + the single athlete name
        for row in data.get("readiness", []):
            extra_keys = set(row.keys()) - {"date", women_athlete["name"]}
            assert not extra_keys, f"Unexpected keys in readiness row: {extra_keys}"
        for row in data.get("load", []):
            extra_keys = set(row.keys()) - {"date", women_athlete["name"]}
            assert not extra_keys, f"Unexpected keys in load row: {extra_keys}"


class TestAthleteFilterAllEndpoints:
    """Verify all P1 listed endpoints accept athlete_id and return 200."""

    @pytest.mark.parametrize("endpoint,params", [
        ("/api/staff/dashboard/stats", {}),
        ("/api/staff/dashboard/charts", {"days": 14}),
        ("/api/staff/dashboard/menstrual-stats", {"days": 7}),
        ("/api/staff/dashboard/pain-analytics", {"days": 90}),
        ("/api/staff/dashboard/workload-metrics", {"weeks": 4}),
        ("/api/staff/dashboard/readiness-radar", {}),
        ("/api/staff/dashboard/daily-pain", {}),
        ("/api/staff/dashboard/longterm", {"months": 3}),
        ("/api/staff/alerts", {}),
    ])
    def test_endpoint_accepts_athlete_id(self, api, auth_headers, women_athlete, endpoint, params):
        params = {**params, "athlete_id": women_athlete["id"]}
        r = api.get(f"{BASE_URL}{endpoint}", headers=auth_headers, params=params, timeout=30)
        assert r.status_code == 200, f"{endpoint} returned {r.status_code}: {r.text[:300]}"


# ============ REGRESSION: ADMIN DELETE ENDPOINTS ============
class TestAdminRegression:
    def test_delete_demo_checkin(self, api, auth_headers):
        # Get a check-in to delete (create one first via athlete or use existing)
        # We just verify the endpoint responds correctly to a fake id (404 not 500)
        r = api.delete(f"{BASE_URL}/api/admin/check-in/nonexistent-id", headers=auth_headers)
        assert r.status_code in (200, 404), f"Unexpected status {r.status_code}: {r.text[:200]}"

    def test_delete_training_session(self, api, auth_headers):
        r = api.delete(f"{BASE_URL}/api/admin/training-session/nonexistent-id", headers=auth_headers)
        assert r.status_code in (200, 404), f"Unexpected status {r.status_code}: {r.text[:200]}"

    def test_clear_demo_data_requires_admin(self, api):
        # Without token should fail
        r = api.delete(f"{BASE_URL}/api/admin/clear-demo-data")
        assert r.status_code in (401, 403), f"Should require auth, got {r.status_code}"
