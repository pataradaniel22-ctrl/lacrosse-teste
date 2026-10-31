"""Tests for Research Data endpoints + OSTRC period-stats (iteration_33)."""
import io
import os
import zipfile

import pytest
import requests
from openpyxl import load_workbook

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("cristina.velez@brasillacrosse.com", "123456", "staff")
COACH = ("coach@brazillacrosse.com", "staff123", "staff")
ATHLETE = ("lucas.silva@email.com", "demo123", "athlete")

ALL_KEYS = [
    "athletes", "morning_checkin", "training_sessions", "pain_reports",
    "recovery_checks", "recovery_logs", "ostrc_responses", "ostrc_submissions",
    "health_problems", "cmj_tests", "fittest_points",
]
STAFF_OSTRC = {"ostrc_responses", "ostrc_submissions", "health_problems"}


def login(email, password, user_type):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password, "user_type": user_type})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {login(*ADMIN)}"}


@pytest.fixture(scope="module")
def coach_h():
    return {"Authorization": f"Bearer {login(*COACH)}"}


@pytest.fixture(scope="module")
def athlete_h():
    return {"Authorization": f"Bearer {login(*ATHLETE)}"}


# ---------- /research/datasets ----------
class TestDatasets:
    def test_admin_lists_11(self, admin_h):
        r = requests.get(f"{API}/research/datasets", headers=admin_h)
        assert r.status_code == 200
        data = r.json()
        keys = [d["key"] for d in data["datasets"]]
        assert set(keys) == set(ALL_KEYS)
        assert all("count" in d and "label" in d for d in data["datasets"])
        assert isinstance(data["teams"], list) and len(data["teams"]) >= 1

    def test_counts_change_with_filter(self, admin_h):
        r_all = requests.get(f"{API}/research/datasets", headers=admin_h).json()
        r_narrow = requests.get(f"{API}/research/datasets?start=2026-10-01&end=2026-10-07", headers=admin_h).json()
        all_mc = next(d["count"] for d in r_all["datasets"] if d["key"] == "morning_checkin")
        narrow_mc = next(d["count"] for d in r_narrow["datasets"] if d["key"] == "morning_checkin")
        assert narrow_mc <= all_mc

    def test_coach_sees_only_ostrc(self, coach_h):
        r = requests.get(f"{API}/research/datasets", headers=coach_h)
        assert r.status_code == 200
        keys = {d["key"] for d in r.json()["datasets"]}
        assert keys == STAFF_OSTRC

    def test_athlete_forbidden(self, athlete_h):
        r = requests.get(f"{API}/research/datasets", headers=athlete_h)
        assert r.status_code == 403


