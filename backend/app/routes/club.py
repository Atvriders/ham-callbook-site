"""Club route — per-club aggregates, callsign rosters, detection history.

The data phase scans every entry's ``name`` field, looking for tell-tale
club signatures ("ARC", "Radio Club", "Repeater Assn", university calls,
emergency-services groups, etc.). Matches land in three companion tables:

* ``clubs``           — one row per slugged club name with display-name,
                        appearance/callsign counts, year range, dominant
                        city/state, and a ``club_type`` classification.
* ``club_callsigns``  — one row per (slug, callsign) pair with the year
                        window and the most representative location string.
* ``club_detections`` — one row per ``entries`` row that matched, capturing
                        the raw OCR'd name and the city/state at that
                        moment in time.

Endpoints
---------

GET /api/club/{slug}
    Full club info from ``clubs`` plus the full callsign roster from
    ``club_callsigns`` ordered by ``first_year`` then callsign.

GET /api/club/{slug}/history
    Every detection from ``club_detections`` (year, edition, callsign,
    city, state, raw_name) ordered chronologically.

GET /api/club/{slug}/callsigns
    The roster from ``club_callsigns`` (callsign, first_year, last_year,
    appearance_count) ordered by ``first_year``.

GET /api/club/{slug}/related?limit=10
    Up to ``limit`` other clubs in the same ``dominant_state`` and
    ``club_type`` ordered by ``appearance_count`` descending.

All endpoints return JSON. All reads use parameter binding and ride the
``idx_club_callsigns_slug`` / ``idx_club_detections_slug`` indexes; the
``clubs`` PK on ``slug`` covers the headline lookup.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.db import get_db


# ---------------------------------------------------------------------------
# Pydantic models — the wire contract this route promises the frontend.
# ---------------------------------------------------------------------------


class ClubCallsign(BaseModel):
    """One callsign row from ``club_callsigns`` (the roster view)."""

    callsign: str
    first_year: int | None = None
    last_year: int | None = None
    appearance_count: int = 0
    location_summary: str | None = None


class Club(BaseModel):
    """Headline ``clubs`` row + nested roster."""

    slug: str
    display_name: str | None = None
    normalized_name: str | None = None
    callsign_count: int = 0
    appearance_count: int = 0
    first_year: int | None = None
    last_year: int | None = None
    dominant_state: str | None = None
    dominant_city: str | None = None
    club_type: str | None = None
    callsigns: list[ClubCallsign] = Field(
        default_factory=list,
        description="All callsigns associated with this club, ordered by first_year.",
    )


class ClubDetection(BaseModel):
    """One entry-level match from ``club_detections``."""

    year: int | None = None
    edition: str | None = None
    callsign: str | None = None
    city: str | None = None
    state: str | None = None
    raw_name: str | None = None


class RelatedClub(BaseModel):
    """Sibling club in the same state + ``club_type``."""

    slug: str
    display_name: str | None = None
    callsign_count: int = 0
    appearance_count: int = 0
    first_year: int | None = None
    last_year: int | None = None
    dominant_state: str | None = None
    dominant_city: str | None = None
    club_type: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Slugs in the data phase are produced by a unicode-aware normalizer that
# preserves a handful of punctuation marks ('!', '+', '(', ')', '<', '>',
# etc.) so we cannot lock the regex down to ``[a-z0-9-]``. Instead we cap
# the length and rule out the SQL-injection-shaped characters; the actual
# uniqueness is enforced by the ``clubs.slug`` primary key.
_SLUG_RE = re.compile(r"^[^\s\x00';\"\\]{1,256}$")


def _validate_slug(slug: str) -> str:
    """Lower-case, length-capped, free of whitespace and quote characters."""
    if not slug or not _SLUG_RE.match(slug):
        raise HTTPException(
            status_code=400,
            detail="slug must be 1-256 characters with no whitespace or quotes.",
        )
    return slug.lower()


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/club", tags=["club"])


@router.get(
    "/{slug}",
    response_model=Club,
    summary="Full club info + complete callsign roster.",
)
def club_detail(
    slug: Annotated[str, Path(min_length=1, max_length=256)],
    db: sqlite3.Connection = Depends(get_db),
) -> Club:
    """Fetch the ``clubs`` row and every ``club_callsigns`` row for it.

    The roster is ordered by ``first_year`` (oldest first) and then by
    callsign so the frontend can render a stable historical timeline
    without re-sorting on the client.
    """
    s = _validate_slug(slug)

    club_row = db.execute(
        """
        SELECT slug, display_name, normalized_name,
               callsign_count, appearance_count,
               first_year, last_year,
               dominant_state, dominant_city, club_type
        FROM   clubs
        WHERE  slug = ?
        """,
        (s,),
    ).fetchone()

    if club_row is None:
        raise HTTPException(status_code=404, detail=f"club not found: {slug}")

    callsign_rows = db.execute(
        """
        SELECT callsign, first_year, last_year,
               appearance_count, location_summary
        FROM   club_callsigns
        WHERE  slug = ?
        ORDER  BY first_year ASC, callsign ASC
        """,
        (s,),
    ).fetchall()

    return Club(
        slug=club_row["slug"],
        display_name=club_row["display_name"],
        normalized_name=club_row["normalized_name"],
        callsign_count=int(club_row["callsign_count"] or 0),
        appearance_count=int(club_row["appearance_count"] or 0),
        first_year=club_row["first_year"],
        last_year=club_row["last_year"],
        dominant_state=club_row["dominant_state"],
        dominant_city=club_row["dominant_city"],
        club_type=club_row["club_type"],
        callsigns=[
            ClubCallsign(
                callsign=r["callsign"],
                first_year=r["first_year"],
                last_year=r["last_year"],
                appearance_count=int(r["appearance_count"] or 0),
                location_summary=r["location_summary"],
            )
            for r in callsign_rows
        ],
    )


@router.get(
    "/{slug}/history",
    response_model=list[ClubDetection],
    summary="Per-entry detection history for one club.",
)
def club_history(
    slug: Annotated[str, Path(min_length=1, max_length=256)],
    db: sqlite3.Connection = Depends(get_db),
) -> list[ClubDetection]:
    """Return every ``club_detections`` row for the slug, in time order.

    Sorting by ``year`` then ``callsign`` gives the frontend a stable
    "first this club appeared here, then there" narrative. We do not 404
    on an empty result — a freshly-detected club can have a ``clubs`` row
    with no detections if the detection table is mid-rebuild — instead
    callers get an empty list and decide how to render that.
    """
    s = _validate_slug(slug)

    rows = db.execute(
        """
        SELECT year, edition, callsign, city, state, raw_name
        FROM   club_detections
        WHERE  slug = ?
        ORDER  BY year ASC, callsign ASC, edition ASC
        """,
        (s,),
    ).fetchall()

    return [
        ClubDetection(
            year=r["year"],
            edition=r["edition"],
            callsign=r["callsign"],
            city=r["city"],
            state=r["state"],
            raw_name=r["raw_name"],
        )
        for r in rows
    ]


@router.get(
    "/{slug}/callsigns",
    response_model=list[ClubCallsign],
    summary="Roster of callsigns associated with one club.",
)
def club_callsigns(
    slug: Annotated[str, Path(min_length=1, max_length=256)],
    db: sqlite3.Connection = Depends(get_db),
) -> list[ClubCallsign]:
    """Same payload as the nested roster in ``/api/club/{slug}`` but as a
    standalone endpoint so the frontend can lazy-load the roster without
    re-fetching the headline ``clubs`` row.
    """
    s = _validate_slug(slug)

    rows = db.execute(
        """
        SELECT callsign, first_year, last_year,
               appearance_count, location_summary
        FROM   club_callsigns
        WHERE  slug = ?
        ORDER  BY first_year ASC, callsign ASC
        """,
        (s,),
    ).fetchall()

    return [
        ClubCallsign(
            callsign=r["callsign"],
            first_year=r["first_year"],
            last_year=r["last_year"],
            appearance_count=int(r["appearance_count"] or 0),
            location_summary=r["location_summary"],
        )
        for r in rows
    ]


@router.get(
    "/{slug}/related",
    response_model=list[RelatedClub],
    summary="Other clubs in the same state + club_type.",
)
def club_related(
    slug: Annotated[str, Path(min_length=1, max_length=256)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    db: sqlite3.Connection = Depends(get_db),
) -> list[RelatedClub]:
    """Sibling clubs that share both ``dominant_state`` and ``club_type``.

    The intent is "show me other ham radio clubs in California" or "show
    me other university stations in Illinois" — clubs that the original
    one would plausibly have shared a band or a hamfest with.

    Returns an empty list when the source club has no dominant_state or
    no club_type (we do not want to match on NULL = NULL semantics, which
    would surface every other unclassified club in the dataset).
    """
    s = _validate_slug(slug)

    src = db.execute(
        "SELECT dominant_state, club_type FROM clubs WHERE slug = ?",
        (s,),
    ).fetchone()

    if src is None:
        raise HTTPException(status_code=404, detail=f"club not found: {slug}")

    state = src["dominant_state"]
    ctype = src["club_type"]

    if not state or not ctype:
        # Nothing meaningful to compare on — better to return [] than to
        # accidentally join every NULL-state club together.
        return []

    rows = db.execute(
        """
        SELECT slug, display_name,
               callsign_count, appearance_count,
               first_year, last_year,
               dominant_state, dominant_city, club_type
        FROM   clubs
        WHERE  dominant_state = ?
          AND  club_type      = ?
          AND  slug          != ?
        ORDER  BY appearance_count DESC, callsign_count DESC, slug ASC
        LIMIT  ?
        """,
        (state, ctype, s, limit),
    ).fetchall()

    return [
        RelatedClub(
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
        for r in rows
    ]
