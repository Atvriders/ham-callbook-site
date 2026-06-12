"""Leaderboards integration — Century Club artifact loader.

Thread-safe lazy loader for ``data/leaderboards.json``, the pre-computed
leaderboard artifact produced by ``app.scripts.build_leaderboards``.

The artifact is read once at startup (or on first request) and cached
in memory.  No DB hits occur at request time.

Lifecycle
---------

1. **Bootstrap** — if the primary path is missing but the upstream
   project-relative artifact exists, copy it across.
2. **Lazy load** — first ``get_category()`` call parses the JSON behind a
   thread-safe double-checked lock.  Subsequent calls are O(1).

Public surface (same shape as ``app.integrations.uls_history``):
``get_category()``, ``get_by_state()``, ``ensure_loaded()``,
``reload()``, ``stats()``, ``CACHE``.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime
from typing import Any, Final

logger = logging.getLogger("callbook.backend.leaderboards")

# --------------------------------------------------------------------------- #
# Paths                                                                       #
# --------------------------------------------------------------------------- #

LEADERBOARDS_PATH: Final[str] = os.environ.get(
    "LEADERBOARDS_PATH", "/data/leaderboards.json"
)

LEADERBOARDS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "LEADERBOARDS_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/leaderboards.json",
)

# --------------------------------------------------------------------------- #
# Category metadata — labels and descriptions surfaced by /api/records/categories
# --------------------------------------------------------------------------- #

CATEGORY_META: Final[dict[str, dict[str, str]]] = {
    "longest_issued": {
        "label": "Longest-Running Callsigns",
        "description": "Callsigns with the greatest span of years between first and last callbook appearance.",
        "sort_field": "span_years",
        "link_type": "callsign",
    },
    "longest_single_holder": {
        "label": "Longest Single-Holder Tenures",
        "description": "Callsigns held by the same licensed operator for the most consecutive editions.",
        "sort_field": "span_years",
        "link_type": "callsign",
    },
    "oldest_still_active": {
        "label": "Oldest Still-Active Calls",
        "description": "Callsigns first appearing in early editions whose license is still Active in FCC ULS.",
        "sort_field": "first_year",
        "link_type": "callsign",
    },
    "most_reissued": {
        "label": "Most-Reissued Callsigns",
        "description": "Callsigns held by the greatest number of distinct operators across the archive.",
        "sort_field": "distinct_holders",
        "link_type": "callsign",
    },
    "longest_at_address": {
        "label": "Longest at Same Address",
        "description": "Callsigns associated with the same physical address for the most years.",
        "sort_field": "span_years",
        "link_type": "callsign",
    },
    "longest_running_clubs": {
        "label": "Longest-Running Clubs",
        "description": "Amateur-radio clubs with the widest year span in the callbook archive.",
        "sort_field": "span_years",
        "link_type": "club",
    },
}


# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #


class _LeaderboardsCache:
    """Thread-safe lazy loader for the leaderboards artifact."""

    def __init__(self, path: str = LEADERBOARDS_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._categories: dict[str, list[dict[str, Any]]] = {}
        self._by_state: dict[str, list[dict[str, Any]]] = {}
        self._generated: str | None = None
        self._dataset_version: str | None = None
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._path):
            return
        if not os.path.exists(LEADERBOARDS_UPSTREAM_PATH):
            logger.warning(
                "Leaderboards artifact missing at %s and no upstream at %s; "
                "leaderboard endpoints will return empty.",
                self._path,
                LEADERBOARDS_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(LEADERBOARDS_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied leaderboards artifact %s -> %s",
                LEADERBOARDS_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy leaderboards artifact %s -> %s",
                LEADERBOARDS_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._path):
            self._categories = {}
            self._by_state = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse leaderboards artifact at %s", self._path)
            self._categories = {}
            self._by_state = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._categories = data.get("categories", {})
        self._by_state = data.get("by_state", {})
        self._generated = data.get("generated")
        self._dataset_version = data.get("dataset_version")

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0

        total_rows = sum(len(v) for v in self._categories.values())
        logger.info(
            "Loaded leaderboards artifact :: categories=%d, total_rows=%d, "
            "states=%d, duration=%.2fs, path=%s",
            len(self._categories),
            total_rows,
            len(self._by_state),
            self._load_duration_s,
            self._path,
        )

    # ----- public API -------------------------------------------------------

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def reload(self) -> int:
        with self._lock:
            self._loaded = False
            self._categories = {}
            self._by_state = {}
            self._load_locked()
            return sum(len(v) for v in self._categories.values())

    def get_category(
        self,
        name: str,
        state: str | None = None,
        district: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        rows = list(self._categories.get(name, []))
        if state:
            st = state.upper()
            rows = [r for r in rows if (r.get("state") or "").upper() == st]
        if district:
            rows = [r for r in rows if _callsign_district(r.get("callsign") or r.get("slug") or "") == district]
        return rows

    def get_by_state(self, state: str) -> list[dict[str, Any]]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return list(self._by_state.get(state.upper(), []))

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "path": self._path,
            "categories": list(self._categories.keys()) if self._loaded else [],
            "total_rows": sum(len(v) for v in self._categories.values()) if self._loaded else None,
            "by_state_count": len(self._by_state) if self._loaded else None,
            "generated": self._generated,
            "dataset_version": self._dataset_version,
            "snapshot_mtime": (
                datetime.utcfromtimestamp(self._snapshot_mtime).isoformat() + "Z"
                if self._snapshot_mtime
                else None
            ),
            "loaded_at": (
                datetime.utcfromtimestamp(self._loaded_at).isoformat() + "Z"
                if self._loaded_at
                else None
            ),
            "load_duration_s": self._load_duration_s,
        }


def _callsign_district(cs: str) -> str:
    """Extract the district digit from a callsign, e.g. W3ABC -> '3'."""
    for ch in cs:
        if ch.isdigit():
            return ch
    return ""


# --------------------------------------------------------------------------- #
# Module-level singleton + public wrappers                                    #
# --------------------------------------------------------------------------- #

CACHE: _LeaderboardsCache = _LeaderboardsCache()


def get_category(
    name: str,
    state: str | None = None,
    district: str | None = None,
) -> list[dict[str, Any]]:
    return CACHE.get_category(name, state=state, district=district)


def get_by_state(state: str) -> list[dict[str, Any]]:
    return CACHE.get_by_state(state)


def ensure_loaded() -> None:
    CACHE.ensure_loaded()


def reload() -> int:
    return CACHE.reload()


def stats() -> dict[str, Any]:
    return CACHE.stats()


__all__ = [
    "LEADERBOARDS_PATH",
    "LEADERBOARDS_UPSTREAM_PATH",
    "CATEGORY_META",
    "CACHE",
    "get_category",
    "get_by_state",
    "ensure_loaded",
    "reload",
    "stats",
]
