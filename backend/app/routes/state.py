"""State route — per-US-state aggregates and entry lookups.

Endpoints
---------

GET /api/state/{state}/summary?year=...
    Headline numbers for one state: total entries, distinct callsigns,
    peak-activity year, and the top-10 cities by entry count. Optionally
    scoped to a single year.

GET /api/state/{state}/entries?year=...&q=...&limit=...
    A list of `Entry` records from one state, optionally filtered by year
    and a free-text term that matches the callsign, name, or city.

GET /api/states
    One row per state for the map: state code, total entry count, and the
    state's seeded centroid (lat/lon) from `geocode_cache`.

All endpoints return JSON. All SQLite reads use parameter binding and the
column indexes on `entries.state`, `entries.year`, and `entries.callsign`.
"""

from __future__ import annotations

import os
import re
import sqlite3
from functools import lru_cache
from typing import Annotated, Iterable

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# DB connection
#
# The canonical place for the SQLite connection helper is `app.db.get_db`.
# To keep this router self-contained and robust during the staged build (the
# db module may be authored by a sibling agent), we try the real import first
# and fall back to an in-module read-only opener. Both paths produce a
# `sqlite3.Connection` with `Row` factory and the read-only pragmas we want.
# ---------------------------------------------------------------------------

try:  # pragma: no cover — exercised once app.db lands
    from app.db import get_db  # type: ignore[no-redef]
except Exception:  # ImportError or AttributeError during partial builds
    _DB_PATH = os.environ.get(
        "CALLBOOK_DB_PATH",
        "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
    )

    @lru_cache(maxsize=1)
    def _open_ro() -> sqlite3.Connection:
        # SQLite read-only URI keeps the FastAPI worker from ever mutating
        # the 2.4 GB archive. check_same_thread=False is safe because we
        # only issue read queries on a per-request basis via a generator.
        uri = f"file:{_DB_PATH}?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            PRAGMA query_only      = ON;
            PRAGMA temp_store      = MEMORY;
            PRAGMA cache_size      = -65536;   -- ~64 MB page cache
            PRAGMA mmap_size       = 30000000000;
            """
        )
        return conn

    def get_db() -> Iterable[sqlite3.Connection]:  # type: ignore[no-redef]
        """FastAPI dependency yielding a shared read-only SQLite connection."""
        yield _open_ro()


# ---------------------------------------------------------------------------
# Pydantic models — the wire contract this route promises the frontend.
# ---------------------------------------------------------------------------


class CityCount(BaseModel):
    city: str
    count: int


class StateSummary(BaseModel):
    state: str = Field(..., description="Two-letter state / territory code.")
    total_entries: int = Field(..., description="Rows in `entries` for this state.")
    distinct_callsigns: int = Field(
        ..., description="COUNT(DISTINCT callsign) for the state."
    )
    peak_year: int | None = Field(
        None, description="Calendar year with the most entries for this state."
    )
    peak_year_count: int | None = Field(
        None, description="Entry count for `peak_year`."
    )
    top_cities: list[CityCount] = Field(
        default_factory=list,
        description="Up to 10 cities by entry count, descending.",
    )
    year: int | None = Field(
        None, description="If the query was scoped to a single year, that year."
    )


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


class StateMapRow(BaseModel):
    state: str
    total_count: int
    lat: float
    lon: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_STATE_RE = re.compile(r"^[A-Za-z]{2}$")


def _validate_state(state: str) -> str:
    """Two-letter code, normalized to uppercase. Reject anything else."""
    if not state or not _STATE_RE.match(state):
        raise HTTPException(
            status_code=400,
            detail="state must be a two-letter US state or territory code (e.g. 'CA').",
        )
    return state.upper()


def _validate_year(year: int | None) -> int | None:
    """Callbook editions span 1909-1997 plus 2003. Reject obvious nonsense."""
    if year is None:
        return None
    if year < 1909 or year > 2003:
        raise HTTPException(
            status_code=400,
            detail="year must be between 1909 and 2003 (inclusive).",
        )
    return year


def _escape_like(term: str) -> str:
    """Escape LIKE metacharacters so user input matches literally."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api", tags=["state"])


@router.get(
    "/states",
    response_model=list[StateMapRow],
    summary="All US states with totals + centroid (for the map).",
)
def list_states(db: sqlite3.Connection = Depends(get_db)) -> list[StateMapRow]:
    """Drives the choropleth / bubble map on the home page.

    Joins `entries` aggregated by state against the seeded `geocode_cache`
    state-centroid rows (where city = ''). States that appear in `entries`
    but have no centroid (rare OCR garbage like 'AA', 'AB') are skipped —
    the map can only plot rows it can place.
    """
    rows = db.execute(
        """
        SELECT  e.state              AS state,
                COUNT(*)             AS total_count,
                g.lat                AS lat,
                g.lon                AS lon
        FROM    entries        AS e
        JOIN    geocode_cache  AS g
          ON    g.state = e.state
         AND    g.city  = ''
        WHERE   e.state IS NOT NULL
          AND   e.state != ''
        GROUP BY e.state, g.lat, g.lon
        ORDER BY total_count DESC
        """
    ).fetchall()
    return [
        StateMapRow(
            state=r["state"],
            total_count=r["total_count"],
            lat=r["lat"],
            lon=r["lon"],
        )
        for r in rows
    ]


