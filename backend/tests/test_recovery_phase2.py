"""
Backend tests for Recovery Points Phase 2 changes + Staff readiness-radar bug fix.

Covers:
- GET /api/recovery/staff/overview (KPIs, alerts, leaderboard, heatmap, trends, relationships)
  with default and ?team=, ?days=7/30 variations.
- POST /api/recovery/logs WITHOUT file -> now SUCCESS (proof optional), has_proof=False, status=approved
- POST /api/recovery/logs WITH file -> still works, has_proof=True
- Multiple submissions same day for same activity allowed and increase day points
- GET /api/recovery/catalog includes Yoga (Silver, 25)
- GET /api/staff/dashboard/readiness-radar today -> athletes_count>0, radar_data 5 dims
"""
import io
import os
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cristina.velez@brasillacrosse.com"
ADMIN_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"


def _png_bytes():
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, data):
        return (struct.pack(">I", len(data)) + t + data
                + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\xff\xff")
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def H(t):
    return {"Authorization": f"Bearer {t}"}


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


# ---- Catalog: Yoga -------------------------------------------------------
class TestYogaActivity:
    def test_catalog_contains_yoga_silver_25(self, athlete_auth):
        tok, _ = athlete_auth
        r = requests.get(f"{API}/recovery/catalog", headers=H(tok), timeout=15)
        assert r.status_code == 200
        activities = r.json()["activities"]
        yoga = [a for a in activities if a.get("name", "").lower() == "yoga"]
        assert len(yoga) >= 1, "Yoga activity missing from catalog"
        a = yoga[0]
        assert a["category"] == "Silver", f"Yoga not in Silver: {a}"
        assert a["points"] == 25, f"Yoga points != 25: {a}"


# ---- Submit without file (proof optional) --------------------------------
class TestProofOptional:
    def test_submit_without_file_succeeds(self, athlete_auth):
        tok, _ = athlete_auth
        cat = requests.get(f"{API}/recovery/catalog", headers=H(tok)).json()
        activity = next(a for a in cat["activities"] if a.get("is_default"))
        # Confirm automatic mode (else test cannot assert status=approved)
        assert cat["settings"]["approval_mode"] == "automatic", \
            "Test requires automatic approval mode"

        r = requests.post(f"{API}/recovery/logs", headers=H(tok),
                          data={"activity_id": activity["id"], "notes": "TEST_no_file"},
                          timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        j = r.json()
        assert j["success"] is True
        assert j["status"] == "approved", f"expected approved, got {j}"
        assert j["awarded"] is True
        log = j["log"]
        assert log.get("has_proof") is False, f"has_proof should be False without file: {log}"
        # No file_id (or null)
        assert not log.get("file_id"), f"file_id should be absent/null: {log}"

    def test_submit_with_file_still_works(self, athlete_auth):
        tok, _ = athlete_auth
        cat = requests.get(f"{API}/recovery/catalog", headers=H(tok)).json()
        activity = next(a for a in cat["activities"] if a.get("is_default"))
        files = {"file": ("proof.png", _png_bytes(), "image/png")}
        r = requests.post(f"{API}/recovery/logs", headers=H(tok),
                          data={"activity_id": activity["id"], "notes": "TEST_with_file"},
                          files=files, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "approved"
        assert j["log"].get("has_proof") is True
        assert j["log"].get("file_id")


# ---- Multiple submissions same day --------------------------------------
class TestMultipleSubmissionsPerDay:
    def test_double_submit_same_activity_increases_points(self, athlete_auth):
        tok, _ = athlete_auth
        cat = requests.get(f"{API}/recovery/catalog", headers=H(tok)).json()
        # Use Yoga (Silver, 25) so the delta is predictable
        yoga = next(a for a in cat["activities"] if a["name"].lower() == "yoga")
        before = requests.get(f"{API}/recovery/today", headers=H(tok)).json()["points"]

        r1 = requests.post(f"{API}/recovery/logs", headers=H(tok),
                           data={"activity_id": yoga["id"], "notes": "TEST_dup1"}, timeout=20)
        assert r1.status_code == 200, r1.text
        assert r1.json()["status"] == "approved"

        r2 = requests.post(f"{API}/recovery/logs", headers=H(tok),
                           data={"activity_id": yoga["id"], "notes": "TEST_dup2"}, timeout=20)
        assert r2.status_code == 200, f"second submission rejected: {r2.status_code} {r2.text}"
        assert r2.json()["status"] == "approved"

        after = requests.get(f"{API}/recovery/today", headers=H(tok)).json()["points"]
        assert after >= before + 2 * yoga["points"], \
            f"day_points did not increase by 2x yoga: before={before} after={after}"


# ---- Staff overview ------------------------------------------------------
class TestStaffOverview:
    def _get_overview(self, admin_token, params=None):
        r = requests.get(f"{API}/recovery/staff/overview",
                         headers=H(admin_token), params=params or {}, timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        return r.json()

    def test_overview_default_days_14(self, admin_token):
        data = self._get_overview(admin_token, {"days": 14})
        # KPIs
        k = data["kpis"]
        for key in ("avg_recovery_points_today", "team_compliance_pct",
                    "athletes_above_goal", "athletes_below_goal",
                    "streak_leader", "pending_approvals", "total_athletes"):
            assert key in k, f"missing kpi {key}: {k}"
        assert k["total_athletes"] > 0
        # streak_leader could be None if no streaks; if present, must have name+streak
        sl = k["streak_leader"]
        if sl is not None:
            assert "name" in sl and "streak" in sl

        # Alerts
        assert isinstance(data["alerts"], list)
        for a in data["alerts"]:
            assert a.get("severity") in ("red", "orange", "yellow"), f"bad severity: {a}"
            assert a.get("message")

        # Leaderboard
        lb = data["leaderboard"]
        assert isinstance(lb, list) and len(lb) > 0
        for row in lb:
            for key in ("rank", "name", "total_points", "avg_points",
                        "streak", "compliance_pct"):
                assert key in row, f"missing leaderboard key {key}: {row}"

        # Heatmap
        hm = data["heatmap"]
        assert isinstance(hm["dates"], list) and len(hm["dates"]) == 14
        assert isinstance(hm["rows"], list) and len(hm["rows"]) > 0
        first_row = hm["rows"][0]
        assert isinstance(first_row["cells"], list) and len(first_row["cells"]) == 14
        for c in first_row["cells"]:
            assert "date" in c and "points" in c and "color" in c
            assert c["color"] in ("red", "orange", "yellow", "green", "gray", None) \
                or isinstance(c["color"], str)

        # Trends
        tr = data["trends"]
        assert isinstance(tr["daily"], list) and len(tr["daily"]) == 14
        assert isinstance(tr["category_breakdown"], list)

        # Relationships (may be empty lists if no data)
        rel = data["relationships"]
        assert isinstance(rel.get("recovery_vs_readiness"), list)
        assert isinstance(rel.get("recovery_vs_pain"), list)

    def test_overview_days_7(self, admin_token):
        data = self._get_overview(admin_token, {"days": 7})
        assert len(data["heatmap"]["dates"]) == 7
        assert len(data["trends"]["daily"]) == 7

    def test_overview_days_30(self, admin_token):
        data = self._get_overview(admin_token, {"days": 30})
        assert len(data["heatmap"]["dates"]) == 30
        assert len(data["trends"]["daily"]) == 30

    def test_overview_team_filter(self, admin_token):
        data = self._get_overview(admin_token,
                                  {"days": 14, "team": "Brazil Lacrosse Men"})
        assert data["kpis"]["total_athletes"] >= 1
        # all leaderboard names should belong to that team (smoke: just nonzero)
        assert len(data["leaderboard"]) >= 1


# ---- Readiness radar bug fix --------------------------------------------
class TestReadinessRadar:
    def test_radar_today_has_data(self, admin_token):
        # endpoint as documented in review_request
        r = requests.get(f"{API}/staff/dashboard/readiness-radar",
                         headers=H(admin_token), params={"timeframe": "today"}, timeout=15)
        # tolerate either timeframe or no params - try both
        if r.status_code != 200:
            r = requests.get(f"{API}/staff/dashboard/readiness-radar",
                             headers=H(admin_token), timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        j = r.json()
        # Common shapes
        athletes_count = j.get("athletes_count")
        radar_data = j.get("radar_data") or j.get("data") or []
        assert athletes_count is not None, f"athletes_count missing: {j}"
        assert athletes_count > 0, f"athletes_count should be > 0 today: {j}"
        assert isinstance(radar_data, list) and len(radar_data) == 5, \
            f"radar_data should have 5 dimensions, got: {radar_data}"
        dims = {d.get("dimension") or d.get("name") or d.get("label") for d in radar_data}
        expected = {"Sleep Quality", "Energy Level", "Muscle Recovery",
                    "Mental Wellness", "Readiness to Train"}
        missing = expected - dims
        assert not missing, f"missing radar dimensions: {missing} (got {dims})"
