"""Printed Lineage integration — KN→K Novice upgrade artifact loader.

Thread-safe lazy loader for ``data/printed_lineage.json``, the pre-computed
Novice-upgrade lineage artifact produced by ``app.scripts.build_printed_lineage``.

The artifact is read once at startup (or on first request) and cached
in memory.  No DB hits occur at request time.

Lifecycle
---------

1. **Bootstrap** — if the primary path is missing but the upstream
   project-relative artifact exists, copy it across.
2. **Lazy load** — first ``get_novice()`` or ``get_upgrade_source()`` call
   parses the JSON behind a thread-safe double-checked lock.
   Subsequent calls are O(1).

Public surface
--------------
``get_novice(cs)``          — returns link dict if *cs* is a novice call (KN/WN/WV).
``get_upgrade_source(cs)``  — returns link dict if *cs* is an upgrade target (K/W).
``ensure_loaded()``         — eagerly warm the cache (called from FastAPI lifespan).
``reload()``                — re-read from disk; returns new link count.
``stats()``                 — diagnostic info dict.
``CACHE``                   — module-level singleton.
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

logger = logging.getLogger("callbook.backend.printed_lineage")

# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #

#: In-container path.  The compose file bind-mounts ``./data`` -> ``/data``
#: so on the host this resolves to ``ham-callbook-site/data/printed_lineage.json``.
PRINTED_LINEAGE_PATH: Final[str] = os.environ.get(
    "PRINTED_LINEAGE_PATH", "/data/printed_lineage.json"
)

#: Project-relative fallback for dev / bare-metal runs where the container
#: bind-mount isn't present.
PRINTED_LINEAGE_UPSTREAM_PATH: Final[str] = os.environ.get(
    "PRINTED_LINEAGE_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/printed_lineage.json",
)


# --------------------------------------------------------------------------- #
# Cache                                                                        #
# --------------------------------------------------------------------------- #


class _PrintedLineageCache:
    """Thread-safe lazy loader for the printed lineage artifact.

    Structural copy of :class:`app.integrations.uls_history._UlsHistoryCache`.
    Adds a *reverse index* (``_reverse``) computed at load time so that
    :meth:`get_upgrade_source` (lookup by upgrade call) is O(1).
    """

    def __init__(self, path: str = PRINTED_LINEAGE_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._data: dict[str, dict[str, Any]] = {}     # novice_call -> link dict
        self._reverse: dict[str, str] = {}              # upgrade_call -> novice_call
        self._generated: str | None = None
        self._dataset_version: str | None = None
        self._total_links: int = 0
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        """Copy the upstream artifact to ``_path`` if the primary is missing."""
        if os.path.exists(self._path):
            return
        if not os.path.exists(PRINTED_LINEAGE_UPSTREAM_PATH):
            logger.warning(
                "Printed lineage artifact missing at %s and no upstream at %s; "
                "lineage endpoints will return empty responses.",
                self._path,
                PRINTED_LINEAGE_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(PRINTED_LINEAGE_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied printed lineage artifact %s -> %s",
                PRINTED_LINEAGE_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy printed lineage artifact %s -> %s",
                PRINTED_LINEAGE_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        """Parse the artifact and build the reverse index.  Caller must hold ``_lock``."""
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._path):
            self._data = {}
            self._reverse = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._path, "rb") as fh:
                raw: dict[str, Any] = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception(
                "Failed to parse printed lineage artifact at %s", self._path
            )
            self._data = {}
            self._reverse = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        if not isinstance(raw, dict):
            logger.error(
                "Printed lineage artifact at %s is not a dict (got %s); ignoring.",
                self._path,
                type(raw).__name__,
            )
            raw = {}

        links: dict[str, dict[str, Any]] = raw.get("links", {})
        # Normalize keys to uppercase
        data: dict[str, dict[str, Any]] = {
            k.strip().upper(): v
            for k, v in links.items()
            if isinstance(k, str) and isinstance(v, dict)
        }

        # Use the artifact's pre-built reverse index if present; otherwise compute it.
        artifact_reverse: dict[str, str] = raw.get("reverse", {})
        if artifact_reverse:
            reverse: dict[str, str] = {
                k.strip().upper(): v.strip().upper()
                for k, v in artifact_reverse.items()
                if isinstance(k, str) and isinstance(v, str)
            }
        else:
            reverse = {}
            for nov_cs, link in data.items():
                upg_cs = link.get("upgrade_call")
                if upg_cs and isinstance(upg_cs, str):
                    reverse[upg_cs.strip().upper()] = nov_cs

        self._data = data
        self._reverse = reverse
        self._generated = raw.get("generated")
        self._dataset_version = raw.get("dataset_version")
        self._total_links = raw.get("total_links", len(data))

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0

        logger.info(
            "Loaded printed lineage artifact :: links=%d, reverse_index=%d, "
            "duration=%.2fs, path=%s",
            len(self._data),
            len(self._reverse),
            self._load_duration_s,
            self._path,
        )

    # ----- public API -------------------------------------------------------

    def ensure_loaded(self) -> None:
        """Eagerly warm the cache (e.g. at FastAPI startup)."""
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def reload(self) -> int:
        """Re-parse the artifact from disk; returns the new link count."""
        with self._lock:
            self._loaded = False
            self._data = {}
            self._reverse = {}
            self._load_locked()
            return len(self._data)

    def get_novice(self, callsign: str) -> dict[str, Any] | None:
        """Return the lineage link dict if *callsign* is a KN/WN/WV novice call.

        Returns ``None`` if no link exists for this callsign.
        """
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._data.get(callsign.strip().upper())

    def get_upgrade_source(self, callsign: str) -> dict[str, Any] | None:
        """Return the lineage link dict if *callsign* is a K/W upgrade target.

        Looks up *callsign* in the reverse index, then returns the full link.
        Returns ``None`` if no link points to this callsign.
        """
        if not self._loaded:
            with self._lock:
                self._load_locked()
        cs = callsign.strip().upper()
        nov_cs = self._reverse.get(cs)
        if nov_cs is None:
            return None
        return self._data.get(nov_cs)

    def stats(self) -> dict[str, Any]:
        """Diagnostic info for /health and similar endpoints."""
        return {
            "loaded": self._loaded,
            "path": self._path,
            "link_count": len(self._data) if self._loaded else None,
            "reverse_index_size": len(self._reverse) if self._loaded else None,
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


# --------------------------------------------------------------------------- #
# Module-level singleton + public wrappers                                     #
# --------------------------------------------------------------------------- #

CACHE: _PrintedLineageCache = _PrintedLineageCache()


def get_novice(callsign: str) -> dict[str, Any] | None:
    """Return the lineage link dict if *callsign* is a KN/WN/WV novice call."""
    if not callsign:
        return None
    return CACHE.get_novice(callsign)


def get_upgrade_source(callsign: str) -> dict[str, Any] | None:
    """Return the lineage link dict if *callsign* is a K/W upgrade target."""
    if not callsign:
        return None
    return CACHE.get_upgrade_source(callsign)


def ensure_loaded() -> None:
    """Eagerly warm the cache.  Safe to call from FastAPI startup."""
    CACHE.ensure_loaded()


def reload() -> int:
    """Re-read the artifact from disk.  Returns the new link count."""
    return CACHE.reload()


def stats() -> dict[str, Any]:
    """Return diagnostic info about the loaded artifact."""
    return CACHE.stats()


__all__ = [
    "PRINTED_LINEAGE_PATH",
    "PRINTED_LINEAGE_UPSTREAM_PATH",
    "CACHE",
    "get_novice",
    "get_upgrade_source",
    "ensure_loaded",
    "reload",
    "stats",
]
