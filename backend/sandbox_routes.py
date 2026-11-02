"""Demo mode (sandbox) — admin-only management of an isolated test athlete.

The sandbox lives in its own database. Configuration collections (surveys,
recovery catalogue, The Fittest settings/challenges, app settings) are copied
from the real database so the athlete screens work, but no real athlete data is
ever copied, and nothing done in demo mode is written to the real database.
"""
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException

from db_context import sandbox_mode

CONFIG_COLLECTIONS = ["surveys", "recovery_activities", "recovery_categories", "recovery_settings",
                      "the_fittest_settings", "the_fittest_challenges", "app_settings"]
NEVER_COPY_SETTINGS = {"iir_pseudonym_key"}
TEAMS = ["Brazil Lacrosse Men", "Brazil Lacrosse Women"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def register_sandbox_routes(api_router, db, get_current_user, create_sandbox_token):

    def _require_real_admin(cu):
        if sandbox_mode.get():
            raise HTTPException(status_code=403, detail="Not available inside demo mode")
        if cu.get("user_type") != "staff" or (cu.get("user") or {}).get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        return cu["user"]

    async def _copy_config():
        real, sb = db.real, db.sandbox
        for name in CONFIG_COLLECTIONS:
            docs = await real[name].find({}).to_list(5000)
            if name == "app_settings":
                docs = [d for d in docs if d.get("_id") not in NEVER_COPY_SETTINGS]
            await sb[name].delete_many({})
            if docs:
                await sb[name].insert_many(docs)

    async def _setup(admin, name=None, team=None):
        sb = db.sandbox
        cfg = await sb.sandbox_meta.find_one({"_id": "config"}) or {}
        name = (name or cfg.get("athlete_name") or
                (admin.get("name") if admin.get("name") and admin.get("name") != "Admin" else "Atleta Teste")).strip()[:80]
        team = team if team in TEAMS else (cfg.get("team") or TEAMS[0])
        athlete_id = cfg.get("athlete_id") or str(uuid.uuid4())
        await _copy_config()
        await sb.athletes.update_one({"id": athlete_id}, {"$set": {
            "id": athlete_id, "name": name, "email": "atleta.teste@brasillacrosse-demo.com", "team": team,
            "preferred_training_time": "09:00", "active": True, "status": "approved",
            "sexo": "Feminino" if team == TEAMS[1] else "Masculino",
            # random hash: this account cannot log in with a password, only through demo mode
            "password_hash": "!" + secrets.token_hex(16),
            "is_demo": True,
        }, "$setOnInsert": {"created_at": _now(), "profile_photo": None}}, upsert=True)
        staff = {k: v for k, v in admin.items() if k not in ("password_hash", "_id")}
        await sb.staff_users.update_one({"id": admin["id"]}, {"$set": {**staff, "is_demo_mirror": True}}, upsert=True)
        await sb.sandbox_meta.update_one({"_id": "config"}, {"$set": {
            "athlete_id": athlete_id, "athlete_name": name, "team": team, "updated_at": _now()}}, upsert=True)
        return {"athlete_id": athlete_id, "athlete_name": name, "team": team}

    @api_router.get("/admin/sandbox")
    async def sandbox_status(current_user: dict = Depends(get_current_user)):
        _require_real_admin(current_user)
        sb = db.sandbox
        cfg = await sb.sandbox_meta.find_one({"_id": "config"})
        if not cfg:
            return {"exists": False, "teams": TEAMS}
        counts = {}
        for name in ("daily_readiness", "training_sessions", "recovery_logs", "health_weekly_submissions",
                     "iir_episodes", "cmj_tests", "survey_responses"):
            counts[name] = await sb[name].count_documents({})
        return {"exists": True, "athlete_name": cfg.get("athlete_name"), "team": cfg.get("team"),
                "updated_at": cfg.get("updated_at"), "counts": counts, "teams": TEAMS}

    @api_router.post("/admin/sandbox/setup")
    async def sandbox_setup(payload: dict, current_user: dict = Depends(get_current_user)):
        admin = _require_real_admin(current_user)
        return await _setup(admin, payload.get("name"), payload.get("team"))

    @api_router.post("/admin/sandbox/enter")
    async def sandbox_enter(payload: dict, current_user: dict = Depends(get_current_user)):
        admin = _require_real_admin(current_user)
        info = await _setup(admin)
        as_ = payload.get("as", "athlete")
        if as_ == "staff":
            token = create_sandbox_token(admin["id"], "staff")
            user = await db.sandbox.staff_users.find_one({"id": admin["id"]}, {"_id": 0, "password_hash": 0})
            return {"token": token, "user_type": "staff", "user": user, "sandbox": True}
        token = create_sandbox_token(info["athlete_id"], "athlete")
        user = await db.sandbox.athletes.find_one({"id": info["athlete_id"]}, {"_id": 0, "password_hash": 0})
        return {"token": token, "user_type": "athlete", "user": user, "sandbox": True}

    @api_router.post("/admin/sandbox/reset")
    async def sandbox_reset(current_user: dict = Depends(get_current_user)):
        """Delete every demo record (the real database is never touched)."""
        admin = _require_real_admin(current_user)
        sb = db.sandbox
        cfg = await sb.sandbox_meta.find_one({"_id": "config"}) or {}
        for name in await sb.list_collection_names():
            if name != "sandbox_meta":
                await sb[name].drop()
        info = await _setup(admin, cfg.get("athlete_name"), cfg.get("team"))
        return {"message": "Demo data cleared", **info}

    @api_router.get("/sandbox/whoami")
    async def sandbox_whoami(current_user: dict = Depends(get_current_user)):
        """Lets the UI confirm that the current session is a demo session."""
        return {"sandbox": bool(sandbox_mode.get())}
