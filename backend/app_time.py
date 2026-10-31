"""Application timezone helpers.

The athlete-monitoring cycle (which day a check-in / training / recovery log
belongs to, and what counts as "today") is anchored to Boston local time
(US Eastern). ZoneInfo("America/New_York") automatically handles the EST/EDT
daylight-saving transitions.

Absolute timestamps (``created_at``) are still stored in UTC ISO format — only
the *calendar day* logic uses local time.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

APP_TZ = ZoneInfo("America/New_York")  # Boston / US Eastern (auto EST/EDT)


def local_now() -> datetime:
    """Current time in the app's local timezone (Boston)."""
    return datetime.now(APP_TZ)


def today_str() -> str:
    """Today's calendar date (YYYY-MM-DD) in Boston local time."""
    return local_now().strftime("%Y-%m-%d")
