"""One-off import of the original app's data from Emergent (read-only on Emergent).

Configuration (Render → Environment; never in code or chat):
  EMERGENT_MONGO_URL   connection string of the Emergent database
  EMERGENT_DB_NAME     database name (optional: detected when missing)
  EMERGENT_LLM_KEY     key of Emergent object storage (optional: needed to copy photos/PDFs)

Flow: preview (counts only) → run (admin types the confirmation). The run copies
every collection of the source into the REAL database of this app, replacing
the local documents of the same collections (the demo data), keeps the original
ids and password hashes, then copies the stored files into GridFS. Collections
that exist only here (e.g. Injury & Illness, settings) are kept.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

import requests
from fastapi import Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from db_context import sandbox_mode

logger = logging.getLogger(__name__)

STATUS_ID = "emergent_import_status"
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
CONFIRM_WORD = "IMPORTAR"
# Local collections that must never be overwritten by the source.
KEEP_LOCAL = {"app_settings"}
FILE_KEYS = ("storage_path", "thumb_path")
BATCH = 500
_TASKS = set()  # keep a reference so the background import is not garbage-collected


def _now():
    return datetime.now(timezone.utc).isoformat()


def _source_config():
    url = os.environ.get("EMERGENT_MONGO_URL", "").strip()
    return url, os.environ.get("EMERGENT_DB_NAME", "").strip() or None, os.environ.get("EMERGENT_LLM_KEY", "").strip() or None


def _collect_paths(doc, out):
    """Find object-storage paths anywhere in a document."""
    if isinstance(doc, dict):
        for k, v in doc.items():
            if k in FILE_KEYS and isinstance(v, str) and v:
                out.add(v)
            elif isinstance(v, (dict, list)):
                _collect_paths(v, out)
    elif isinstance(doc, list):
        for v in doc:
            _collect_paths(v, out)


class EmergentStorage:
    """Minimal client of Emergent object storage (download only)."""

    def __init__(self, key):
        self.key = key
        self.storage_key = None

    def _init(self):
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": self.key}, timeout=30)
        r.raise_for_status()
        self.storage_key = r.json()["storage_key"]

    def get(self, path):
        if not self.storage_key:
            self._init()
        r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": self.storage_key}, timeout=60)
        if r.status_code == 403:
            self._init()
            r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": self.storage_key}, timeout=60)
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")


def register_emergent_import_routes(api_router, db, get_current_user):

    def _require_admin(cu):
        if sandbox_mode.get():
            raise HTTPException(status_code=403, detail="Not available inside demo mode")
        if cu.get("user_type") != "staff" or (cu.get("user") or {}).get("role") != "Admin":
            raise HTTPException(status_code=403, detail="Admin only")
        return cu["user"]

    async def _source_db():
        url, name, _ = _source_config()
        if not url:
            raise HTTPException(status_code=400, detail="EMERGENT_MONGO_URL is not configured in Render → Environment")
        client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=15000)
        try:
            if not name:
                names = [n for n in await client.list_database_names() if n not in ("admin", "local", "config")]
                candidates = []
                for n in names:
                    if "athletes" in await client[n].list_collection_names():
                        candidates.append(n)
                if len(candidates) != 1:
                    raise HTTPException(status_code=400, detail=(
                        "Could not detect the Emergent database name automatically "
                        f"(found: {', '.join(names) or 'none'}). Set EMERGENT_DB_NAME in Render."))
                name = candidates[0]
            src = client[name]
            await src.command("ping")
            return client, src, name
        except HTTPException:
            client.close()
            raise
        except Exception as e:
            client.close()
            msg = str(e)
            # keep the per-server errors (they say why: network blocked, TLS, auth…), hide credentials
            import re as _re
            servers = _re.findall(r"error=([A-Za-z]+\([^)]{0,160})", msg) or _re.findall(r"error=([^,>]{0,160})", msg)
            raise HTTPException(status_code=400, detail=f"Could not connect to the Emergent database: {type(e).__name__}. "
                                                        f"Server errors: {'; '.join(servers[:3]) or msg[:300]}")

    async def _status():
        return await db.real.app_settings.find_one({"_id": STATUS_ID}, {"_id": 0}) or {"state": "idle"}

    async def _set_status(**kw):
        await db.real.app_settings.update_one({"_id": STATUS_ID}, {"$set": {**kw, "updated_at": _now()}}, upsert=True)

    @api_router.get("/admin/emergent-import/preview")
    async def emergent_preview(current_user: dict = Depends(get_current_user)):
        """Read-only: what exists in Emergent vs here. Nothing is changed anywhere."""
        _require_admin(current_user)
        client, src, name = await _source_db()
        try:
            rows = []
            paths = set()
            for coll in sorted(await src.list_collection_names()):
                if coll.startswith("system."):
                    continue
                n = await src[coll].count_documents({})
                local = await db.real[coll].count_documents({})
                rows.append({"collection": coll, "emergent": n, "here": local,
                             "action": "keep local" if coll in KEEP_LOCAL else "replace"})
                if n and n < 200000:
                    async for d in src[coll].find({}):
                        _collect_paths(d, paths)
            athletes = await src.athletes.count_documents({})
            staff = await src.staff_users.find({}, {"_id": 0, "name": 1, "role": 1, "email": 1}).to_list(100)
            _, _, key = _source_config()
            return {"database": name, "collections": rows, "athletes": athletes,
                    "staff": [{"name": s.get("name"), "role": s.get("role")} for s in staff],
                    "files": len(paths), "files_key_configured": bool(key),
                    "local_only_collections_kept": sorted(set(await db.real.list_collection_names()) -
                                                          {r["collection"] for r in rows}),
                    "status": await _status()}
        finally:
            client.close()

    @api_router.get("/admin/emergent-import/status")
    async def emergent_status(current_user: dict = Depends(get_current_user)):
        _require_admin(current_user)
        return await _status()

    @api_router.post("/admin/emergent-import/run")
    async def emergent_run(payload: dict, current_user: dict = Depends(get_current_user)):
        admin = _require_admin(current_user)
        if (payload.get("confirm") or "").strip().upper() != CONFIRM_WORD:
            raise HTTPException(status_code=400, detail=f"Type {CONFIRM_WORD} to confirm")
        st = await _status()
        if st.get("state") == "running":
            raise HTTPException(status_code=409, detail="An import is already running")
        client, src, name = await _source_db()
        include_files = bool(payload.get("include_files", True))
        await _set_status(state="running", started_at=_now(), started_by=admin.get("name"), database=name,
                          phase="collections", collections_done=[], errors=[], files_total=0, files_done=0,
                          files_failed=0, finished_at=None)
        task = asyncio.create_task(_run(client, src, include_files))
        _TASKS.add(task)
        task.add_done_callback(_TASKS.discard)
        return {"message": "Import started", "database": name}

    register_backup_file_routes(api_router, db, get_current_user, _require_admin, _set_status, _status)

    async def _run(client, src, include_files):
        errors = []
        done = []
        paths = set()
        try:
            for coll in sorted(await src.list_collection_names()):
                if coll.startswith("system.") or coll in KEEP_LOCAL:
                    continue
                try:
                    await db.real[coll].delete_many({})
                    batch = []
                    n = 0
                    async for d in src[coll].find({}):
                        _collect_paths(d, paths)
                        batch.append(d)
                        if len(batch) >= BATCH:
                            await db.real[coll].insert_many(batch, ordered=False)
                            n += len(batch)
                            batch = []
                    if batch:
                        await db.real[coll].insert_many(batch, ordered=False)
                        n += len(batch)
                    expected = await src[coll].count_documents({})
                    done.append({"collection": coll, "copied": n, "emergent": expected, "ok": n == expected})
                except Exception as e:
                    errors.append(f"{coll}: {type(e).__name__}: {str(e)[:150]}")
                await _set_status(collections_done=done, errors=errors)

            _, _, key = _source_config()
            if include_files and paths:
                if not key:
                    errors.append("EMERGENT_LLM_KEY not configured: photos/PDFs were not copied")
                    await _set_status(errors=errors)
                else:
                    await _set_status(phase="files", files_total=len(paths))
                    from recovery_storage import put_object
                    storage = EmergentStorage(key)
                    ok = failed = 0
                    for p in sorted(paths):
                        try:
                            data, ctype = await asyncio.to_thread(storage.get, p)
                            await put_object(p, data, ctype)
                            ok += 1
                        except Exception as e:
                            failed += 1
                            if failed <= 20:
                                errors.append(f"file {p}: {type(e).__name__}")
                        if (ok + failed) % 10 == 0:
                            await _set_status(files_done=ok, files_failed=failed, errors=errors)
                    await _set_status(files_done=ok, files_failed=failed, errors=errors)
            # Real data is now here: never re-create demo data automatically again.
            await db.real.app_settings.update_one({"_id": "demo_seed_disabled"}, {"$set": {
                "value": True, "reason": "Emergent data imported", "at": _now()}}, upsert=True)
            await _set_status(state="finished", phase="done", finished_at=_now(),
                              all_counts_match=all(c["ok"] for c in done) and not any(
                                  e for e in errors if not e.startswith("file ")))
        except Exception as e:
            logger.exception("Emergent import failed")
            errors.append(f"fatal: {type(e).__name__}: {str(e)[:200]}")
            await _set_status(state="failed", errors=errors, finished_at=_now())
        finally:
            client.close()


# ---------------------------------------------------------------------------
# Import from the backup ZIP produced by GET /api/admin/full-backup on Emergent
#   manifest.json · collections/<name>.json (bson.json_util relaxed) ·
#   files/<storage_path> · files_index.json
# ---------------------------------------------------------------------------
import json  # noqa: E402
import tempfile  # noqa: E402
import uuid as _uuid  # noqa: E402
import zipfile  # noqa: E402

from fastapi import File, UploadFile  # noqa: E402

UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "emergent_backups")
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB


def read_backup(path):
    """Validate a backup ZIP and return (manifest, {collection: count_in_file}, files_count)."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if "manifest.json" not in names:
            raise ValueError("manifest.json not found — is this the full backup from the Emergent app?")
        manifest = json.loads(z.read("manifest.json"))
        colls = {}
        for n in names:
            if n.startswith("collections/") and n.endswith(".json"):
                colls[n[len("collections/"):-len(".json")]] = n
        files = [n for n in names if n.startswith("files/") and not n.endswith("/")]
        return manifest, colls, len(files)


