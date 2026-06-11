"""ULS History integration — multi-license and previous-callsign data.

This module exposes a **pre-extracted ULS history artifact** produced by
``leehite-callbooks/build_uls_history.py``.  The artifact captures two things
that the main ``uls.json`` snapshot does not:

* ``prev_call`` / ``prev_class`` — the previous callsign a licensee held
  before this one (from AM.dat field 15), useful for building vanity-upgrade
  chains.
* ``licenses`` — every historical HD.dat record for callsigns that have been
  held by more than one licensee over the years (e.g. KY6W has 15 records).

The artifact is a flat JSON dict keyed by callsign; entries only exist when
the callsign has a non-empty ``prev_call`` *or* more than one license record.
That keeps the artifact lean (~350K keys, target <80 MB on disk) while covering
all interesting cases.

Lifecycle
---------

Identical to :mod:`app.integrations.fcc_uls`:

1. **Bootstrap** — on construction, if the primary path is missing but the
   upstream project-relative artifact exists, copy it across.
2. **Lazy load** — first ``get()`` call parses the JSON behind a
   thread-safe double-checked lock.  Subsequent calls are O(1).
3. **Reverse index** — at load time we build a ``forward_index``
   (``old_call -> [new_calls...]``) so we can answer "who upgraded *to*
   this callsign?" in O(1) without a second pass at request time.

The module exposes a module-level singleton ``CACHE`` plus thin public
wrappers ``get()``, ``forward_links()``, ``ensure_loaded()``, ``reload()``,
and ``stats()`` — the same surface as :mod:`app.integrations.fcc_uls`.
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

logger = logging.getLogger("callbook.backend.uls_history")


# --------------------------------------------------------------------------- #
# Paths                                                                       #
# --------------------------------------------------------------------------- #

#: In-container path.  The compose file bind-mounts ``./data`` -> ``/data``
#: so on the host this resolves to ``ham-callbook-site/data/uls_history.json``.
ULS_HISTORY_PATH: Final[str] = os.environ.get(
    "ULS_HISTORY_PATH", "/data/uls_history.json"
)

#: Project-relative fallback for dev / bare-metal runs where the container
#: bind-mount isn't present.
ULS_HISTORY_UPSTREAM_PATH: Final[str] = os.environ.get(
    "ULS_HISTORY_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/uls_history.json",
)


# --------------------------------------------------------------------------- #
# Label maps                                                                  #
# --------------------------------------------------------------------------- #

_STATUS_LABELS: Final[dict[str, str]] = {
    "A": "Active",
    "E": "Expired",
    "C": "Cancelled",
    "X": "Terminated",
    "L": "Pending Legal Status",
    "P": "Pending",
    "T": "Terminated",
    "R": "Revoked",
    "S": "Suspended",
}

_CLASS_LABELS: Final[dict[str, str]] = {
    "E": "Extra",
    "A": "Advanced",
    "G": "General",
    "T": "Technician",
    "N": "Novice",
    "P": "Technician Plus",
}


# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #


class _UlsHistoryCache:
    """Thread-safe lazy loader for the ULS history artifact.

    Identical double-checked-locking pattern as :class:`app.integrations.fcc_uls._UlsCache`.
    Adds a *reverse index* (``_forward_index``) computed once at load time so
    that :meth:`forward_links` is O(1).
    """

    def __init__(self, path: str = ULS_HISTORY_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._data: dict[str, dict[str, Any]] = {}
        self._forward_index: dict[str, list[str]] = {}
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        """Copy the upstream artifact to ``_path`` if the primary is missing."""
        if os.path.exists(self._path):
            return
        if not os.path.exists(ULS_HISTORY_UPSTREAM_PATH):
            logger.warning(
                "ULS history artifact missing at %s and no upstream at %s; "
                "uls_history lookups will return empty responses.",
                self._path,
                ULS_HISTORY_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(ULS_HISTORY_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied ULS history artifact from %s -> %s",
                ULS_HISTORY_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy ULS history artifact from %s -> %s",
                ULS_HISTORY_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        """Parse the artifact and build the forward index.  Caller must hold ``_lock``."""
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        if not os.path.exists(self._path):
            # Artifact absent — mark loaded so we don't stat() every request.
            self._data = {}
            self._forward_index = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(self._path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse ULS history artifact at %s", self._path)
            self._data = {}
            self._forward_index = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        if not isinstance(data, dict):
            logger.error(
                "ULS history artifact at %s is not a dict (got %s); ignoring.",
                self._path,
                type(data).__name__,
            )
            data = {}

        # Normalize keys to uppercase once.
        normalized: dict[str, dict[str, Any]] = {}
        for k, v in data.items():
            if isinstance(k, str) and isinstance(v, dict):
                normalized[k.strip().upper()] = v

        # Build forward index: old_callsign -> [callsigns whose prev_call == old].
        fwd: dict[str, list[str]] = {}
        for cs, rec in normalized.items():
            pc = rec.get("prev_call")
            if pc and isinstance(pc, str):
                key = pc.strip().upper()
                if key:
                    fwd.setdefault(key, []).append(cs)

        self._data = normalized
        self._forward_index = fwd

        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0
        logger.info(
            "Loaded ULS history artifact :: records=%s, forward_links=%s, "
            "duration=%.2fs, path=%s",
            f"{len(self._data):,}",
            f"{len(self._forward_index):,}",
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
        """Re-parse the artifact from disk; returns the new record count."""
        with self._lock:
            self._loaded = False
            self._data = {}
            self._forward_index = {}
            self._load_locked()
            return len(self._data)

    def get(self, callsign: str) -> dict[str, Any] | None:
        """Return the raw history dict for ``callsign``, or ``None``."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._data.get(callsign.strip().upper())

    def forward_links(self, callsign: str) -> list[str]:
        """Return callsigns whose ``prev_call`` field equals ``callsign``.

        These are the callsigns that were *upgraded from* this one — i.e.
        vanity successors or re-use of a released callsign.
        """
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return list(self._forward_index.get(callsign.strip().upper(), []))

    def stats(self) -> dict[str, Any]:
        """Diagnostic info for /health and similar endpoints."""
        return {
            "loaded": self._loaded,
            "path": self._path,
            "record_count": len(self._data) if self._loaded else None,
            "forward_index_size": len(self._forward_index) if self._loaded else None,
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

CACHE: _UlsHistoryCache = _UlsHistoryCache()


def get(callsign: str) -> dict[str, Any] | None:
    """Return the raw history record for ``callsign``, or ``None``."""
    if not callsign:
        return None
    return CACHE.get(callsign)


def forward_links(callsign: str) -> list[str]:
    """Return callsigns whose AM.dat previous_callsign equals ``callsign``."""
    if not callsign:
        return []
    return CACHE.forward_links(callsign)


def ensure_loaded() -> None:
    """Eagerly warm the cache.  Safe to call from FastAPI startup."""
    CACHE.ensure_loaded()


def reload() -> int:
    """Re-read the artifact from disk.  Returns the new record count."""
    return CACHE.reload()


def stats() -> dict[str, Any]:
    """Return diagnostic info about the loaded artifact."""
    return CACHE.stats()


__all__ = [
    "ULS_HISTORY_PATH",
    "ULS_HISTORY_UPSTREAM_PATH",
    "_STATUS_LABELS",
    "_CLASS_LABELS",
    "CACHE",
    "get",
    "forward_links",
    "ensure_loaded",
    "reload",
    "stats",
]
