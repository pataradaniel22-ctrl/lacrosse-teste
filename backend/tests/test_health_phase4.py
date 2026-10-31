"""Phase 4 tests: Combined Load x Health Risk, Offline idempotency, Health PDF reports, ACWR regression."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')

STAFF_EMAIL = "cristina.velez@brasillacrosse.com"
STAFF_PASS = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASS = "demo123"


@pytest.fixture(scope="module")
def staff_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": STAFF_EMAIL, "password": STAFF_PASS, "user_type": "staff"}, timeout=15)
    assert r.status_code == 200, f"Staff login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def athlete_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ATHLETE_EMAIL, "password": ATHLETE_PASS, "user_type": "athlete"}, timeout=15)
    assert r.status_code == 200, f"Athlete login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def staff_headers(staff_token):
    return {"Authorization": f"Bearer {staff_token}"}


@pytest.fixture(scope="module")
def athlete_headers(athlete_token):
    return {"Authorization": f"Bearer {athlete_token}"}


# ---------- Combined Risk ----------
class TestCombinedRisk:
    def test_combined_risk_shape_and_staff_only(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/health/staff/combined-risk?days=7", headers=staff_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        for k in ["team_mean", "threshold", "combined_risk_count", "combined_risk_athletes", "athletes", "disclaimer"]:
            assert k in data, f"Missing key: {k}"
        assert isinstance(data["combined_risk_athletes"], list)
        assert isinstance(data["athletes"], list)
        assert data["combined_risk_count"] == len(data["combined_risk_athletes"])

        for a in data["athletes"]:
            for k in ["high_load", "elevated_health", "combined_risk", "factors", "total_load", "current_severity"]:
                assert k in a, f"Missing athlete field: {k}"
            assert isinstance(a["high_load"], bool)
            assert isinstance(a["elevated_health"], bool)
            assert isinstance(a["combined_risk"], bool)
            assert isinstance(a["factors"], list)
            # combined_risk logic
            assert a["combined_risk"] == (a["high_load"] and a["elevated_health"])
        # Every combined_risk athlete listed must satisfy AND
        for a in data["combined_risk_athletes"]:
            assert a["high_load"] and a["elevated_health"]

    def test_combined_risk_athlete_forbidden(self, athlete_headers):
        r = requests.get(f"{BASE_URL}/api/health/staff/combined-risk?days=7", headers=athlete_headers, timeout=15)
        assert r.status_code == 403, f"Expected 403 for athlete, got {r.status_code}"


# ---------- Offline Idempotency ----------
class TestOfflineIdempotency:
    def _payload(self, csid):
        return {
            "client_submission_id": csid,
            "offline_submission": True,
            "no_problem": True,
            "problems": [],
            "started_at": "2026-01-15T10:00:00-05:00",
            "completion_time_seconds": 45,
        }

    def test_duplicate_client_submission_id_is_idempotent(self, athlete_headers):
        csid = f"TEST_offline_{uuid.uuid4()}"
        payload = self._payload(csid)

        r1 = requests.post(f"{BASE_URL}/api/health/submit", json=payload, headers=athlete_headers, timeout=15)
        assert r1.status_code == 200, f"First submit failed: {r1.status_code} {r1.text}"
        d1 = r1.json()
        assert d1.get("success") is True
        sid1 = d1.get("submission_id")
        assert sid1

        r2 = requests.post(f"{BASE_URL}/api/health/submit", json=payload, headers=athlete_headers, timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("duplicate") is True, f"Expected duplicate:true on 2nd submit, got {d2}"
        assert d2.get("submission_id") == sid1, f"submission_id should match, got {d2.get('submission_id')} vs {sid1}"

    def test_different_client_submission_id_creates_new(self, athlete_headers):
        csid1 = f"TEST_offline_{uuid.uuid4()}"
        csid2 = f"TEST_offline_{uuid.uuid4()}"
        r1 = requests.post(f"{BASE_URL}/api/health/submit",
                           json=self._payload(csid1), headers=athlete_headers, timeout=15)
        r2 = requests.post(f"{BASE_URL}/api/health/submit",
                           json=self._payload(csid2), headers=athlete_headers, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        d1, d2 = r1.json(), r2.json()
        assert not d2.get("duplicate"), "Different csid must NOT be dedup'd"
        assert d1.get("submission_id") != d2.get("submission_id")


# ---------- Health PDF Reports ----------
class TestHealthReports:
    def test_team_report_pdf(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/health/staff/report/team", headers=staff_headers, timeout=30)
        assert r.status_code == 200, f"team report status={r.status_code} body={r.text[:200]}"
        ctype = r.headers.get("content-type", "")
        assert "application/pdf" in ctype, f"content-type={ctype}"
        assert r.content[:4] == b"%PDF", f"body did not start with %PDF: {r.content[:20]}"

    def test_team_report_athlete_forbidden(self, athlete_headers):
        r = requests.get(f"{BASE_URL}/api/health/staff/report/team", headers=athlete_headers, timeout=15)
        assert r.status_code == 403

    def test_athlete_report_pdf(self, staff_headers):
        # Get an athlete id via staff list
        r = requests.get(f"{BASE_URL}/api/staff/athletes", headers=staff_headers, timeout=15)
        assert r.status_code == 200
        athletes = r.json()
        assert athletes, "No athletes returned"
        aid = athletes[0]["id"] if isinstance(athletes[0], dict) else None
        assert aid, f"No athlete id: {athletes[0]}"

        r = requests.get(f"{BASE_URL}/api/health/staff/report/athlete/{aid}", headers=staff_headers, timeout=30)
        assert r.status_code == 200, f"athlete report status={r.status_code} body={r.text[:200]}"
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"

    def test_athlete_report_404_for_unknown(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/health/staff/report/athlete/does_not_exist_xyz",
                         headers=staff_headers, timeout=15)
        assert r.status_code == 404

    def test_athlete_report_athlete_forbidden(self, athlete_headers):
        r = requests.get(f"{BASE_URL}/api/health/staff/report/athlete/any", headers=athlete_headers, timeout=15)
        assert r.status_code == 403


# ---------- ACWR Regression ----------
class TestAcwrRegression:
    def test_workload_no_acwr(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/staff/athletes", headers=staff_headers, timeout=15)
        aid = r.json()[0]["id"]
        r = requests.get(f"{BASE_URL}/api/staff/athlete/{aid}/workload", headers=staff_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "weekly_monotony" in data
        assert "weekly_strain" in data
        assert "acwr" not in data

    def test_clinical_availability_no_acwr(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/staff/athletes", headers=staff_headers, timeout=15)
        aid = r.json()[0]["id"]
        r = requests.get(f"{BASE_URL}/api/clinical/athlete/{aid}/availability", headers=staff_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        components = data.get("components") or {}
        assert "load_balance" in components
        assert "acwr" not in components

    def test_removed_acwr_endpoints_404(self, staff_headers):
        r1 = requests.get(f"{BASE_URL}/api/staff/dashboard/acwr", headers=staff_headers, timeout=15)
        assert r1.status_code == 404
        r2 = requests.get(f"{BASE_URL}/api/staff/athlete/any_id/acwr-gabbett", headers=staff_headers, timeout=15)
        assert r2.status_code == 404
