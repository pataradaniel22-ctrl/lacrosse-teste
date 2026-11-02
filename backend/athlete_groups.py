"""Athlete groups (e.g. Competition, Training Camp, Development).

* Each athlete has a list of group ids in ``athletes.groups``.
* The group definitions (name + colour) live in ``app_settings`` (_id "athlete_groups").
* Any staff request may carry ``?group=<id>``: for that request every *list*
  query on the athletes collection (``find``, ``count_documents``, ``distinct``)
  only sees athletes of that group. Every dashboard chart, KPI, alert and report
  that starts from the athlete list is therefore filtered without changing each
  endpoint. Single-athlete lookups (``find_one``) and writes are never filtered.
"""
from __future__ import annotations

import re
from typing import List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from athlete_group_filter import GroupFilterMiddleware, athlete_group_filter, wrap_collection, _ID_RE  # noqa: F401

SETTINGS_ID = "athlete_groups"
COLORS = ["yellow", "green", "blue", "purple", "pink", "orange", "red", "cyan", "gray"]
DEFAULT_GROUPS = [
    {"id": "competition", "name": "Competition", "color": "yellow"},
    {"id": "training-camp", "name": "Training Camp", "color": "blue"},
    {"id": "development", "name": "Development", "color": "green"},
]
MAX_GROUPS = 20


# ---------------------------------------------------------------- settings
def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s[:40] or "group"


def validate_groups(groups: list) -> list:
    if len(groups) > MAX_GROUPS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_GROUPS} groups")
    out, seen = [], set()
    for g in groups:
        name = (g.get("name") or "").strip()
        if not 1 <= len(name) <= 30:
            raise HTTPException(status_code=400, detail="Group names must have 1–30 characters")
        gid = (g.get("id") or "").strip().lower() or slugify(name)
        if not _ID_RE.match(gid):
            gid = slugify(name)
        base, n = gid, 2
        while gid in seen:
            gid = f"{base[:36]}-{n}"
            n += 1
        seen.add(gid)
        color = g.get("color") if g.get("color") in COLORS else "gray"
        out.append({"id": gid, "name": name, "color": color})
    return out


async def load_groups(db) -> list:
    doc = await db.app_settings.find_one({"_id": SETTINGS_ID})
    if not doc:
        return [dict(g) for g in DEFAULT_GROUPS]
    return doc.get("groups") or []


async def current_group_meta(db):
    """{"id", "name"} of the group filter active on this request, or None."""
    gid = athlete_group_filter.get()
    if not gid:
        return None
    g = next((x for x in await load_groups(db) if x["id"] == gid), None)
    return {"id": gid, "name": g["name"] if g else gid}


class GroupDef(BaseModel):
    id: Optional[str] = None
    name: str
    color: Optional[str] = None


class GroupsUpdate(BaseModel):
    groups: List[GroupDef]


class AthleteGroupsUpdate(BaseModel):
    groups: List[str]


def register_athlete_group_routes(api_router, db, get_current_user):
    def staff_only(cu):
        if cu["user_type"] != "staff":
            raise HTTPException(status_code=403, detail="Staff only")

    def require_roles(cu, roles):
        staff_only(cu)
        if cu["user"].get("role") not in roles:
            raise HTTPException(status_code=403, detail="Not allowed for your role")

    @api_router.get("/athlete-groups")
    async def get_groups(current_user: dict = Depends(get_current_user)):
        staff_only(current_user)
        return {"groups": await load_groups(db), "colors": COLORS}

    @api_router.put("/admin/athlete-groups")
    async def save_groups(data: GroupsUpdate, current_user: dict = Depends(get_current_user)):
        require_roles(current_user, {"Admin"})
        groups = validate_groups([g.model_dump() if hasattr(g, "model_dump") else g.dict() for g in data.groups])
        old_ids = {g["id"] for g in await load_groups(db)}
        new_ids = {g["id"] for g in groups}
        await db.app_settings.update_one({"_id": SETTINGS_ID}, {"$set": {"groups": groups}}, upsert=True)
        removed = list(old_ids - new_ids)
        if removed:
            await db.athletes.update_many({"groups": {"$in": removed}}, {"$pull": {"groups": {"$in": removed}}})
        return {"groups": groups, "removed": removed}

    @api_router.put("/staff/athletes/{athlete_id}/groups")
    async def set_athlete_groups(athlete_id: str, data: AthleteGroupsUpdate, current_user: dict = Depends(get_current_user)):
        require_roles(current_user, {"Admin", "Coach"})
        valid = {g["id"] for g in await load_groups(db)}
        wanted = []
        for g in data.groups:
            if g not in valid:
                raise HTTPException(status_code=400, detail=f"Unknown group: {g}")
            if g not in wanted:
                wanted.append(g)
        r = await db.athletes.update_one({"id": athlete_id}, {"$set": {"groups": wanted}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Athlete not found")
        return {"athlete_id": athlete_id, "groups": wanted}
