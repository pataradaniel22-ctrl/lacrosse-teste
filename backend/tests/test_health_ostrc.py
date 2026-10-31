"""Weekly Health OSTRC-H2 (Phase 1 athlete core) backend tests.

Covers: questionnaire fetch, status ready/completed transitions, scoring for
Q1=a (no problem), Q1=d (severity 100 skip Q2-4), typical b/c path,
substantial flag, multiple problems, and postpone gating for a ready athlete.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://performance-fueling.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

# Demo athletes (see test_credentials.md)
READY_CANDIDATES = [
    "lucas.silva@email.com",
    "rafael.oliveira@email.com",
    "bruno.ferreira@email.com",
    "diego.almeida@email.com",
    "felipe.rodrigues@email.com",
    "thiago.martins@email.com",
    "julia.pereira@email.com",
    "maria.souza@email.com",
    "camila.lima@email.com",
    "beatriz.santos@email.com",
    "larissa.costa@email.com",
    "fernanda.silva@email.com",
    "carolina.rocha@email.com",
    "gabriel.costa@email.com",
    "pedro.santos@email.com",
    "ana.oliveira@email.com",
]
PASSWORD = "demo123"


def _login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD, "user_type": "athlete"}, timeout=15)
    if r.status_code != 200:
        return None
    return r.json()["token"]


def _headers(tok):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {tok}"}


def _find_ready(exclude=None):
    """Return (email, token, status_json) for a Ready athlete not in exclude."""
    exclude = set(exclude or [])
    for email in READY_CANDIDATES:
        if email in exclude:
            continue
        tok = _login(email)
        if not tok:
            continue
        s = requests.get(f"{API}/health/status", headers=_headers(tok), timeout=15)
        if s.status_code != 200:
            continue
        st = s.json()
        if st.get("state") == "ready":
            return email, tok, st
    return None, None, None


# --- Basics ---------------------------------------------------------------
class TestQuestionnaire:
    def test_questionnaire_shape(self):
        email = READY_CANDIDATES[0]
        tok = _login(email)
        assert tok, f"login failed for {email}"
        r = requests.get(f"{API}/health/questionnaire", headers=_headers(tok), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["version"].startswith("OSTRC-H2")
        codes = [q["code"] for q in data["questions"]]
        assert codes == [
            "OSTRC_Q1_PARTICIPATION",
            "OSTRC_Q2_MODIFICATION",
            "OSTRC_Q3_PERFORMANCE",
            "OSTRC_Q4_SYMPTOMS",
        ]
        # Q1 official four options with the four canonical scores
        q1_opts = data["questions"][0]["options"]
        assert [o["code"] for o in q1_opts] == ["a", "b", "c", "d"]
        assert [o["score"] for o in q1_opts] == [0, 8, 17, 100]
        # Q2/Q3/Q4 must be 0/8/17/25
        for q in data["questions"][1:]:
            assert [o["score"] for o in q["options"]] == [0, 8, 17, 25]
        assert "injury" in data["categories"] and "pain" in data["categories"]

    def test_status_returns_state(self):
        email = READY_CANDIDATES[0]
        tok = _login(email)
        assert tok
        r = requests.get(f"{API}/health/status", headers=_headers(tok), timeout=15)
        assert r.status_code == 200
        st = r.json()
        assert st["state"] in ("ready", "overdue", "completed", "postponed")
        assert "is_mandatory" in st
        # freshly ready must NOT be mandatory (no gating yet)
        if st["state"] == "ready":
            assert st["is_mandatory"] is False


# --- Scoring paths --------------------------------------------------------
class TestScoringPaths:
    def test_q1_a_no_problem_fast_path(self):
        email, tok, st = _find_ready()
        if not tok:
            pytest.skip("No ready athlete available for no-problem submit")
        payload = {
            "no_problem": True,
            "started_at": "2026-01-01T00:00:00",
            "completion_time_seconds": 10,
            "problems": [],
        }
        r = requests.post(f"{API}/health/submit", json=payload, headers=_headers(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["success"] is True
        assert data["no_problem"] is True
        assert data["problems"] == []
        assert data["highest_severity_score"] == 0
        assert data["contains_substantial_problem"] is False
        # After submit -> status should flip to 'completed'
        s = requests.get(f"{API}/health/status", headers=_headers(tok), timeout=15).json()
        assert s["state"] == "completed"
        assert s["is_mandatory"] is False

    def test_q1_d_skips_q234_severity_100(self):
        # Different athlete than the previous test.
        email, tok, st = _find_ready(exclude=[READY_CANDIDATES[0]])
        if not tok:
            pytest.skip("No ready athlete for Q1=d path")
        payload = {
            "no_problem": False,
            "problems": [{
                "ostrc": {"OSTRC_Q1_PARTICIPATION": "d"},
                "category": "injury",
                "body_region": "Knee",
                "body_side": "left",
                "onset_type": "sudden",
                "description": "TEST_ q1=d path",
                "request_contact": False,
            }],
        }
        r = requests.post(f"{API}/health/submit", json=payload, headers=_headers(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["no_problem"] is False
        assert len(data["problems"]) == 1
        p = data["problems"][0]
        assert p["severity_score"] == 100
        assert p["substantial"] is True
        assert data["highest_severity_score"] == 100
        assert data["contains_substantial_problem"] is True

    def test_typical_bcd_scoring_and_substantial(self):
        email, tok, st = _find_ready(exclude=READY_CANDIDATES[:2])
        if not tok:
            pytest.skip("No ready athlete for b/c path")
        # Q1=c(17) + Q2=d(25) + Q3=c(17) + Q4=b(8) = 67, substantial (Q2 in c/d OR Q3 in c/d)
        payload = {
            "no_problem": False,
            "problems": [{
                "ostrc": {
                    "OSTRC_Q1_PARTICIPATION": "c",
                    "OSTRC_Q2_MODIFICATION": "d",
                    "OSTRC_Q3_PERFORMANCE": "c",
                    "OSTRC_Q4_SYMPTOMS": "b",
                },
                "category": "pain",
                "body_region": "Shoulder",
                "body_side": "right",
                "onset_type": "gradual",
                "description": "TEST_ typical path",
            }],
        }
        r = requests.post(f"{API}/health/submit", json=payload, headers=_headers(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        p = data["problems"][0]
        assert p["severity_score"] == 67
        assert p["substantial"] is True
        assert data["contains_substantial_problem"] is True

    def test_multiple_problems_single_submission(self):
        email, tok, st = _find_ready(exclude=READY_CANDIDATES[:3])
        if not tok:
            pytest.skip("No ready athlete for multi-problem")
        payload = {
            "no_problem": False,
            "problems": [
                {
                    "ostrc": {
                        "OSTRC_Q1_PARTICIPATION": "b",
                        "OSTRC_Q2_MODIFICATION": "a",
                        "OSTRC_Q3_PERFORMANCE": "b",
                        "OSTRC_Q4_SYMPTOMS": "b",
                    },
                    "category": "pain",
                    "body_region": "Ankle/Foot",
                    "body_side": "left",
                },
                {
                    "ostrc": {"OSTRC_Q1_PARTICIPATION": "d"},
                    "category": "illness",
                    "description": "TEST_ illness",
                },
            ],
        }
        r = requests.post(f"{API}/health/submit", json=payload, headers=_headers(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["problems"]) == 2
        assert data["highest_severity_score"] == 100
        assert data["contains_substantial_problem"] is True

    def test_completed_athlete_status_persists(self):
        # ana.oliveira / pedro.santos already submitted per problem statement
        for e in ("ana.oliveira@email.com", "pedro.santos@email.com"):
            tok = _login(e)
            if not tok:
                continue
            r = requests.get(f"{API}/health/status", headers=_headers(tok), timeout=15)
            assert r.status_code == 200
            st = r.json()
            # If they've submitted within CYCLE_DAYS they must show 'completed'
            if st["state"] == "completed":
                assert st["is_mandatory"] is False
                assert st.get("last_submission_date") is not None
                return
        pytest.skip("Neither pre-submitted athlete returned 'completed' state")


# --- Postpone -------------------------------------------------------------
class TestPostpone:
    def test_postpone_available_for_ready(self):
        email, tok, st = _find_ready(exclude=READY_CANDIDATES[:4])
        if not tok:
            pytest.skip("No ready athlete for postpone")
        # can_postpone is only meaningful for a not-yet-mandatory ready athlete
        assert st.get("can_postpone") in (True, None)
        r = requests.post(f"{API}/health/postpone", headers=_headers(tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["success"] is True
        assert "postponed_until" in data
        # subsequent status should reflect postponed and NOT be mandatory
        s = requests.get(f"{API}/health/status", headers=_headers(tok), timeout=15).json()
        assert s["state"] == "postponed"
        assert s["is_mandatory"] is False


# --- Validation -----------------------------------------------------------
class TestValidation:
    def test_invalid_q1_answer_400(self):
        email, tok, _ = _find_ready(exclude=READY_CANDIDATES[:5])
        if not tok:
            pytest.skip("No ready athlete for validation")
        payload = {
            "no_problem": False,
            "problems": [{"ostrc": {"OSTRC_Q1_PARTICIPATION": "z"}, "category": "injury"}],
        }
        r = requests.post(f"{API}/health/submit", json=payload, headers=_headers(tok), timeout=15)
        assert r.status_code == 400

    def test_athlete_required(self):
        # Staff must be blocked from athlete endpoints
        r = requests.post(f"{API}/auth/login", json={
            "email": "cristina.velez@brasillacrosse.com",
            "password": "123456",
        }, timeout=15)
        if r.status_code != 200:
            pytest.skip("staff login not available")
        tok = r.json().get("token")
        st = requests.get(f"{API}/health/status", headers=_headers(tok), timeout=15)
        assert st.status_code == 403
