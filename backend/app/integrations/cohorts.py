"""Cohort Observatory integration — cohort tables artifact loader.

Thread-safe lazy loader for ``data/cohorts.json``, the pre-computed
cohort retention artifact produced by ``app.scripts.build_cohorts``.

The artifact is read once at startup (or on first request) and cached
in memory.  No DB hits occur at request time.

Public surface:
  ``get_cohort(key)``, ``list_cohort_keys()``, ``get_archive_years()``,
  ``ensure_loaded()``, ``reload()``, ``stats()``, ``CACHE``.
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

logger = logging.getLogger("callbook.backend.cohorts")

# --------------------------------------------------------------------------- #
# Paths                                                                       #
# --------------------------------------------------------------------------- #

COHORTS_PATH: Final[str] = os.environ.get(
    "COHORTS_PATH", "/data/cohorts.json"
)

COHORTS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "COHORTS_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/cohorts.json",
)

# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #


class _CohortsCache:
    """Thread-safe lazy loader for the cohorts artifact."""

    def __init__(self, path: str = COHORTS_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._cohorts: dict[str, dict[str, Any]] = {}
        self._archive_years: list[int] = []
        self._print_horizon: int = 1997
        self._today_year: int = 2026
        self._generated: str | None = None
        self._dataset_version: str | None = None
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._path):
            return
        if not os.path.exists(COHORTS_UPSTREAM_PATH):
            logger.warning(
                "Cohorts artifact missing at %s and no upstream at %s; "
                "cohort endpoints will return empty.",
                self._path,
                COHORTS_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(COHORTS_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied cohorts artifact %s -> %s",
                COHORTS_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy cohorts artifact %s -> %s",
                COHORTS_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        # Resolve effective path: primary first, then upstream fallback
        effective_path = self._path
        if not os.path.exists(effective_path) and os.path.exists(
            COHORTS_UPSTREAM_PATH
        ):
            effective_path = COHORTS_UPSTREAM_PATH
            logger.info(
                "Primary artifact missing; reading directly from upstream %s",
                effective_path,
            )

        if not os.path.exists(effective_path):
            self._cohorts = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(effective_path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse cohorts artifact at %s", effective_path)
            self._cohorts = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._cohorts = data.get("cohorts", {})
        self._archive_years = data.get("archive_years", [])
        self._print_horizon = data.get("print_horizon", 1997)
        self._today_year = data.get("today_year", 2026)
        self._generated = data.get("generated")
        self._dataset_version = data.get("dataset_version")

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0

        logger.info(
            "Loaded cohorts artifact :: cohorts=%d, archive_years=%d, duration=%.2fs, path=%s",
            len(self._cohorts),
            len(self._archive_years),
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
            self._cohorts = {}
            self._load_locked()
            return len(self._cohorts)

    def get_cohort(self, key: str) -> dict[str, Any] | None:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._cohorts.get(key)

    def list_cohort_keys(
        self,
        entry_class: str | None = None,
        state: str | None = None,
        first_year: int | None = None,
    ) -> list[str]:
        """Return sorted cohort keys, optionally filtered."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        keys = list(self._cohorts.keys())
        if entry_class:
            ec = entry_class.upper()
            keys = [k for k in keys if k.split("|")[1] == ec]
        if state:
            st = state.upper()
            keys = [k for k in keys if k.split("|")[2] == st]
        if first_year is not None:
            keys = [k for k in keys if k.split("|")[0] == str(first_year)]
        return sorted(keys)

    def get_archive_years(self) -> list[int]:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return list(self._archive_years)

    def get_print_horizon(self) -> int:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._print_horizon

    def get_today_year(self) -> int:
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._today_year

    def available_years(self) -> list[int]:
        """Sorted list of first_year values that have at least one ALL-state cohort."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        seen: set[int] = set()
        for k in self._cohorts:
            parts = k.split("|")
            if len(parts) == 3 and parts[2] == "ALL":
                seen.add(int(parts[0]))
        return sorted(seen)

    def available_classes(self) -> list[str]:
        """Sorted list of entry_class values present in the artifact."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        seen: set[str] = set()
        for k in self._cohorts:
            parts = k.split("|")
            if len(parts) == 3:
                seen.add(parts[1])
        return sorted(seen)

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "path": self._path,
            "cohort_count": len(self._cohorts) if self._loaded else None,
            "archive_years": len(self._archive_years) if self._loaded else None,
            "print_horizon": self._print_horizon,
            "today_year": self._today_year,
            "generated": self._generated,
            "dataset_version": self._dataset_version,
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

CACHE: _CohortsCache = _CohortsCache()


def get_cohort(key: str) -> dict[str, Any] | None:
    return CACHE.get_cohort(key)


def list_cohort_keys(
    entry_class: str | None = None,
    state: str | None = None,
    first_year: int | None = None,
) -> list[str]:
    return CACHE.list_cohort_keys(entry_class=entry_class, state=state, first_year=first_year)


def get_archive_years() -> list[int]:
    return CACHE.get_archive_years()


def available_years() -> list[int]:
    return CACHE.available_years()


def available_classes() -> list[str]:
    return CACHE.available_classes()


def ensure_loaded() -> None:
    CACHE.ensure_loaded()


def reload() -> int:
    return CACHE.reload()


def stats() -> dict[str, Any]:
    return CACHE.stats()


__all__ = [
    "COHORTS_PATH",
    "COHORTS_UPSTREAM_PATH",
    "CACHE",
    "get_cohort",
    "list_cohort_keys",
    "get_archive_years",
    "available_years",
    "available_classes",
    "ensure_loaded",
    "reload",
    "stats",
]
