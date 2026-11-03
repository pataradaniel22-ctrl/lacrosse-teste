"""Sign in with Google.

Only people who already have an account in the app (same e-mail, approved and
active) can sign in this way; Google never creates accounts here. The ID token
sent by the browser is verified locally against Google's public keys: the
signature, the issuer, the audience (our client id), the expiry and that Google
verified the e-mail.

Configuration: GOOGLE_CLIENT_ID (Render environment). It is public (it is also
shown to the browser), so it is not a secret. When it is empty the feature is
off and the button is hidden.
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Iterable, Optional

import jwt
from fastapi import HTTPException
from pydantic import BaseModel

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"

_jwk_client: Optional[jwt.PyJWKClient] = None


def configured_client_ids() -> list[str]:
    raw = os.environ.get("GOOGLE_CLIENT_ID", "")
    return [c.strip() for c in raw.split(",") if c.strip()]


def _get_jwk_client() -> jwt.PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=3600)
    return _jwk_client


def verify_google_id_token(token: str, client_ids: Iterable[str], signing_key=None) -> dict:
    """Return the verified claims or raise HTTPException(401)."""
    client_ids = list(client_ids)
    if not client_ids:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    if not token or len(token) > 4096:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in")
    try:
        key = signing_key if signing_key is not None else _get_jwk_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=client_ids,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            leeway=60,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in")
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in")
    if claims.get("email_verified") not in (True, "true"):
        raise HTTPException(status_code=401, detail="Your Google e-mail is not verified")
    if not claims.get("email"):
        raise HTTPException(status_code=401, detail="Invalid Google sign-in")
    return claims


def _email_query(email: str) -> dict:
    return {"email": {"$regex": f"^{re.escape(email.strip())}$", "$options": "i"}}


def check_account_allowed(user: dict, user_type: str) -> None:
    """Same approval / access rules as the password login."""
    status = user.get("status", "approved")
    if status == "pending":
        raise HTTPException(status_code=403, detail="Your account is pending approval. Please wait for admin confirmation.")
    if status == "rejected":
        raise HTTPException(status_code=403, detail="Your registration was not approved. Please contact the team administrator.")
    if user_type == "staff" and not user.get("active", True):
        raise HTTPException(status_code=403, detail="Your access has been revoked. Please contact an administrator.")


async def find_account(db, email: str):
    """Return (user, user_type) for an existing account with this e-mail, or (None, None)."""
    athlete = await db.athletes.find_one(_email_query(email), {"_id": 0})
    if athlete:
        return athlete, "athlete"
    staff = await db.staff_users.find_one(_email_query(email), {"_id": 0})
    if staff:
        return staff, "staff"
    return None, None


async def google_login(db, credential: str, create_token, client_ids=None, signing_key=None) -> dict:
    client_ids = configured_client_ids() if client_ids is None else client_ids
    if signing_key is None and client_ids:
        claims = await asyncio.to_thread(verify_google_id_token, credential, client_ids)
    else:
        claims = verify_google_id_token(credential, client_ids, signing_key=signing_key)

    user, user_type = await find_account(db, claims["email"])
    if not user:
        raise HTTPException(
            status_code=403,
            detail="There is no account with this Google e-mail. Register first, or ask an administrator.",
        )
    # Once an account is linked to a Google account, only that Google account may use it
    linked = user.get("google_sub")
    if linked and linked != claims["sub"]:
        raise HTTPException(status_code=403, detail="This account is linked to a different Google account.")
    check_account_allowed(user, user_type)

    collection = db.athletes if user_type == "athlete" else db.staff_users
    if not linked:
        await collection.update_one({"id": user["id"]}, {"$set": {"google_sub": claims["sub"]}})

    hidden = ("password_hash", "google_sub", "groups") if user_type == "athlete" else ("password_hash", "google_sub")
    user_data = {k: v for k, v in user.items() if k not in hidden}
    return {"token": create_token(user["id"], user_type), "user_type": user_type, "user": user_data}


class GoogleLoginRequest(BaseModel):
    credential: str


def register_google_auth_routes(api_router, db, create_token):
    @api_router.get("/auth/google/config")
    async def google_config():
        ids = configured_client_ids()
        return {"enabled": bool(ids), "client_id": ids[0] if ids else None}

    @api_router.post("/auth/google")
    async def google_sign_in(data: GoogleLoginRequest):
        return await google_login(db, data.credential, create_token)
