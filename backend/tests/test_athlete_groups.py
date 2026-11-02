"""Athlete groups: request filter and group validation (runs without a server).

    cd backend && python3 -m unittest tests.test_athlete_groups
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

from athlete_group_filter import athlete_group_filter, group_from_query_string, wrap_collection, GroupFilteredCollection  # noqa: E402
from athlete_groups import validate_groups  # noqa: E402
from db_context import SandboxAwareDB  # noqa: E402

HTTPException = sys.modules["fastapi"].HTTPException


class Spy:
    def __init__(self):
        self.calls = []

    def find(self, f=None, *a, **k):
        self.calls.append(("find", f))
        return "cursor"

    async def count_documents(self, f=None):
        self.calls.append(("count", f))
        return 0

    async def find_one(self, f=None):
        self.calls.append(("find_one", f))

    async def update_one(self, f, u):
        self.calls.append(("update_one", f))


class FakeMotorDB:
    def __init__(self):
        self.athletes = Spy()
        self.checkins = Spy()

    def __getitem__(self, k):
        return getattr(self, k)


class QueryStringTests(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(group_from_query_string(b"team=men&group=competition"), "competition")
        self.assertIsNone(group_from_query_string(b"group=all"))
        self.assertIsNone(group_from_query_string(b"group="))
        self.assertIsNone(group_from_query_string(b"team=men"))
        self.assertIsNone(group_from_query_string(b"group=%7B%24ne%3A1%7D"))  # {$ne:1} rejected
        self.assertEqual(group_from_query_string(b"group=Training-Camp"), "training-camp")


class FilterTests(unittest.TestCase):
    def setUp(self):
        self.real = FakeMotorDB()
        self.db = SandboxAwareDB(self.real, FakeMotorDB())

    def test_no_filter_passes_through(self):
        self.assertIs(self.db.athletes, self.real.athletes)

    def test_list_queries_filtered_single_lookups_not(self):
        tok = athlete_group_filter.set("competition")
        try:
            coll = self.db.athletes
            self.assertIsInstance(coll, GroupFilteredCollection)
            coll.find({"active": True}, {"_id": 0})
            coll.find()
            asyncio.run(coll.count_documents({"team": "x"}))
            asyncio.run(coll.find_one({"id": "a"}))
            asyncio.run(coll.update_one({"id": "a"}, {}))
            self.assertIs(self.db.checkins, self.real.checkins)  # other collections untouched
            self.assertIsInstance(self.db["athletes"], GroupFilteredCollection)
        finally:
            athlete_group_filter.reset(tok)
        c = self.real.athletes.calls
        self.assertEqual(c[0], ("find", {"$and": [{"active": True}, {"groups": "competition"}]}))
        self.assertEqual(c[1], ("find", {"groups": "competition"}))
        self.assertEqual(c[2], ("count", {"$and": [{"team": "x"}, {"groups": "competition"}]}))
        self.assertEqual(c[3], ("find_one", {"id": "a"}))
        self.assertEqual(c[4], ("update_one", {"id": "a"}))

    def test_wrap_other_names(self):
        tok = athlete_group_filter.set("x")
        try:
            self.assertEqual(wrap_collection("staff_users", 1), 1)
        finally:
            athlete_group_filter.reset(tok)


class ValidateTests(unittest.TestCase):
    def test_ids_colors_duplicates(self):
        out = validate_groups([{"name": "Competição 2027", "color": "yellow"},
                               {"name": "Competição 2027", "color": "nope"},
                               {"id": "dev", "name": "Dev"}])
        self.assertEqual(out[0], {"id": "competi-o-2027", "name": "Competição 2027", "color": "yellow"})
        self.assertEqual(out[1]["id"], "competi-o-2027-2")
        self.assertEqual(out[1]["color"], "gray")
        self.assertEqual(out[2]["id"], "dev")

    def test_bad_names(self):
        for bad in ([{"name": ""}], [{"name": "x" * 31}], [{"name": f"g{i}"} for i in range(21)]):
            with self.assertRaises(HTTPException):
                validate_groups(bad)


if __name__ == "__main__":
    unittest.main()
