"""QSL Dating Wizard — narrow a QSL card's probable send date.

Given a callsign plus one or more optional clues (city, state, name
fragment, address fragment), the wizard queries the callbook entries
table and returns the narrowest date window consistent with ALL
supplied clues.

Endpoints
---------

GET /api/qsl/date
    Query params:
      callsign     required   e.g. W9QQQ
      city         optional   partial, case-insensitive LIKE match
      state        optional   two-letter abbreviation, exact
      name         optional   partial, case-insensitive LIKE match
      address      optional   partial, case-insensitive LIKE match

    Returns a :class:`QslDateResult` with the narrowed window,
    the matching edition rows, confidence assessment, and a
    human-readable plain-English interpretation.

GET /api/qsl/all-entries/{callsign}
    Return all callbook appearances for a callsign (no filters) so
    the frontend can render a full timeline for context.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

try:
    from app.db import get_db  # type: ignore[no-redef]
except Exception:
    import os
    from functools import lru_cache
    from typing import Iterable

    _DB_PATH = os.environ.get(
        "CALLBOOK_DB_PATH",
        "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
    )

    @lru_cache(maxsize=1)
    def _open_ro() -> sqlite3.Connection:
        # immutable=1 so a WAL-mode DB on a read-only mount opens (see search.py).
        uri = f"file:{_DB_PATH}?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.executescript(
            "PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-65536;"
        )
        return conn

    def get_db() -> Iterable[sqlite3.Connection]:  # type: ignore[no-redef]
        yield _open_ro()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class QslEditionRow(BaseModel):
    year: int
    edition: str
    name: str | None = None
    city: str | None = None
    state: str | None = None
    address: str | None = None


class QslDateResult(BaseModel):
    callsign: str = Field(..., description="Normalised callsign queried.")
    first_year: int | None = Field(
        None, description="Earliest callbook year matching all clues."
    )
    last_year: int | None = Field(
        None, description="Latest callbook year matching all clues."
    )
    window_years: int | None = Field(
        None, description="last_year - first_year; 0 = single edition."
    )
    matching_editions: list[QslEditionRow] = Field(
        ..., description="All editions that satisfy every supplied clue."
    )
    all_editions: list[QslEditionRow] = Field(
        ..., description="All callbook appearances (no clue filter) for context."
    )
    confidence: str = Field(
        ...,
        description=(
            "high — ≤5 years window | medium — 6-20 years | "
            "low — >20 years | none — no matches"
        ),
    )
    interpretation: str = Field(
        ..., description="Plain-English date-range sentence for the UI."
    )
    clues_used: list[str] = Field(
        ..., description="Which optional clue fields were actually applied."
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/qsl", tags=["qsl"])

_CALLSIGN_RE = re.compile(r"^[A-Z0-9]{3,8}$")


def _like_safe(fragment: str) -> str:
    """Escape LIKE special chars so user input can't glob the whole table."""
    return fragment.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _build_interpretation(
    callsign: str,
    first_year: int | None,
    last_year: int | None,
    clues: list[str],
    total_all: int,
) -> str:
    if first_year is None:
        if total_all == 0:
            return f"{callsign} does not appear in the callbook archive."
        return (
            f"{callsign} appears in the archive but no editions match the "
            f"supplied clue(s) ({', '.join(clues) if clues else 'none'})."
        )
    if first_year == last_year:
        return (
            f"This QSL was most likely sent in {first_year} — only one callbook "
            f"edition with {callsign} at that location."
        )
    assert last_year is not None
    clue_str = f" ({', '.join(clues)})" if clues else ""
    return (
        f"Based on the archive record{clue_str}, {callsign} was at this "
        f"location between {first_year} and {last_year} — a {last_year - first_year}-year "
        f"window. The QSL was most likely sent during that span."
    )


