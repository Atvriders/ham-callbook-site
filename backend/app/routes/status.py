"""Callsign current-status API (single + bulk) backed by the ULS snapshot.

Endpoints (mounted by ``app.main``; Caddy/Next forward ``/api`` verbatim)
-------------------------------------------------------------------------
GET /api/status/{cs}   -> CallsignStatus (ULS record + archive roll-up + verdict)
GET /api/status/bulk   -> BulkStatuses  (?calls=CS1,CS2,... up to 60)

The single-callsign endpoint combines two O(1)-ish sources:

* the in-memory FCC ULS snapshot (``fcc_uls.lookup`` — a dict get over
  ~1.59M callsigns), and
* one indexed aggregate over ``entries`` (``idx_entries_callsign`` keeps
  MIN/MAX/COUNT to O(rows-per-callsign), in practice 1-99 rows).

The bulk endpoint is ULS-only by design (no DB work): it exists so the
search page can decorate a page of hits in a single round-trip. Calls
absent from the snapshot are reported as ``historical-only`` — the
archive corpus is where a search hit came from in the first place.

Verdict semantics (shared with the frontend StatusChip):
    active          ULS status 'A'
    expired         ULS status 'E'
    cancelled       ULS status 'C'/'T' (and other terminal codes)
    historical-only not in ULS at all, but present in the printed archive
A callsign in neither source 404s (single endpoint only).
"""

from __future__ import annotations

import re
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Query
from pydantic import BaseModel, Field

from app.db import get_db
from app.integrations import fcc_uls

router = APIRouter(prefix="/api/status", tags=["status"])


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

# Same shape the callsign routes accept — uppercase alphanumerics plus '/'
# for portable suffixes. Anything else 404s early without touching the DB.
CALLSIGN_RE = re.compile(r"^[A-Z0-9/]{3,12}$")


class UlsStatus(BaseModel):
    found: bool
    status: Optional[str] = Field(None, description="Raw FCC status code (A/E/C/T/...).")
    status_label: Optional[str] = Field(None, description="Human-readable status.")
    grant_date: Optional[str] = Field(None, description="License grant date (ISO).")
    name: Optional[str] = Field(None, description="Licensee / entity name from ULS.")


class ArchiveStatus(BaseModel):
    first_year: Optional[int] = None
    last_year: Optional[int] = None
    appearances: int = 0


class CallsignStatus(BaseModel):
    callsign: str
    uls: UlsStatus
    archive: ArchiveStatus
    verdict: str = Field(
        ..., description='"active" | "expired" | "cancelled" | "historical-only"'
    )


class BulkStatusItem(BaseModel):
    status: Optional[str] = None
    status_label: Optional[str] = None
    verdict: str


class BulkStatuses(BaseModel):
    statuses: dict[str, BulkStatusItem]


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _normalize_callsign(cs: str) -> str:
    return cs.strip().upper()


def _uls_verdict(status: Optional[str]) -> Optional[str]:
    """Map a raw ULS status code to a verdict, or ``None`` when the code is
    absent/unrecognized (caller falls back to the archive)."""
    if not status:
        return None
    if status == "A":
        return "active"
    if status == "E":
        return "expired"
    # C = Cancelled, T/X = Terminated, R = Revoked, S = Suspended — all
    # terminal, all rendered the same way by the UI.
    return "cancelled"


def _archive_rollup(conn: sqlite3.Connection, cs: str) -> ArchiveStatus:
    """One indexed aggregate over ``entries`` for first/last year + count."""
    row = conn.execute(
        """
        SELECT MIN(year) AS first_year,
               MAX(year) AS last_year,
               COUNT(*)  AS appearances
        FROM entries
        WHERE callsign = ?
        """,
        (cs,),
    ).fetchone()
    appearances = int(row["appearances"]) if row is not None else 0
    if appearances == 0:
        return ArchiveStatus(first_year=None, last_year=None, appearances=0)
    return ArchiveStatus(
        first_year=int(row["first_year"]) if row["first_year"] is not None else None,
        last_year=int(row["last_year"]) if row["last_year"] is not None else None,
        appearances=appearances,
    )


# --------------------------------------------------------------------------- #
# Routes — /bulk MUST be declared before /{cs} so it isn't captured as a
# callsign path parameter (FastAPI matches in declaration order).
# --------------------------------------------------------------------------- #


@router.get("/bulk", response_model=BulkStatuses)
def bulk_status(
    calls: str = Query(
        ...,
        min_length=1,
        max_length=1024,
        description="Comma-separated callsigns, up to 60.",
    ),
) -> BulkStatuses:
    """ULS status for up to 60 callsigns in one round-trip.

    Pure in-memory dict lookups — no DB access. Calls absent from the ULS
    snapshot (junk included) map to a ``historical-only`` verdict with null
    status, per the frontend contract.
    """
    seen: set[str] = set()
    normalized: list[str] = []
    for token in calls.split(","):
        cs = _normalize_callsign(token)
        if not cs or cs in seen:
            continue
        seen.add(cs)
        normalized.append(cs)

    if not normalized:
        raise HTTPException(status_code=400, detail="no callsigns supplied")
    if len(normalized) > 60:
        raise HTTPException(
            status_code=400,
            detail=f"too many callsigns: {len(normalized)} (max 60)",
        )

    statuses: dict[str, BulkStatusItem] = {}
    for cs in normalized:
        rec = fcc_uls.lookup(cs)
        if rec is None:
            statuses[cs] = BulkStatusItem(
                status=None, status_label=None, verdict="historical-only"
            )
            continue
        statuses[cs] = BulkStatusItem(
            status=rec.status,
            status_label=rec.status_label,
            verdict=_uls_verdict(rec.status) or "historical-only",
        )
    return BulkStatuses(statuses=statuses)


@router.get("/{cs}", response_model=CallsignStatus)
def callsign_status(
    cs: str = PathParam(..., min_length=1, max_length=16),
    conn: sqlite3.Connection = Depends(get_db),
) -> CallsignStatus:
    """Current license status + archive footprint for one callsign."""
    callsign = _normalize_callsign(cs)
    if not CALLSIGN_RE.match(callsign):
        raise HTTPException(status_code=404, detail=f"invalid callsign: {cs}")

    rec = fcc_uls.lookup(callsign)
    archive = _archive_rollup(conn, callsign)

    if rec is None and archive.appearances == 0:
        raise HTTPException(
            status_code=404,
            detail=f"callsign not found in ULS or archive: {callsign}",
        )

    if rec is None:
        uls = UlsStatus(found=False)
        verdict = "historical-only"
    else:
        uls = UlsStatus(
            found=True,
            status=rec.status,
            status_label=rec.status_label,
            grant_date=rec.grant_date,
            name=rec.full_name,
        )
        # A found-but-unstatused ULS row (shouldn't happen in the snapshot)
        # falls back to the archive verdict rather than lying about a code.
        verdict = _uls_verdict(rec.status) or (
            "historical-only" if archive.appearances > 0 else "cancelled"
        )

    return CallsignStatus(
        callsign=callsign, uls=uls, archive=archive, verdict=verdict
    )
