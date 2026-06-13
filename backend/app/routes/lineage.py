"""Printed Lineage route — KN→K / WN→W Novice upgrade evidence endpoint.

Endpoint
--------

GET /api/lineage/{cs}
    Returns the printed-lineage link for a callsign, whether that callsign
    is the Novice call (KN/WN/WV prefix) or the upgrade target (K/W).
    Responds 200 with ``found=False`` when no link exists; never 404 so
    callers can safely fire-and-forget without a try/catch.

All data is served from the in-memory ``printed_lineage`` cache — no DB
hits at request time.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Path as PathParam
from pydantic import BaseModel

from app.integrations import printed_lineage as _pl

router = APIRouter(prefix="/api/lineage", tags=["lineage"])

_CS_RE = re.compile(r"^[A-Z0-9/]{3,12}$")


def _normalize(cs: str) -> str:
    return (cs or "").strip().upper()


# --------------------------------------------------------------------------- #
# Pydantic models                                                              #
# --------------------------------------------------------------------------- #


class PrintedLineageLink(BaseModel):
    novice_call: str
    upgrade_call: str
    prefix_type: str
    """'KN', 'WN', or 'WV'."""
    novice_first_year: int
    novice_last_year: int
    upgrade_first_year: int
    score: int
    confidence: str
    """'high' (score ≥ 3) or 'medium' (score = 2)."""
    match_basis: list[str]
    uls_confirmed: bool
    label: str
    """Human-readable evidence sentence, e.g. 'Likely upgraded to K4ABC, ~1963'."""


class PrintedLineageResponse(BaseModel):
    callsign: str
    found: bool
    role: str | None = None
    """'novice' when *callsign* is the KN/WN call; 'upgrade' when it is the K/W target."""
    link: PrintedLineageLink | None = None


# --------------------------------------------------------------------------- #
# Endpoint                                                                     #
# --------------------------------------------------------------------------- #


@router.get(
    "/{cs}",
    response_model=PrintedLineageResponse,
    summary="Novice upgrade lineage for a callsign",
    description=(
        "Look up the KN→K (or WN→W) printed-era lineage link for a callsign. "
        "Returns `found=true` and the evidence `link` when a high- or medium-"
        "confidence link exists. Works for both the Novice call (role='novice') "
        "and the upgraded call (role='upgrade'). Never returns 404."
    ),
)
def get_lineage(
    cs: str = PathParam(
        ...,
        min_length=3,
        max_length=12,
        description="Callsign to look up (case-insensitive).",
    ),
) -> PrintedLineageResponse:
    callsign = _normalize(cs)

    # Check as Novice source (KN/WN/WV prefix)
    raw = _pl.get_novice(callsign)
    if raw:
        return PrintedLineageResponse(
            callsign=callsign,
            found=True,
            role="novice",
            link=PrintedLineageLink(**raw),
        )

    # Check as upgrade target (K/W — look up via reverse index)
    raw = _pl.get_upgrade_source(callsign)
    if raw:
        return PrintedLineageResponse(
            callsign=callsign,
            found=True,
            role="upgrade",
            link=PrintedLineageLink(**raw),
        )

    return PrintedLineageResponse(callsign=callsign, found=False, role=None)
