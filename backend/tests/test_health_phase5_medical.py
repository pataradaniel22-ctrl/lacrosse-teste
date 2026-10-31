"""
Phase 5 - Medical follow-up (alerts / review-queue / review / athlete messages)
Tests the new OSTRC-H2 medical follow-up endpoints introduced in this iteration.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

STAFF_EMAIL = "cristina.velez@brasillacrosse.com"
STAFF_PASSWORD = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASSWORD = "demo123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def staff_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def athlete_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ATHLETE_EMAIL, "password": ATHLETE_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------- 1. Alerts endpoint ----------
class TestAlerts:
    def test_alerts_staff_ok(self, staff_token):
        r = requests.get(f"{API}/health/staff/alerts", headers=_h(staff_token))
        assert r.status_code == 200
        j = r.json()
        assert "alerts" in j and "active_count" in j
        assert isinstance(j["alerts"], list)
        assert isinstance(j["active_count"], int)
        # shape assertions on first alert (if any)
        if j["alerts"]:
            a = j["alerts"][0]
            for k in ("athlete_id", "athlete_name", "athlete_email",
                     "type", "severity", "message", "handled", "submission_id"):
                assert k in a, f"alert missing key {k}"
            assert a["type"] in ("substantial", "contact", "worsening")
            assert isinstance(a["handled"], bool)
            # BUG-FIX regression: athlete_email must be populated (mailto: link)
            assert a["athlete_email"], f"athlete_email is empty for {a['athlete_name']}"
            assert "@" in a["athlete_email"]
        # active_count equals number of not-handled alerts
        assert j["active_count"] == sum(1 for x in j["alerts"] if not x["handled"])

    def test_alerts_athlete_forbidden(self, athlete_token):
        r = requests.get(f"{API}/health/staff/alerts", headers=_h(athlete_token))
        assert r.status_code == 403

    def test_alerts_no_auth(self):
        r = requests.get(f"{API}/health/staff/alerts")
        assert r.status_code in (401, 403)


# ---------- 2. Review queue endpoint ----------
class TestReviewQueue:
    def test_review_queue_staff_ok(self, staff_token):
        r = requests.get(f"{API}/health/staff/review-queue", headers=_h(staff_token))
        assert r.status_code == 200
        j = r.json()
        assert "items" in j and "pending_count" in j
        assert isinstance(j["items"], list)
        assert isinstance(j["pending_count"], int)
        if j["items"]:
            it = j["items"][0]
            for k in ("submission_id", "athlete_id", "athlete_name",
                     "review_status", "notes_count"):
                assert k in it
            assert it["review_status"] in ("not_reviewed", "in_review", "reviewed")
        # sort order: not_reviewed first
        statuses = [i["review_status"] for i in j["items"]]
        rank = {"not_reviewed": 0, "in_review": 1, "reviewed": 2}
        assert statuses == sorted(statuses, key=lambda s: rank.get(s, 0))
        # pending_count matches not-reviewed count
        assert j["pending_count"] == sum(1 for x in j["items"] if x["review_status"] != "reviewed")

    def test_review_queue_athlete_forbidden(self, athlete_token):
        r = requests.get(f"{API}/health/staff/review-queue", headers=_h(athlete_token))
        assert r.status_code == 403


# ---------- 3. Review submission (notes + mark reviewed) ----------
class TestReviewSubmission:
    def test_review_unknown_submission_404(self, staff_token):
        r = requests.post(f"{API}/health/staff/review/does-not-exist",
                          headers=_h(staff_token),
                          json={"note": "hi", "mark_reviewed": False})
        assert r.status_code == 404

    def test_review_athlete_forbidden(self, athlete_token, staff_token):
        # find a submission id first
        q = requests.get(f"{API}/health/staff/review-queue", headers=_h(staff_token)).json()
        if not q["items"]:
            pytest.skip("no submissions in queue")
        sid = q["items"][0]["submission_id"]
        r = requests.post(f"{API}/health/staff/review/{sid}",
                          headers=_h(athlete_token),
                          json={"note": "TEST", "mark_reviewed": False})
        assert r.status_code == 403

    def test_note_without_mark_sets_in_review(self, staff_token):
        q = requests.get(f"{API}/health/staff/review-queue", headers=_h(staff_token)).json()
        cand = next((i for i in q["items"] if i["review_status"] == "not_reviewed"), None)
        if not cand:
            pytest.skip("no not_reviewed submissions available")
        sid = cand["submission_id"]
        pre_notes = cand["notes_count"]
        r = requests.post(f"{API}/health/staff/review/{sid}",
                          headers=_h(staff_token),
                          json={"note": "TEST_in_review_note",
                                "visible_to_athlete": False,
                                "mark_reviewed": False})
        assert r.status_code == 200
        j = r.json()
        assert j["review_status"] == "in_review"
        assert len(j["medical_notes"]) == pre_notes + 1
        assert j["medical_notes"][-1]["text"] == "TEST_in_review_note"
        assert j["medical_notes"][-1]["visible_to_athlete"] is False
        assert "author" in j["medical_notes"][-1]
        assert "created_at" in j["medical_notes"][-1]


# ---------- 4. Athlete messages (only visible notes) ----------
class TestAthleteMessages:
    def test_messages_shape(self, athlete_token):
        r = requests.get(f"{API}/health/athlete/messages", headers=_h(athlete_token))
        assert r.status_code == 200
        j = r.json()
        assert "messages" in j
        assert isinstance(j["messages"], list)
        # every returned message must have text/from/date fields
        for m in j["messages"]:
            assert "text" in m and "from" in m and "date" in m

    def test_visible_vs_private_isolation(self, staff_token, athlete_token):
        # Resolve lucas athlete_id via staff athletes list
        alist = requests.get(f"{API}/staff/athletes", headers=_h(staff_token)).json()
        lucas = next((x for x in alist if x.get("email") == ATHLETE_EMAIL), None)
        assert lucas, "lucas.silva not found in staff/athletes"
        aid = lucas["id"]
        # Fetch his health profile to grab any submission id
        prof = requests.get(f"{API}/health/staff/athlete/{aid}",
                            headers=_h(staff_token)).json()
        subs = prof.get("submissions", [])
        if not subs:
            pytest.skip("lucas has no weekly submissions")
        sid = subs[0]["id"]

        # add one visible + one private note
        v = requests.post(f"{API}/health/staff/review/{sid}", headers=_h(staff_token),
                          json={"note": "TEST_visible_note_for_athlete",
                                "visible_to_athlete": True, "mark_reviewed": False})
        assert v.status_code == 200
        p = requests.post(f"{API}/health/staff/review/{sid}", headers=_h(staff_token),
                          json={"note": "TEST_private_staff_only_note",
                                "visible_to_athlete": False, "mark_reviewed": False})
        assert p.status_code == 200

        # athlete fetches messages
        r = requests.get(f"{API}/health/athlete/messages", headers=_h(athlete_token))
        assert r.status_code == 200
        msgs = r.json()["messages"]
        texts = [m["text"] for m in msgs]
        assert "TEST_visible_note_for_athlete" in texts
        assert "TEST_private_staff_only_note" not in texts


# ---------- 5. End-to-end review cycle: handled=true & active_count decreases ----------
class TestE2EReviewCycle:
    def test_review_cycle_flips_handled(self, staff_token):
        alerts_before = requests.get(f"{API}/health/staff/alerts",
                                     headers=_h(staff_token)).json()
        unhandled = [a for a in alerts_before["alerts"] if not a["handled"]]
        if not unhandled:
            pytest.skip("no unhandled alerts to review")
        target = unhandled[0]
        sid = target["submission_id"]
        aid = target["athlete_id"]
        pre_active = alerts_before["active_count"]

        # count how many not-handled alerts belong to this athlete BEFORE
        pre_for_ath = sum(1 for a in alerts_before["alerts"]
                          if a["athlete_id"] == aid and not a["handled"])

        r = requests.post(f"{API}/health/staff/review/{sid}", headers=_h(staff_token),
                          json={"note": "TEST_e2e_mark_reviewed",
                                "visible_to_athlete": False, "mark_reviewed": True})
        assert r.status_code == 200
        assert r.json()["review_status"] == "reviewed"

        alerts_after = requests.get(f"{API}/health/staff/alerts",
                                    headers=_h(staff_token)).json()
        # all alerts for this athlete (same submission) should now be handled=true
        ath_alerts = [a for a in alerts_after["alerts"] if a["athlete_id"] == aid]
        assert ath_alerts, "athlete disappeared from alerts list"
        assert all(a["handled"] for a in ath_alerts), \
            f"expected all alerts for {aid} to be handled after review, got {ath_alerts}"
        # active_count decreased by exactly the number of unhandled alerts this athlete had
        assert alerts_after["active_count"] == pre_active - pre_for_ath
