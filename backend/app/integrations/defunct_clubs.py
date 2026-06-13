"""Defunct Clubs integration — lazy loader for ``data/defunct_clubs.json``.

Thread-safe lazy loader for the pre-computed defunct-clubs artifact
produced by ``scripts/build_defunct_clubs.py``.

The artifact is read once on first request and cached in memory.  No DB
hits occur at request time; all filtering and pagination is in-process.

Lifecycle
---------

1. **Bootstrap** — if the primary path is missing but the project-relative
   upstream artifact exists, copy it across.
2. **Lazy load** — first public API call parses the JSON behind a
   thread-safe double-checked lock.  Subsequent calls are O(1).

Public surface
--------------
``get_list()``, ``get_by_slug()``, ``ensure_loaded()``,
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

logger = logging.getLogger("callbook.backend.defunct_clubs")

# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #

DEFUNCT_CLUBS_PATH: Final[str] = os.environ.get(
    "DEFUNCT_CLUBS_PATH", "/data/defunct_clubs.json"
)

DEFUNCT_CLUBS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "DEFUNCT_CLUBS_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/defunct_clubs.json",
)

# --------------------------------------------------------------------------- #
# Cache                                                                        #
# --------------------------------------------------------------------------- #


class _DefunctClubsCache:
    """Thread-safe lazy loader for the defunct_clubs artifact."""

    def __init__(self, path: str = DEFUNCT_CLUBS_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False

        # Flat list ordered by the artifact (appearance_count DESC)
        self._clubs: list[dict[str, Any]] = []

        # Fast-lookup indexes built at load time
        self._by_slug: dict[str, dict[str, Any]] = {}
        self._by_state: dict[str, list[dict[str, Any]]] = {}
        self._by_era: dict[str, list[dict[str, Any]]] = {}

        # Artifact-level metadata
        self._generated: str | None = None
        self._dataset_version: str | None = None
        self._gap_years: int | None = None
        self._min_appearances: int | None = None
        self._min_span: int | None = None

        # Profiling
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._path):
            return
        if not os.path.exists(DEFUNCT_CLUBS_UPSTREAM_PATH):
            logger.warning(
                "Defunct-clubs artifact missing at %s and no upstream at %s; "
                "defunct endpoints will return empty.",
                self._path,
                DEFUNCT_CLUBS_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(DEFUNCT_CLUBS_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied defunct-clubs artifact %s -> %s",
                DEFUNCT_CLUBS_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy defunct-clubs artifact %s -> %s",
                DEFUNCT_CLUBS_UPSTREAM_PATH,
                self._path,
            )

    def _build_indexes(self) -> None:
        """Populate slug / state / era lookup dicts from self._clubs."""
        by_slug: dict[str, dict[str, Any]] = {}
        by_state: dict[str, list[dict[str, Any]]] = {}
        by_era: dict[str, list[dict[str, Any]]] = {}

        for club in self._clubs:
            slug = club.get("slug") or ""
            if slug:
                by_slug[slug] = club

            state = (club.get("dominant_state") or "").upper()
            if state:
                by_state.setdefault(state, []).append(club)

            era = club.get("era_class") or "post_boom"
            by_era.setdefault(era, []).append(club)

        self._by_slug = by_slug
        self._by_state = by_state
        self._by_era = by_era

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._path):
            self._clubs = []
            self._by_slug = {}
            self._by_state = {}
            self._by_era = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception(
                "Failed to parse defunct-clubs artifact at %s", self._path
            )
            self._clubs = []
            self._by_slug = {}
            self._by_state = {}
            self._by_era = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._clubs = data.get("clubs", [])
        self._generated = data.get("generated")
        self._dataset_version = data.get("dataset_version")
        self._gap_years = data.get("gap_years")
        self._min_appearances = data.get("min_appearances")
        self._min_span = data.get("min_span")

        self._build_indexes()

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0

        logger.info(
            "Loaded defunct-clubs artifact :: total=%d, states=%d, eras=%d, "
            "duration=%.2fs, path=%s",
            len(self._clubs),
            len(self._by_state),
            len(self._by_era),
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
            self._clubs = []
            self._by_slug = {}
            self._by_state = {}
            self._by_era = {}
            self._load_locked()
            return len(self._clubs)

    def get_list(
        self,
        state: str | None = None,
        era: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, int]]:
        """Return ``(page, facet_by_state, facet_by_era)``.

        *page* is the ``limit``-sized slice of results after filtering.
        The facets reflect the un-paginated post-filter counts so the
        frontend can render accurate filter chips.
        """
        if not self._loaded:
            with self._lock:
                self._load_locked()

        # Apply filters
        if state and era:
            st = state.upper()
            candidates = [
                c
                for c in self._clubs
                if (c.get("dominant_state") or "").upper() == st
                and c.get("era_class") == era
            ]
        elif state:
            st = state.upper()
            candidates = [
                c
                for c in self._clubs
                if (c.get("dominant_state") or "").upper() == st
            ]
        elif era:
            candidates = [c for c in self._clubs if c.get("era_class") == era]
        else:
            candidates = self._clubs

        # Facet counts over the *filtered* candidate set
        facet_state: dict[str, int] = {}
        facet_era: dict[str, int] = {}
        for c in candidates:
            st_key = (c.get("dominant_state") or "").upper()
            if st_key:
                facet_state[st_key] = facet_state.get(st_key, 0) + 1
            era_key = c.get("era_class") or "post_boom"
            facet_era[era_key] = facet_era.get(era_key, 0) + 1

        page = candidates[offset : offset + limit]
        return page, facet_state, facet_era

    def get_total(
        self,
        state: str | None = None,
        era: str | None = None,
    ) -> int:
        """Count of clubs matching the given filters."""
        if not self._loaded:
            with self._lock:
                self._load_locked()

        if not state and not era:
            return len(self._clubs)

        candidates, _, _ = self.get_list(state=state, era=era, limit=len(self._clubs), offset=0)
        return len(candidates)

    def get_by_slug(self, slug: str) -> dict[str, Any] | None:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._by_slug.get(slug)

    def meta(self) -> dict[str, Any]:
        """Top-level artifact metadata (no club records)."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return {
            "total": len(self._clubs),
            "gap_years": self._gap_years,
            "min_appearances": self._min_appearances,
            "min_span": self._min_span,
            "generated": self._generated,
            "dataset_version": self._dataset_version,
        }

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "path": self._path,
            "total": len(self._clubs) if self._loaded else None,
            "states": len(self._by_state) if self._loaded else None,
            "eras": list(self._by_era.keys()) if self._loaded else None,
            "generated": self._generated,
            "dataset_version": self._dataset_version,
            "gap_years": self._gap_years,
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
# Module-level singleton + public wrappers                                     #
# --------------------------------------------------------------------------- #

CACHE: _DefunctClubsCache = _DefunctClubsCache()


def get_list(
    state: str | None = None,
    era: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, int]]:
    return CACHE.get_list(state=state, era=era, limit=limit, offset=offset)


def get_by_slug(slug: str) -> dict[str, Any] | None:
    return CACHE.get_by_slug(slug)


def meta() -> dict[str, Any]:
    return CACHE.meta()


def ensure_loaded() -> None:
    CACHE.ensure_loaded()


def reload() -> int:
    return CACHE.reload()


def stats() -> dict[str, Any]:
    return CACHE.stats()


__all__ = [
    "DEFUNCT_CLUBS_PATH",
    "DEFUNCT_CLUBS_UPSTREAM_PATH",
    "CACHE",
    "get_list",
    "get_by_slug",
    "meta",
    "ensure_loaded",
    "reload",
    "stats",
]
