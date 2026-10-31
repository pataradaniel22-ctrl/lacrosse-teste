"""Emergent Object Storage helper for Recovery proof uploads (images / PDFs)."""
import os
import logging
import asyncio
from io import BytesIO

import requests
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Thumbnail config: small JPEG used in the staff gallery grid so the browser does
# not download full-resolution (up to 10MB) photos for every tile.
THUMB_MAX_PX = 400
THUMB_QUALITY = 80
THUMBNAILABLE = {"jpg", "jpeg", "png"}

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "brazil-lacrosse-recovery"

_storage_key = None

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "pdf"}
MIME_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "pdf": "application/pdf",
}
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


def init_storage():
    """Initialize (once) a session-scoped storage key. Returns the key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    # Read the key lazily (env may not have been loaded at import time).
    emergent_key = EMERGENT_KEY or os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    logger.info("Recovery object storage initialized")
    return _storage_key


def _put_object_sync(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    try:
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        if resp.status_code == 403:
            # Key expired - reinit once and retry
            globals()["_storage_key"] = None
            key = init_storage()
            resp = requests.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key, "Content-Type": content_type},
                data=data,
                timeout=120,
            )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.exception(f"put_object failed: {e}")
        raise


def _get_object_sync(path: str):
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 403:
        globals()["_storage_key"] = None
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


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
