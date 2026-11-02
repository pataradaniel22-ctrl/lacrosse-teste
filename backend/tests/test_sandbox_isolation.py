"""Demo mode isolation: the db proxy must resolve to the sandbox database only for
requests carrying a sandbox token, and to the real database otherwise."""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from db_context import SandboxAwareDB, SandboxMiddleware, sandbox_mode  # noqa: E402


class FakeDB:
    def __init__(self, name):
        self.name = name

    def __getattr__(self, coll):
        return f"{self.name}.{coll}"

    def __getitem__(self, coll):
        return f"{self.name}.{coll}"


TOKENS = {"real-token": {"user_id": "u"}, "demo-token": {"user_id": "u", "sandbox": True}}


def decode(tok):
    if tok not in TOKENS:
        raise ValueError("bad token")
    return TOKENS[tok]


class TestIsolation(unittest.TestCase):
    def setUp(self):
        self.db = SandboxAwareDB(FakeDB("real"), FakeDB("sandbox"))
        self.seen = []

        async def app(scope, receive, send):
            self.seen.append((self.db.athletes, self.db["daily_readiness"]))

        self.mw = SandboxMiddleware(app, decode)

    def run_req(self, auth=None):
        headers = [(b"authorization", f"Bearer {auth}".encode())] if auth else []
        asyncio.run(self.mw({"type": "http", "headers": headers}, None, None))
        return self.seen[-1]

    def test_default_is_real(self):
        self.assertEqual(self.db.athletes, "real.athletes")

    def test_real_token(self):
        self.assertEqual(self.run_req("real-token"), ("real.athletes", "real.daily_readiness"))

    def test_demo_token(self):
        self.assertEqual(self.run_req("demo-token"), ("sandbox.athletes", "sandbox.daily_readiness"))
        self.assertFalse(sandbox_mode.get())  # reset after the request

    def test_forged_token_is_not_sandbox(self):
        self.assertEqual(self.run_req("forged"), ("real.athletes", "real.daily_readiness"))

    def test_no_token(self):
        self.assertEqual(self.run_req(None), ("real.athletes", "real.daily_readiness"))


if __name__ == "__main__":
    unittest.main()
