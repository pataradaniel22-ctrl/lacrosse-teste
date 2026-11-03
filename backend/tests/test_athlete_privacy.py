"""Athletes never receive group labels or credential fields (runs without a server).

    cd backend && python3 -m unittest tests.test_athlete_privacy
"""
import asyncio
import json
import unittest

from athlete_privacy import AthletePrivacyMiddleware, scrub


def make_app(body: dict, ctype=b"application/json"):
    raw = json.dumps(body).encode()

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", ctype), (b"content-length", str(len(raw)).encode())]})
        await send({"type": "http.response.body", "body": raw[:10], "more_body": True})
        await send({"type": "http.response.body", "body": raw[10:], "more_body": False})
    return app


def run(app, token):
    sent = []

    async def send(m):
        sent.append(m)
    scope = {"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}
    mw = AthletePrivacyMiddleware(app, decode=lambda t: {"user_type": t})
    asyncio.run(mw(scope, None, send))
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return sent, body


DATA = {"user": {"id": "a1", "name": "X", "groups": ["competition"], "password_hash": "h", "google_sub": "g"},
        "list": [{"name": "Y", "groups": ["development"]}], "survey": {"title": "ok"}}


class PrivacyTests(unittest.TestCase):
    def test_scrub_nested(self):
        out = scrub(DATA)
        self.assertNotIn("groups", out["user"])
        self.assertNotIn("password_hash", out["user"])
        self.assertNotIn("groups", out["list"][0])
        self.assertEqual(out["survey"], {"title": "ok"})

    def test_athlete_response_scrubbed_and_length_fixed(self):
        sent, body = run(make_app(DATA), "athlete")
        out = json.loads(body)
        self.assertNotIn("groups", out["user"])
        self.assertNotIn("groups", out["list"][0])
        headers = dict(sent[0]["headers"])
        self.assertEqual(int(headers[b"content-length"]), len(body))

    def test_staff_untouched(self):
        _, body = run(make_app(DATA), "staff")
        self.assertIn("groups", json.loads(body)["user"])

    def test_non_json_passthrough(self):
        _, body = run(make_app(DATA, ctype=b"application/pdf"), "athlete")
        self.assertIn(b"groups", body)


if __name__ == "__main__":
    unittest.main()