def register_backup_file_routes(api_router, db, get_current_user, require_admin, set_status, get_status):

    @api_router.post("/admin/emergent-import/upload")
    async def backup_upload(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
        require_admin(current_user)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        upload_id = str(_uuid.uuid4())
        dest = os.path.join(UPLOAD_DIR, f"{upload_id}.zip")
        size = 0
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD:
                    out.close()
                    os.remove(dest)
                    raise HTTPException(status_code=400, detail="Backup too large (max 1 GB)")
                out.write(chunk)
        try:
            manifest, colls, nfiles = read_backup(dest)
        except (zipfile.BadZipFile, ValueError, json.JSONDecodeError) as e:
            os.remove(dest)
            raise HTTPException(status_code=400, detail=f"Invalid backup file: {e}")
        rows = []
        for name in sorted(colls):
            rows.append({"collection": name, "emergent": (manifest.get("collections") or {}).get(name),
                         "here": await db.real[name].count_documents({}),
                         "action": "keep local" if name in KEEP_LOCAL else "replace"})
        missing = sorted(set((manifest.get("collections") or {})) - set(colls))
        return {"upload_id": upload_id, "size": size, "database": manifest.get("db_name"),
                "generated_at": manifest.get("generated_at"), "collections": rows, "files": nfiles,
                "missing_in_zip": missing,
                "local_only_collections_kept": sorted(set(await db.real.list_collection_names()) - set(colls))}

    @api_router.post("/admin/emergent-import/run-file")
    async def backup_run(payload: dict, current_user: dict = Depends(get_current_user)):
        admin = require_admin(current_user)
        if (payload.get("confirm") or "").strip().upper() != CONFIRM_WORD:
            raise HTTPException(status_code=400, detail=f"Type {CONFIRM_WORD} to confirm")
        if (await get_status()).get("state") == "running":
            raise HTTPException(status_code=409, detail="An import is already running")
        upload_id = str(payload.get("upload_id") or "")
        if not upload_id or "/" in upload_id or ".." in upload_id:
            raise HTTPException(status_code=400, detail="Invalid upload")
        path = os.path.join(UPLOAD_DIR, f"{upload_id}.zip")
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Backup file not found — upload it again")
        manifest, colls, _ = read_backup(path)
        await set_status(state="running", started_at=_now(), started_by=admin.get("name"),
                         database=manifest.get("db_name"), source="backup file", phase="collections",
                         collections_done=[], errors=[], files_total=0, files_done=0, files_failed=0,
                         finished_at=None)
        task = asyncio.create_task(_run_file(path, manifest, colls, bool(payload.get("include_files", True))))
        _TASKS.add(task)
        task.add_done_callback(_TASKS.discard)
        return {"message": "Import started"}

    async def _run_file(path, manifest, colls, include_files):
        from bson import json_util
        errors, done = [], []
        expected_counts = manifest.get("collections") or {}
        try:
            with zipfile.ZipFile(path) as z:
                for name in sorted(colls):
                    if name.startswith("system.") or name in KEEP_LOCAL:
                        continue
                    try:
                        docs = json_util.loads(z.read(colls[name]).decode("utf-8"))
                        if not isinstance(docs, list):
                            raise ValueError("collection file is not a list")
                        await db.real[name].delete_many({})
                        for i in range(0, len(docs), BATCH):
                            await db.real[name].insert_many(docs[i:i + BATCH], ordered=False)
                        exp = expected_counts.get(name, len(docs))
                        here = await db.real[name].count_documents({})
                        done.append({"collection": name, "copied": here, "emergent": exp, "ok": here == exp})
                    except Exception as e:
                        errors.append(f"{name}: {type(e).__name__}: {str(e)[:150]}")
                    await set_status(collections_done=done, errors=errors)

                files = [n for n in z.namelist() if n.startswith("files/") and not n.endswith("/")]
                if include_files and files:
                    index = {}
                    if "files_index.json" in z.namelist():
                        for it in json.loads(z.read("files_index.json")):
                            index[it.get("path")] = it.get("content_type")
                    await set_status(phase="files", files_total=len(files))
                    from recovery_storage import put_object
                    ok = failed = 0
                    for n in files:
                        p = n[len("files/"):]
                        try:
                            await put_object(p, z.read(n), index.get(p) or "application/octet-stream")
                            ok += 1
                        except Exception as e:
                            failed += 1
                            if failed <= 20:
                                errors.append(f"file {p}: {type(e).__name__}")
                        if (ok + failed) % 20 == 0:
                            await set_status(files_done=ok, files_failed=failed, errors=errors)
                    await set_status(files_done=ok, files_failed=failed, errors=errors)
            await db.real.app_settings.update_one({"_id": "demo_seed_disabled"}, {"$set": {
                "value": True, "reason": "Emergent data imported (backup file)", "at": _now()}}, upsert=True)
            await set_status(state="finished", phase="done", finished_at=_now(),
                             all_counts_match=all(c["ok"] for c in done) and not any(
                                 e for e in errors if not e.startswith("file ")))
        except Exception as e:
            logger.exception("Backup import failed")
            errors.append(f"fatal: {type(e).__name__}: {str(e)[:200]}")
            await set_status(state="failed", errors=errors, finished_at=_now())
        finally:
            try:
                os.remove(path)  # the backup contains personal data: do not keep it on the server
            except OSError:
                pass
