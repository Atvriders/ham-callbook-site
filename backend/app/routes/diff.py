"""Edition Diff route — explore callsign churn between consecutive editions.

Endpoints
---------

GET /api/diff/pairs
    List all pre-computed consecutive-edition pairs with headline counts.
    Response: list of pair objects (year_a, year_b, adds, drops, retained, …)

GET /api/diff/pair/{year_a}/{year_b}
    Full detail for a single pair including samples.

GET /api/diff/timeline
    Condensed list of (year_b, adds, drops, retained, net, retention_pct) for
    charting — no samples included.

GET /api/diff/wwii
    WWII special cohort summary (silent / returned / postwar_new counts).

GET /api/diff/meta
    generated timestamp + dataset_version.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.integrations import edition_diff as ed

router = APIRouter(prefix="/api/diff", tags=["diff"])


def _pair_or_404(year_a: int, year_b: int) -> dict[str, Any]:
    pair = ed.get_pair(year_a, year_b)
    if pair is None:
        raise HTTPException(
            status_code=404,
            detail=f"No diff pair found for {year_a} -> {year_b}. "
                   "Check /api/diff/pairs for valid combinations.",
        )
    return pair


@router.get("/pairs")
def list_pairs() -> list[dict[str, Any]]:
    """All consecutive edition pairs with headline counts (no sample arrays)."""
    pairs = ed.get_pairs()
    # Strip sample arrays for the list endpoint — keep them for the detail view
    trimmed = []
    for p in pairs:
        row = {k: v for k, v in p.items() if not k.endswith("_samples")}
        trimmed.append(row)
    return trimmed


@router.get("/timeline")
def timeline() -> list[dict[str, Any]]:
    """Condensed series suitable for charting (year_b, counts only, no samples)."""
    pairs = ed.get_pairs()
    return [
        {
            "year_a": p.get("year_a"),
            "year_b": p.get("year_b"),
            "edition_a": p.get("edition_a"),
            "edition_b": p.get("edition_b"),
            "total_a": p.get("total_a"),
            "total_b": p.get("total_b"),
            "adds": p.get("adds"),
            "drops": p.get("drops"),
            "retained": p.get("retained"),
            "net": p.get("net"),
            "retention_pct": p.get("retention_pct"),
            "address_changes": p.get("address_changes"),
            "class_upgrades": p.get("class_upgrades"),
        }
        for p in pairs
    ]


@router.get("/pair/{year_a}/{year_b}")
def get_pair(year_a: int, year_b: int) -> dict[str, Any]:
    """Full detail for a specific consecutive pair, including sample callsigns."""
    return _pair_or_404(year_a, year_b)


@router.get("/wwii")
def wwii_cohort() -> dict[str, Any]:
    """WWII special cohort: 1941 Spring vs 1946 Fall."""
    cohort = ed.get_wwii_cohort()
    if cohort is None:
        raise HTTPException(status_code=503, detail="Edition diff artifact not loaded.")
    return cohort


@router.get("/meta")
def diff_meta() -> dict[str, Any]:
    """Generated timestamp and dataset version for this artifact."""
    m = ed.meta()
    if not m:
        raise HTTPException(status_code=503, detail="Edition diff artifact not loaded.")
    return m