@router.get(
    "/state/{state}/summary",
    response_model=StateSummary,
    summary="Headline numbers for one state.",
)
def state_summary(
    state: Annotated[str, Path(min_length=2, max_length=2)],
    year: Annotated[int | None, Query(ge=1909, le=2003)] = None,
    db: sqlite3.Connection = Depends(get_db),
) -> StateSummary:
    """Total entries, distinct callsigns, peak year, top-10 cities.

    When `year` is supplied, every aggregate is scoped to that year — and
    `peak_year` collapses to `year` itself (since the data is filtered to
    that single year before aggregation).
    """
    st = _validate_state(state)
    yr = _validate_year(year)

    if yr is None:
        total_row = db.execute(
            """
            SELECT COUNT(*)              AS total_entries,
                   COUNT(DISTINCT callsign) AS distinct_callsigns
            FROM   entries
            WHERE  state = ?
            """,
            (st,),
        ).fetchone()
    else:
        total_row = db.execute(
            """
            SELECT COUNT(*)              AS total_entries,
                   COUNT(DISTINCT callsign) AS distinct_callsigns
            FROM   entries
            WHERE  state = ?
              AND  year  = ?
            """,
            (st, yr),
        ).fetchone()

    total_entries = int(total_row["total_entries"] or 0)
    distinct_callsigns = int(total_row["distinct_callsigns"] or 0)

    # No rows? Return an empty-but-valid summary so the frontend can render
    # "no records" without special-casing a 404.
    if total_entries == 0:
        return StateSummary(
            state=st,
            total_entries=0,
            distinct_callsigns=0,
            peak_year=yr,
            peak_year_count=0 if yr is not None else None,
            top_cities=[],
            year=yr,
        )

    if yr is None:
        peak_row = db.execute(
            """
            SELECT year, COUNT(*) AS n
            FROM   entries
            WHERE  state = ?
              AND  year IS NOT NULL
            GROUP BY year
            ORDER BY n DESC, year DESC
            LIMIT 1
            """,
            (st,),
        ).fetchone()
        peak_year = int(peak_row["year"]) if peak_row else None
        peak_year_count = int(peak_row["n"]) if peak_row else None
    else:
        peak_year = yr
        peak_year_count = total_entries

    if yr is None:
        city_rows = db.execute(
            """
            SELECT city, COUNT(*) AS n
            FROM   entries
            WHERE  state = ?
              AND  city IS NOT NULL
              AND  city != ''
            GROUP BY city
            ORDER BY n DESC, city ASC
            LIMIT 10
            """,
            (st,),
        ).fetchall()
    else:
        city_rows = db.execute(
            """
            SELECT city, COUNT(*) AS n
            FROM   entries
            WHERE  state = ?
              AND  year  = ?
              AND  city IS NOT NULL
              AND  city != ''
            GROUP BY city
            ORDER BY n DESC, city ASC
            LIMIT 10
            """,
            (st, yr),
        ).fetchall()

    return StateSummary(
        state=st,
        total_entries=total_entries,
        distinct_callsigns=distinct_callsigns,
        peak_year=peak_year,
        peak_year_count=peak_year_count,
        top_cities=[CityCount(city=r["city"], count=int(r["n"])) for r in city_rows],
        year=yr,
    )


@router.get(
    "/state/{state}/entries",
    response_model=list[Entry],
    summary="Entries for one state, optionally filtered by year and a term.",
)
def state_entries(
    state: Annotated[str, Path(min_length=2, max_length=2)],
    year: Annotated[int | None, Query(ge=1909, le=2003)] = None,
    q: Annotated[str | None, Query(max_length=128)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: sqlite3.Connection = Depends(get_db),
) -> list[Entry]:
    """Return up to `limit` rows from `entries` for the state.

    The free-text filter `q` matches against callsign, name, or city via
    case-insensitive LIKE with proper escaping. We deliberately do not use
    FTS5 here because that index is keyed off rowid and the state route is
    almost always scoped narrowly enough that the `idx_entries_state` +
    `idx_entries_year` indexes win.
    """
    st = _validate_state(state)
    yr = _validate_year(year)

    clauses = ["state = ?"]
    params: list[object] = [st]

    if yr is not None:
        clauses.append("year = ?")
        params.append(yr)

    if q:
        term = q.strip()
        if term:
            like = f"%{_escape_like(term)}%"
            clauses.append(
                "(callsign LIKE ? ESCAPE '\\' "
                " OR name    LIKE ? ESCAPE '\\' "
                " OR city    LIKE ? ESCAPE '\\')"
            )
            params.extend([like, like, like])

    where = " AND ".join(clauses)
    sql = f"""
        SELECT year, edition, callsign, license_class,
               name, address, city, state, zip
        FROM   entries
        WHERE  {where}
        ORDER  BY year ASC, callsign ASC
        LIMIT  ?
    """
    params.append(limit)

    rows = db.execute(sql, params).fetchall()
    return [
        Entry(
            year=r["year"],
            edition=r["edition"],
            callsign=r["callsign"],
            license_class=r["license_class"],
            name=r["name"],
            address=r["address"],
            city=r["city"],
            state=r["state"],
            zip=r["zip"],
        )
        for r in rows
    ]
