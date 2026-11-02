"""Admin: remove an athlete and everything recorded for them (e.g. test accounts).

GET  /api/admin/athlete/{id}/purge-preview  -> how many records would go, per collection
POST /api/admin/athlete/{id}/purge {"confirm": "<athlete e-mail>"} -> deletes them

Records are found by the athlete's id in `athlete_id`, `user_id` or `sender_id`;
the id is also removed from `athlete_ids` lists (other people's records stay).
Uses the request's database (respects demo mode). Cannot be undone.
"""
from fastapi import Depends, HTTPException
from pydantic import BaseModel

SKIP = {"athletes", "app_settings", "staff_users"}
FIELDS = ("athlete_id", "user_id", "sender_id")


def _skip(name: str) -> bool:
    return name in SKIP or name.startswith("system.") or name.endswith(".files") or name.endswith(".chunks")


def _query(athlete_id: str) -> dict:
    return {"$or": [{f: athlete_id} for f in FIELDS]}


async def purge_plan(database, athlete_id: str) -> dict:
    out = {}
    for name in sorted(await database.list_collection_names()):
        if _skip(name):
            continue
        coll = database[name]
        n = await coll.count_documents(_query(athlete_id))
        m = await coll.count_documents({"athlete_ids": athlete_id})
        if n or m:
            out[name] = {"delete": n, "unlink": m}
    return out


async def purge_athlete(database, athlete_id: str) -> dict:
    out = {}
    for name in sorted(await database.list_collection_names()):
        if _skip(name):
            continue
        coll = database[name]
        d = (await coll.delete_many(_query(athlete_id))).deleted_count
        u = (await coll.update_many({"athlete_ids": athlete_id}, {"$pull": {"athlete_ids": athlete_id}})).modified_count
        if d or u:
            out[name] = {"deleted": d, "unlinked": u}
    r = await database["athletes"].delete_one({"id": athlete_id})
    out["athletes"] = {"deleted": r.deleted_count, "unlinked": 0}
    return out


class PurgeRequest(BaseModel):
    confirm: str


def register_athlete_purge_routes(api_router, db, get_current_user):
    def require_admin(cu):
        if cu["user_type"] != "staff" or cu["user"].get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")

    async def get_athlete(athlete_id):
        a = await db.athletes.find_one({"id": athlete_id}, {"_id": 0, "id": 1, "name": 1, "email": 1})
        if not a:
            raise HTTPException(status_code=404, detail="Athlete not found")
        return a

    @api_router.get("/admin/athlete/{athlete_id}/purge-preview")
    async def purge_preview(athlete_id: str, current_user: dict = Depends(get_current_user)):
        require_admin(current_user)
        a = await get_athlete(athlete_id)
        return {"athlete": a, "records": await purge_plan(db.current(), athlete_id)}

    @api_router.post("/admin/athlete/{athlete_id}/purge")
    async def purge(athlete_id: str, data: PurgeRequest, current_user: dict = Depends(get_current_user)):
        require_admin(current_user)
        a = await get_athlete(athlete_id)
        if data.confirm.strip().lower() != (a.get("email") or "").strip().lower():
            raise HTTPException(status_code=400, detail="Type the athlete's e-mail to confirm")
        return {"athlete": a, "removed": await purge_athlete(db.current(), athlete_id)}
