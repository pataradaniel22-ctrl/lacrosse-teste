"""Request-scoped athlete-group filter (see athlete_groups.py). No web-framework imports."""
from __future__ import annotations

import contextvars
import re
from typing import Optional
from urllib.parse import parse_qs

athlete_group_filter: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("athlete_group_filter", default=None)
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def _with_group(filter_doc, group):
    cond = {"groups": group}
    if not filter_doc:
        return cond
    return {"$and": [filter_doc, cond]}


class GroupFilteredCollection:
    """Wraps the athletes collection while a group filter is active."""

    def __init__(self, coll, group):
        self._coll = coll
        self._group = group

    def find(self, filter=None, *args, **kwargs):
        return self._coll.find(_with_group(filter, self._group), *args, **kwargs)

    async def count_documents(self, filter=None, *args, **kwargs):
        return await self._coll.count_documents(_with_group(filter, self._group), *args, **kwargs)

    async def distinct(self, key, filter=None, *args, **kwargs):
        return await self._coll.distinct(key, _with_group(filter, self._group), *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._coll, name)


def wrap_collection(name, coll):
    """Called by the database proxy for every collection access."""
    if name == "athletes":
        g = athlete_group_filter.get()
        if g:
            return GroupFilteredCollection(coll, g)
    return coll


def group_from_query_string(qs: bytes) -> Optional[str]:
    try:
        values = parse_qs(qs.decode("latin-1")).get("group")
    except Exception:
        return None
    if not values:
        return None
    g = values[0].strip().lower()
    if g in ("", "all") or not _ID_RE.match(g):
        return None
    return g


class GroupFilterMiddleware:
    """Pure ASGI middleware: reads ``?group=`` into the request's context."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        token = athlete_group_filter.set(group_from_query_string(scope.get("query_string") or b""))
        try:
            return await self.app(scope, receive, send)
        finally:
            athlete_group_filter.reset(token)


