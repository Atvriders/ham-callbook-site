"""Cohort Observatory endpoints (Feature #11).

All responses are served from the in-memory ``cohorts.CACHE``.
No DB hits occur at request time.

Endpoints
---------

GET /api/cohorts
    List available cohort keys with metadata (years, classes, sizes).
    Optional filters: ?entry_class=N&first_year=1980

GET /api/cohorts/{key}
    Full cohort object for a specific key (e.g. "1980|N|ALL").
    Includes km_curve, km_summary, class_ladder, caveats.

GET /api/cohorts/compare
    Side-by-side data for two cohorts.
    Query params: ?a=1980|N|ALL&b=1970|N|ALL

GET /api/cohorts/meta
    Artifact metadata: generated timestamp, dataset_version, archive_years.

GET /api/cohorts/available
    Available years and classes for the cohort picker UI.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.integrations import cohorts

router = APIRouter(prefix="/api/cohorts", tags=["cohorts"])


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _not_found(key: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"Cohort '{key}' not found. Use GET /api/cohorts to list available cohorts.",
    )


def _cohort_summary(key: str, cohort: dict[str, Any]) -> dict[str, Any]:
    """Slim summary used in list responses (omit km_curve to keep payload small)."""
    return {
        "cohort_key": key,
        "first_year": cohort.get("first_year"),
        "entry_class": cohort.get("entry_class"),
        "entry_class_name": cohort.get("entry_class_name"),
        "state": cohort.get("state"),
        "cohort_size": cohort.get("cohort_size"),
        "uls_still_active": cohort.get("uls_still_active"),
        "km_summary": cohort.get("km_summary"),
        "caveats": cohort.get("caveats", []),
    }


# --------------------------------------------------------------------------- #
# Routes                                                                      #
# --------------------------------------------------------------------------- #


@router.get("/meta")
def cohorts_meta() -> dict[str, Any]:
    """Return artifact metadata: timestamps, archive_years, print_horizon."""
    s = cohorts.stats()
    return {
        "generated": s.get("generated"),
        "dataset_version": s.get("dataset_version"),
        "print_horizon": s.get("print_horizon"),
        "today_year": s.get("today_year"),
        "cohort_count": s.get("cohort_count"),
        "archive_years": cohorts.get_archive_years(),
        "loaded": s.get("loaded"),
        "load_duration_s": s.get("load_duration_s"),
    }


@router.get("/available")
def cohorts_available() -> dict[str, Any]:
    """Return available years and classes for the picker UI."""
    return {
        "years": cohorts.available_years(),
        "classes": cohorts.available_classes(),
        "print_horizon": cohorts.CACHE.get_print_horizon(),
    }


@router.get("/compare")
def cohorts_compare(
    a: str = Query(..., description="First cohort key, e.g. 1980|N|ALL"),
    b: str = Query(..., description="Second cohort key, e.g. 1970|N|ALL"),
) -> dict[str, Any]:
    """Return two full cohort objects side by side for comparison."""
    cohort_a = cohorts.get_cohort(a)
    if cohort_a is None:
        raise _not_found(a)
    cohort_b = cohorts.get_cohort(b)
    if cohort_b is None:
        raise _not_found(b)
    return {
        "a": cohort_a,
        "b": cohort_b,
        "print_horizon": cohorts.CACHE.get_print_horizon(),
        "today_year": cohorts.CACHE.get_today_year(),
    }


@router.get("")
def list_cohorts(
    entry_class: str | None = Query(None, description="Filter by entry class: N, G, A, E"),
    first_year: int | None = Query(None, description="Filter by first licensed year"),
    state: str | None = Query(None, description="Filter by state (2-char) or ALL"),
) -> dict[str, Any]:
    """List available cohorts with slim summaries (no km_curve)."""
    keys = cohorts.list_cohort_keys(
        entry_class=entry_class,
        state=state,
        first_year=first_year,
    )
    items: list[dict[str, Any]] = []
    for k in keys:
        cohort = cohorts.get_cohort(k)
        if cohort is not None:
            items.append(_cohort_summary(k, cohort))
    return {
        "count": len(items),
        "cohorts": items,
        "print_horizon": cohorts.CACHE.get_print_horizon(),
    }


@router.get("/{key:path}")
def get_cohort(key: str) -> dict[str, Any]:
    """Return a full cohort object including km_curve and class_ladder."""
    # Normalise URL-encoded pipes (%7C) that browsers may send
    normalised_key = key.replace("%7C", "|").replace("%7c", "|")
    cohort = cohorts.get_cohort(normalised_key)
    if cohort is None:
        raise _not_found(normalised_key)
    result: dict[str, Any] = dict(cohort)
    result["print_horizon"] = cohorts.CACHE.get_print_horizon()
    result["today_year"] = cohorts.CACHE.get_today_year()
    return result
