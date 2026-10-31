"""Phase 2 — Staff Health Dashboard (OSTRC-H2) backend tests.

Covers the four staff endpoints:
  GET /api/health/staff/overview
  GET /api/health/staff/athletes
  GET /api/health/staff/substantial
  GET /api/health/staff/athlete/{athlete_id}

Also verifies:
  - athlete token gets 403 on staff endpoints (auth boundary)
  - Phase 1 athlete regression: GET /api/health/status still works with athlete token
"""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://performance-fueling.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

STAFF_EMAIL = "cristina.velez@brasillacrosse.com"
STAFF_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def staff_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD, "user_type": "staff"},
        timeout=15,
    )
    assert r.status_code == 200, f"Staff login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token in staff login: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def athlete_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ATHLETE_EMAIL, "password": ATHLETE_PASSWORD, "user_type": "athlete"},
        timeout=15,
    )
    assert r.status_code == 200, f"Athlete login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def staff_headers(staff_token):
    return {"Authorization": f"Bearer {staff_token}"}


@pytest.fixture(scope="module")
def athlete_headers(athlete_token):
    return {"Authorization": f"Bearer {athlete_token}"}


# ---------- overview ----------

class TestStaffOverview:
    def test_overview_shape_and_values(self, staff_headers):
        r = requests.get(f"{API}/health/staff/overview", headers=staff_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # required keys
        for k in [
            "total_athletes", "submitted_this_week", "response_rate",
            "athletes_with_problems", "substantial_problems", "contact_requests",
            "severity_distribution", "availability_distribution",
        ]:
            assert k in d, f"missing key {k} in overview"
        assert isinstance(d["total_athletes"], int) and d["total_athletes"] > 0
        assert 0 <= d["response_rate"] <= 100
        # severity distribution buckets
        for band in ["none", "minimal", "moderate", "high"]:
            assert band in d["severity_distribution"]
            assert isinstance(d["severity_distribution"][band], int)
        # availability distribution buckets
        for k in ["full", "modified", "unavailable", "not_updated"]:
            assert k in d["availability_distribution"]
            assert isinstance(d["availability_distribution"][k], int)
        # sanity: submitted + not-submitted-ish <= total
        assert d["submitted_this_week"] <= d["total_athletes"]
        # per phase-2 context: several substantial problems expected
        assert d["substantial_problems"] >= 1, f"expected >=1 substantial (seed says ~6). got {d}"

    def test_overview_athlete_forbidden(self, athlete_headers):
        r = requests.get(f"{API}/health/staff/overview", headers=athlete_headers, timeout=15)
        assert r.status_code == 403, f"athlete should be 403, got {r.status_code} {r.text}"


# ---------- athletes list ----------

class TestStaffAthletes:
    def test_athletes_list_shape(self, staff_headers):
        r = requests.get(f"{API}/health/staff/athletes", headers=staff_headers, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list) and len(rows) > 0
        needed = {"athlete_id", "name", "status", "active_problems",
                  "current_severity", "severity_band", "substantial",
                  "contact_requested", "availability", "trend"}
        first = rows[0]
        missing = needed - set(first.keys())
        assert not missing, f"missing fields in athletes row: {missing}. row={first}"
        assert isinstance(first["trend"], list)
        # severity_band values valid
        for row in rows:
            assert row["severity_band"] in ("none", "minimal", "moderate", "high")
            assert row["availability"] in ("full", "modified", "unavailable", "not_updated")
            assert row["status"] in ("ready", "completed", "overdue", "postponed")

    def test_athletes_sorted_substantial_first(self, staff_headers):
        r = requests.get(f"{API}/health/staff/athletes", headers=staff_headers, timeout=30)
        rows = r.json()
        # substantial True rows must all appear before substantial False rows
        seen_non_substantial = False
        for row in rows:
            if not row["substantial"]:
                seen_non_substantial = True
            else:
                assert not seen_non_substantial, "substantial=True must sort before substantial=False"
        # among substantial rows, severity is non-increasing
        sev = [r["current_severity"] for r in rows if r["substantial"]]
        assert sev == sorted(sev, reverse=True), f"substantial rows not sorted desc by severity: {sev}"

    def test_athletes_forbidden_to_athlete(self, athlete_headers):
        r = requests.get(f"{API}/health/staff/athletes", headers=athlete_headers, timeout=15)
        assert r.status_code == 403


# ---------- substantial list ----------

class TestStaffSubstantial:
    def test_substantial_shape(self, staff_headers):
        r = requests.get(f"{API}/health/staff/substantial", headers=staff_headers, timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        # Per seed context: several substantial problems exist
        assert len(rows) >= 1, "expected at least 1 substantial/moderate problem"
        for p in rows:
            for k in ("id", "athlete_id", "athlete_name", "problem_category",
                      "current_severity_score", "total_weeks_reported"):
                assert k in p, f"missing {k} in substantial row {p}"
            assert p["current_severity_score"] >= 17 or p.get("substantial_problem")
        # sorted desc by current_severity_score
        sev = [p["current_severity_score"] for p in rows]
        assert sev == sorted(sev, reverse=True)

    def test_substantial_forbidden(self, athlete_headers):
        r = requests.get(f"{API}/health/staff/substantial", headers=athlete_headers, timeout=15)
        assert r.status_code == 403


# ---------- athlete profile ----------

class TestStaffAthleteProfile:
    def test_profile_shape(self, staff_headers):
        # pick an athlete from the list
        rows = requests.get(f"{API}/health/staff/athletes", headers=staff_headers, timeout=30).json()
        assert rows
        aid = rows[0]["athlete_id"]
        r = requests.get(f"{API}/health/staff/athlete/{aid}", headers=staff_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("athlete", "summary", "submissions", "problems"):
            assert k in d, f"missing {k} in athlete profile"
        assert d["athlete"]["id"] == aid
        assert isinstance(d["submissions"], list)
        assert isinstance(d["problems"], list)
        # each problem carries observations[] (longitudinal)
        for p in d["problems"]:
            assert "observations" in p and isinstance(p["observations"], list)

    def test_profile_with_substantial_has_observations(self, staff_headers):
        subs = requests.get(f"{API}/health/staff/substantial", headers=staff_headers, timeout=30).json()
        if not subs:
            pytest.skip("no substantial problems in demo data")
        aid = subs[0]["athlete_id"]
        d = requests.get(f"{API}/health/staff/athlete/{aid}", headers=staff_headers, timeout=30).json()
        # at least one problem observation entry should be present for a real athlete with substantial
        total_obs = sum(len(p.get("observations", [])) for p in d["problems"])
        assert total_obs >= 1, f"expected >=1 observation for substantial athlete {aid}"

    def test_profile_404_for_unknown_id(self, staff_headers):
        r = requests.get(f"{API}/health/staff/athlete/does-not-exist-uuid",
                         headers=staff_headers, timeout=15)
        assert r.status_code == 404

    def test_profile_forbidden_to_athlete(self, athlete_headers):
        # pick any athlete id we happen to have
        # (athlete cannot access staff endpoint even for themselves)
        r = requests.get(f"{API}/health/staff/athlete/any-id", headers=athlete_headers, timeout=15)
        assert r.status_code == 403


# ---------- regression: Phase 1 athlete endpoint still OK ----------

class TestPhase1Regression:
    def test_athlete_health_status(self, athlete_headers):
        r = requests.get(f"{API}/health/status", headers=athlete_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["state"] in ("ready", "completed", "overdue", "postponed")
        assert "is_mandatory" in d
        assert "active_problems" in d

    def test_athlete_cannot_see_staff_overview(self, athlete_headers):
        r = requests.get(f"{API}/health/staff/overview", headers=athlete_headers, timeout=15)
        assert r.status_code == 403
