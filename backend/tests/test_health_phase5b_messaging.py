"""Phase 5b — Athlete↔Staff medical messaging + report-error + delete-submission.

Covers:
- POST /api/health/athlete/messages/{note_id}/read (idempotent)
- POST /api/health/athlete/messages/reply (empty text 400, missing sub_id falls back to latest)
- POST /api/health/athlete/report-error (404 for foreign submission)
- GET  /api/health/staff/alerts (correction alert emitted, high, unhandled)
- DELETE /api/health/staff/submission/{id} (cascade + 403/404)
- E2E flow: visible/private staff notes, athlete only sees visible, marks read, replies.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
STAFF_EMAIL = "cristina.velez@brasillacrosse.com"
STAFF_PASS = "123456"
ATHLETE_EMAIL = "lucas.silva@email.com"
ATHLETE_PASS = "demo123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    d = r.json()
    return d["token"], d["user"]


@pytest.fixture(scope="module")
def staff():
    tok, user = _login(STAFF_EMAIL, STAFF_PASS)
    return {"token": tok, "user": user, "H": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def athlete():
    tok, user = _login(ATHLETE_EMAIL, ATHLETE_PASS)
    return {"token": tok, "user": user, "H": {"Authorization": f"Bearer {tok}"}}


def _latest_sub_id(staff, athlete_id):
    r = requests.get(f"{BASE_URL}/api/health/staff/athlete/{athlete_id}", headers=staff["H"], timeout=30)
    assert r.status_code == 200
    subs = r.json().get("submissions") or []
    assert subs, "no submissions for athlete"
    return subs[0]["id"]


# ---------------------------------------------------------------- messages
class TestAthleteMessagesRead:
    def test_add_visible_and_private_notes_then_athlete_sees_only_visible(self, staff, athlete):
        sub_id = _latest_sub_id(staff, athlete["user"]["id"])
        tag = f"TEST_{uuid.uuid4().hex[:6]}"

        r_pub = requests.post(f"{BASE_URL}/api/health/staff/review/{sub_id}", headers=staff["H"],
                              json={"note": f"{tag}_visible", "visible_to_athlete": True}, timeout=30)
        assert r_pub.status_code == 200
        r_pri = requests.post(f"{BASE_URL}/api/health/staff/review/{sub_id}", headers=staff["H"],
                              json={"note": f"{tag}_private", "visible_to_athlete": False}, timeout=30)
        assert r_pri.status_code == 200

        r = requests.get(f"{BASE_URL}/api/health/athlete/messages", headers=athlete["H"], timeout=30)
        assert r.status_code == 200
        msgs = r.json()["messages"]
        texts = [m["text"] for m in msgs]
        assert f"{tag}_visible" in texts
        assert f"{tag}_private" not in texts
        # find our visible note
        vis = next(m for m in msgs if m["text"] == f"{tag}_visible")
        assert vis["submission_id"] == sub_id
        assert vis["from_athlete"] is False
        # store note id via env for next tests
        pytest.LAST_VISIBLE_NOTE_ID = vis["id"]
        pytest.LAST_SUB_ID = sub_id
        pytest.LAST_TAG = tag

    def test_mark_read_and_idempotent(self, athlete):
        note_id = pytest.LAST_VISIBLE_NOTE_ID
        r1 = requests.post(f"{BASE_URL}/api/health/athlete/messages/{note_id}/read",
                           headers=athlete["H"], timeout=30)
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["success"] is True
        assert d1["updated"] == 1

        # second call must not error and must be a no-op
        r2 = requests.post(f"{BASE_URL}/api/health/athlete/messages/{note_id}/read",
                           headers=athlete["H"], timeout=30)
        assert r2.status_code == 200
        assert r2.json()["updated"] == 0

        # read_at now populated in GET
        r = requests.get(f"{BASE_URL}/api/health/athlete/messages", headers=athlete["H"], timeout=30)
        m = next(x for x in r.json()["messages"] if x["id"] == note_id)
        assert m["read_at"] is not None and "T" in m["read_at"]


# ---------------------------------------------------------------- reply
class TestAthleteReply:
    def test_empty_text_returns_400(self, athlete):
        r = requests.post(f"{BASE_URL}/api/health/athlete/messages/reply",
                          headers=athlete["H"], json={"text": "   "}, timeout=30)
        assert r.status_code == 400

    def test_reply_missing_submission_id_falls_back_to_latest(self, athlete, staff):
        text = f"TEST_reply_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/health/athlete/messages/reply",
                          headers=athlete["H"], json={"text": text}, timeout=30)
        assert r.status_code == 200
        note = r.json()["note"]
        assert note["from_athlete"] is True
        assert note["visible_to_athlete"] is True
        assert note["text"] == text
        # appears in GET as from_athlete=True
        r2 = requests.get(f"{BASE_URL}/api/health/athlete/messages", headers=athlete["H"], timeout=30)
        found = next((m for m in r2.json()["messages"] if m["text"] == text), None)
        assert found is not None
        assert found["from_athlete"] is True

    def test_reply_with_explicit_submission_id(self, athlete):
        text = f"TEST_reply2_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/health/athlete/messages/reply",
                          headers=athlete["H"],
                          json={"text": text, "submission_id": pytest.LAST_SUB_ID}, timeout=30)
        assert r.status_code == 200


# ---------------------------------------------------------------- report-error
class TestReportError:
    def test_report_error_on_own_submission(self, athlete, staff):
        # Create a throwaway no_problem submission first via the athlete
        # to avoid touching demo data, but the athlete may not be due; skip this
        # if not due and use LAST_SUB_ID instead.
        r = requests.post(f"{BASE_URL}/api/health/athlete/report-error", headers=athlete["H"],
                          json={"submission_id": pytest.LAST_SUB_ID,
                                "reason": "TEST_wrong_answers_pls_delete"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_report_error_unknown_sub_returns_404(self, athlete):
        r = requests.post(f"{BASE_URL}/api/health/athlete/report-error", headers=athlete["H"],
                          json={"submission_id": "does-not-exist-uuid", "reason": "x"}, timeout=30)
        assert r.status_code == 404

    def test_report_error_on_foreign_submission_returns_404(self, athlete, staff):
        # find another athlete's latest submission
        r = requests.get(f"{BASE_URL}/api/staff/athletes", headers=staff["H"], timeout=30)
        assert r.status_code == 200
        others = [a for a in r.json() if a["id"] != athlete["user"]["id"]]
        assert others, "need at least 2 athletes"
        foreign_sub_id = None
        for o in others:
            rr = requests.get(f"{BASE_URL}/api/health/staff/athlete/{o['id']}", headers=staff["H"], timeout=30)
            if rr.status_code == 200:
                subs = rr.json().get("submissions") or []
                if subs:
                    foreign_sub_id = subs[0]["id"]
                    break
        assert foreign_sub_id, "no foreign submission found"
        r = requests.post(f"{BASE_URL}/api/health/athlete/report-error", headers=athlete["H"],
                          json={"submission_id": foreign_sub_id, "reason": "hack"}, timeout=30)
        assert r.status_code == 404


# ---------------------------------------------------------------- correction alert
class TestCorrectionAlert:
    def test_correction_alert_present_for_reported_submission(self, staff, athlete):
        r = requests.get(f"{BASE_URL}/api/health/staff/alerts", headers=staff["H"], timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data
        corr = [a for a in data["alerts"]
                if a["type"] == "correction" and a["athlete_id"] == athlete["user"]["id"]]
        assert corr, "no correction alert for the athlete who just reported an error"
        a = corr[0]
        assert a["severity"] == "high"
        assert a["handled"] is False
        assert "TEST_wrong_answers_pls_delete" in (a.get("message") or "")


# ---------------------------------------------------------------- delete cascade
class TestDeleteSubmissionCascade:
    def _create_no_problem_sub(self, athlete):
        # We create a throwaway submission using client_submission_id to be idempotent.
        # Since the athlete may not be due, we bypass status by posting directly; the endpoint
        # accepts submissions regardless of due state (it just marks submitted_late if is_mandatory).
        cid = f"TEST_del_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/health/submit", headers=athlete["H"],
                          json={"no_problem": True, "problems": [], "client_submission_id": cid}, timeout=30)
        assert r.status_code == 200, f"submit failed: {r.status_code} {r.text}"
        return r.json()["submission_id"]

    def _create_problem_sub(self, athlete):
        cid = f"TEST_del_p_{uuid.uuid4().hex[:8]}"
        problems = [{
            "category": "injury",
            "body_region": "knee",
            "description": "TEST_delete_me",
            "ostrc": {
                "OSTRC_Q1_PARTICIPATION": "c",
                "OSTRC_Q2_MODIFICATION": "c",
                "OSTRC_Q3_PERFORMANCE": "b",
                "OSTRC_Q4_SYMPTOMS": "b",
            }
        }]
        r = requests.post(f"{BASE_URL}/api/health/submit", headers=athlete["H"],
                          json={"no_problem": False, "problems": problems,
                                "client_submission_id": cid}, timeout=30)
        assert r.status_code == 200
        return r.json()["submission_id"], r.json().get("problems", [])

    def test_athlete_forbidden_from_delete(self, athlete):
        r = requests.delete(f"{BASE_URL}/api/health/staff/submission/anything",
                            headers=athlete["H"], timeout=30)
        assert r.status_code == 403

    def test_delete_unknown_returns_404(self, staff):
        r = requests.delete(f"{BASE_URL}/api/health/staff/submission/does-not-exist-{uuid.uuid4().hex}",
                            headers=staff["H"], timeout=30)
        assert r.status_code == 404

    def test_delete_cascades_observations_and_problem(self, staff, athlete):
        sub_id, prob_summ = self._create_problem_sub(athlete)
        # confirm it exists in history
        r_hist = requests.get(f"{BASE_URL}/api/health/my-history", headers=athlete["H"], timeout=30)
        ids_before = {s["id"] for s in r_hist.json()}
        assert sub_id in ids_before

        # confirm health problem exists
        pid = prob_summ[0]["problem_id"] if prob_summ else None
        assert pid, "expected a created health problem"

        r = requests.delete(f"{BASE_URL}/api/health/staff/submission/{sub_id}",
                            headers=staff["H"], timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["athlete_id"] == athlete["user"]["id"]

        # submission no longer in history
        r_hist2 = requests.get(f"{BASE_URL}/api/health/my-history", headers=athlete["H"], timeout=30)
        ids_after = {s["id"] for s in r_hist2.json()}
        assert sub_id not in ids_after

        # health problem created by that submission is gone (via /api/health/my-problems)
        r_prob = requests.get(f"{BASE_URL}/api/health/my-problems", headers=athlete["H"], timeout=30)
        assert r_prob.status_code == 200
        prob_ids = {p["id"] for p in r_prob.json()}
        assert pid not in prob_ids, "health_problem created by deleted submission should have been removed"

    def test_delete_no_problem_submission(self, staff, athlete):
        sub_id = self._create_no_problem_sub(athlete)
        r = requests.delete(f"{BASE_URL}/api/health/staff/submission/{sub_id}",
                            headers=staff["H"], timeout=30)
        assert r.status_code == 200
        # verify gone
        r_hist = requests.get(f"{BASE_URL}/api/health/my-history", headers=athlete["H"], timeout=30)
        assert sub_id not in {s["id"] for s in r_hist.json()}


# ---------------------------------------------------------------- e2e read receipts on staff side
class TestStaffSeesReadReceipts:
    def test_staff_review_shows_read_and_reply(self, staff, athlete):
        # LAST_SUB_ID should still exist (a demo submission, not one of the created/deleted ones)
        r = requests.get(f"{BASE_URL}/api/health/staff/athlete/{athlete['user']['id']}",
                         headers=staff["H"], timeout=30)
        assert r.status_code == 200
        sub = next((s for s in r.json()["submissions"] if s["id"] == pytest.LAST_SUB_ID), None)
        assert sub, "expected our tagged submission to still exist"
        notes = sub.get("medical_notes") or []
        # visible note has read_at populated
        vis = next((n for n in notes if n.get("id") == pytest.LAST_VISIBLE_NOTE_ID), None)
        assert vis is not None
        assert vis.get("read_at"), "read_at should be visible on staff side"
        # at least one athlete reply present
        replies = [n for n in notes if n.get("from_athlete")]
        assert replies, "expected at least one athlete reply on this submission"
