"""
Backend tests for Recovery Points Ecosystem - Phase 1.
Covers: catalog, log submission (with proof file), today, my-summary, file serving,
manual/automatic approval flow, admin activity create, non-admin 403.
"""
import io
import os
import struct
import zlib
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cristina.velez@brasillacrosse.com"
ADMIN_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE2_EMAIL = "pedro.santos@email.com"
ATHLETE_PASSWORD = "demo123"
COACH_EMAIL = "coach@brazillacrosse.com"
COACH_PASSWORD = "staff123"


def _png_bytes():
    """Generate a minimal valid 1x1 PNG (no external deps)."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(t, data):
        return (struct.pack(">I", len(data)) + t + data
                + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\xff\xff")
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def athlete_token_and_id():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ATHLETE_EMAIL, "password": ATHLETE_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"athlete login failed: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]["id"]


@pytest.fixture(scope="session")
def athlete2_token_and_id():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ATHLETE2_EMAIL, "password": ATHLETE_PASSWORD}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    return j["token"], j["user"]["id"]


@pytest.fixture(scope="session")
def coach_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": COACH_EMAIL, "password": COACH_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"coach account unavailable: {r.status_code}")
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


# -------------------- CATALOG --------------------
class TestCatalog:
    def test_catalog_structure(self, athlete_token_and_id):
        tok, _ = athlete_token_and_id
        r = requests.get(f"{API}/recovery/catalog", headers=H(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "categories" in data and "activities" in data and "settings" in data
        cat_names = [c["name"] for c in data["categories"]]
        for name in ("Gold", "Silver", "Bronze"):
            assert name in cat_names, f"missing default category {name}"
        # default points mapping per spec
        cat_pts = {c["name"]: c.get("default_points") for c in data["categories"]}
        assert cat_pts.get("Gold") == 40
        assert cat_pts.get("Silver") == 25
        assert cat_pts.get("Bronze") == 15
        # 14 default activities
        defaults = [a for a in data["activities"] if a.get("is_default")]
        assert len(defaults) >= 14, f"expected >=14 default activities, got {len(defaults)}"
        # settings present
        s = data["settings"]
        assert s["approval_mode"] in ("automatic", "manual")
        assert isinstance(s["daily_target"], int)


# -------------------- LOG SUBMISSION (auto mode) --------------------
class TestLogSubmissionAuto:
    def test_submit_without_file_succeeds(self, athlete_token_and_id):
        # Proof photo is OPTIONAL: submitting without a file must succeed.
        tok, _ = athlete_token_and_id
        cat = requests.get(f"{API}/recovery/catalog", headers=H(tok)).json()
        activity_id = cat["activities"][0]["id"]
        r = requests.post(f"{API}/recovery/logs", headers=H(tok),
                          data={"activity_id": activity_id, "notes": "TEST_no_file"}, timeout=15)
        assert r.status_code == 200, f"expected 200 (proof optional), got {r.status_code}: {r.text}"

    def test_submit_auto_awards_points(self, athlete_token_and_id):
        tok, _ = athlete_token_and_id
        # ensure automatic mode (try via admin in another test). Here we just submit.
        cat = requests.get(f"{API}/recovery/catalog", headers=H(tok)).json()
        activity = next(a for a in cat["activities"] if a.get("is_default"))
        files = {"file": ("proof.png", _png_bytes(), "image/png")}
        data = {"activity_id": activity["id"], "notes": "TEST_auto_submit"}
        r = requests.post(f"{API}/recovery/logs", headers=H(tok),
                          data=data, files=files, timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        j = r.json()
        assert j["success"] is True
        # automatic mode default: should be awarded
        if j["status"] == "approved":
            assert j["awarded"] is True
            assert j["log"]["points"] == activity["points"]
        # save the log id + file_id for downstream tests
        pytest.shared_log_id = j["log"]["id"]
        pytest.shared_file_id = j["log"]["file_id"]


# -------------------- TODAY / SUMMARY --------------------
class TestAthleteSummaries:
    def test_today(self, athlete_token_and_id):
        tok, _ = athlete_token_and_id
        r = requests.get(f"{API}/recovery/today", headers=H(tok), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("points", "target", "color", "goal_achieved", "remaining", "streak", "logs"):
            assert k in j, f"missing key {k}"
        assert j["color"] in ("red", "orange", "yellow", "green")
        assert isinstance(j["logs"], list)

    def test_my_summary(self, athlete_token_and_id):
        tok, _ = athlete_token_and_id
        r = requests.get(f"{API}/recovery/my-summary", headers=H(tok), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("target", "streak", "compliance", "badges", "series_14d"):
            assert k in j, f"missing key {k}"
        assert "compliance_pct" in j["compliance"]
        assert isinstance(j["badges"], list)
        assert isinstance(j["series_14d"], list) and len(j["series_14d"]) == 14


# -------------------- PROOF FILE SERVING --------------------
class TestProofFiles:
    def test_athlete_access_own_file(self, athlete_token_and_id):
        tok, _ = athlete_token_and_id
        file_id = getattr(pytest, "shared_file_id", None)
        if not file_id:
            pytest.skip("no file_id from prior submission")
        # via query token
        r = requests.get(f"{API}/recovery/files/{file_id}?auth={tok}", timeout=15)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/")

    def test_other_athlete_forbidden(self, athlete2_token_and_id):
        tok2, _ = athlete2_token_and_id
        file_id = getattr(pytest, "shared_file_id", None)
        if not file_id:
            pytest.skip("no file_id from prior submission")
        r = requests.get(f"{API}/recovery/files/{file_id}?auth={tok2}", timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_staff_can_access(self, admin_token):
        file_id = getattr(pytest, "shared_file_id", None)
        if not file_id:
            pytest.skip("no file_id from prior submission")
        r = requests.get(f"{API}/recovery/files/{file_id}?auth={admin_token}", timeout=15)
        assert r.status_code == 200


# -------------------- MANUAL APPROVAL FLOW --------------------
class TestManualApprovalFlow:
    def test_full_flow(self, admin_token, athlete_token_and_id):
        atok, _ = athlete_token_and_id
        # 1. Switch to manual
        r = requests.put(f"{API}/recovery/settings", headers=H(admin_token),
                         json={"approval_mode": "manual", "daily_target": 100}, timeout=15)
        assert r.status_code == 200, r.text
        try:
            # 2. Athlete submits -> should be pending
            cat = requests.get(f"{API}/recovery/catalog", headers=H(atok)).json()
            activity = next(a for a in cat["activities"] if a.get("is_default"))
            files = {"file": ("proof.png", _png_bytes(), "image/png")}
            r = requests.post(f"{API}/recovery/logs", headers=H(atok),
                              data={"activity_id": activity["id"], "notes": "TEST_manual"},
                              files=files, timeout=20)
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["status"] == "pending"
            assert j["awarded"] is False
            pending_log_id = j["log"]["id"]

            # 3. Staff lists pending
            r = requests.get(f"{API}/recovery/pending", headers=H(admin_token), timeout=15)
            assert r.status_code == 200
            body = r.json()
            pending = body.get("pending") or body.get("logs") or (body if isinstance(body, list) else [])
            ids = [lg["id"] for lg in pending]
            assert pending_log_id in ids, f"pending log not found in queue: {body}"

            # 4. Approve it
            r = requests.post(f"{API}/recovery/logs/{pending_log_id}/review",
                              headers=H(admin_token),
                              json={"action": "approve"}, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "approved"
        finally:
            # 5. Reset back to automatic regardless
            requests.put(f"{API}/recovery/settings", headers=H(admin_token),
                         json={"approval_mode": "automatic", "daily_target": 100}, timeout=15)


# -------------------- ADMIN: CREATE ACTIVITY + AUTHZ --------------------
class TestAdminAuthz:
    def test_admin_create_custom_activity(self, admin_token):
        body = {"name": f"TEST_Ice Bath {int(time.time())}",
                "category": "Silver", "points": 30, "icon": "snowflake"}
        r = requests.post(f"{API}/recovery/activities", headers=H(admin_token),
                          json=body, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["success"] is True
        new_id = j["activity"]["id"]
        # verify present in catalog
        r2 = requests.get(f"{API}/recovery/catalog", headers=H(admin_token))
        ids = [a["id"] for a in r2.json()["activities"]]
        assert new_id in ids
        # cleanup
        requests.delete(f"{API}/recovery/activities/{new_id}", headers=H(admin_token))

    def test_non_admin_staff_cannot_create_activity(self, coach_token):
        body = {"name": "TEST_should_fail", "category": "Bronze", "points": 10}
        r = requests.post(f"{API}/recovery/activities", headers=H(coach_token),
                          json=body, timeout=15)
        assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code} {r.text}"

    def test_non_admin_staff_cannot_change_settings(self, coach_token):
        r = requests.put(f"{API}/recovery/settings", headers=H(coach_token),
                         json={"approval_mode": "manual", "daily_target": 100}, timeout=15)
        assert r.status_code == 403
