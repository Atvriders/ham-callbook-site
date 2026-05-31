"""Callsign -> club lookup route.

Endpoint (mounted under ``/callsign`` by ``app.main``; Caddy adds ``/api``)
--------------------------------------------------------------------------
GET /callsign/{cs}/club -> CallsignClubResult

Given a callsign, tell the caller whether it appears in the club tables.
The club tables are built by ``scripts/build_clubs.py`` and live in the
same SQLite file as ``entries`` (the bind-mounted read-only callbook DB):

    club_callsigns(slug, callsign, first_year, last_year, ...)
    clubs(slug, display_name, club_type, ...)

This endpoint is intentionally cheap: a single index lookup on
``idx_club_callsigns_callsign`` plus a join into ``clubs`` by ``slug``.
A callsign can in principle map to more than one club row across edits;
in that case we return the row spanning the widest year range, which is
almost always the canonical assignment.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Path as PathParam
from pydantic import BaseModel, Field

from app.db import get_db
from app.routes.callsign import normalize_callsign

router = APIRouter(prefix="/api/callsign", tags=["callsign"])


# --------------------------------------------------------------------------- #
# Pydantic models                                                             #
# --------------------------------------------------------------------------- #


class CallsignClubResult(BaseModel):
    is_club: bool
    club_slug: str | None = None
    display_name: str | None = None
    years: list[int] = Field(
        default_factory=list,
        description="Two-element [first_year, last_year] range when is_club is true.",
    )
    club_type: str | None = None


# --------------------------------------------------------------------------- #
# Endpoint                                                                    #
# --------------------------------------------------------------------------- #


def _club_tables_present(db: sqlite3.Connection) -> bool:
    """Return True iff both ``club_callsigns`` and ``clubs`` exist.

    The club tables are built by an offline phase and may not yet be present
    in development or on a freshly-attached DB. When missing we treat every
    callsign as a non-club rather than 500'ing the endpoint.
    """
    cur = db.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name IN ('club_callsigns','clubs')"
    )
    names = {r[0] for r in cur.fetchall()}
    return {"club_callsigns", "clubs"}.issubset(names)


@router.get("/{cs}/club", response_model=CallsignClubResult)
def get_callsign_club(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> CallsignClubResult:
    callsign = normalize_callsign(cs)

    if not _club_tables_present(db):
        return CallsignClubResult(is_club=False)

    # If a callsign appears under multiple slugs (rare), pick the one with the
    # widest year span; ties broken by latest last_year, then by slug for
    # determinism.
    cur = db.execute(
        """
        SELECT cc.slug          AS slug,
               cc.first_year    AS first_year,
               cc.last_year     AS last_year,
               c.display_name   AS display_name,
               c.club_type      AS club_type
        FROM   club_callsigns cc
        JOIN   clubs c ON c.slug = cc.slug
        WHERE  cc.callsign = ?
        ORDER  BY (COALESCE(cc.last_year, 0) - COALESCE(cc.first_year, 0)) DESC,
                  COALESCE(cc.last_year, 0) DESC,
                  cc.slug ASC
        LIMIT  1
        """,
        (callsign,),
    )
    row = cur.fetchone()
    if row is None:
        return CallsignClubResult(is_club=False)

    fy = row["first_year"]
    ly = row["last_year"]
    years: list[int] = []
    if fy is not None and ly is not None:
        years = [fy, ly]
    elif fy is not None:
        years = [fy]
    elif ly is not None:
        years = [ly]

    return CallsignClubResult(
        is_club=True,
        club_slug=row["slug"],
        display_name=row["display_name"],
        years=years,
        club_type=row["club_type"],
    )


__all__ = ["router", "CallsignClubResult"]
