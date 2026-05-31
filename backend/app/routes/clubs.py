"""Clubs route — discovery and listing endpoints for amateur-radio clubs.

The Data phase materialises a ``clubs`` table plus a ``clubs_fts`` FTS5
index by clustering callbook entries whose ``name`` field looks like a
club (e.g. "ACME ARC", "BIG VALLEY RADIO CLUB"). This router exposes
read-only listing endpoints over those aggregates.

Endpoints
---------

GET /api/clubs/search?q=&limit=20&offset=0
    Free-text club search. When ``q`` is supplied we match against the
    ``clubs_fts`` virtual table. When omitted, we return the most-active
    clubs (highest ``appearance_count``) so the page has something to
    show on first paint.

GET /api/clubs/by-letter/{letter}
    Alphabetical browse. Returns every club whose ``display_name`` begins
    with the given letter (case-insensitive). Single-character path
    parameter; non-letters raise 400.

GET /api/clubs/notable?limit=20
    Top-N clubs by ``appearance_count``. Cheap to compute thanks to the
    descending index on the count column.

GET /api/clubs/types
    Breakdown by ``club_type`` ('arc', 'radio club', 'amateur radio
    association', etc). One row per type with a count of clubs.

All endpoints return JSON. SQLite reads use parameter binding throughout
and never construct raw SQL from user input.
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
# Canonical helper lives in ``app.db.get_db`` (FastAPI dependency that
# returns the process-wide read-only connection). To keep this router
# self-contained during the staged build, fall back to an in-module
# opener if the import fails. Both paths produce a ``sqlite3.Connection``
# with ``Row`` factory and read-only pragmas.
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
# Pydantic models — wire contract.
# ---------------------------------------------------------------------------


class ClubRow(BaseModel):
    slug: str = Field(..., description="URL-safe identifier (primary key in `clubs`).")
    display_name: str = Field(..., description="Human-readable club name.")
    callsign_count: int = Field(
        ..., description="DISTINCT callsigns ever attributed to this club."
    )
    appearance_count: int = Field(
        ..., description="Total entries (callsign x year) attributed to this club."
    )
    first_year: int | None = Field(
        None, description="Earliest callbook year in which this club appears."
    )
    last_year: int | None = Field(
        None, description="Latest callbook year in which this club appears."
    )
    dominant_state: str | None = Field(
        None, description="State that hosts the most entries for this club."
    )
    dominant_city: str | None = Field(
        None, description="City that hosts the most entries for this club."
    )
    club_type: str | None = Field(
        None, description="Detected club_type label (e.g. 'arc', 'radio club')."
    )


class ClubTypeCount(BaseModel):
    club_type: str = Field(..., description="Detected club_type label.")
    count: int = Field(..., description="Number of clubs with this type.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Mirrors FTS5's documented quoting rules: wrap every token in double
# quotes and escape any embedded double-quote by doubling it. This lets
# users type apostrophes, hyphens, or other punctuation without SQLite
# trying to interpret them as FTS operators.
_FTS_TOKEN_SPLIT = re.compile(r"\s+")


def _fts_match_expr(term: str) -> str:
    """Build a safe MATCH expression from a raw query string.

    We split on whitespace, drop empty pieces, escape embedded quotes,
    and AND the tokens together. A trailing ``*`` on the last token
    enables prefix matching so "redwood r" finds "REDWOOD RADIO CLUB".
    """
    tokens = [t for t in _FTS_TOKEN_SPLIT.split(term.strip()) if t]
    if not tokens:
        return ""
    quoted: list[str] = []
    for i, tok in enumerate(tokens):
        escaped = tok.replace('"', '""')
        if i == len(tokens) - 1:
            quoted.append(f'"{escaped}"*')
        else:
            quoted.append(f'"{escaped}"')
    return " ".join(quoted)


_LETTER_RE = re.compile(r"^[A-Za-z]$")


# Columns we project for every ClubRow result. Kept here so the SELECT
# clauses across endpoints stay in lock-step.
_CLUB_COLUMNS = (
    "slug, display_name, callsign_count, appearance_count, "
    "first_year, last_year, dominant_state, dominant_city, club_type"
)


def _row_to_club(r: sqlite3.Row) -> ClubRow:
    return ClubRow(
        slug=r["slug"],
        display_name=r["display_name"],
        callsign_count=int(r["callsign_count"] or 0),
        appearance_count=int(r["appearance_count"] or 0),
        first_year=r["first_year"],
        last_year=r["last_year"],
        dominant_state=r["dominant_state"],
        dominant_city=r["dominant_city"],
        club_type=r["club_type"],
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/clubs", tags=["clubs"])


@router.get(
    "/search",
    response_model=list[ClubRow],
    summary="Free-text club search (FTS5) or top-by-activity browse.",
)
def search_clubs(
    q: Annotated[str | None, Query(max_length=128)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    db: sqlite3.Connection = Depends(get_db),
) -> list[ClubRow]:
    """Return clubs matching ``q`` via FTS5, or the busiest clubs if no ``q``.

    The FTS path joins ``clubs_fts`` back to ``clubs`` on rowid so we can
    return the same column set as the no-query browse path. Ordering by
    bm25() puts the most relevant matches first; ties break on
    ``appearance_count`` so well-known clubs win between equally relevant
    hits.
    """
    term = (q or "").strip()

    if term:
        match_expr = _fts_match_expr(term)
        if not match_expr:
            # User passed pure whitespace — degrade to the browse path.
            term = ""

    if term:
        # Qualify every projected column with the ``c.`` alias — several
        # columns (notably ``display_name``) live in both ``clubs`` and
        # ``clubs_fts``, and an unqualified reference triggers SQLite's
        # "ambiguous column" error on the join.
        qualified_columns = ", ".join(
            f"c.{col.strip()}" for col in _CLUB_COLUMNS.split(",")
        )
        sql = f"""
            SELECT  {qualified_columns}
            FROM    clubs_fts AS fts
            JOIN    clubs     AS c  ON c.rowid = fts.rowid
            WHERE   clubs_fts MATCH ?
            ORDER BY bm25(clubs_fts), c.appearance_count DESC
            LIMIT  ? OFFSET ?
        """
        rows = db.execute(sql, (match_expr, limit, offset)).fetchall()
    else:
        sql = f"""
            SELECT  {_CLUB_COLUMNS}
            FROM    clubs
            ORDER BY appearance_count DESC, display_name ASC
            LIMIT  ? OFFSET ?
        """
        rows = db.execute(sql, (limit, offset)).fetchall()

    return [_row_to_club(r) for r in rows]


@router.get(
    "/by-letter/{letter}",
    response_model=list[ClubRow],
    summary="All clubs whose display_name starts with the given letter.",
)
def clubs_by_letter(
    letter: Annotated[str, Path(min_length=1, max_length=1)],
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    db: sqlite3.Connection = Depends(get_db),
) -> list[ClubRow]:
    """Alphabetical browse — used by the A-Z directory page.

    Case-insensitive prefix match against ``display_name``. We accept
    both upper- and lower-case letters but normalise to upper for the
    LIKE so the index on ``display_name`` (which collates NOCASE in the
    Data phase build) can still be used.
    """
    if not _LETTER_RE.match(letter):
        raise HTTPException(
            status_code=400,
            detail="letter must be a single ASCII letter A-Z.",
        )
    upper = letter.upper()
    # ``display_name`` is stored uppercase-ish but mixed-case names slip
    # in; the COLLATE NOCASE makes the comparison robust either way.
    sql = f"""
        SELECT  {_CLUB_COLUMNS}
        FROM    clubs
        WHERE   substr(display_name, 1, 1) = ? COLLATE NOCASE
        ORDER BY display_name ASC
        LIMIT  ? OFFSET ?
    """
    rows = db.execute(sql, (upper, limit, offset)).fetchall()
    return [_row_to_club(r) for r in rows]


@router.get(
    "/notable",
    response_model=list[ClubRow],
    summary="Top clubs by appearance_count.",
)
def notable_clubs(
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    db: sqlite3.Connection = Depends(get_db),
) -> list[ClubRow]:
    """The most-active clubs across the whole archive.

    Drives the "Notable Clubs" rail on the clubs landing page. Cheap
    thanks to ``idx_clubs_callsign_count`` and the descending sort —
    SQLite reads the top ``limit`` rows and stops.
    """
    sql = f"""
        SELECT  {_CLUB_COLUMNS}
        FROM    clubs
        ORDER BY appearance_count DESC, display_name ASC
        LIMIT  ?
    """
    rows = db.execute(sql, (limit,)).fetchall()
    return [_row_to_club(r) for r in rows]


@router.get(
    "/types",
    response_model=list[ClubTypeCount],
    summary="Breakdown of clubs by detected club_type.",
)
def club_types(
    db: sqlite3.Connection = Depends(get_db),
) -> list[ClubTypeCount]:
    """One row per ``club_type`` with the number of clubs of that type.

    Powers the "Browse by Type" facet. Rows with NULL/empty type are
    suppressed because the frontend can't render an unlabelled facet.
    """
    sql = """
        SELECT  club_type,
                COUNT(*) AS n
        FROM    clubs
        WHERE   club_type IS NOT NULL
          AND   club_type != ''
        GROUP BY club_type
        ORDER BY n DESC, club_type ASC
    """
    rows = db.execute(sql).fetchall()
    return [
        ClubTypeCount(club_type=r["club_type"], count=int(r["n"] or 0))
        for r in rows
    ]
