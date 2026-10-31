"""Backend tests for: severe pain alerts, daily-pain entries, athlete pain-report
tab data, and recovery proofs gallery filters.

Covers the new features requested in iteration 12:
  - POST /api/recovery/logs with pain_reports >=7 -> alert in /api/staff/alerts
  - Pain < 7 does NOT create an alert
  - GET /api/staff/dashboard/daily-pain returns region.entries with athlete name + side + level + source
  - GET /api/staff/athlete/{id}/pain-report returns recent_reports with source (Morning/Recovery/Training)
  - GET /api/recovery/proofs supports start_date/end_date/team/category filters
"""
import io
import os
import json
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
STAFF = {"email": "cristina.velez@brasillacrosse.com", "password": "123456", "user_type": "staff"}
ATHLETE = {"email": "lucas.silva@email.com", "password": "demo123", "user_type": "athlete"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    return data.get("token") or data.get("access_token"), data.get("user", {})


@pytest.fixture(scope="module")
def staff_token():
    tok, _ = _login(STAFF)
    return tok


@pytest.fixture(scope="module")
def athlete_token_and_id():
    tok, user = _login(ATHLETE)
    return tok, user.get("id") or user.get("athlete_id")


@pytest.fixture(scope="module")
def staff_h(staff_token):
    return {"Authorization": f"Bearer {staff_token}"}


@pytest.fixture(scope="module")
def ath_h(athlete_token_and_id):
    return {"Authorization": f"Bearer {athlete_token_and_id[0]}"}


# ------------------------------------------------------------
# Recovery activity helper - find an existing active activity
# ------------------------------------------------------------
@pytest.fixture(scope="module")
def recovery_activity_id(ath_h):
    r = requests.get(f"{BASE_URL}/api/recovery/catalog", headers=ath_h, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    activities = data.get("activities") if isinstance(data, dict) else data
    assert activities, "no recovery activities seeded"
    # Pick the first active one
    for a in activities:
        if a.get("active", True):
            return a["id"]
    return activities[0]["id"]


# ------------------------------------------------------------
# Tests: Severe pain alert auto-creation from Recovery log
# ------------------------------------------------------------
class TestSeverePainAlert:
    def test_severe_pain_recovery_creates_alert(self, ath_h, staff_h, recovery_activity_id, athlete_token_and_id):
        _, athlete_id = athlete_token_and_id
        # Submit a recovery log with severe (8/10) Knee/Left
        unique_marker = f"TEST_{datetime.now(timezone.utc).strftime('%H%M%S%f')}"
        pr = [{"body_region": "Knee", "laterality": "Left", "pain_level": 8}]
        files = {
            "activity_id": (None, recovery_activity_id),
            "pain_reports": (None, json.dumps(pr)),
            "notes": (None, unique_marker),
        }
        r = requests.post(f"{BASE_URL}/api/recovery/logs", headers=ath_h, files=files, timeout=30)
        assert r.status_code in (200, 201), f"recovery submit failed: {r.status_code} {r.text}"

        # Verify alert exists for this athlete with severe pain message
        r = requests.get(f"{BASE_URL}/api/staff/alerts", headers=staff_h, timeout=30)
        assert r.status_code == 200, r.text
        alerts = r.json()
        # alerts may be a list or {alerts: [...]}
        if isinstance(alerts, dict):
            alerts = alerts.get("alerts", [])
        matching = [a for a in alerts
                    if a.get("athlete_id") == athlete_id
                    and "Severe pain reported" in (a.get("message") or "")
                    and "Recovery" in (a.get("message") or "")
                    and "Knee" in (a.get("message") or "")
                    and "8/10" in (a.get("message") or "")
                    and not a.get("resolved", False)]
        assert matching, f"no severe-pain Recovery alert found. alerts={alerts[:3]}"

    def test_mild_pain_recovery_does_not_create_alert(self, ath_h, staff_h, recovery_activity_id, athlete_token_and_id):
        _, athlete_id = athlete_token_and_id
        # Submit a recovery log with mild (4/10) Shoulder/Right
        pr = [{"body_region": "Shoulder", "laterality": "Right", "pain_level": 4}]
        files = {
            "activity_id": (None, recovery_activity_id),
            "pain_reports": (None, json.dumps(pr)),
            "notes": (None, "TEST_mild_no_alert"),
        }
        r = requests.post(f"{BASE_URL}/api/recovery/logs", headers=ath_h, files=files, timeout=30)
        assert r.status_code in (200, 201), r.text

        r = requests.get(f"{BASE_URL}/api/staff/alerts", headers=staff_h, timeout=30)
        assert r.status_code == 200
        alerts = r.json()
        if isinstance(alerts, dict):
            alerts = alerts.get("alerts", [])
        # No unresolved alert for Shoulder 4/10 Recovery on this athlete
        bad = [a for a in alerts
               if a.get("athlete_id") == athlete_id
               and "Shoulder" in (a.get("message") or "")
               and "4/10" in (a.get("message") or "")
               and "Recovery" in (a.get("message") or "")
               and not a.get("resolved", False)]
        assert not bad, f"mild pain should NOT create alert; found {bad}"

    def test_severe_pain_alert_is_dedup(self, ath_h, staff_h, recovery_activity_id, athlete_token_and_id):
        """Submitting the same severe pain again should not create a duplicate unresolved alert."""
        _, athlete_id = athlete_token_and_id
        pr = [{"body_region": "Knee", "laterality": "Left", "pain_level": 8}]
        files = {
            "activity_id": (None, recovery_activity_id),
            "pain_reports": (None, json.dumps(pr)),
        }
        r = requests.post(f"{BASE_URL}/api/recovery/logs", headers=ath_h, files=files, timeout=30)
        assert r.status_code in (200, 201)

        r = requests.get(f"{BASE_URL}/api/staff/alerts", headers=staff_h, timeout=30)
        alerts = r.json()
        if isinstance(alerts, dict):
            alerts = alerts.get("alerts", [])
        unresolved = [a for a in alerts
                      if a.get("athlete_id") == athlete_id
                      and "Severe pain reported" in (a.get("message") or "")
                      and "Knee" in (a.get("message") or "")
                      and "Recovery" in (a.get("message") or "")
                      and "8/10" in (a.get("message") or "")
                      and not a.get("resolved", False)]
        assert len(unresolved) == 1, f"expected exactly 1 dedup alert, got {len(unresolved)}"


# ------------------------------------------------------------
# Tests: Daily Pain by Region returns rich entries
# ------------------------------------------------------------
class TestDailyPainEntries:
    def test_daily_pain_returns_entries_with_source(self, staff_h, athlete_token_and_id):
        _, athlete_id = athlete_token_and_id
        r = requests.get(
            f"{BASE_URL}/api/staff/dashboard/daily-pain",
            headers=staff_h, params={"days_ago": 0}, timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        regions = data.get("pain_regions", [])
        # Find Knee region from the severe-pain Recovery submission above
        knee = next((rg for rg in regions if rg.get("region") == "Knee"), None)
        assert knee is not None, f"Knee region not present. regions={[rg['region'] for rg in regions]}"
        entries = knee.get("entries", [])
        assert entries, "Knee region has no entries"
        # At least one entry must have source=Recovery + this athlete + pain_level 8 + laterality Left
        match = [e for e in entries
                 if e.get("athlete_id") == athlete_id
                 and e.get("source") == "Recovery"
                 and e.get("laterality") == "Left"
                 and e.get("pain_level") == 8
                 and e.get("athlete_name")]
        assert match, f"expected recovery Knee Left 8/10 entry by this athlete, got {entries}"


# ------------------------------------------------------------
# Tests: Athlete Pain Report tab returns recent_reports w/ source
# ------------------------------------------------------------
class TestAthletePainReport:
    def test_pain_report_recent_includes_recovery_source(self, staff_h, athlete_token_and_id):
        _, athlete_id = athlete_token_and_id
        r = requests.get(
            f"{BASE_URL}/api/staff/athlete/{athlete_id}/pain-report",
            headers=staff_h, timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        recent = data.get("recent_reports") or []
        assert recent, "recent_reports is empty"
        # Each report should expose a source field
        sources = {r.get("source") for r in recent}
        assert "Recovery" in sources, f"expected Recovery source in recent_reports, got sources={sources}"
        # Validate shape of one entry
        rec = next((r for r in recent if r.get("source") == "Recovery"), None)
        assert rec is not None
        assert rec.get("body_region") or rec.get("region")
        assert rec.get("pain_level") is not None
        assert rec.get("date")


# ------------------------------------------------------------
# Tests: Recovery proofs gallery filters
# ------------------------------------------------------------
class TestProofsFilters:
    def test_proofs_endpoint_basic(self, staff_h):
        r = requests.get(f"{BASE_URL}/api/recovery/proofs", headers=staff_h, params={"days": 30}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "proofs" in data and "count" in data
        assert isinstance(data["proofs"], list)
        assert data["count"] == len(data["proofs"])

    def test_proofs_date_range_filter(self, staff_h):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(
            f"{BASE_URL}/api/recovery/proofs",
            headers=staff_h, params={"start_date": today, "end_date": today}, timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # All proofs returned must have date == today
        for p in data["proofs"]:
            assert p.get("date") == today, f"out-of-range proof: {p}"

    def test_proofs_team_filter(self, staff_h):
        r = requests.get(
            f"{BASE_URL}/api/recovery/proofs",
            headers=staff_h, params={"team": "Brazil Lacrosse Men", "days": 30}, timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        for p in data["proofs"]:
            # team field on proof should match (or be unknown -> we allow exact match check)
            assert p.get("team") == "Brazil Lacrosse Men", f"wrong team in proofs: {p}"

    def test_proofs_category_filter(self, staff_h):
        # Pick a real category from any existing proof
        r = requests.get(f"{BASE_URL}/api/recovery/proofs", headers=staff_h, params={"days": 60}, timeout=30)
        proofs = r.json().get("proofs", [])
        if not proofs:
            pytest.skip("no proofs to test category filter")
        cat = next((p.get("category") for p in proofs if p.get("category")), None)
        if not cat:
            pytest.skip("no categorized proofs")
        r2 = requests.get(
            f"{BASE_URL}/api/recovery/proofs",
            headers=staff_h, params={"category": cat, "days": 60}, timeout=30,
        )
        assert r2.status_code == 200
        data = r2.json()
        for p in data["proofs"]:
            assert p.get("category") == cat

    def test_proofs_empty_future_range(self, staff_h):
        # A future date range should return empty
        r = requests.get(
            f"{BASE_URL}/api/recovery/proofs",
            headers=staff_h, params={"start_date": "2099-01-01", "end_date": "2099-01-07"}, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["count"] == 0
