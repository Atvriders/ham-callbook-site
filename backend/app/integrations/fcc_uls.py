"""FCC ULS (Universal Licensing System) integration.

This module exposes a **bulk-snapshot** view of the FCC ULS amateur-radio
licensee database. The actual ULS web service (and the weekly
``l_amat.zip`` dump it publishes) is huge, slow, and rate-limited; for
the read-mostly callbook UI we instead serve a pre-extracted snapshot
that the Data phase produces at
``leehite-callbooks/xref_out/3way/source_E_uls.json`` — roughly 1.56M
callsign -> {first, last, status, grant_date} records, ~144 MB on disk.

Lifecycle
---------

1. **Bootstrap (idempotent, at import time, *not* in a hot path)**:
   If ``/data/uls.json`` doesn't exist but the upstream xref artifact
   does, copy it across. This lets the operator land a fresh snapshot
   simply by replacing the file in the data volume.

2. **Lazy load (on first ``lookup`` call)**: parse the snapshot into an
   in-memory dict, behind a thread-safe lock so that the first burst of
   concurrent requests doesn't trigger N parses. Subsequent calls are
   O(1) dict lookups.

3. **Lookup**: callsigns are normalized (uppercase, stripped) before
   indexing into the cache. Records are normalized into the
   :class:`FccUlsRecord` Pydantic model; raw codes (``A``/``E``/``C``/
   ``X`` etc.) get a human-readable ``status_label`` alongside the raw
   ``status`` field.

The cache lives for the life of the process. It costs ~250-400 MB of
resident memory after JSON parse — acceptable given the backend
container already mmaps a 2.4 GB SQLite file.

Why not SQLite-import-it? Because the FTS5/main DB is mounted read-only
and the Data phase owns its schema. Keeping ULS in a sidecar JSON file
means the snapshot can be refreshed independently and rolled back by
copying a single file. The cost is one big up-front parse, which we
amortize over the life of the worker.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from datetime import date, datetime
from typing import Any, Final

from pydantic import BaseModel, Field

logger = logging.getLogger("callbook.backend.uls")


# --------------------------------------------------------------------------- #
# Paths                                                                       #
# --------------------------------------------------------------------------- #

#: In-container path to the snapshot. The compose file bind-mounts
#: ``./data`` -> ``/data`` so this resolves on the host to
#: ``ham-callbook-site/data/uls.json``.
ULS_JSON_PATH: Final[str] = os.environ.get(
    "ULS_JSON_PATH", "/data/uls.json"
)

#: Optional upstream artifact path that the Data phase produces. If
#: ``ULS_JSON_PATH`` is missing on startup we try to copy this across as
#: a convenience. This is path-on-disk only — there is no network fetch.
ULS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "ULS_UPSTREAM_PATH",
    "/home/kasm-user/leehite-callbooks/xref_out/3way/source_E_uls.json",
)


# --------------------------------------------------------------------------- #
# Status-code map                                                             #
# --------------------------------------------------------------------------- #

# Reference: FCC ULS public-data tables, HD record, "license_status" column.
# Only the codes that show up in the snapshot are mapped here; anything
# unknown falls through to "Unknown" with the raw code preserved on the
# response so a caller can render it verbatim.
_STATUS_LABELS: Final[dict[str, str]] = {
    "A": "Active",
    "E": "Expired",
    "C": "Cancelled",
    "X": "Terminated",
    "L": "Pending Legal Status",
    "P": "Pending",
    "T": "Terminated",  # Variant some snapshots use.
    "R": "Revoked",
    "S": "Suspended",
}

#: Statuses we treat as "still on the air" for the boolean helper field.
_ACTIVE_STATUSES: Final[frozenset[str]] = frozenset({"A"})


# --------------------------------------------------------------------------- #
# Pydantic model                                                              #
# --------------------------------------------------------------------------- #


class FccUlsRecord(BaseModel):
    """Normalized FCC ULS licensee record.

    A handful of source quirks are smoothed over here:

    * ``first`` / ``last`` are title-cased even when the snapshot stores
      them ALL-CAPS (the FCC public file is mixed-case across decades of
      data entry). The original casing is preserved on
      :attr:`raw_first` / :attr:`raw_last` so a UI that wants the
      "feels-like-an-old-callsign-book" look can pick either.
    * ``status`` is the raw single-letter code; ``status_label`` is the
      human string; ``is_active`` is ``True`` only for status ``A``.
    * ``grant_date`` is exposed as both the original ISO string and a
      :class:`datetime.date`; the date form is ``None`` if parsing
      fails so the API never breaks on a malformed snapshot row.
    """

    callsign: str = Field(..., description="Uppercase callsign, no whitespace.")
    first: str | None = Field(None, description="Licensee first name, title-cased.")
    last: str | None = Field(None, description="Licensee last name, title-cased.")
    raw_first: str | None = Field(None, description="First name as stored in the FCC snapshot.")
    raw_last: str | None = Field(None, description="Last name as stored in the FCC snapshot.")
    entity_name: str | None = Field(
        None,
        description="Entity/club name from EN.entity_name. Set when license is held by a club, school, or org rather than an individual.",
    )
    is_club: bool = Field(
        False,
        description="True iff license is held by a club/entity (entity_name is set, no individual name).",
    )
    full_name: str | None = Field(
        None,
        description='"First Last" if individual; entity_name if club; whichever is non-null otherwise.',
    )
    status: str | None = Field(
        None, description="Raw FCC status code (A/E/C/X/…)."
    )
    status_label: str | None = Field(
        None, description="Human-readable status (e.g. 'Active', 'Expired')."
    )
    is_active: bool = Field(
        False, description="True iff status is 'A' (Active)."
    )
    grant_date: str | None = Field(
        None, description="License grant date in ISO format (YYYY-MM-DD)."
    )
    grant_date_iso: date | None = Field(
        None, description="Parsed grant date as a calendar date, or null if malformed."
    )
    source: str = Field(
        "fcc_uls_snapshot",
        description="Provenance tag so callers can distinguish bulk-snapshot vs live lookups.",
    )


# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #


class _UlsCache:
    """Thread-safe lazy loader for the ULS snapshot.

    Implementation notes:

    * The double-checked locking pattern means the *first* request pays
      the load cost (typically 2-5 s for 144 MB of JSON on a modern
      box) while subsequent calls hit a fast-path that doesn't touch
      the lock at all. ``self._loaded`` is a simple sentinel — reading
      a bool in CPython is atomic, so the read-without-lock is safe.

    * The raw dict is kept as ``dict[str, dict[str, Any]]`` rather than
      pre-materialized :class:`FccUlsRecord` instances. ~1.56M Pydantic
      objects would balloon RSS by several hundred MB; we instead
      materialize on demand inside :meth:`lookup`. A single lookup
      builds a model in microseconds.

    * Reload is exposed for ops convenience (the Data phase can drop a
      new snapshot and ``POST /admin/uls/reload`` could trigger this —
      not wired up here, but the method is ready).
    """

    def __init__(self, path: str = ULS_JSON_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._loaded: bool = False
        self._data: dict[str, dict[str, Any]] = {}
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None
        self._snapshot_mtime: float | None = None

    # ----- internal helpers -------------------------------------------------

    def _ensure_snapshot(self) -> None:
        """Copy the upstream artifact into ``ULS_JSON_PATH`` if missing.

        This runs once at construction time (cheap stat()) so the first
        ``lookup()`` can simply open the file. If neither path exists we
        log a warning and continue — every lookup will then return
        ``None`` until an operator lands a snapshot.
        """
        if os.path.exists(self._path):
            return
        if not os.path.exists(ULS_UPSTREAM_PATH):
            logger.warning(
                "ULS snapshot missing at %s and no upstream at %s; lookups will return None.",
                self._path,
                ULS_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            shutil.copy2(ULS_UPSTREAM_PATH, self._path)
            logger.info(
                "Copied ULS snapshot from %s -> %s",
                ULS_UPSTREAM_PATH,
                self._path,
            )
        except OSError:
            logger.exception(
                "Failed to copy ULS snapshot from %s -> %s",
                ULS_UPSTREAM_PATH,
                self._path,
            )

    def _load_locked(self) -> None:
        """Parse the snapshot into ``self._data``. Caller must hold ``self._lock``."""
        if self._loaded:
            return
        self._ensure_snapshot()
        if not os.path.exists(self._path):
            # No data, but mark loaded so we don't keep stat()-ing per request.
            self._data = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        t0 = time.perf_counter()
        try:
            with open(self._path, "rb") as fh:
                # json.load over a binary file is faster than text mode
                # because Python skips an encoding pass; the FCC snapshot
                # is ASCII-clean in practice.
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse ULS snapshot at %s", self._path)
            self._data = {}
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        if not isinstance(data, dict):
            logger.error(
                "ULS snapshot at %s is not a dict (got %s); ignoring.",
                self._path,
                type(data).__name__,
            )
            data = {}

        # Normalize all keys to uppercase once, at load time, so the hot
        # lookup path is a single str.upper() + dict.get().
        normalized: dict[str, dict[str, Any]] = {}
        for k, v in data.items():
            if not isinstance(k, str) or not isinstance(v, dict):
                continue
            normalized[k.strip().upper()] = v

        self._data = normalized
        try:
            self._snapshot_mtime = os.path.getmtime(self._path)
        except OSError:
            self._snapshot_mtime = None
        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0
        logger.info(
            "Loaded ULS snapshot :: records=%s, duration=%.2fs, path=%s",
            f"{len(self._data):,}",
            self._load_duration_s,
            self._path,
        )

    # ----- public API -------------------------------------------------------

    def ensure_loaded(self) -> None:
        """Force a load now (e.g. at FastAPI startup if you want to pay
        the cost up-front instead of on the first request)."""
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def reload(self) -> int:
        """Re-parse the snapshot from disk; returns the new record count."""
        with self._lock:
            self._loaded = False
            self._data = {}
            self._load_locked()
            return len(self._data)

    def __len__(self) -> int:
        if not self._loaded:
            self.ensure_loaded()
        return len(self._data)

    def get_raw(self, callsign: str) -> dict[str, Any] | None:
        """Return the raw snapshot dict for ``callsign``, or ``None``."""
        if not self._loaded:
            with self._lock:
                self._load_locked()
        return self._data.get(callsign.strip().upper())

    def lookup(self, callsign: str) -> FccUlsRecord | None:
        """Return a normalized :class:`FccUlsRecord` for ``callsign``,
        or ``None`` if the snapshot has no entry."""
        raw = self.get_raw(callsign)
        if raw is None:
            return None
        return _normalize(callsign.strip().upper(), raw)

    def stats(self) -> dict[str, Any]:
        """Diagnostic info for /health and similar endpoints."""
        return {
            "loaded": self._loaded,
            "path": self._path,
            "record_count": len(self._data) if self._loaded else None,
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
# Normalization                                                               #
# --------------------------------------------------------------------------- #


def _title_case_name(name: str | None) -> str | None:
    """Title-case a name while preserving common prefixes like ``McX``.

    The FCC stores names inconsistently across decades; some rows are
    ALL CAPS, some are Mixed, some are lower. We pick a single
    presentation policy (title case with a tiny bit of intelligence for
    Scottish/Irish prefixes) so the frontend doesn't have to.
    """
    if not name:
        return None
    s = name.strip()
    if not s:
        return None
    # Fast path: if it's already nicely mixed-case, leave it alone.
    if any(c.islower() for c in s) and any(c.isupper() for c in s):
        return s
    # Title case + restore Mc/Mac/O' patterns.
    titled = s.title()
    out_parts: list[str] = []
    for part in titled.split(" "):
        if part.startswith("Mc") and len(part) > 2:
            out_parts.append("Mc" + part[2:].capitalize())
        elif part.startswith("Mac") and len(part) > 3 and part[3].isalpha():
            # Only re-capitalize if the rest looks like a name; "Mack"
            # shouldn't become "MacK".
            rest = part[3:]
            if len(rest) >= 2:
                out_parts.append("Mac" + rest.capitalize())
            else:
                out_parts.append(part)
        elif part.startswith("O'") and len(part) > 2:
            out_parts.append("O'" + part[2:].capitalize())
        else:
            out_parts.append(part)
    return " ".join(out_parts)


def _parse_date(s: str | None) -> date | None:
    """Parse a ``YYYY-MM-DD`` string into a :class:`date`, tolerantly."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    # The snapshot is ISO-8601-ish (YYYY-MM-DD); but be defensive against
    # ``YYYY/MM/DD`` and ``MM/DD/YYYY`` which appear in some legacy
    # exports.
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _normalize(callsign: str, raw: dict[str, Any]) -> FccUlsRecord:
    """Turn a raw snapshot dict into an :class:`FccUlsRecord`."""
    raw_first = raw.get("first") if isinstance(raw.get("first"), str) else None
    raw_last = raw.get("last") if isinstance(raw.get("last"), str) else None
    first = _title_case_name(raw_first) if raw_first else None
    last = _title_case_name(raw_last) if raw_last else None

    raw_entity = raw.get("entity_name") if isinstance(raw.get("entity_name"), str) else None
    entity_name = raw_entity.strip() if raw_entity else None
    if entity_name == "":
        entity_name = None
    is_club = bool(entity_name) and not (first and last)

    if first and last:
        full_name: str | None = f"{first} {last}"
    elif entity_name:
        full_name = entity_name
    else:
        full_name = first or last or None

    status_raw = raw.get("status") if isinstance(raw.get("status"), str) else None
    status = status_raw.strip().upper() if status_raw else None
    status_label = _STATUS_LABELS.get(status, "Unknown") if status else None

    grant_date_raw = raw.get("grant_date")
    if isinstance(grant_date_raw, str):
        grant_date_str: str | None = grant_date_raw.strip() or None
    else:
        grant_date_str = None
    grant_date_iso = _parse_date(grant_date_str)

    return FccUlsRecord(
        callsign=callsign,
        first=first,
        last=last,
        raw_first=raw_first,
        raw_last=raw_last,
        entity_name=entity_name,
        is_club=is_club,
        full_name=full_name,
        status=status,
        status_label=status_label,
        is_active=status in _ACTIVE_STATUSES if status else False,
        grant_date=grant_date_str,
        grant_date_iso=grant_date_iso,
        source="fcc_uls_snapshot",
    )


# --------------------------------------------------------------------------- #
# Module-level singleton                                                      #
# --------------------------------------------------------------------------- #

#: Process-wide singleton. Tests can swap this out by reassigning the
#: attribute; production code should use the helper functions below.
CACHE: _UlsCache = _UlsCache()


def lookup(callsign: str) -> FccUlsRecord | None:
    """Public convenience wrapper around the module singleton."""
    if not callsign:
        return None
    return CACHE.lookup(callsign)


def ensure_loaded() -> None:
    """Eagerly warm the cache. Safe to call from FastAPI startup."""
    CACHE.ensure_loaded()


def reload() -> int:
    """Re-read the snapshot from disk. Returns the new record count."""
    return CACHE.reload()


def stats() -> dict[str, Any]:
    """Return diagnostic info about the loaded snapshot."""
    return CACHE.stats()


__all__ = [
    "FccUlsRecord",
    "ULS_JSON_PATH",
    "ULS_UPSTREAM_PATH",
    "CACHE",
    "lookup",
    "ensure_loaded",
    "reload",
    "stats",
]
