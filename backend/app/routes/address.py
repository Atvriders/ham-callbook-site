"""Address Time Machine endpoints.

All data served from in-memory artifact caches; no DB hits.

Routes
------
GET /api/address/search?q=&city=&state=&limit=
    Normalize q, fuzzy-match against cluster keys, return matching
    clusters with their occupant timeline.

GET /api/address/cluster/{cluster_key}
    Exact cluster lookup (cluster_key is pipe-delimited, URL-encoded).
    Also returns any household groupings at that address.

GET /api/address/callsign/{cs}
    All clusters a given callsign appears in (for callsign-page cross-links).

GET /api/households
    Paginated household browse. Optional ?state=IL&limit=50&offset=0

GET /api/households/{cluster_key}/{surname}
    Single household detail.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query

from app.integrations import address_index

router = APIRouter(prefix="/api/address", tags=["address"])
hh_router = APIRouter(prefix="/api/households", tags=["households"])


# --------------------------------------------------------------------------- #
# Address routes                                                               #
# --------------------------------------------------------------------------- #


@router.get("/search")
def address_search(
    q: str = Query(..., min_length=3, description="Raw street address to search"),
    city: str | None = Query(None),
    state: str | None = Query(None, min_length=2, max_length=2),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Search address clusters by raw address string.

    The query is normalized server-side using the same rules that built the
    artifact (street-type expansion, directionals, ordinal stripping, apt noise
    removal). Returns matching multi-occupant clusters with their full
    occupant timeline.
    """
    norm_q = address_index.normalize_address(q)
    clusters = address_index.search_address(q=q, city=city, state=state, limit=limit)

    return {
        "query": q,
        "normalized_query": norm_q,
        "city_filter": city,
        "state_filter": state,
        "total": len(clusters),
        "clusters": clusters,
    }


@router.get("/cluster/{cluster_key:path}")
def address_cluster(cluster_key: str) -> dict[str, Any]:
    """Return a single address cluster by key (URL-encoded pipe-delimited key).

    Also attaches any household groupings detected at this address.
    """
    key = unquote(cluster_key)
    cluster = address_index.get_cluster(key)
    if cluster is None:
        raise HTTPException(status_code=404, detail=f"Cluster not found: {key!r}")

    households = address_index.households_for_cluster(key)
    return {**cluster, "households": households}


@router.get("/callsign/{cs}")
def address_for_callsign(cs: str) -> dict[str, Any]:
    """All address clusters a callsign appears in.

    Used to add 'neighbors at this address' cross-links on callsign pages.
    """
    clusters = address_index.clusters_for_callsign(cs.upper())
    return {
        "callsign": cs.upper(),
        "cluster_count": len(clusters),
        "clusters": clusters,
    }


# --------------------------------------------------------------------------- #
# Households routes                                                            #
# --------------------------------------------------------------------------- #


@hh_router.get("")
def households_browse(
    state: str | None = Query(None, min_length=2, max_length=2),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Browse household clusters, optionally filtered by state abbreviation."""
    rows, total = address_index.get_households(state=state, limit=limit, offset=offset)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "state_filter": state,
        "households": rows,
    }


@hh_router.get("/{cluster_key:path}/{surname}")
def household_detail(cluster_key: str, surname: str) -> dict[str, Any]:
    """Single household lookup by cluster_key and surname."""
    key = unquote(cluster_key)
    hh = address_index.get_household(key, surname)
    if hh is None:
        raise HTTPException(
            status_code=404,
            detail=f"Household not found for cluster={key!r} surname={surname!r}",
        )
    cluster = address_index.get_cluster(key)
    return {**hh, "cluster": cluster}
