"""Edition Diff integration — thread-safe lazy loader for edition_diff.json.

Follows the same double-checked-locking pattern as uls_history.py.

Public API:
  get_pair(year_a, year_b)   -> dict | None
  get_pairs()                -> list[dict]
  get_wwii_cohort()          -> dict | None
  stats()                    -> dict
  ensure_loaded()            -> None
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

logger = logging.getLogger("callbook.backend.edition_diff")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

EDITION_DIFF_PATH: Final[str] = os.environ.get(
    "EDITION_DIFF_PATH", "/data/edition_diff.json"
)

EDITION_DIFF_UPSTREAM_PATH: Final[str] = os.environ.get(
    "EDITION_DIFF_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/edition_diff.json",
)


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


class _EditionDiffCache:
    """Thread-safe lazy loader for the edition_diff artifact."""

    def __init__(self, path: str = EDITION_DIFF_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._pairs: list[dict[str, Any]] = []
        self._pairs_index: dict[tuple[int, int], dict[str, Any]] = {}
        self._wwii: dict[str, Any] | None = None
        self._meta: dict[str, Any] = {}
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._path):
            return
        if not os.path.exists(EDITION_DIFF_UPSTREAM_PATH):
            logger.warning(
                "edition_diff artifact missing at %s and no upstream at %s",
                self._path,
                EDITION_DIFF_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(EDITION_DIFF_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied edition_diff artifact %s -> %s",
                EDITION_DIFF_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy edition_diff artifact %s -> %s",
                EDITION_DIFF_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._path):
            self._pairs = []
            self._pairs_index = {}
            self._wwii = None
            self._meta = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse edition_diff artifact at %s", self._path)
            self._pairs = []
            self._pairs_index = {}
            self._wwii = None
            self._meta = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        pairs: list[dict[str, Any]] = data.get("pairs", [])
        index: dict[tuple[int, int], dict[str, Any]] = {}
        for p in pairs:
            ya = p.get("year_a")
            yb = p.get("year_b")
            if isinstance(ya, int) and isinstance(yb, int):
                index[(ya, yb)] = p

        self._pairs = pairs
        self._pairs_index = index
        self._wwii = data.get("wwii_cohort")
        self._meta = {
            "generated": data.get("generated"),
            "dataset_version": data.get("dataset_version"),
            "pair_count": data.get("pair_count", len(pairs)),
        }

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0
        logger.info(
            "Loaded edition_diff artifact :: pairs=%d, duration=%.2fs, path=%s",
            len(self._pairs),
            self._load_duration_s,
            self._path,
        )

    # ----- public API -------------------------------------------------------

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def get_pair(self, year_a: int, year_b: int) -> dict[str, Any] | None:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._pairs_index.get((year_a, year_b))

    def get_pairs(self) -> list[dict[str, Any]]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return list(self._pairs)

    def get_wwii_cohort(self) -> dict[str, Any] | None:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._wwii

    def meta(self) -> dict[str, Any]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return dict(self._meta)

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "path": self._path,
            "pair_count": len(self._pairs) if self._loaded else None,
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


# ---------------------------------------------------------------------------
# Module-level singleton + public wrappers
# ---------------------------------------------------------------------------

CACHE: _EditionDiffCache = _EditionDiffCache()


def get_pair(year_a: int, year_b: int) -> dict[str, Any] | None:
    return CACHE.get_pair(year_a, year_b)


def get_pairs() -> list[dict[str, Any]]:
    return CACHE.get_pairs()


def get_wwii_cohort() -> dict[str, Any] | None:
    return CACHE.get_wwii_cohort()


def meta() -> dict[str, Any]:
    return CACHE.meta()


def ensure_loaded() -> None:
    CACHE.ensure_loaded()


def stats() -> dict[str, Any]:
    return CACHE.stats()


__all__ = [
    "EDITION_DIFF_PATH",
    "EDITION_DIFF_UPSTREAM_PATH",
    "CACHE",
    "get_pair",
    "get_pairs",
    "get_wwii_cohort",
    "meta",
    "ensure_loaded",
    "stats",
]