@router.get(
    "/date",
    response_model=QslDateResult,
    summary="Narrow a QSL card's probable send-date window.",
)
def qsl_date(
    callsign: Annotated[str, Query(min_length=3, max_length=10)],
    city: Annotated[str | None, Query(max_length=80)] = None,
    state: Annotated[str | None, Query(min_length=2, max_length=2)] = None,
    name: Annotated[str | None, Query(max_length=80)] = None,
    address: Annotated[str | None, Query(max_length=120)] = None,
    db: sqlite3.Connection = Depends(get_db),
) -> QslDateResult:
    cs = callsign.strip().upper()
    if not _CALLSIGN_RE.match(cs):
        raise HTTPException(status_code=400, detail="Invalid callsign format.")

    # -- All editions (no clue filter) for context sidebar --
    all_rows: list[sqlite3.Row] = db.execute(
        "SELECT year, edition, name, city, state, address "
        "FROM entries WHERE callsign=? ORDER BY year, edition",
        (cs,),
    ).fetchall()

    all_editions = [
        QslEditionRow(
            year=int(r["year"]),
            edition=str(r["edition"] or ""),
            name=r["name"],
            city=r["city"],
            state=r["state"],
            address=r["address"],
        )
        for r in all_rows
    ]

    # -- Build filtered query --
    where_parts: list[str] = ["callsign=?"]
    params: list[Any] = [cs]
    clues_used: list[str] = []

    if city:
        where_parts.append("city LIKE ? ESCAPE '\\'")
        params.append(f"%{_like_safe(city.strip())}%")
        clues_used.append("city")

    if state:
        where_parts.append("state=?")
        params.append(state.strip().upper())
        clues_used.append("state")

    if name:
        where_parts.append("name LIKE ? ESCAPE '\\'")
        params.append(f"%{_like_safe(name.strip())}%")
        clues_used.append("name")

    if address:
        where_parts.append("address LIKE ? ESCAPE '\\'")
        params.append(f"%{_like_safe(address.strip())}%")
        clues_used.append("address")

    where_sql = " AND ".join(where_parts)
    sql = (
        f"SELECT year, edition, name, city, state, address "
        f"FROM entries WHERE {where_sql} ORDER BY year, edition"
    )
    filtered_rows: list[sqlite3.Row] = db.execute(sql, params).fetchall()

    matching = [
        QslEditionRow(
            year=int(r["year"]),
            edition=str(r["edition"] or ""),
            name=r["name"],
            city=r["city"],
            state=r["state"],
            address=r["address"],
        )
        for r in filtered_rows
    ]

    first_year: int | None = None
    last_year: int | None = None
    window_years: int | None = None
    confidence: str = "none"

    if matching:
        first_year = matching[0].year
        last_year = matching[-1].year
        window_years = last_year - first_year
        if window_years <= 5:
            confidence = "high"
        elif window_years <= 20:
            confidence = "medium"
        else:
            confidence = "low"

    interpretation = _build_interpretation(
        cs, first_year, last_year, clues_used, len(all_editions)
    )

    return QslDateResult(
        callsign=cs,
        first_year=first_year,
        last_year=last_year,
        window_years=window_years,
        matching_editions=matching,
        all_editions=all_editions,
        confidence=confidence,
        interpretation=interpretation,
        clues_used=clues_used,
    )


@router.get(
    "/all-entries/{callsign}",
    response_model=list[QslEditionRow],
    summary="All callbook appearances for a callsign (no filters).",
)
def all_entries(
    callsign: str,
    db: sqlite3.Connection = Depends(get_db),
) -> list[QslEditionRow]:
    cs = callsign.strip().upper()
    if not _CALLSIGN_RE.match(cs):
        raise HTTPException(status_code=400, detail="Invalid callsign format.")
    rows: list[sqlite3.Row] = db.execute(
        "SELECT year, edition, name, city, state, address "
        "FROM entries WHERE callsign=? ORDER BY year, edition",
        (cs,),
    ).fetchall()
    return [
        QslEditionRow(
            year=int(r["year"]),
            edition=str(r["edition"] or ""),
            name=r["name"],
            city=r["city"],
            state=r["state"],
            address=r["address"],
        )
        for r in rows
    ]
