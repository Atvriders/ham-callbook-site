"""Name Trends integration — lazy loader for name_trends.json.

Thread-safe lazy loader for ``data/name_trends.json``, the pre-computed
name-trends and YL-index artifact produced by
``app.scripts.build_name_trends``.

The artifact is read once at startup (or on first request) and cached
in memory.  No DB hits occur at request time.

Lifecycle
---------

1. **Bootstrap** — if the primary path is missing but the upstream
   project-relative artifact exists, copy it across.
2. **Lazy load** — first API call parses the JSON behind a thread-safe
   double-checked lock.  Subsequent calls are O(1).

Public surface:
``voyager_lookup()``, ``yl_index()``, ``top_names_by_era()``,
``archive_years()``, ``ensure_loaded()``, ``reload()``, ``stats()``, ``CACHE``.
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

logger = logging.getLogger("callbook.backend.name_trends")

# --------------------------------------------------------------------------- #
# Paths                                                                       #
# --------------------------------------------------------------------------- #

NAME_TRENDS_PATH: Final[str] = os.environ.get(
    "NAME_TRENDS_PATH", "/data/name_trends.json"
)

NAME_TRENDS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "NAME_TRENDS_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/name_trends.json",
)


# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #


class _NameTrendsCache:
    """Thread-safe lazy loader for the name trends artifact."""

    def __init__(self, path: str = NAME_TRENDS_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._voyager: dict[str, dict[str, int]] = {}
        self._yl_index: dict[str, dict[str, dict[str, Any]]] | None = None
        self._top_names_by_era: dict[str, list[dict[str, Any]]] = {}
        self._archive_years: list[int] = []
        self._yl_degraded: bool = True
        self._yl_degraded_reason: str | None = None
        self._generated: str | None = None
        self._dataset_version: str | None = None
        self._meta: dict[str, Any] = {}
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._path):
            return
        if not os.path.exists(NAME_TRENDS_UPSTREAM_PATH):
            logger.warning(
                "Name trends artifact missing at %s and no upstream at %s; "
                "name voyager and YL index endpoints will return empty.",
                self._path,
                NAME_TRENDS_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(NAME_TRENDS_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied name trends artifact %s -> %s",
                NAME_TRENDS_UPSTREAM_PATH,
                self._path,
            )
        except OSError as exc:
            logger.warning(
                "Failed to copy name trends artifact %s -> %s: %s "
                "(will read upstream directly on first request).",
                NAME_TRENDS_UPSTREAM_PATH,
                self._path,
                exc,
            )

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        # Resolve effective path: primary, then upstream fallback
        effective_path = self._path
        if not os.path.exists(effective_path) and os.path.exists(
            NAME_TRENDS_UPSTREAM_PATH
        ):
            effective_path = NAME_TRENDS_UPSTREAM_PATH
            logger.info(
                "Primary artifact missing; reading directly from upstream %s",
                effective_path,
            )

        if not os.path.exists(effective_path):
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(effective_path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse name trends artifact at %s", self._path)
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._voyager = data.get("voyager", {})
        self._yl_index = data.get("yl_index")
        self._top_names_by_era = data.get("top_names_by_era", {})
        self._archive_years = data.get("archive_years", [])
        self._yl_degraded = data.get("yl_degraded", True)
        self._yl_degraded_reason = data.get("yl_degraded_reason")
        self._generated = data.get("generated")
        self._dataset_version = data.get("dataset_version")
        self._meta = {
            "total_rows_scanned": data.get("total_rows_scanned"),
            "total_classifiable": data.get("total_classifiable"),
            "total_unclassifiable": data.get("total_unclassifiable"),
            "distinct_first_names": data.get("distinct_first_names"),
            "min_count_threshold": data.get("min_count_threshold"),
            "min_year": data.get("min_year"),
            "max_year": data.get("max_year"),
        }

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0

        logger.info(
            "Loaded name trends artifact :: names=%d, yl_degraded=%s, "
            "duration=%.2fs, path=%s",
            len(self._voyager),
            self._yl_degraded,
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
            self._voyager = {}
            self._yl_index = None
            self._load_locked()
            return len(self._voyager)

    def voyager_lookup(self, name: str) -> dict[str, int] | None:
        """Return {year_str: count} for a first name, or None if not found."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        # Try exact match first, then title-case
        result = self._voyager.get(name)
        if result is None:
            result = self._voyager.get(name.title())
        return result

    def voyager_search(self, prefix: str, limit: int = 20) -> list[str]:
        """Return names starting with ``prefix`` (case-insensitive), up to limit."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        pfx = prefix.lower()
        matches = [n for n in self._voyager if n.lower().startswith(pfx)]
        return sorted(matches)[:limit]

    def voyager_compare(self, names: list[str]) -> dict[str, dict[str, int]]:
        """Return voyager data for multiple names at once."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        result: dict[str, dict[str, int]] = {}
        for name in names[:10]:  # cap at 10 for compare mode
            data = self._voyager.get(name) or self._voyager.get(name.title())
            if data:
                result[name] = data
        return result

    def yl_index(
        self,
        state: str | None = None,
        decade: str | None = None,
    ) -> dict[str, Any] | None:
        """Return the full YL index, optionally filtered by state and/or decade."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        if self._yl_index is None:
            return None
        if state is None and decade is None:
            return self._yl_index
        result: dict[str, Any] = {}
        for st, dmap in self._yl_index.items():
            if state and st != state.upper():
                continue
            if decade:
                if decade in dmap:
                    result[st] = {decade: dmap[decade]}
            else:
                result[st] = dmap
        return result

    def top_names_by_era(self) -> dict[str, list[dict[str, Any]]]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._top_names_by_era

    def archive_years(self) -> list[int]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._archive_years

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "path": self._path,
            "voyager_names": len(self._voyager) if self._loaded else None,
            "yl_degraded": self._yl_degraded,
            "yl_degraded_reason": self._yl_degraded_reason,
            "generated": self._generated,
            "dataset_version": self._dataset_version,
            "meta": self._meta,
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


# --------------------------------------------------------------------------- #
# Module-level singleton + public wrappers                                    #
# --------------------------------------------------------------------------- #

CACHE: _NameTrendsCache = _NameTrendsCache()


def voyager_lookup(name: str) -> dict[str, int] | None:
    """Return {year_str: count} for a first name, or None if not found."""
    return CACHE.voyager_lookup(name)


def voyager_search(prefix: str, limit: int = 20) -> list[str]:
    """Return names starting with prefix (case-insensitive)."""
    return CACHE.voyager_search(prefix, limit=limit)


def voyager_compare(names: list[str]) -> dict[str, dict[str, int]]:
    """Return voyager data for multiple names."""
    return CACHE.voyager_compare(names)


def yl_index(
    state: str | None = None,
    decade: str | None = None,
) -> dict[str, Any] | None:
    """Return the YL index, optionally filtered."""
    return CACHE.yl_index(state=state, decade=decade)


def top_names_by_era() -> dict[str, list[dict[str, Any]]]:
    """Return top 10 names per era/decade."""
    return CACHE.top_names_by_era()


def archive_years() -> list[int]:
    """Return sorted list of archive years covered by this artifact."""
    return CACHE.archive_years()


def ensure_loaded() -> None:
    """Eagerly warm the cache (e.g. at FastAPI startup)."""
    CACHE.ensure_loaded()


def reload() -> int:
    """Re-read the artifact from disk. Returns the new name count."""
    return CACHE.reload()


def stats() -> dict[str, Any]:
    """Return diagnostic info about the loaded artifact."""
    return CACHE.stats()


__all__ = [
    "NAME_TRENDS_PATH",
    "NAME_TRENDS_UPSTREAM_PATH",
    "CACHE",
    "voyager_lookup",
    "voyager_search",
    "voyager_compare",
    "yl_index",
    "top_names_by_era",
    "archive_years",
    "ensure_loaded",
    "reload",
    "stats",
]
