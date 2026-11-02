"""Removing an athlete's records (runs without a server).

    cd backend && python3 -m unittest tests.test_athlete_purge
"""
import asyncio
import sys
import types
import unittest

try:
    import fastapi  # noqa: F401
except ImportError:
    class HTTPException(Exception):
        def __init__(self, status_code, detail=None):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail
    sys.modules["fastapi"] = types.SimpleNamespace(Depends=lambda x: x, HTTPException=HTTPException)
try:
    import pydantic  # noqa: F401
except ImportError:
    sys.modules["pydantic"] = types.SimpleNamespace(BaseModel=object)

from athlete_purge import purge_athlete, purge_plan  # noqa: E402


def match(doc, q):
    if "$or" in q:
        return any(match(doc, s) for s in q["$or"])
    for k, v in q.items():
        val = doc.get(k)
        if isinstance(val, list):
            if v not in val:
                return False
        elif val != v:
            return False
    return True


class R:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Coll:
    def __init__(self, docs):
        self.docs = docs

    async def count_documents(self, q):
        return sum(match(d, q) for d in self.docs)

    async def delete_many(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not match(d, q)]
        return R(deleted_count=before - len(self.docs))

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if match(d, q):
                del self.docs[i]
                return R(deleted_count=1)
        return R(deleted_count=0)

    async def update_many(self, q, upd):
        n = 0
        for d in self.docs:
            if match(d, q):
                d["athlete_ids"].remove(upd["$pull"]["athlete_ids"])
                n += 1
        return R(modified_count=n)


class DB:
    def __init__(self, data):
        self.c = {k: Coll(v) for k, v in data.items()}

    async def list_collection_names(self):
        return list(self.c)

    def __getitem__(self, k):
        return self.c[k]


def data():
    return {
        "athletes": [{"id": "T"}, {"id": "A"}],
        "checkins": [{"athlete_id": "T"}, {"athlete_id": "T"}, {"athlete_id": "A"}],
        "messages": [{"sender_id": "T"}, {"athlete_ids": ["A", "T"], "text": "team"}],
        "staff_users": [{"id": "S", "user_id": "T"}],
        "uploads.files": [{"athlete_id": "T"}],
    }


class PurgeTests(unittest.TestCase):
    def test_preview_counts(self):
        plan = asyncio.run(purge_plan(DB(data()), "T"))
        self.assertEqual(plan, {"checkins": {"delete": 2, "unlink": 0}, "messages": {"delete": 1, "unlink": 1}})

    def test_purge_removes_only_that_athlete(self):
        db = DB(data())
        out = asyncio.run(purge_athlete(db, "T"))
        self.assertEqual(out["checkins"]["deleted"], 2)
        self.assertEqual(out["athletes"]["deleted"], 1)
        self.assertEqual(db["checkins"].docs, [{"athlete_id": "A"}])
        self.assertEqual(db["athletes"].docs, [{"id": "A"}])
        self.assertEqual(db["messages"].docs, [{"athlete_ids": ["A"], "text": "team"}])
        self.assertEqual(len(db["staff_users"].docs), 1)   # never touched
        self.assertEqual(len(db["uploads.files"].docs), 1)  # file store left alone


if __name__ == "__main__":
    unittest.main()