# ---------- /research/preview/{key} ----------
class TestPreview:
    @pytest.mark.parametrize("key", ALL_KEYS)
    def test_preview_each(self, admin_h, key):
        r = requests.get(f"{API}/research/preview/{key}?limit=20", headers=admin_h)
        assert r.status_code == 200, f"{key}: {r.text}"
        d = r.json()
        assert d["key"] == key
        assert "columns" in d and "rows" in d and "total" in d
        assert len(d["rows"]) <= 20

    def test_anonymize_hides_name_email(self, admin_h):
        r = requests.get(f"{API}/research/preview/athletes?anonymize=true", headers=admin_h)
        cols = r.json()["columns"]
        assert "athlete_name" not in cols
        assert "email" not in cols
        assert "athlete_code" in cols
        # athlete_code format ATH-###
        for row in r.json()["rows"][:5]:
            assert row["athlete_code"].startswith("ATH-")

        r2 = requests.get(f"{API}/research/preview/athletes?anonymize=false", headers=admin_h)
        assert "athlete_name" in r2.json()["columns"]

    def test_date_filter_bounds(self, admin_h):
        start, end = "2026-09-01", "2026-09-30"
        r = requests.get(
            f"{API}/research/preview/ostrc_submissions?start={start}&end={end}&limit=200",
            headers=admin_h,
        )
        assert r.status_code == 200
        for row in r.json()["rows"]:
            if row.get("date"):
                assert start <= row["date"][:10] <= end

    def test_include_archived_toggle(self, admin_h):
        a_true = requests.get(f"{API}/research/preview/pain_reports?include_archived=true&limit=1", headers=admin_h).json()["total"]
        a_false = requests.get(f"{API}/research/preview/pain_reports?include_archived=false&limit=1", headers=admin_h).json()["total"]
        assert a_false <= a_true

    def test_pain_other_region_display(self, admin_h):
        r = requests.get(f"{API}/research/preview/pain_reports?limit=500", headers=admin_h).json()
        others = [row for row in r["rows"] if (row.get("region_note") or "") and row.get("body_region") == "Other"]
        for row in others:
            assert row["region_display"].startswith("Other — ")

    def test_coach_preview_ostrc_ok(self, coach_h):
        for k in STAFF_OSTRC:
            r = requests.get(f"{API}/research/preview/{k}?limit=5", headers=coach_h)
            assert r.status_code == 200, f"{k}: {r.status_code}"

    def test_coach_preview_admin_dataset_forbidden(self, coach_h):
        r = requests.get(f"{API}/research/preview/morning_checkin", headers=coach_h)
        assert r.status_code == 403


# ---------- /research/export ----------
class TestExport:
    def test_xlsx_all(self, admin_h):
        r = requests.get(f"{API}/research/export?datasets=all&format=xlsx", headers=admin_h)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        wb = load_workbook(io.BytesIO(r.content), read_only=True)
        assert "README" in wb.sheetnames
        for k in ALL_KEYS:
            assert k[:31] in wb.sheetnames, f"missing sheet {k}"

    def test_csv_single(self, admin_h):
        r = requests.get(f"{API}/research/export?datasets=pain_reports&format=csv", headers=admin_h)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")

    def test_csv_multi_zip(self, admin_h):
        r = requests.get(f"{API}/research/export?datasets=athletes,pain_reports&format=csv", headers=admin_h)
        assert r.status_code == 200
        assert "application/zip" in r.headers.get("content-type", "")
        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = z.namelist()
        assert "athletes.csv" in names and "pain_reports.csv" in names

    def test_unknown_dataset_400(self, admin_h):
        r = requests.get(f"{API}/research/export?datasets=bogus&format=csv", headers=admin_h)
        assert r.status_code == 400

    def test_coach_export_all_forbidden(self, coach_h):
        r = requests.get(f"{API}/research/export?datasets=all&format=csv", headers=coach_h)
        assert r.status_code == 403

    def test_coach_export_ostrc_ok(self, coach_h):
        r = requests.get(f"{API}/research/export?datasets=ostrc_responses&format=csv", headers=coach_h)
        assert r.status_code == 200


# ---------- /health/staff/period-stats ----------
class TestPeriodStats:
    def test_coach_week(self, coach_h):
        r = requests.get(f"{API}/health/staff/period-stats?group=week", headers=coach_h)
        assert r.status_code == 200
        d = r.json()
        assert d["group"] == "week"
        assert "periods" in d and "totals" in d
        for p in d["periods"]:
            for k in ("respondents", "response_rate", "prevalence_all", "prevalence_substantial", "mean_severity", "by_category"):
                assert k in p

    def test_group_month_buckets(self, admin_h):
        r = requests.get(f"{API}/health/staff/period-stats?group=month&start=2026-01-01&end=2026-12-31", headers=admin_h)
        assert r.status_code == 200
        for p in r.json()["periods"]:
            # YYYY-MM
            assert len(p["period"]) == 7 and p["period"][4] == "-"

    def test_athlete_forbidden(self, athlete_h):
        r = requests.get(f"{API}/health/staff/period-stats", headers=athlete_h)
        assert r.status_code == 403
