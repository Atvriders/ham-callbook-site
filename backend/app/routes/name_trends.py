"""Name Trends + YL Index endpoints (Feature #14).

All responses are served from the in-memory ``name_trends.CACHE``.
No DB hits occur at request time.

Endpoints
---------

GET /api/name-trends/voyager/{name}
    Per-edition-year counts for a single first name.
    Returns {name, years: {year_str: count}, total, first_year, last_year}.

GET /api/name-trends/search?q=<prefix>&limit=<n>
    Autocomplete: names starting with the prefix.

GET /api/name-trends/compare?names=Elmer,Mildred,Patricia
    Voyager data for multiple names in one request (max 10).

GET /api/name-trends/top-by-era
    Top-10 names per decade from 1920s through 1990s.

GET /api/name-trends/yl-index
    Full YL index (women-operator share per state per decade).
    Optional query params: ?state=CA, ?decade=1970s

GET /api/name-trends/yl-index/{state}
    YL index for a single US state.

GET /api/name-trends/stats
    Artifact metadata and load diagnostics.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.integrations import name_trends

router = APIRouter(prefix="/api/name-trends", tags=["name-trends"])

# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _name_envelope(name: str, year_map: dict[str, int]) -> dict[str, Any]:
    """Build a standard voyager response envelope for a single name."""
    if not year_map:
        return {"name": name, "years": {}, "total": 0, "first_year": None, "last_year": None}
    years_sorted = sorted(year_map.keys())
    return {
        "name": name,
        "years": year_map,
        "total": sum(year_map.values()),
        "first_year": int(years_sorted[0]) if years_sorted else None,
        "last_year": int(years_sorted[-1]) if years_sorted else None,
    }


# --------------------------------------------------------------------------- #
# Voyager endpoints                                                            #
# --------------------------------------------------------------------------- #


@router.get("/voyager/{name}")
def voyager_get(name: str) -> dict[str, Any]:
    """Per-edition-year counts for a first name."""
    year_map = name_trends.voyager_lookup(name)
    if year_map is None:
        raise HTTPException(
            status_code=404,
            detail=f"First name '{name}' not found in the archive name index. "
            "Names with fewer than 10 total appearances are excluded.",
        )
    return _name_envelope(name.title(), year_map)


@router.get("/search")
def voyager_search(
    q: str = Query(..., min_length=1, max_length=50, description="Name prefix"),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Autocomplete: names starting with the given prefix."""
    matches = name_trends.voyager_search(q, limit=limit)
    return {"q": q, "count": len(matches), "names": matches}


@router.get("/compare")
def voyager_compare(
    names: str = Query(
        ...,
        description="Comma-separated list of first names (max 10)",
    )
) -> dict[str, Any]:
    """Return voyager data for multiple names for side-by-side comparison."""
    name_list = [n.strip() for n in names.split(",") if n.strip()][:10]
    if not name_list:
        raise HTTPException(status_code=400, detail="Provide at least one name.")
    data = name_trends.voyager_compare(name_list)
    result: dict[str, Any] = {}
    for name in name_list:
        year_map = data.get(name) or data.get(name.title())
        canonical = name.title()
        if year_map:
            result[canonical] = _name_envelope(canonical, year_map)
        else:
            result[canonical] = {
                "name": canonical,
                "years": {},
                "total": 0,
                "first_year": None,
                "last_year": None,
                "not_found": True,
            }
    return {"names": name_list, "data": result}


# --------------------------------------------------------------------------- #
# Era top-names                                                               #
# --------------------------------------------------------------------------- #


@router.get("/top-by-era")
def top_by_era() -> dict[str, Any]:
    """Top-10 first names per decade."""
    return {
        "top_names_by_era": name_trends.top_names_by_era(),
        "archive_years": name_trends.archive_years(),
    }


# --------------------------------------------------------------------------- #
# YL index endpoints                                                          #
# --------------------------------------------------------------------------- #


@router.get("/yl-index")
def yl_index_all(
    state: str | None = Query(None, min_length=2, max_length=2, description="Two-letter US state code"),
    decade: str | None = Query(None, description="Decade label e.g. '1970s'"),
) -> dict[str, Any]:
    """Full YL (women-operator) index, optionally filtered by state and/or decade."""
    s = name_trends.stats()
    if s.get("yl_degraded"):
        return {
            "yl_degraded": True,
            "yl_degraded_reason": s.get("yl_degraded_reason"),
            "yl_index": None,
        }
    data = name_trends.yl_index(
        state=state.upper() if state else None,
        decade=decade,
    )
    return {
        "yl_degraded": False,
        "yl_degraded_reason": None,
        "filter_state": state.upper() if state else None,
        "filter_decade": decade,
        "yl_index": data,
        "methodology": (
            "Women-operator share estimated by matching extracted first names to "
            "SSA baby-names gender probability (p_female = F_births / total_births "
            "1880-1980). Wilson-score 95% CI. Names not in SSA data are excluded "
            "from the denominator and counted as 'unclassifiable_n'. Interpret as "
            "a lower-bound estimate; many YL operators used initials and are "
            "unclassifiable."
        ),
    }


@router.get("/yl-index/{state}")
def yl_index_state(state: str) -> dict[str, Any]:
    """YL index for a single US state across all decades."""
    st = state.upper()
    s = name_trends.stats()
    if s.get("yl_degraded"):
        return {
            "state": st,
            "yl_degraded": True,
            "yl_degraded_reason": s.get("yl_degraded_reason"),
            "decades": None,
        }
    data = name_trends.yl_index(state=st)
    if not data or st not in data:
        raise HTTPException(
            status_code=404,
            detail=f"No YL index data for state '{st}'. "
            "Only US states with sufficient data are included.",
        )
    return {
        "state": st,
        "yl_degraded": False,
        "decades": data[st],
        "methodology": (
            "share = weighted mean p_female per operator entry. "
            "Wilson-score 95% CI. Excludes unclassifiable (initials-only, "
            "single-token, OCR-noise) names."
        ),
    }


# --------------------------------------------------------------------------- #
# Stats / health                                                              #
# --------------------------------------------------------------------------- #


@router.get("/stats")
def artifact_stats() -> dict[str, Any]:
    """Artifact metadata and load diagnostics."""
    return name_trends.stats()
