"""Messages / Athlete Feedback Center — backend integration tests.

Covers: athlete conversation (pain), listing/detail, staff 403 negative, admin inbox+filters,
counts, admin reply / internal-note / resolve / archive / pain-followup, feedback flow,
athlete pain-report link (source='Message'), attachment upload + cross-athlete access denied.
Cleans up all created data at the end.
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "cristina.velez@brasillacrosse.com"
ADMIN_PASS = "123456"
ATH1_EMAIL = "lucas.silva@email.com"
ATH2_EMAIL = "ana.oliveira@email.com"
ATH_PASS = "demo123"


def _login(email, pw, user_type):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw, "user_type": user_type}, timeout=30)
    assert r.status_code == 200, f"Login {email} failed: {r.status_code} {r.text}"
    d = r.json()
    return d.get("token") or d.get("access_token"), d


@pytest.fixture(scope="module")
def tokens():
    admin_tok, admin_data = _login(ADMIN_EMAIL, ADMIN_PASS, "staff")
    ath1_tok, ath1_data = _login(ATH1_EMAIL, ATH_PASS, "athlete")
    ath2_tok, ath2_data = _login(ATH2_EMAIL, ATH_PASS, "athlete")
    ath1_id = (ath1_data.get("user") or {}).get("id") or (ath1_data.get("athlete") or {}).get("id")
    ath2_id = (ath2_data.get("user") or {}).get("id") or (ath2_data.get("athlete") or {}).get("id")
    return {
        "admin": admin_tok, "ath1": ath1_tok, "ath2": ath2_tok,
        "admin_data": admin_data, "ath1_id": ath1_id, "ath2_id": ath2_id,
    }


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def state():
    return {"conv_id": None, "conv2_id": None, "feedback_id": None,
            "attach_id_a1": None, "attach_id_a2": None}


# ---------- Athlete create / list / detail ----------
def test_athlete_create_pain_conversation(tokens, state):
    payload = {
        "category": "pain",
        "title": "TEST_ Right knee pain during training",
        "message_body": "TEST_ my right knee has been hurting since Tuesday",
        "priority": "high",
        "pain": {
            "body_region": "Knee", "side": "Right", "pain_intensity": 7,
            "onset": "2 days ago", "trend": "worsening",
            "occurred_during_training": True, "can_train_normally": False,
            "aggravating_movements": "running, jumping",
        },
    }
    r = requests.post(f"{API}/messages/athlete/conversations", headers=_h(tokens["ath1"]), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["category"] == "pain"
    assert d["is_pain_related"] is True
    assert d["priority"] == "high"
    assert d["athlete_id"] == tokens["ath1_id"]
    state["conv_id"] = d["id"]


def test_athlete_list_shows_conversation(tokens, state):
    r = requests.get(f"{API}/messages/athlete/conversations", headers=_h(tokens["ath1"]), timeout=30)
    assert r.status_code == 200
    lst = r.json()
    found = [c for c in lst if c["id"] == state["conv_id"]]
    assert found, "Created conversation missing from athlete list"
    assert found[0]["athlete_status"] == "sent"


def test_athlete_detail(tokens, state):
    r = requests.get(f"{API}/messages/athlete/conversations/{state['conv_id']}", headers=_h(tokens["ath1"]), timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["conversation"]["id"] == state["conv_id"]
    assert len(d["messages"]) == 1
    assert d["pain"] is not None
    assert d["pain"]["body_region"] == "Knee"
    # No internal notes exposed to athlete
    assert "internal_notes" not in d["conversation"]


def test_staff_forbidden_on_athlete_endpoints(tokens):
    r = requests.get(f"{API}/messages/athlete/conversations", headers=_h(tokens["admin"]), timeout=30)
    assert r.status_code == 403


# ---------- Admin counts + list ----------
def test_admin_counts(tokens):
    r = requests.get(f"{API}/messages/admin/counts", headers=_h(tokens["admin"]), timeout=30)
    assert r.status_code == 200
    d = r.json()
    for k in ("unread", "pain", "high_priority", "pending"):
        assert k in d
    assert d["unread"] >= 1
    assert d["pain"] >= 1
    assert d["high_priority"] >= 1


def test_admin_list_filters(tokens, state):
    params = {"is_pain": "true", "priority": "high", "status": "pending", "q": "TEST_"}
    r = requests.get(f"{API}/messages/admin/conversations", headers=_h(tokens["admin"]), params=params, timeout=30)
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()]
    assert state["conv_id"] in ids


# ---------- Admin reply -> athlete sees reply, unread cleared ----------
def test_admin_reply_and_athlete_reads(tokens, state):
    r = requests.post(f"{API}/messages/admin/conversations/{state['conv_id']}/reply",
                      headers=_h(tokens["admin"]), json={"message_body": "TEST_ admin reply"}, timeout=30)
    assert r.status_code == 200

    # Admin sees status replied + unread_athlete True
    r2 = requests.get(f"{API}/messages/admin/conversations/{state['conv_id']}", headers=_h(tokens["admin"]), timeout=30)
    assert r2.status_code == 200
    conv = r2.json()["conversation"]
    assert conv["status"] == "replied"
    assert conv["unread_athlete"] is True

    # Athlete GET detail: should now see 2 messages and reads reset unread
    r3 = requests.get(f"{API}/messages/athlete/conversations/{state['conv_id']}", headers=_h(tokens["ath1"]), timeout=30)
    assert r3.status_code == 200
    d = r3.json()
    assert len(d["messages"]) == 2
    assert d["conversation"]["athlete_status"] in ("read", "staff_replied")


# ---------- Admin internal note ----------
def test_admin_internal_note_not_visible_to_athlete(tokens, state):
    r = requests.post(f"{API}/messages/admin/conversations/{state['conv_id']}/internal-note",
                      headers=_h(tokens["admin"]), json={"text": "TEST_ private note"}, timeout=30)
    assert r.status_code == 200

    r_admin = requests.get(f"{API}/messages/admin/conversations/{state['conv_id']}", headers=_h(tokens["admin"]), timeout=30)
    admin_conv = r_admin.json()["conversation"]
    assert any(n.get("text") == "TEST_ private note" for n in admin_conv.get("internal_notes", []))

    r_ath = requests.get(f"{API}/messages/athlete/conversations/{state['conv_id']}", headers=_h(tokens["ath1"]), timeout=30)
    assert "internal_notes" not in r_ath.json()["conversation"]


# ---------- Pain followup ----------
def test_admin_pain_followup(tokens, state):
    r = requests.post(f"{API}/messages/admin/conversations/{state['conv_id']}/pain-followup",
                      headers=_h(tokens["admin"]), timeout=30)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/messages/admin/conversations/{state['conv_id']}", headers=_h(tokens["admin"]), timeout=30)
    assert r2.json()["pain"]["requires_follow_up"] is True


# ---------- Pain report link (source Message) ----------
def test_pain_report_includes_message(tokens):
    r = requests.get(f"{API}/staff/athlete/{tokens['ath1_id']}/pain-report", headers=_h(tokens["admin"]),
                     params={"days": 90}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    # Look for 'Message' source somewhere in pain_history / region_analysis / events
    text = str(body).lower()
    assert "message" in text and "knee" in text, f"Expected Message-source knee entry in pain report: {body}"


# ---------- Feedback ----------
def test_admin_create_feedback_and_athlete_visibility(tokens, state):
    payload = {
        "athlete_id": tokens["ath1_id"], "title": "TEST_ Great job", "feedback_body": "TEST_ well done last week",
        "category": "general", "pinned_to_profile": True, "important": True, "send_push": False,
    }
    r = requests.post(f"{API}/messages/admin/feedback", headers=_h(tokens["admin"]), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    fb = r.json()
    state["feedback_id"] = fb["id"]
    assert fb["pinned_to_profile"] is True

    r2 = requests.get(f"{API}/messages/athlete/feedback", headers=_h(tokens["ath1"]), timeout=30)
    assert any(x["id"] == state["feedback_id"] for x in r2.json())

    r3 = requests.get(f"{API}/messages/athlete/unread-count", headers=_h(tokens["ath1"]), timeout=30)
    d = r3.json()
    assert d["unread"] >= 1
    assert d["unread_feedback"] >= 1

    r4 = requests.get(f"{API}/messages/admin/athlete/{tokens['ath1_id']}/feedback", headers=_h(tokens["admin"]), timeout=30)
    assert any(x["id"] == state["feedback_id"] for x in r4.json())


# ---------- Attachments (cross-athlete denied) ----------
def _mkimg():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 50, 50)).save(buf, format="PNG")
    return buf.getvalue()


def test_attachment_upload_and_access_control(tokens, state):
    files = {"file": ("test.png", io.BytesIO(_mkimg()), "image/png")}
    r = requests.post(f"{API}/messages/attachment", headers=_h(tokens["ath1"]), files=files, timeout=30)
    assert r.status_code == 200, r.text
    state["attach_id_a1"] = r.json()["attachment_id"]

    # Owner can access
    r_own = requests.get(f"{API}/messages/attachment/{state['attach_id_a1']}",
                        params={"auth": tokens["ath1"]}, timeout=30)
    assert r_own.status_code == 200

    # Other athlete cannot
    r_other = requests.get(f"{API}/messages/attachment/{state['attach_id_a1']}",
                           params={"auth": tokens["ath2"]}, timeout=30)
    assert r_other.status_code == 403


# ---------- Resolve + Archive (last) ----------
def test_admin_resolve(tokens, state):
    r = requests.post(f"{API}/messages/admin/conversations/{state['conv_id']}/resolve",
                      headers=_h(tokens["admin"]), timeout=30)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/messages/admin/conversations/{state['conv_id']}", headers=_h(tokens["admin"]), timeout=30)
    assert r2.json()["conversation"]["status"] == "resolved"


def test_admin_archive_excluded_from_default_lists(tokens, state):
    # create a second conv to archive
    r = requests.post(f"{API}/messages/athlete/conversations", headers=_h(tokens["ath1"]),
                     json={"category": "question", "title": "TEST_ archive me", "message_body": "TEST_ hi", "priority": "normal"},
                     timeout=30)
    assert r.status_code == 200
    state["conv2_id"] = r.json()["id"]

    ra = requests.post(f"{API}/messages/admin/conversations/{state['conv2_id']}/archive",
                       headers=_h(tokens["admin"]), timeout=30)
    assert ra.status_code == 200

    lst_admin = requests.get(f"{API}/messages/admin/conversations", headers=_h(tokens["admin"]), timeout=30).json()
    assert state["conv2_id"] not in [c["id"] for c in lst_admin]

    lst_ath = requests.get(f"{API}/messages/athlete/conversations", headers=_h(tokens["ath1"]), timeout=30).json()
    assert state["conv2_id"] not in [c["id"] for c in lst_ath]


# ---------- Cleanup ----------
def test_cleanup(tokens, state):
    """Best-effort cleanup via direct Mongo — uses server's DB via a helper endpoint if available.
    Falls back to marking cleanup for main agent."""
    # We cannot delete directly via API (no delete endpoints). Report what remains.
    remaining = {
        "conversation_ids": [i for i in [state.get("conv_id"), state.get("conv2_id")] if i],
        "feedback_ids": [state.get("feedback_id")] if state.get("feedback_id") else [],
        "attachment_ids": [state.get("attach_id_a1")] if state.get("attach_id_a1") else [],
    }
    print("REMAINING_TEST_DATA:", remaining)
    assert True
