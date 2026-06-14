"""Year route — per-edition browsing of the USA Ham Callbook archive.

Three endpoints back the "Year" view on the frontend:

    GET /api/year/{year}/summary    — headline stats + notable callsigns + editions
    GET /api/year/{year}/entries    — paginated entries filtered by state/class
    GET /api/years                  — list of {year, entry_count} for the timeline

The SQLite database lives at ``/data/USA_Ham_Callbooks.sqlite`` inside the
backend container (mounted read-only). Connections are opened per-request and
returned to a thread-local pool so FastAPI's threadpool workers each get their
own cursor without paying the open/close cost on every call.

All queries are powered by the indexes shipped on the ``entries`` table
(``idx_entries_year``, ``idx_entries_year_callsign``, ``idx_entries_state``)
plus the precomputed ``stats_per_year`` summary table.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from functools import lru_cache
from typing import Iterable

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["year"])


# ---------------------------------------------------------------------------
# Database access
# ---------------------------------------------------------------------------

_DB_PATH = (
    os.environ.get("HAM_DB_PATH")
    or os.environ.get("DB_PATH")
    or "/data/USA_Ham_Callbooks.sqlite"
)

_local = threading.local()


def _resolve_db_path() -> str:
    if not os.path.exists(_DB_PATH):
        raise RuntimeError(
            f"/data/USA_Ham_Callbooks.sqlite not found (resolved to {_DB_PATH!r}). "
            "Ensure the DB volume is mounted and DB_PATH is set correctly."
        )
    return _DB_PATH


def _get_conn() -> sqlite3.Connection:
    """Return a thread-local, read-only SQLite connection.

    SQLite connections are not safe to share across threads, but FastAPI's
    sync route handlers run on a threadpool. A thread-local connection keeps
    things both safe and cheap.
    """

    conn = getattr(_local, "conn", None)
    if conn is None:
        db_path = _resolve_db_path()
        # ``uri=True`` so we can request a read-only handle that won't ever
        # mutate the source database, even by accident.
        conn = sqlite3.connect(
            # immutable=1 so a WAL-mode DB on a read-only mount opens (mode=ro
            # alone needs to create the -shm, which a :ro dir forbids).
            f"file:{db_path}?mode=ro&immutable=1",
            uri=True,
            check_same_thread=False,
            timeout=15.0,
        )
        conn.row_factory = sqlite3.Row
        # Performance pragmas appropriate for a read-only analytic workload.
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA temp_store = MEMORY")
        conn.execute("PRAGMA mmap_size = 268435456")  # 256 MiB
        conn.execute("PRAGMA cache_size = -65536")    # 64 MiB page cache
        _local.conn = conn
    return conn


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class Entry(BaseModel):
    year: int | None = None
    edition: str | None = None
    callsign: str | None = None
    license_class: str | None = None
    name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    flag: str | None = None
    source: str | None = None


class TopState(BaseModel):
    state: str
    count: int


class NotableCallsign(BaseModel):
    callsign: str
    name: str | None = None
    state: str | None = None
    license_class: str | None = None
    city: str | None = None


class EditionInfo(BaseModel):
    key: str
    label: str | None = None
    entry_count: int | None = None
    parse_quality: str | None = None


class YearSummary(BaseModel):
    year: int
    entry_count: int
    distinct_callsigns: int
    top_states: list[TopState] = Field(default_factory=list)
    notable_callsigns: list[NotableCallsign] = Field(default_factory=list)
    editions: list[EditionInfo] = Field(default_factory=list)


class EntriesPage(BaseModel):
    year: int
    total: int
    limit: int
    offset: int
    filters: dict[str, str | None]
    entries: list[Entry]


class YearCount(BaseModel):
    year: int
    entry_count: int


# ---------------------------------------------------------------------------
# Validators / helpers
# ---------------------------------------------------------------------------

# Two-letter US state / territory code. Kept permissive (any 2 uppercase
# letters) so the OCR'd corpus's non-canonical codes (e.g. military APOs)
# still flow through, but tight enough to make SQL-injection impossible.
_STATE_RE = re.compile(r"^[A-Za-z]{2}$")

# License classes seen in the corpus: A, B, C, E, G, N, P, T (and rarely X).
_CLASS_RE = re.compile(r"^[A-Za-z]$")


@lru_cache(maxsize=1)
def _known_years() -> frozenset[int]:
    """Years present in ``stats_per_year``; cached for the process lifetime."""

    conn = _get_conn()
    rows = conn.execute("SELECT year FROM stats_per_year").fetchall()
    return frozenset(int(r["year"]) for r in rows)


def _validate_year(year: int) -> None:
    if year not in _known_years():
        raise HTTPException(
            status_code=404,
            detail=f"No callbook data on file for year {year}",
        )


def _row_to_entry(row: sqlite3.Row) -> Entry:
    return Entry(
        year=row["year"],
        edition=row["edition"],
        callsign=row["callsign"],
        license_class=row["license_class"],
        name=row["name"],
        address=row["address"],
        city=row["city"],
        state=row["state"],
        zip=row["zip"],
        flag=row["flag"],
        source=row["source"] if "source" in row.keys() else None,
    )


def _rows_to_entries(rows: Iterable[sqlite3.Row]) -> list[Entry]:
    return [_row_to_entry(r) for r in rows]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/years", response_model=list[YearCount])
def list_years() -> list[YearCount]:
    """List every year present in the corpus along with its entry count.

    Powers the frontend timeline / browse-by-year view. Sourced from the
    precomputed ``stats_per_year`` table so it returns in well under a
    millisecond regardless of corpus size.
    """

    conn = _get_conn()
    rows = conn.execute(
        "SELECT year, entry_count FROM stats_per_year ORDER BY year"
    ).fetchall()
    return [YearCount(year=int(r["year"]), entry_count=int(r["entry_count"])) for r in rows]


@router.get("/year/{year}/summary", response_model=YearSummary)
def year_summary(
    year: int = Path(..., ge=1909, le=2100, description="Four-digit year"),
) -> YearSummary:
    """Return headline statistics and notable callsigns for a single year."""

    _validate_year(year)
    conn = _get_conn()

    stats_row = conn.execute(
        "SELECT entry_count, distinct_callsigns FROM stats_per_year WHERE year = ?",
        (year,),
    ).fetchone()
    if stats_row is None:
        # Defensive — _validate_year already guards this, but keep a clean
        # 404 if the stats table was somehow truncated.
        raise HTTPException(
            status_code=404,
            detail=f"No callbook data on file for year {year}",
        )

    top_state_rows = conn.execute(
        """
        SELECT state, COUNT(*) AS ct
          FROM entries
         WHERE year = ?
           AND state IS NOT NULL
           AND state <> ''
         GROUP BY state
         ORDER BY ct DESC, state ASC
         LIMIT 5
        """,
        (year,),
    ).fetchall()

    # "Notable" = real 1x1 / 1x2 callsigns (the short, prestige assignments)
    # owned by an identifiable operator. The GLOB patterns leverage SQLite's
    # ordered scan so we can stop after eight matches without sorting the
    # whole year. We require a state and license class so we drop most of the
    # OCR garbage that the early Lee Hite scans produced.
    notable_rows = conn.execute(
        """
        SELECT callsign, name, state, license_class, city
          FROM entries
         WHERE year = ?
           AND (
                callsign GLOB '[KNW][0-9][A-Z]'
             OR callsign GLOB '[KNW][0-9][A-Z][A-Z]'
             OR callsign GLOB '[AKNW][A-Z][0-9][A-Z]'
           )
           AND name IS NOT NULL
           AND length(name) BETWEEN 5 AND 40
           AND state IS NOT NULL AND state <> ''
           AND license_class IS NOT NULL AND license_class <> ''
         ORDER BY length(callsign) ASC, callsign ASC
         LIMIT 8
        """,
        (year,),
    ).fetchall()

    edition_rows = conn.execute(
        """
        SELECT key, label, entry_count, parse_quality
          FROM editions
         WHERE year = ?
         ORDER BY key
        """,
        (year,),
    ).fetchall()

    return YearSummary(
        year=year,
        entry_count=int(stats_row["entry_count"] or 0),
        distinct_callsigns=int(stats_row["distinct_callsigns"] or 0),
        top_states=[
            TopState(state=r["state"], count=int(r["ct"])) for r in top_state_rows
        ],
        notable_callsigns=[
            NotableCallsign(
                callsign=r["callsign"],
                name=r["name"],
                state=r["state"],
                license_class=r["license_class"],
                city=r["city"],
            )
            for r in notable_rows
        ],
        editions=[
            EditionInfo(
                key=r["key"],
                label=r["label"],
                entry_count=int(r["entry_count"]) if r["entry_count"] is not None else None,
                parse_quality=r["parse_quality"],
            )
            for r in edition_rows
        ],
    )


@router.get("/year/{year}/entries", response_model=EntriesPage)
def year_entries(
    year: int = Path(..., ge=1909, le=2100, description="Four-digit year"),
    state: str | None = Query(
        None,
        description="Two-letter US state / territory code (case-insensitive)",
        max_length=2,
    ),
    license_class: str | None = Query(
        None,
        alias="class",
        description="License class letter, e.g. E, A, G, T, N",
        max_length=1,
    ),
    limit: int = Query(
        50, ge=1, le=500, description="Page size (max 500)"
    ),
    offset: int = Query(
        0, ge=0, le=10_000_000, description="Page offset"
    ),
) -> EntriesPage:
    """Paginated entries from a given year, optionally filtered.

    The compound ``(year, callsign)`` index drives both the WHERE clause and
    the ORDER BY, so even deep pagination through a populous year (1997 has
    ~307k rows) stays well under a hundred milliseconds.
    """

    _validate_year(year)

    # Build WHERE clause from optional filters with strict input validation.
    where = ["year = ?"]
    params: list[object] = [year]
    filters: dict[str, str | None] = {"state": None, "class": None}

    if state is not None:
        if not _STATE_RE.match(state):
            raise HTTPException(
                status_code=422,
                detail="state must be a two-letter code",
            )
        state_uc = state.upper()
        where.append("state = ?")
        params.append(state_uc)
        filters["state"] = state_uc

    if license_class is not None:
        if not _CLASS_RE.match(license_class):
            raise HTTPException(
                status_code=422,
                detail="class must be a single letter",
            )
        class_uc = license_class.upper()
        where.append("license_class = ?")
        params.append(class_uc)
        filters["class"] = class_uc

    where_sql = " AND ".join(where)

    conn = _get_conn()

    total_row = conn.execute(
        f"SELECT COUNT(*) AS ct FROM entries WHERE {where_sql}",
        params,
    ).fetchone()
    total = int(total_row["ct"]) if total_row else 0

    rows = conn.execute(
        f"""
        SELECT year, edition, callsign, license_class, name,
               address, city, state, zip, flag, source
          FROM entries
         WHERE {where_sql}
         ORDER BY callsign ASC, edition ASC
         LIMIT ? OFFSET ?
        """,
        (*params, limit, offset),
    ).fetchall()

    return EntriesPage(
        year=year,
        total=total,
        limit=limit,
        offset=offset,
        filters=filters,
        entries=_rows_to_entries(rows),
    )
