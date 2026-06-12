"""Data Portal integration — thread-safe lazy loader for MANIFEST.json.

Exposes the Open Data Portal artifact produced by
``scripts/build_data_release.py``. The manifest is a flat JSON file listing
every per-edition CSV with size, sha256, and row_count.

Lifecycle matches :mod:`app.integrations.uls_history`:
1. Bootstrap — copy from upstream path if primary missing.
2. Lazy load — first call parses behind a double-checked lock.
3. Subsequent calls are O(1) dict lookups.

Public surface: ``get_manifest()``, ``get_file(filename)``,
``list_files()``, ``stats()``, ``ensure_loaded()``.
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

logger = logging.getLogger("callbook.backend.data_portal")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

MANIFEST_PATH: Final[str] = os.environ.get(
    "DATA_PORTAL_MANIFEST_PATH", "/data/downloads/MANIFEST.json"
)

MANIFEST_UPSTREAM_PATH: Final[str] = os.environ.get(
    "DATA_PORTAL_MANIFEST_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/downloads/MANIFEST.json",
)

DOWNLOADS_PATH: Final[str] = os.environ.get(
    "DATA_PORTAL_DOWNLOADS_PATH", "/data/downloads"
)

DOWNLOADS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "DATA_PORTAL_DOWNLOADS_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/downloads",
)


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


class _DataPortalCache:
    """Thread-safe lazy loader for MANIFEST.json."""

    def __init__(self, manifest_path: str = MANIFEST_PATH) -> None:
        self._manifest_path = manifest_path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._manifest: dict[str, Any] = {}
        self._files_by_name: dict[str, dict[str, Any]] = {}
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal ---------------------------------------------------------

    def _ensure_snapshot(self) -> None:
        if os.path.exists(self._manifest_path):
            return
        if not os.path.exists(MANIFEST_UPSTREAM_PATH):
            logger.warning(
                "MANIFEST.json missing at %s and no upstream at %s",
                self._manifest_path,
                MANIFEST_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._manifest_path) or ".", exist_ok=True)
            shutil.copy2(MANIFEST_UPSTREAM_PATH, self._manifest_path)
            logger.info(
                "Copied MANIFEST.json from %s -> %s",
                MANIFEST_UPSTREAM_PATH,
                self._manifest_path,
            )
        except OSError:
            logger.exception(
                "Failed to copy MANIFEST.json from %s -> %s",
                MANIFEST_UPSTREAM_PATH,
                self._manifest_path,
            )

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._manifest_path):
            self._manifest = {}
            self._files_by_name = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._manifest_path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse MANIFEST.json at %s", self._manifest_path)
            self._manifest = {}
            self._files_by_name = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        if not isinstance(data, dict):
            logger.error("MANIFEST.json is not a dict, ignoring")
            data = {}

        files_by_name: dict[str, dict[str, Any]] = {}
        for f in data.get("files", []):
            if isinstance(f, dict) and "filename" in f:
                files_by_name[f["filename"]] = f

        self._manifest = data
        self._files_by_name = files_by_name

        try:
            self._snapshot_mtime = os.path.getmtime(self._manifest_path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0
        logger.info(
            "Loaded MANIFEST.json :: files=%d, duration=%.3fs, path=%s",
            len(files_by_name),
            self._load_duration_s,
            self._manifest_path,
        )

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            with self._lock:
                self._load_locked()

    # ----- public API -------------------------------------------------------

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def reload(self) -> int:
        with self._lock:
            self._loaded = False
            self._manifest = {}
            self._files_by_name = {}
            self._load_locked()
            return len(self._files_by_name)

    def get_manifest(self) -> dict[str, Any]:
        self._ensure_loaded()
        return self._manifest

    def get_file(self, filename: str) -> dict[str, Any] | None:
        self._ensure_loaded()
        return self._files_by_name.get(filename)

    def list_files(
        self,
        year: int | None = None,
        label: str | None = None,
    ) -> list[dict[str, Any]]:
        self._ensure_loaded()
        files = list(self._manifest.get("files", []))
        if year is not None:
            files = [f for f in files if f.get("year") == year]
        if label is not None:
            files = [f for f in files if f.get("edition_label", "").lower() == label.lower()]
        return files

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "manifest_path": self._manifest_path,
            "file_count": len(self._files_by_name) if self._loaded else None,
            "total_rows": self._manifest.get("total_rows") if self._loaded else None,
            "total_editions": self._manifest.get("total_editions") if self._loaded else None,
            "dataset_version": self._manifest.get("dataset_version") if self._loaded else None,
            "generated": self._manifest.get("generated") if self._loaded else None,
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

CACHE: _DataPortalCache = _DataPortalCache()


def get_manifest() -> dict[str, Any]:
    return CACHE.get_manifest()


def get_file(filename: str) -> dict[str, Any] | None:
    return CACHE.get_file(filename)


def list_files(
    year: int | None = None,
    label: str | None = None,
) -> list[dict[str, Any]]:
    return CACHE.list_files(year=year, label=label)


def ensure_loaded() -> None:
    CACHE.ensure_loaded()


def reload() -> int:
    return CACHE.reload()


def stats() -> dict[str, Any]:
    return CACHE.stats()


__all__ = [
    "MANIFEST_PATH",
    "MANIFEST_UPSTREAM_PATH",
    "DOWNLOADS_PATH",
    "DOWNLOADS_UPSTREAM_PATH",
    "CACHE",
    "get_manifest",
    "get_file",
    "list_files",
    "ensure_loaded",
    "reload",
    "stats",
]
