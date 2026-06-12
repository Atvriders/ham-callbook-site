"""Records / Century Club leaderboard endpoints.

All responses are served from the in-memory ``leaderboards.CACHE``.
No DB hits occur at request time.

Endpoints
---------

GET /api/records/categories
    List of category names with metadata (label, description, sort_field,
    link_type).

GET /api/records/{category}
    Top-100 rows for a category. Optional query params:
      ?state=PA   — filter to rows whose ``state`` field matches (2-char)
      ?district=3 — filter to rows whose callsign district matches

GET /api/records/{category}/{rank}
    Single row by (category, rank) — used for shareable deep-links.

GET /api/records/meta
    Generated timestamp and dataset_version from the artifact.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.integrations import leaderboards
from app.integrations.leaderboards import CATEGORY_META

router = APIRouter(prefix="/api/records", tags=["records"])


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _not_found_cat(name: str) -> HTTPException:
    known = list(CATEGORY_META.keys())
    return HTTPException(
        status_code=404,
        detail=f"Unknown category '{name}'. Known: {known}",
    )


# --------------------------------------------------------------------------- #
# Routes                                                                      #
# --------------------------------------------------------------------------- #


@router.get("/categories")
def list_categories() -> list[dict[str, Any]]:
    """Return all category names with their label, description, and sort_field."""
    return [
        {"name": name, **meta}
        for name, meta in CATEGORY_META.items()
    ]


@router.get("/meta")
def get_meta() -> dict[str, Any]:
    """Artifact provenance: generated timestamp + dataset_version."""
    s = leaderboards.stats()
    return {
        "generated": s.get("generated"),
        "dataset_version": s.get("dataset_version"),
        "loaded": s.get("loaded"),
        "total_rows": s.get("total_rows"),
    }


@router.get("/{category}")
def get_category(
    category: str,
    state: str | None = Query(default=None, max_length=2, description="Filter by 2-char state code"),
    district: str | None = Query(default=None, max_length=1, description="Filter by callsign district digit"),
) -> list[dict[str, Any]]:
    """Top-100 rows for a leaderboard category with optional facets."""
    if category not in CATEGORY_META:
        raise _not_found_cat(category)
    rows = leaderboards.get_category(category, state=state, district=district)
    return rows


@router.get("/{category}/{rank}")
def get_single(category: str, rank: int) -> dict[str, Any]:
    """Single leaderboard row by category + rank (1-indexed)."""
    if category not in CATEGORY_META:
        raise _not_found_cat(category)
    rows = leaderboards.get_category(category)
    # rank is 1-based; find the row with matching rank field
    for row in rows:
        if row.get("rank") == rank:
            meta = CATEGORY_META[category]
            return {"category": category, "category_label": meta["label"], **row}
    raise HTTPException(status_code=404, detail=f"Rank {rank} not found in category '{category}'")
