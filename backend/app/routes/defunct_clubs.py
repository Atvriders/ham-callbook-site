"""Defunct Clubs route — endpoints for the Silent Key club finder.

Serves pre-computed results from ``app.integrations.defunct_clubs`` (the
``data/defunct_clubs.json`` artifact).  All endpoints return 200 with an
empty payload when the artifact is absent — they never 500.

Endpoints
---------

GET /api/clubs/defunct/meta
    Artifact metadata: total count, gap_years, generated timestamp.
    Must be registered before /api/clubs/defunct/{slug} so FastAPI does
    not misinterpret "meta" as a slug.

GET /api/clubs/defunct
    Paginated, filterable list of defunct clubs ranked by appearance_count.
    Query params: state (2-char), era (pre_war|mid_century|
    incentive_licensing|post_boom), limit (1-200, default 50), offset.
    Response includes per-filter facet counts.

GET /api/clubs/defunct/{slug}
    Evidence card for a single defunct club including per-callsign fates
    and years_silent.  Falls back gracefully when slug not in artifact.

All data is served from the in-memory cache — no DB hits at request time.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.integrations import defunct_clubs as _dc

# --------------------------------------------------------------------------- #
# Pydantic response models                                                     #
# --------------------------------------------------------------------------- #

_CORPUS_END = 1997
_CURRENT_YEAR = 2026


class CallsignFate(BaseModel):
    callsign: str
    fate: str = Field(
        ...,
        description=(
            "dead_missing | dead_expired | dead_cancelled | reissued_individual"
        ),
    )
    uls_status: str | None = Field(
        None, description="Raw FCC ULS status code, null when absent from ULS."
    )


class DefunctClubSummary(BaseModel):
    slug: str
    display_name: str
    first_year: int | None
    last_year: int | None
    span_years: int
    appearance_count: int
    callsign_count: int
    dominant_state: str | None
    dominant_city: str | None
    club_type: str | None
    era_class: str


class DefunctFacets(BaseModel):
    by_state: dict[str, int] = Field(
        default_factory=dict,
        description="State abbreviation -> count of clubs in current filter view.",
    )
    by_era: dict[str, int] = Field(
        default_factory=dict,
        description="era_class -> count of clubs in current filter view.",
    )


class DefunctClubList(BaseModel):
    total: int
    clubs: list[DefunctClubSummary]
    facets: DefunctFacets


class DefunctClubDetail(DefunctClubSummary):
    callsign_fates: list[CallsignFate]
    years_silent: int = Field(
        ...,
        description=(
            "Years since last corpus appearance, measured from corpus end (1997) "
            "to the current year."
        ),
    )


class DefunctMeta(BaseModel):
    total: int
    gap_years: int | None
    min_appearances: int | None
    min_span: int | None
    generated: str | None
    dataset_version: str | None


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #

_ERA_VALUES = frozenset(
    ["pre_war", "mid_century", "incentive_licensing", "post_boom"]
)


def _to_summary(rec: dict[str, Any]) -> DefunctClubSummary:
    last_year: int | None = rec.get("last_year")
    first_year: int | None = rec.get("first_year")
    return DefunctClubSummary(
        slug=rec.get("slug") or "",
        display_name=rec.get("display_name") or "",
        first_year=first_year,
        last_year=last_year,
        span_years=int(rec.get("span_years") or 0),
        appearance_count=int(rec.get("appearance_count") or 0),
        callsign_count=int(rec.get("callsign_count") or 0),
        dominant_state=rec.get("dominant_state"),
        dominant_city=rec.get("dominant_city"),
        club_type=rec.get("club_type"),
        era_class=rec.get("era_class") or "post_boom",
    )


def _years_silent(last_year: int | None) -> int:
    if last_year is None:
        return 0
    gap_from_corpus = _CORPUS_END - last_year
    total = gap_from_corpus + (_CURRENT_YEAR - _CORPUS_END)
    return max(total, 0)


# --------------------------------------------------------------------------- #
# Router                                                                       #
# --------------------------------------------------------------------------- #

# Prefix matches the existing /api/clubs namespace; "defunct" sub-path keeps
# all defunct endpoints co-located and avoids collisions with clubs.py routes
# (/search, /by-letter, /notable, /types) and club.py (/api/club/{slug}).
router = APIRouter(prefix="/api/clubs/defunct", tags=["clubs-defunct"])


@router.get(
    "/meta",
    response_model=DefunctMeta,
    summary="Artifact metadata — total count, gap threshold, build timestamp.",
)
def defunct_meta() -> DefunctMeta:
    """Return top-level metadata from the defunct-clubs artifact.

    Safe to call even when the artifact is absent — returns zeros/nulls.
    Registered before ``/{slug}`` so FastAPI routes 'meta' here, not to
    the slug handler.
    """
    m = _dc.meta()
    return DefunctMeta(
        total=int(m.get("total") or 0),
        gap_years=m.get("gap_years"),
        min_appearances=m.get("min_appearances"),
        min_span=m.get("min_span"),
        generated=m.get("generated"),
        dataset_version=m.get("dataset_version"),
    )


@router.get(
    "",
    response_model=DefunctClubList,
    summary="Paginated defunct-club list with state/era facets.",
)
def list_defunct_clubs(
    state: Annotated[
        str | None,
        Query(min_length=2, max_length=2, description="Two-letter US state code."),
    ] = None,
    era: Annotated[
        str | None,
        Query(
            description=(
                "pre_war | mid_century | incentive_licensing | post_boom"
            )
        ),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=500_000)] = 0,
) -> DefunctClubList:
    """List defunct clubs, optionally filtered by state and/or era.

    Results are ordered by ``appearance_count`` DESC (most historically
    documented first) — the artifact is pre-sorted so this is a simple
    slice.  Returns 200 with an empty list when the artifact is absent.
    """
    # Validate era if supplied
    if era and era not in _ERA_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"era must be one of: {', '.join(sorted(_ERA_VALUES))}",
        )

    state_upper = state.upper() if state else None

    page, facet_state, facet_era = _dc.get_list(
        state=state_upper,
        era=era,
        limit=limit,
        offset=offset,
    )

    # Total is the unsliced candidate count; re-derive from facets when
    # a filter is active, otherwise use the global total from meta.
    if state_upper or era:
        total = sum(facet_era.values())
    else:
        total = int(_dc.meta().get("total") or 0)

    return DefunctClubList(
        total=total,
        clubs=[_to_summary(r) for r in page],
        facets=DefunctFacets(by_state=facet_state, by_era=facet_era),
    )


@router.get(
    "/{slug}",
    response_model=DefunctClubDetail,
    summary="Evidence card for a single defunct club.",
)
def get_defunct_club(slug: str) -> DefunctClubDetail:
    """Return the full evidence record for a defunct club by slug.

    Includes per-callsign fate classifications and the computed
    ``years_silent`` span.  Returns 404 when the slug is not in the
    defunct artifact (the club may still exist in the main /api/club/
    endpoint if it did not meet the defunct criteria).
    """
    rec = _dc.get_by_slug(slug)
    if rec is None:
        raise HTTPException(
            status_code=404,
            detail=f"Slug '{slug}' not found in defunct-clubs artifact.",
        )

    summary = _to_summary(rec)

    raw_fates: list[dict[str, Any]] = rec.get("callsign_fates") or []
    fates = [
        CallsignFate(
            callsign=f.get("callsign") or "",
            fate=f.get("fate") or "dead_missing",
            uls_status=f.get("uls_status"),
        )
        for f in raw_fates
    ]

    return DefunctClubDetail(
        **summary.model_dump(),
        callsign_fates=fates,
        years_silent=_years_silent(summary.last_year),
    )
