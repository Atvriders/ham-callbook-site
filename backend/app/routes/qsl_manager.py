"""QSL-route directory lookups (printed QSL-manager listings).

The Data phase ingested the printed QSL-route directories from the 1999 and
2003 editions into the ``qsl_routes`` table::

    CREATE TABLE qsl_routes (year INTEGER, callsign TEXT, manager TEXT)

with covering indexes ``idx_qsl_callsign`` and ``idx_qsl_manager``, so both
lookup directions are single B-tree probes.

Endpoints (mounted under ``/api/qsl-routes`` by ``app.main``)
-------------------------------------------------------------

GET /api/qsl-routes/{callsign}
    Every printed route for a DX callsign — which manager handled its cards,
    per edition year. Returns an empty ``routes`` list (not 404) when the
    callsign never appeared in a printed directory.

GET /api/qsl-routes/by-manager/{manager}?limit=100
    The inverse: every callsign a given manager handled, across both years,
    capped at 500 rows. ``total`` carries the uncapped count so the UI can
    say "showing 500 of 819".

Both endpoints are read-only against the shared connection from
:func:`app.db.get_db`. The by-manager direction can return hundreds of rows
for the big-name managers (F6FNU handled 800+ calls), so its envelopes are
memoized in a small :class:`cachetools.TTLCache` following the ``stats.py``
convention — the table is immutable for the life of the process.
"""

from __future__ import annotations

import re
import sqlite3
import threading

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Query
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter(prefix="/api/qsl-routes", tags=["qsl"])

# QSL-route directories list worldwide DX calls (e.g. "0S0D", "3A2LZ"),
# so the shape check is looser than the US-corpus callsign regex.
_CALL_RE = re.compile(r"^[A-Z0-9/]{2,16}$")

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class QslRoute(BaseModel):
    year: int
    manager: str


class QslRoutesResult(BaseModel):
    callsign: str
    routes: list[QslRoute]


class ManagedCall(BaseModel):
    year: int
    callsign: str


class ManagerRoutesResult(BaseModel):
    manager: str
    total: int = Field(
        ..., description="Total routes for this manager (before the cap)."
    )
    routes: list[ManagedCall]


# ---------------------------------------------------------------------------
# Cache (stats.py TTLCache convention) — by-manager envelopes only; the
# per-callsign direction is a 1-5 row index probe and not worth caching.
# ---------------------------------------------------------------------------

_MANAGER_CACHE: TTLCache = TTLCache(maxsize=256, ttl=3600)
_CACHE_LOCK = threading.Lock()


def _normalize(raw: str, what: str) -> str:
    value = (raw or "").strip().upper()
    if not _CALL_RE.match(value):
        raise HTTPException(status_code=400, detail=f"invalid {what}: {raw!r}")
    return value


# ---------------------------------------------------------------------------
# Endpoints — by-manager is declared first so the fixed segment wins any
# ambiguity with the single-segment /{callsign} route.
# ---------------------------------------------------------------------------


@router.get(
    "/by-manager/{manager}",
    response_model=ManagerRoutesResult,
    summary="All callsigns a QSL manager handled (1999 + 2003 directories).",
)
def routes_by_manager(
    manager: str = PathParam(..., description="Manager callsign, case-insensitive."),
    limit: int = Query(100, ge=1, le=500, description="Max routes returned (cap 500)."),
    db: sqlite3.Connection = Depends(get_db),
) -> ManagerRoutesResult:
    mgr = _normalize(manager, "manager")

    cache_key = (mgr, limit)
    with _CACHE_LOCK:
        cached = _MANAGER_CACHE.get(cache_key)
    if cached is not None:
        return cached

    total_row = db.execute(
        "SELECT COUNT(*) AS n FROM qsl_routes WHERE manager = ?",
        (mgr,),
    ).fetchone()
    total = int(total_row["n"]) if total_row is not None else 0

    cur = db.execute(
        """
        SELECT year, callsign
        FROM   qsl_routes
        WHERE  manager = ?
        ORDER  BY year ASC, callsign ASC
        LIMIT  ?
        """,
        (mgr, limit),
    )
    routes = [
        ManagedCall(year=int(r["year"]), callsign=r["callsign"])
        for r in cur.fetchall()
        if r["year"] is not None and r["callsign"]
    ]

    result = ManagerRoutesResult(manager=mgr, total=total, routes=routes)
    with _CACHE_LOCK:
        _MANAGER_CACHE[cache_key] = result
    return result


@router.get(
    "/{callsign}",
    response_model=QslRoutesResult,
    summary="Printed QSL routes (manager per year) for a DX callsign.",
)
def routes_for_callsign(
    callsign: str = PathParam(..., description="DX callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> QslRoutesResult:
    cs = _normalize(callsign, "callsign")
    cur = db.execute(
        """
        SELECT year, manager
        FROM   qsl_routes
        WHERE  callsign = ?
        ORDER  BY year ASC, manager ASC
        """,
        (cs,),
    )
    routes = [
        QslRoute(year=int(r["year"]), manager=r["manager"])
        for r in cur.fetchall()
        if r["year"] is not None and r["manager"]
    ]
    return QslRoutesResult(callsign=cs, routes=routes)


__all__ = [
    "router",
    "QslRoute",
    "QslRoutesResult",
    "ManagedCall",
    "ManagerRoutesResult",
]
