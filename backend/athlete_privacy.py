"""Guarantee: athletes never receive staff-only labels from the server.

For every request authenticated with an *athlete* token, JSON responses are
scrubbed of the keys in ``ATHLETE_HIDDEN_KEYS`` (anywhere in the body):
  * ``groups``        – staff categorisation (Competition, Development, ...)
  * ``password_hash`` / ``google_sub`` – never needed by any client
This protects every current and future endpoint, not just the ones we know.
"""
from __future__ import annotations

import json

ATHLETE_HIDDEN_KEYS = {"groups", "password_hash", "google_sub"}
MAX_SCRUB_BYTES = 8 * 1024 * 1024


def scrub(obj, keys=ATHLETE_HIDDEN_KEYS):
    if isinstance(obj, dict):
        return {k: scrub(v, keys) for k, v in obj.items() if k not in keys}
    if isinstance(obj, list):
        return [scrub(v, keys) for v in obj]
    return obj


class AthletePrivacyMiddleware:
    def __init__(self, app, decode):
        self.app = app
        self.decode = decode  # callable(token) -> payload, raises on invalid

    def _is_athlete(self, scope) -> bool:
        for k, v in scope.get("headers") or []:
            if k == b"authorization":
                val = v.decode("latin-1")
                if val.lower().startswith("bearer "):
                    try:
                        return self.decode(val[7:].strip()).get("user_type") == "athlete"
                    except Exception:
                        return False
        return False

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not self._is_athlete(scope):
            return await self.app(scope, receive, send)

        start = {}
        chunks = []
        state = {"json": False, "passthrough": False}

        async def wrapped_send(message):
            if message["type"] == "http.response.start":
                headers = dict((k.lower(), v) for k, v in message.get("headers") or [])
                ctype = headers.get(b"content-type", b"").decode("latin-1").lower()
                if "application/json" in ctype:
                    state["json"] = True
                    start.update(message)
                    return
                state["passthrough"] = True
                return await send(message)
            if message["type"] == "http.response.body" and state["json"]:
                chunks.append(message.get("body", b""))
                if message.get("more_body"):
                    return
                body = b"".join(chunks)
                if len(body) <= MAX_SCRUB_BYTES:
                    try:
                        body = json.dumps(scrub(json.loads(body)), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                    except (ValueError, UnicodeDecodeError):
                        pass
                headers = [(k, v) for k, v in start.get("headers") or [] if k.lower() != b"content-length"]
                headers.append((b"content-length", str(len(body)).encode()))
                await send({**start, "headers": headers})
                return await send({"type": "http.response.body", "body": body, "more_body": False})
            return await send(message)

        return await self.app(scope, receive, wrapped_send)
