"""
Regression tests for:
  1. Profile photo upload -> persisted in Emergent Object Storage and served
     back via /api/profile-photo/{id} (replica-safe, survives restarts).
  2. Athlete data export collects pain reports from ALL sources
     (morning check-ins / daily_readiness, not only training sessions).
"""
import io
import os
import struct
import zlib

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
API = f"{BASE_URL}/api"

STAFF = {"email": "cristina.velez@brasillacrosse.com", "password": "123456", "user_type": "staff"}
ATHLETE_CANDIDATES = [
    "pedro.santos@email.com", "ana.oliveira@email.com",
    "bruno.costa@email.com", "rafael.lima@email.com",
]


def _png_bytes():
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def test_profile_photo_object_storage_roundtrip():
    files = {"file": ("avatar.png", _png_bytes(), "image/png")}
    r = requests.post(f"{API}/upload/profile-photo", files=files, timeout=30)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("/api/profile-photo/"), f"expected object-storage URL, got {url}"

    # Serve it back
    served = requests.get(f"{BASE_URL}{url}", timeout=30)
    assert served.status_code == 200, served.text
    assert served.headers.get("content-type", "").startswith("image/")
    assert len(served.content) > 0


def test_profile_photo_missing_returns_404():
    r = requests.get(f"{API}/profile-photo/does-not-exist-id", timeout=15)
    assert r.status_code == 404


def test_athlete_export_includes_recovery_pain():
    """Pain reported via a Recovery submission must appear in the athlete export
    (recovery_logs is one of the new sources collected by the export fix).
    Recovery logs are repeatable per day, so this is deterministic."""
    staff_tok = _login(STAFF)
    atok = _login({"email": ATHLETE_CANDIDATES[0], "password": "demo123", "user_type": "athlete"})
    headers = {"Authorization": f"Bearer {atok}"}
    aid = requests.get(f"{API}/profile", headers=headers, timeout=15).json()["user"]["id"]

    # Submit a recovery log WITH pain (proof optional -> no file needed)
    cat = requests.get(f"{API}/recovery/catalog", headers=headers, timeout=15).json()
    activity_id = cat["activities"][0]["id"]
    r = requests.post(
        f"{API}/recovery/logs",
        headers=headers,
        data={
            "activity_id": activity_id,
            "notes": "TEST_export_pain",
            "pain_reports": '[{"body_region": "Shoulder", "laterality": "Right", "pain_level": 6}]',
        },
        timeout=20,
    )
    assert r.status_code == 200, f"recovery submit failed: {r.status_code} {r.text}"

    exp = requests.post(
        f"{API}/export/athlete/{aid}",
        headers={"Authorization": f"Bearer {staff_tok}"},
        json={"format": "csv", "scope": "individual", "start_date": "2026-06-01", "end_date": "2026-12-31"},
        timeout=60,
    )
    assert exp.status_code == 200, exp.text
    csv_text = exp.content.decode("utf-8", errors="ignore")
    assert "PAIN REPORTS" in csv_text
    assert "Recovery" in csv_text, "Recovery-sourced pain must be included in athlete export"
    assert "Shoulder" in csv_text

