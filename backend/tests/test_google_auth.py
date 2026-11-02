"""Sign in with Google: token checks and account rules (runs without a server).

    cd backend && python3 -m unittest tests.test_google_auth
"""
import asyncio
import re
import time
import unittest

import sys
import types

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

try:  # the real packages on the server; light stand-ins where they are not installed
    from fastapi import HTTPException
except ImportError:
    class HTTPException(Exception):
        def __init__(self, status_code, detail=None):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail
    sys.modules["fastapi"] = types.SimpleNamespace(HTTPException=HTTPException)
try:
    import pydantic  # noqa: F401
except ImportError:
    sys.modules["pydantic"] = types.SimpleNamespace(BaseModel=object)

from google_auth import google_login, verify_google_id_token

CLIENT = "123-abc.apps.googleusercontent.com"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUB = KEY.public_key()


def make_token(key=KEY, **over):
    now = int(time.time())
    claims = {"iss": "https://accounts.google.com", "aud": CLIENT, "sub": "g-1",
              "email": "Ana@Example.com", "email_verified": True, "iat": now, "exp": now + 600}
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256")


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if "email" in query:
                pat = query["email"]["$regex"]
                if re.match(pat, d["email"], re.I):
                    return dict(d)
            elif all(d.get(k) == v for k, v in query.items()):
                return dict(d)
        return None

    async def update_one(self, query, update):
        for d in self.docs:
            if d["id"] == query["id"]:
                d.update(update["$set"])


class FakeDB:
    def __init__(self, athletes=(), staff=()):
        self.athletes = FakeCollection([dict(a) for a in athletes])
        self.staff_users = FakeCollection([dict(s) for s in staff])


def run(coro):
    return asyncio.run(coro)


def login(db, token):
    return run(google_login(db, token, lambda uid, ut: f"tok-{uid}-{ut}", client_ids=[CLIENT], signing_key=PUB))


class VerifyTokenTests(unittest.TestCase):
    def test_valid(self):
        c = verify_google_id_token(make_token(), [CLIENT], signing_key=PUB)
        self.assertEqual(c["email"], "Ana@Example.com")

    def bad(self, token, ids=(CLIENT,)):
        with self.assertRaises(HTTPException) as e:
            verify_google_id_token(token, list(ids), signing_key=PUB)
        return e.exception.status_code

    def test_wrong_signature(self):
        self.assertEqual(self.bad(make_token(key=OTHER_KEY)), 401)

    def test_wrong_audience(self):
        self.assertEqual(self.bad(make_token(aud="someone-else")), 401)

    def test_wrong_issuer(self):
        self.assertEqual(self.bad(make_token(iss="https://evil.example")), 401)

    def test_expired(self):
        self.assertEqual(self.bad(make_token(exp=int(time.time()) - 3600, iat=int(time.time()) - 7200)), 401)

    def test_unverified_email(self):
        self.assertEqual(self.bad(make_token(email_verified=False)), 401)

    def test_not_configured(self):
        self.assertEqual(self.bad(make_token(), ids=()), 503)

    def test_garbage(self):
        self.assertEqual(self.bad("not-a-token"), 401)


class LoginRuleTests(unittest.TestCase):
    def test_existing_athlete_case_insensitive_and_linked(self):
        db = FakeDB(athletes=[{"id": "a1", "email": "ana@example.com", "password_hash": "x", "status": "approved"}])
        r = login(db, make_token())
        self.assertEqual(r["user_type"], "athlete")
        self.assertEqual(r["token"], "tok-a1-athlete")
        self.assertNotIn("password_hash", r["user"])
        self.assertNotIn("google_sub", r["user"])
        self.assertEqual(db.athletes.docs[0]["google_sub"], "g-1")

    def test_staff(self):
        db = FakeDB(staff=[{"id": "s1", "email": "ana@example.com", "role": "Admin"}])
        self.assertEqual(login(db, make_token())["user_type"], "staff")

    def test_unknown_email_rejected(self):
        with self.assertRaises(HTTPException) as e:
            login(FakeDB(), make_token())
        self.assertEqual(e.exception.status_code, 403)

    def test_regex_chars_do_not_match_other_accounts(self):
        db = FakeDB(athletes=[{"id": "a1", "email": "anaXexample.com"}])
        with self.assertRaises(HTTPException):
            login(db, make_token(email="ana.example.com"))

    def test_pending_rejected_and_revoked_blocked(self):
        for doc, kind in (({"status": "pending"}, "athletes"), ({"status": "rejected"}, "athletes"),
                          ({"active": False}, "staff"), ({"status": "pending"}, "staff")):
            base = {"id": "u1", "email": "ana@example.com", **doc}
            db = FakeDB(athletes=[base]) if kind == "athletes" else FakeDB(staff=[base])
            with self.assertRaises(HTTPException) as e:
                login(db, make_token())
            self.assertEqual(e.exception.status_code, 403)

    def test_linked_to_other_google_account(self):
        db = FakeDB(athletes=[{"id": "a1", "email": "ana@example.com", "google_sub": "g-OTHER"}])
        with self.assertRaises(HTTPException) as e:
            login(db, make_token())
        self.assertEqual(e.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
