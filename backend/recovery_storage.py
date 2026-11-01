"""Object storage for uploads (images / PDFs), kept in MongoDB GridFS.

Files live in the same MongoDB database as the rest of the app (bucket
``uploads``), so no external storage service or extra account is needed.
Each object is addressed by its ``path`` (stored as the GridFS filename).
"""
import os
import logging
import asyncio
import threading
from io import BytesIO

import gridfs
from pymongo import MongoClient
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Thumbnail config: small JPEG used in the staff gallery grid so the browser does
# not download full-resolution (up to 10MB) photos for every tile.
THUMB_MAX_PX = 400
THUMB_QUALITY = 80
THUMBNAILABLE = {"jpg", "jpeg", "png"}

APP_NAME = "brazil-lacrosse-recovery"
BUCKET_NAME = "uploads"

_fs = None
_fs_lock = threading.Lock()

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "pdf"}
MIME_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "pdf": "application/pdf",
}
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


def init_storage():
    """Open (once) the GridFS bucket. Returns the bucket."""
    global _fs
    if _fs is not None:
        return _fs
    with _fs_lock:
        if _fs is None:
            mongo_url = os.environ.get("MONGO_URL")
            db_name = os.environ.get("DB_NAME")
            if not mongo_url or not db_name:
                raise RuntimeError("MONGO_URL / DB_NAME not configured")
            client = MongoClient(mongo_url)
            _fs = gridfs.GridFSBucket(client[db_name], bucket_name=BUCKET_NAME)
            logger.info("Object storage (GridFS) initialized")
    return _fs


def _put_object_sync(path: str, data: bytes, content_type: str) -> dict:
    fs = init_storage()
    try:
        # Keep one file per path: replace any previous version.
        for old in fs.find({"filename": path}):
            fs.delete(old._id)
        fs.upload_from_stream(path, BytesIO(data), metadata={"content_type": content_type})
        return {"path": path, "size": len(data)}
    except Exception as e:
        logger.exception(f"put_object failed: {e}")
        raise


def _get_object_sync(path: str):
    fs = init_storage()
    try:
        stream = fs.open_download_stream_by_name(path)
    except gridfs.errors.NoFile:
        raise FileNotFoundError(path)
    meta = stream.metadata or {}
    return stream.read(), meta.get("content_type", "application/octet-stream")


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await asyncio.to_thread(_put_object_sync, path, data, content_type)


async def get_object(path: str):
    return await asyncio.to_thread(_get_object_sync, path)


def _make_thumbnail_sync(data: bytes) -> bytes | None:
    """Return a small JPEG thumbnail (<=THUMB_MAX_PX) or None if generation fails."""
    try:
        img = Image.open(BytesIO(data))
        # Respect phone EXIF orientation so portraits aren't sideways.
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=THUMB_QUALITY, optimize=True)
        return buf.getvalue()
    except Exception:
        logger.exception("Thumbnail generation failed")
        return None


async def make_thumbnail(data: bytes) -> bytes | None:
    return await asyncio.to_thread(_make_thumbnail_sync, data)


# Low-resolution config for training-session photos: we keep ONLY a compressed
# copy (no original) to minimise storage — these photos are context, not proof.
LOWRES_MAX_PX = 1280
LOWRES_QUALITY = 55


def _make_lowres_sync(data: bytes) -> bytes | None:
    """Return a compressed, low-resolution JPEG or None if it fails."""
    try:
        img = Image.open(BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail((LOWRES_MAX_PX, LOWRES_MAX_PX))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=LOWRES_QUALITY, optimize=True)
        return buf.getvalue()
    except Exception:
        logger.exception("Low-res generation failed")
        return None


async def make_lowres(data: bytes) -> bytes | None:
    return await asyncio.to_thread(_make_lowres_sync, data)


# Higher-quality config for device screenshots (Whoop/Garmin/Apple Health etc.):
# kept larger + higher quality than session photos so numbers/text stay legible.
SCREENSHOT_MAX_PX = 1600
SCREENSHOT_QUALITY = 82


def _make_screenshot_sync(data: bytes) -> bytes | None:
    """Return a legible, moderately-compressed JPEG for a device screenshot."""
    try:
        img = Image.open(BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail((SCREENSHOT_MAX_PX, SCREENSHOT_MAX_PX))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=SCREENSHOT_QUALITY, optimize=True)
        return buf.getvalue()
    except Exception:
        logger.exception("Screenshot generation failed")
        return None


async def make_screenshot(data: bytes) -> bytes | None:
    return await asyncio.to_thread(_make_screenshot_sync, data)



def validate_extension(filename: str) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("Unsupported file type. Allowed: JPG, JPEG, PNG, PDF")
    return ext
