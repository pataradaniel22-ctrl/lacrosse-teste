"""Backend tests for research adherence + Google Sheets live feeds (iteration 34)."""
import csv
import io
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "cristina.velez@brasillacrosse.com", "password": "123456", "user_type": "staff"}
COACH = {"email": "coach@brazillacrosse.com", "password": "staff123", "user_type": "staff"}
ATHLETE = {"email": "lucas.silva@email.com", "password": "demo123", "user_type": "athlete"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_h():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def coach_h():
    return _login(COACH)


@pytest.fixture(scope="module")
def athlete_h():
    return _login(ATHLETE)


# ---- Adherence ----
class TestAdherence:
    def test_adherence_admin_all_time(self, admin_h):
        r = requests.get(f"{API}/research/adherence", headers=admin_h, timeout=60)
        assert r.status_code == 200
        d = r.json()
        for k in ("weeks", "athletes", "team_weekly", "overall"):
            assert k in d
        assert isinstance(d["athletes"], list) and len(d["athletes"]) > 0
        # Check week_start is Monday
        from datetime import datetime
        for w in d["weeks"]:
            assert datetime.strptime(w, "%Y-%m-%d").weekday() == 0
        # Check structure of one athlete-week
        a = d["athletes"][0]
        for key in ("athlete_code", "team", "weeks", "avg"):
            assert key in a
        # One week math check
        if a["weeks"]:
            w = next(iter(a["weeks"].values()))
            # overall = round((morning + ostrc*100 + recovery)/3)
            # ostrc_pct = 100 if ostrc_submitted else 0, but stored as ostrc_pct
            expected = round((w["morning_pct"] + w["ostrc_pct"] + w["recovery_pct"]) / 3)
            assert w["overall_pct"] == expected, f"overall math off: {w}"
            # morning_pct = round(100*morning_days/days_in_period)
            if w["days_in_period"]:
                assert w["morning_pct"] == round(100 * w["morning_days"] / w["days_in_period"])

    def test_adherence_period_filter(self, admin_h):
        r = requests.get(f"{API}/research/adherence?start=2026-07-01&end=2026-07-31",
                         headers=admin_h, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert len(d["weeks"]) >= 4
        # Should have some non-zero overall adherence in this window (demo data lives here)
        has_data = any(a["avg"]["overall_pct"] > 0 for a in d["athletes"])
        assert has_data, "Expected non-zero adherence in July 2026"

    def test_adherence_team_filter(self, admin_h):
        # First get a team
        rr = requests.get(f"{API}/research/datasets", headers=admin_h, timeout=30)
        teams = rr.json().get("teams", [])
        assert teams
        t = teams[0]
        r = requests.get(f"{API}/research/adherence?team={t}", headers=admin_h, timeout=60)
        assert r.status_code == 200
        for a in r.json()["athletes"]:
            assert a["team"] == t

    def test_adherence_coach_forbidden(self, coach_h):
        r = requests.get(f"{API}/research/adherence", headers=coach_h, timeout=30)
        assert r.status_code == 403

    def test_adherence_athlete_forbidden(self, athlete_h):
        r = requests.get(f"{API}/research/adherence", headers=athlete_h, timeout=30)
        assert r.status_code == 403


# ---- adherence_weekly dataset ----
class TestAdherenceDataset:
    def test_datasets_includes_adherence_weekly(self, admin_h):
        r = requests.get(f"{API}/research/datasets", headers=admin_h, timeout=60)
        assert r.status_code == 200
        d = r.json()
        keys = {x["key"] for x in d["datasets"]}
        assert "adherence_weekly" in keys
        assert len(d["datasets"]) == 12

    def test_preview_adherence_weekly(self, admin_h):
        r = requests.get(f"{API}/research/preview/adherence_weekly?start=2026-07-01&end=2026-07-31",
                         headers=admin_h, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["key"] == "adherence_weekly"
        assert d["total"] > 0
        row = d["rows"][0]
        for col in ("week_start", "week_end", "morning_pct", "ostrc_pct", "recovery_pct", "overall_pct"):
            assert col in row

    def test_export_adherence_xlsx(self, admin_h):
        r = requests.get(f"{API}/research/export?datasets=adherence_weekly&format=xlsx&start=2026-07-01&end=2026-07-31",
                         headers=admin_h, timeout=60)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        assert len(r.content) > 1000

    def test_export_adherence_csv(self, admin_h):
        r = requests.get(f"{API}/research/export?datasets=adherence_weekly&format=csv&start=2026-07-01&end=2026-07-31",
                         headers=admin_h, timeout=60)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        text = r.content.decode("utf-8-sig")
        assert "week_start" in text.splitlines()[0]


# ---- Feeds / Google Sheets ----
class TestFeeds:
    created_ids = []

    def test_create_feed_coach_forbidden(self, coach_h):
        r = requests.post(f"{API}/research/feeds", headers=coach_h,
                          json={"dataset": "morning_checkin"}, timeout=30)
        assert r.status_code == 403

    def test_list_feeds_coach_forbidden(self, coach_h):
        r = requests.get(f"{API}/research/feeds", headers=coach_h, timeout=30)
        assert r.status_code == 403

    def test_create_feed_unknown_dataset(self, admin_h):
        r = requests.post(f"{API}/research/feeds", headers=admin_h,
                          json={"dataset": "nope"}, timeout=30)
        assert r.status_code == 400

    def test_create_and_fetch_feed(self, admin_h):
        payload = {"dataset": "morning_checkin", "anonymize": True,
                   "period_days": 365, "name": "TEST_feed_1"}
        r = requests.post(f"{API}/research/feeds", headers=admin_h, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        f = r.json()
        for k in ("id", "token", "path", "label"):
            assert k in f
        assert f["path"] == f"/api/research/feed/{f['token']}.csv"
        TestFeeds.created_ids.append(f["id"])

        # Public fetch WITHOUT auth
        url = f"{BASE_URL}{f['path']}"
        pr = requests.get(url, timeout=60)
        assert pr.status_code == 200
        assert "text/csv" in pr.headers.get("content-type", "")
        text = pr.text
        assert text, "empty csv"
        header = next(csv.reader(io.StringIO(text)))
        # Anonymized => no athlete_name column
        assert "athlete_name" not in header
        assert "athlete_code" in header

        # access count increments
        lr = requests.get(f"{API}/research/feeds", headers=admin_h, timeout=30)
        feeds = lr.json()
        this_feed = next((x for x in feeds if x["id"] == f["id"]), None)
        assert this_feed and this_feed["access_count"] >= 1

    def test_create_feed_non_anonymized(self, admin_h):
        payload = {"dataset": "training_sessions", "anonymize": False, "name": "TEST_feed_named"}
        r = requests.post(f"{API}/research/feeds", headers=admin_h, json=payload, timeout=30)
        assert r.status_code == 200
        f = r.json()
        TestFeeds.created_ids.append(f["id"])
        pr = requests.get(f"{BASE_URL}{f['path']}", timeout=60)
        assert pr.status_code == 200
        header = next(csv.reader(io.StringIO(pr.text)))
        assert "athlete_name" in header

    def test_list_feeds(self, admin_h):
        r = requests.get(f"{API}/research/feeds", headers=admin_h, timeout=30)
        assert r.status_code == 200
        ids = {x["id"] for x in r.json()}
        for fid in TestFeeds.created_ids:
            assert fid in ids

    def test_revoke_feed(self, admin_h):
        # Revoke all created feeds and verify 404 publicly
        for fid in TestFeeds.created_ids:
            # fetch path first
            lr = requests.get(f"{API}/research/feeds", headers=admin_h, timeout=30)
            feed = next((x for x in lr.json() if x["id"] == fid), None)
            assert feed is not None, f"feed {fid} not in list before revoke"
            path = feed["path"]
            rr = requests.delete(f"{API}/research/feeds/{fid}", headers=admin_h, timeout=30)
            assert rr.status_code == 200
            # Public should now 404
            pr = requests.get(f"{BASE_URL}{path}", timeout=30)
            assert pr.status_code == 404
        TestFeeds.created_ids.clear()

    def test_revoke_feed_athlete_forbidden(self, athlete_h):
        r = requests.delete(f"{API}/research/feeds/any-id", headers=athlete_h, timeout=30)
        assert r.status_code == 403
