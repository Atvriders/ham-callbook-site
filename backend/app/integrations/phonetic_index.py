"""Phonetic index integration — lazy loader for phonetic_index.json.

Thread-safe lazy loader for ``data/phonetic_index.json``, the pre-computed
phonetic artifact produced by ``app.scripts.build_phonetic_index``.

The artifact is read once at startup (or on first request) and cached
in memory.  No DB hits occur at request time.

Lifecycle
---------

1. **Bootstrap** — if the primary path is missing but the upstream
   project-relative artifact exists, copy it across.
2. **Lazy load** — first ``lookup()`` call parses the JSON behind a
   thread-safe double-checked lock.  Subsequent calls are O(1) dict lookups.

Public surface:
``lookup()``, ``ensure_loaded()``, ``reload()``, ``stats()``, ``CACHE``.
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

logger = logging.getLogger("callbook.backend.phonetic_index")

# --------------------------------------------------------------------------- #
# Paths                                                                       #
# --------------------------------------------------------------------------- #

PHONETIC_INDEX_PATH: Final[str] = os.environ.get(
    "PHONETIC_INDEX_PATH", "/data/phonetic_index.json"
)

PHONETIC_INDEX_UPSTREAM_PATH: Final[str] = os.environ.get(
    "PHONETIC_INDEX_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/phonetic_index.json",
)


# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #


class _PhoneticIndexCache:
    """Thread-safe lazy loader for the phonetic index artifact."""

    def __init__(self, path: str = PHONETIC_INDEX_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._index: dict[str, dict[str, Any]] = {}  # phonetic_key -> {t, p}
        self._generated: str | None = None
        self._dataset_version: str | None = None
        self._phonetic_lib: str | None = None
        self._stats: dict[str, Any] = {}
        self._abbrev_map: dict[str, str] = {}
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._path):
            return
        if not os.path.exists(PHONETIC_INDEX_UPSTREAM_PATH):
            logger.warning(
                "Phonetic index artifact missing at %s and no upstream at %s; "
                "people lookup endpoints will return empty.",
                self._path,
                PHONETIC_INDEX_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(PHONETIC_INDEX_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied phonetic index artifact %s -> %s",
                PHONETIC_INDEX_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy phonetic index artifact %s -> %s",
                PHONETIC_INDEX_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._path):
            self._index = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse phonetic index artifact at %s", self._path)
            self._index = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._index = data.get("index", {})
        self._generated = data.get("generated")
        self._dataset_version = data.get("dataset_version")
        self._phonetic_lib = data.get("phonetic_lib")
        self._stats = data.get("stats", {})
        self._abbrev_map = data.get("abbrev_map", {})

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0

        logger.info(
            "Loaded phonetic index artifact :: keys=%d, duration=%.2fs, path=%s",
            len(self._index),
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
            self._index = {}
            self._load_locked()
            return len(self._index)

    def lookup(self, phonetic_key: str) -> dict[str, Any] | None:
        """Return the posting dict for ``phonetic_key``, or None."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._index.get(phonetic_key)

    def abbrev_map(self) -> dict[str, str]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._abbrev_map

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "path": self._path,
            "index_keys": len(self._index) if self._loaded else None,
            "generated": self._generated,
            "dataset_version": self._dataset_version,
            "phonetic_lib": self._phonetic_lib,
            "artifact_stats": self._stats,
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

CACHE: _PhoneticIndexCache = _PhoneticIndexCache()


def lookup(phonetic_key: str) -> dict[str, Any] | None:
    """Return the phonetic posting dict for ``phonetic_key``, or None."""
    return CACHE.lookup(phonetic_key)


def ensure_loaded() -> None:
    """Eagerly warm the cache (e.g. at FastAPI startup)."""
    CACHE.ensure_loaded()


def reload() -> int:
    """Re-read the artifact from disk. Returns the new key count."""
    return CACHE.reload()


def stats() -> dict[str, Any]:
    """Return diagnostic info about the loaded artifact."""
    return CACHE.stats()


__all__ = [
    "PHONETIC_INDEX_PATH",
    "PHONETIC_INDEX_UPSTREAM_PATH",
    "CACHE",
    "lookup",
    "ensure_loaded",
    "reload",
    "stats",
]
