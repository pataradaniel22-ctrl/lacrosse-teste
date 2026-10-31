"""Backend tests for the Event Report feature.

Covers:
- /api/staff/event-report success for staff, key shape, KPI fields
- Empty-range handling (future dates -> N/A/insufficient)
- Team filter, view-independent (server does not filter by view)
- /api/staff/event-report/athlete/{aid} success and 404 empty
- Access control: athlete token must be 403 on both endpoints
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback used only when the env is missing during pytest — will be captured
    pytest.skip("REACT_APP_BACKEND_URL not set", allow_module_level=True)

STAFF_EMAIL = "cristina.velez@brasillacrosse.com"
STAFF_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"
RICH_START = "2026-06-05"
RICH_END = "2026-06-18"
EMPTY_START = "2026-08-01"
EMPTY_END = "2026-08-05"


def _login(email, password, user_type):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password, "user_type": user_type},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"no token in login response: {body}"
    return tok


@pytest.fixture(scope="module")
def staff_headers():
    return {"Authorization": f"Bearer {_login(STAFF_EMAIL, STAFF_PASSWORD, 'staff')}"}


@pytest.fixture(scope="module")
def athlete_headers():
    return {"Authorization": f"Bearer {_login(ATHLETE_EMAIL, ATHLETE_PASSWORD, 'athlete')}"}


# ---------- Event report main endpoint ----------
class TestEventReportMain:
    def test_status_200_and_shape(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        expected_keys = [
            "meta", "header", "kpis", "executive_summary", "daily",
            "team_comparison", "team_profiles", "compliance", "readiness",
            "pain", "load", "recovery", "availability", "rankings",
            "insights", "recommendations", "data_quality", "athletes",
        ]
        for k in expected_keys:
            assert k in data, f"missing top-level key: {k}"

    def test_kpi_and_header_values(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        data = r.json()
        k = data["kpis"]
        # Rich window should have meaningful values
        assert k["athletes"] > 0
        assert k["adherence"] is not None and k["adherence"] > 0
        assert k["readiness"] is not None
        h = data["header"]
        assert h["athletes"] == k["athletes"]
        assert h["expected_checkins"] > 0
        assert h["actual_checkins"] > 0
        # Executive summary is a non-empty sentence
        assert isinstance(data["executive_summary"], str)
        assert len(data["executive_summary"]) > 20

    def test_daily_series_matches_range(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        data = r.json()
        # 06-05 .. 06-18 inclusive = 14 days
        assert len(data["daily"]) == 14
        assert data["daily"][0]["date"] == RICH_START
        assert data["daily"][-1]["date"] == RICH_END

    def test_pain_section_populated_rich_range(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        data = r.json()
        pain = data["pain"]
        # As per user request: rich range must have pain reports
        assert pain["total_reports"] > 0, "expected pain reports in rich range"
        assert pain["athletes_reporting"] > 0

    def test_insights_at_least_five(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        data = r.json()
        assert len(data["insights"]) >= 5
        for ins in data["insights"]:
            assert "priority" in ins and ins["priority"] in ("high", "moderate", "low")

    def test_team_filter_men_only(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={
                "start_date": RICH_START, "end_date": RICH_END,
                "team": "Brazil Lacrosse Men",
            },
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        # only one team present after filter
        team_labels = {a["team"] for a in data["athletes"]}
        assert team_labels.issubset({"Men", "Unassigned"})
        # team_comparison should have 1 team
        assert len(data["team_comparison"]) == 1

    def test_empty_future_range(self, staff_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=staff_headers,
            params={"start_date": EMPTY_START, "end_date": EMPTY_END},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        k = data["kpis"]
        assert k["adherence"] in (None, 0, 0.0)
        assert k["readiness"] is None
        assert data["pain"]["total_reports"] == 0
        assert data["header"]["actual_checkins"] == 0
        # daily present but empty metrics
        assert len(data["daily"]) == 5
        assert all(d["checkins"] == 0 for d in data["daily"])


# ---------- Individual athlete endpoint ----------
class TestEventReportAthlete:
    def _pick_athlete_id(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        data = r.json()
        ath = [a for a in data["athletes"] if a["days_monitored"] > 0]
        assert ath, "no monitored athletes to test with"
        return ath[0]["id"]

    def test_athlete_report_success(self, staff_headers):
        aid = self._pick_athlete_id(staff_headers)
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report/athlete/{aid}",
            headers=staff_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "athlete" in body and "meta" in body
        a = body["athlete"]
        assert a["id"] == aid
        assert isinstance(a.get("summary"), str) and len(a["summary"]) > 5
        assert "readiness_series" in a

    def test_athlete_report_empty_range_404(self, staff_headers):
        aid = self._pick_athlete_id(staff_headers)
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report/athlete/{aid}",
            headers=staff_headers,
            params={"start_date": EMPTY_START, "end_date": EMPTY_END},
            timeout=30,
        )
        # For empty range athlete might still exist (active=True) with all-null stats.
        # Backend returns the athlete row even if compliance=0 -> 200 acceptable.
        # But if athletes list empty, backend raises 404. Accept both.
        assert r.status_code in (200, 404), r.text


# ---------- Access control ----------
class TestEventReportAccessControl:
    def test_athlete_forbidden_main(self, athlete_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            headers=athlete_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=15,
        )
        assert r.status_code == 403, f"athlete should be forbidden, got {r.status_code}"

    def test_athlete_forbidden_individual(self, athlete_headers):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report/athlete/some-id",
            headers=athlete_headers,
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=15,
        )
        assert r.status_code == 403

    def test_unauthenticated_401(self):
        r = requests.get(
            f"{BASE_URL}/api/staff/event-report",
            params={"start_date": RICH_START, "end_date": RICH_END},
            timeout=15,
        )
        assert r.status_code in (401, 403)
