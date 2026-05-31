"""Live "activity" routes.

These endpoints surface present-day information about a callsign that
*isn't* in the historical SQLite corpus: FCC ULS licensee status,
PSK Reporter spots, Reverse Beacon Network spots, and the QRZ.com
public-page snapshot.

The router is mounted at ``/activity`` by :mod:`app.main`, so the public
URLs (after Caddy's ``/api`` prefix) are::

    GET /api/activity/{cs}        -> UnifiedActivitySnapshot
        Aggregates PSK Reporter + RBN + FCC ULS into a single payload,
        picking the most-authoritative source that actually has data.
    GET /api/activity/{cs}/psk    -> psk_reporter.ActivitySnapshot
    GET /api/activity/{cs}/rbn    -> rbn.ActivitySnapshot
    GET /api/activity/{cs}/uls    -> FccUlsRecord | null
    GET /api/activity/{cs}/qrz    -> QRZFound | QRZNotFound
    GET /api/activity/uls/_stats  -> snapshot diagnostics (internal)
    GET /api/activity/rbn/_stats  -> RBN cache diagnostics (internal)
    GET /api/activity/psk/_stats  -> PSK Reporter cache diagnostics (internal)
    GET /api/activity/qrz/_stats  -> QRZ cache diagnostics (internal)

We deliberately return JSON ``null`` (or a ``found=false`` envelope)
rather than 404 when the callsign isn't present in a given source: the
frontend renders the "Live activity" panel even for callsigns with no
current license (typically historic SK records from the 1930s), and a
404 would force it into an error state.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any, Union

from fastapi import APIRouter, HTTPException, Path as PathParam
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.integrations import fcc_uls, psk_reporter, rbn
from app.integrations.fcc_uls import FccUlsRecord
from app.integrations.psk_reporter import ActivitySnapshot as PskSnapshot
from app.integrations.psk_reporter import ActivitySpot as PskSpot
from app.integrations.qrz_public import QRZPublicProfile, fetch_qrz_public
from app.integrations.rbn import ActivitySnapshot as RbnSnapshot
from app.integrations.rbn import ActivitySpot as RbnSpot

logger = logging.getLogger("callbook.routes.activity")

router = APIRouter(prefix="/api/activity", tags=["activity"])


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

# Same shape as the callsign router's regex; duplicated locally to avoid
# a cross-router import (the activity router is independently mountable).
_CALLSIGN_RE = re.compile(r"^[A-Z0-9/]{3,12}$")


def _normalize_callsign(raw: str) -> str:
    cs = (raw or "").strip().upper()
    if not _CALLSIGN_RE.match(cs):
        raise HTTPException(status_code=400, detail=f"invalid callsign: {raw!r}")
    return cs


# --------------------------------------------------------------------------- #
# FCC ULS                                                                     #
# --------------------------------------------------------------------------- #


@router.get(
    "/{cs}/uls",
    response_model=FccUlsRecord | None,
    summary="Current FCC ULS licensee record for a callsign",
    description=(
        "Returns the normalized FCC ULS record for the given callsign, or "
        "``null`` if the callsign is not present in the ULS bulk snapshot. "
        "The snapshot is loaded lazily on the first request and held in "
        "memory for the life of the worker."
    ),
)
def get_uls(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
) -> FccUlsRecord | None:
    callsign = _normalize_callsign(cs)
    return fcc_uls.lookup(callsign)


@router.get(
    "/uls/_stats",
    summary="Diagnostics for the loaded ULS snapshot",
    include_in_schema=False,
)
def uls_stats() -> JSONResponse:
    """Internal endpoint used by ``/health`` and ops dashboards."""
    payload: dict[str, Any] = fcc_uls.stats()
    return JSONResponse(payload)


# --------------------------------------------------------------------------- #
# Reverse Beacon Network                                                      #
# --------------------------------------------------------------------------- #


@router.get(
    "/{cs}/rbn",
    response_model=RbnSnapshot,
    summary="Recent Reverse Beacon Network spots for a callsign",
    description=(
        "Returns up to ~50 normalized RBN spots from the last 24 hours for "
        "the given callsign. Results are cached server-side for 5 minutes "
        "to stay polite to reversebeacon.net. If RBN is unreachable, the "
        "response is still 200 with an empty ``spots`` list — never an "
        "upstream-induced 5xx — so the frontend's activity card renders "
        "consistently."
    ),
)
async def get_rbn(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
) -> RbnSnapshot:
    callsign = _normalize_callsign(cs)
    try:
        return await rbn.fetch_rbn(callsign)
    except ValueError as exc:
        # Defensive: _normalize_callsign already caught the obvious case,
        # but the integration also validates so re-raise as a 400.
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/rbn/_stats",
    summary="Diagnostics for the RBN integration cache",
    include_in_schema=False,
)
def rbn_stats() -> JSONResponse:
    """Internal endpoint reporting RBN cache occupancy / TTL."""
    return JSONResponse(rbn.cache_info())


# --------------------------------------------------------------------------- #
# QRZ.com public-page scrape                                                  #
# --------------------------------------------------------------------------- #


class QRZNotFound(BaseModel):
    """Returned when QRZ has no public record (or is blocking us).

    Wrapped in an envelope rather than a bare ``null`` so the union
    response model stays self-describing in OpenAPI and the frontend
    can branch on ``found`` without inspecting status codes.
    """

    callsign: str
    found: bool = Field(False, description="Always ``false`` for this envelope.")
    source: str = Field("qrz.com", description="Which live source replied null.")


class QRZFound(BaseModel):
    """Successful QRZ.com public-page lookup envelope."""

    callsign: str
    found: bool = Field(True, description="Always ``true`` for this envelope.")
    source: str = Field("qrz.com", description="Which live source supplied data.")
    profile: QRZPublicProfile


QRZResponse = Union[QRZFound, QRZNotFound]


@router.get(
    "/{cs}/qrz",
    response_model=QRZResponse,
    summary="QRZ.com public profile snapshot for a callsign",
    description=(
        "Scrapes the operator's public QRZ.com page (no login). "
        "Returns the visible name, address (if shown), license class, "
        "country, and a short bio snippet. Heavily cached (24h on hit, "
        "1h on miss) and globally rate-limited to one request every two "
        "seconds. On 404, soft-block, or any network/parse failure, "
        "returns ``{ found: false }`` instead of an HTTP error so the "
        "frontend's activity card renders consistently."
    ),
    responses={
        200: {
            "description": (
                "QRZ.com lookup result. ``found=true`` carries a full "
                "``profile`` payload; ``found=false`` means QRZ had no "
                "public record or we were politely blocked."
            )
        },
        400: {"description": "Malformed callsign."},
    },
)
async def get_qrz(
    cs: str = PathParam(
        ...,
        description=(
            "Callsign to look up on QRZ.com, case-insensitive. Same "
            "syntactic rules as the rest of the API."
        ),
    ),
) -> QRZResponse:
    """Look up a callsign on QRZ.com's public profile page.

    See :mod:`app.integrations.qrz_public` for cache and rate-limit
    semantics; this handler is a thin Pydantic envelope shim.
    """
    callsign = _normalize_callsign(cs)

    try:
        profile = await fetch_qrz_public(callsign)
    except ValueError as exc:
        # ``fetch_qrz_public`` raises ``ValueError`` only for malformed
        # input; ``_normalize_callsign`` should have already caught that,
        # so reaching here is defense-in-depth.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:  # pragma: no cover - defensive
        # The scraper deliberately swallows network/parse errors and
        # returns ``None``; anything else escaping is a bug. Don't take
        # the API down — log it and return a graceful not-found.
        logger.exception("qrz: unexpected error for %s", callsign)
        return QRZNotFound(callsign=callsign)

    if profile is None:
        return QRZNotFound(callsign=callsign)

    return QRZFound(callsign=callsign, profile=profile)


@router.get(
    "/qrz/_stats",
    summary="Diagnostics for the QRZ integration cache",
    include_in_schema=False,
)
def qrz_stats() -> JSONResponse:
    """Internal endpoint reporting QRZ cache occupancy."""
    from app.integrations.qrz_public import cache_stats

    return JSONResponse(cache_stats())


# --------------------------------------------------------------------------- #
# PSK Reporter                                                                #
# --------------------------------------------------------------------------- #


@router.get(
    "/{cs}/psk",
    response_model=PskSnapshot,
    summary="Recent PSK Reporter spots for a callsign",
    description=(
        "Returns up to 200 PSK Reporter reception reports from the last 24 "
        "hours where the given callsign was the *sender* (transmitter). "
        "Responses are cached per-callsign for 5 minutes and the outgoing "
        "HTTPS call is rate-limited to one request per second across all "
        "callsigns. If PSK Reporter is unreachable or returns malformed "
        "XML, the response is still HTTP 200 with ``found=false`` and a "
        "descriptive ``error`` field set — never an upstream-induced 5xx."
    ),
)
async def get_psk(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
) -> PskSnapshot:
    callsign = _normalize_callsign(cs)
    try:
        return await psk_reporter.fetch_psk_reporter(callsign)
    except Exception:  # pragma: no cover - defensive
        # The integration deliberately catches and wraps every known
        # failure mode; anything reaching here is a bug. Don't take the
        # API down — log it and return a graceful empty snapshot.
        logger.exception("psk: unexpected error for %s", callsign)
        return PskSnapshot(
            callsign=callsign,
            source="psk_reporter",
            found=False,
            error="unexpected internal error",
        )


@router.get(
    "/psk/_stats",
    summary="Diagnostics for the PSK Reporter integration cache",
    include_in_schema=False,
)
def psk_stats() -> JSONResponse:
    """Internal endpoint reporting PSK Reporter cache occupancy."""
    # Reach in for cache counts via the module-level TTLCache singletons.
    return JSONResponse(
        {
            "success_cache_size": len(psk_reporter._snapshot_cache),
            "success_cache_maxsize": psk_reporter._snapshot_cache.maxsize,
            "success_cache_ttl_seconds": int(psk_reporter._snapshot_cache.ttl),
            "negative_cache_size": len(psk_reporter._negative_cache),
            "negative_cache_maxsize": psk_reporter._negative_cache.maxsize,
            "negative_cache_ttl_seconds": int(psk_reporter._negative_cache.ttl),
            "min_request_interval_s": psk_reporter.MIN_REQUEST_INTERVAL_S,
        }
    )


# --------------------------------------------------------------------------- #
# Unified aggregator                                                          #
# --------------------------------------------------------------------------- #


class UnifiedActivitySpot(BaseModel):
    """One normalized on-air spot, source-agnostic.

    A thin superset of the per-source spot shapes so the frontend can
    render a single sparkline / table regardless of where the data came
    from. Fields not applicable to a given source are simply ``None``.
    """

    ts: str = Field(..., description="ISO-8601 UTC timestamp of the spot.")
    mode: str | None = Field(None, description="Mode (FT8, CW, RTTY, ...).")
    freq_khz: float | None = Field(None, description="Frequency in kHz.")
    band: str | None = Field(None, description="Coarse band label (20m, 40m, ...).")
    snr: int | None = Field(None, description="Signal-to-noise ratio in dB.")
    spotter: str | None = Field(None, description="Reporting station's callsign.")
    rx_loc: str | None = Field(
        None, description="Receiver Maidenhead grid, when known."
    )


class UnifiedFccLicense(BaseModel):
    """Compact FCC ULS roll-up for the unified payload."""

    callsign: str
    full_name: str | None = None
    status: str | None = None
    status_label: str | None = None
    is_active: bool = False
    grant_date: str | None = None


class UnifiedActivitySnapshot(BaseModel):
    """Aggregated activity payload for a single callsign.

    The ``source`` field signals which upstream the data came from. The
    selection rule is "first source with content wins":

    1. ``psk_reporter`` if PSK Reporter returned at least one spot.
    2. ``rbn`` if the Reverse Beacon Network returned at least one spot.
    3. ``fcc_uls`` if the FCC bulk snapshot has a row (covers the
       still-licensed-but-not-currently-on-the-air case).
    4. ``none`` if every source came up empty.
    """

    callsign: str
    source: str = Field(
        ...,
        description="psk_reporter | rbn | fcc_uls | none",
    )
    found: bool = Field(
        ...,
        description="True iff at least one source supplied non-empty data.",
    )
    fetched_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="When the snapshot was assembled.",
    )

    # Live-activity roll-ups (populated only when source ∈ {psk_reporter, rbn})
    spot_count: int = 0
    last_seen: str | None = None
    bands: list[str] = Field(default_factory=list)
    modes: list[str] = Field(default_factory=list)
    receivers: list[str] = Field(default_factory=list)
    spots: list[UnifiedActivitySpot] = Field(default_factory=list)

    # Static-license roll-up (populated when FCC ULS has a row, regardless
    # of which `source` was chosen — useful context even when we picked
    # PSK Reporter for the "live" data).
    license: UnifiedFccLicense | None = None

    # Per-source diagnostics, so the frontend can show "PSK Reporter: 12
    # spots / RBN: 0 / FCC: licensed" without re-querying each endpoint.
    sources: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description=(
            "Per-source diagnostics keyed by source name. Each entry has "
            "``found`` (bool) and may carry ``spot_count``, ``error``, or "
            "``cached``."
        ),
    )


# Strict cap so a busy DXpedition's RBN+PSK joint output can't blow up
# the response payload. 200 matches the per-source cap in psk_reporter.
_UNIFIED_MAX_SPOTS = 200


def _psk_spot_to_unified(spot: PskSpot) -> UnifiedActivitySpot:
    ts_str: str | None = None
    if spot.timestamp is not None:
        # ActivitySnapshot already normalizes to UTC; emit with explicit Z.
        ts_str = spot.timestamp.astimezone(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    elif spot.flow_start_seconds is not None:
        try:
            ts_str = datetime.fromtimestamp(
                spot.flow_start_seconds, tz=timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ")
        except (OverflowError, OSError, ValueError):
            ts_str = None
    if ts_str is None:
        # Final fallback: stamp "now" so the spot is at least sortable.
        ts_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return UnifiedActivitySpot(
        ts=ts_str,
        mode=spot.mode,
        freq_khz=(
            round(spot.frequency_hz / 1000.0, 3)
            if spot.frequency_hz is not None
            else None
        ),
        band=spot.band,
        snr=spot.snr_db,
        spotter=spot.receiver_callsign,
        rx_loc=spot.receiver_locator,
    )


def _rbn_spot_to_unified(spot: RbnSpot) -> UnifiedActivitySpot:
    # The RBN integration uses kHz as a float and pre-derived ISO ts;
    # we just have to re-derive the band label from the frequency.
    freq_hz = int(spot.freq_khz * 1000) if spot.freq_khz else None
    return UnifiedActivitySpot(
        ts=spot.ts,
        mode=spot.mode or None,
        freq_khz=spot.freq_khz,
        band=psk_reporter.frequency_to_band(freq_hz),
        snr=spot.snr,
        spotter=spot.spotter or None,
        rx_loc=(spot.rx_loc or None),
    )


def _fcc_to_unified_license(rec: FccUlsRecord) -> UnifiedFccLicense:
    return UnifiedFccLicense(
        callsign=rec.callsign,
        full_name=rec.full_name,
        status=rec.status,
        status_label=rec.status_label,
        is_active=rec.is_active,
        grant_date=rec.grant_date,
    )


async def _safe_fetch_psk(callsign: str) -> PskSnapshot:
    """Run the PSK Reporter fetch but never raise — return an empty
    snapshot with ``error`` populated on any failure."""
    try:
        return await psk_reporter.fetch_psk_reporter(callsign)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("aggregate: psk fetch failed for %s", callsign)
        return PskSnapshot(
            callsign=callsign,
            source="psk_reporter",
            found=False,
            error=f"unexpected: {exc}",
        )


async def _safe_fetch_rbn(callsign: str) -> RbnSnapshot:
    """Run the RBN fetch but never raise."""
    try:
        return await rbn.fetch_rbn(callsign)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("aggregate: rbn fetch failed for %s", callsign)
        # Mirror the empty-snapshot shape from rbn._empty_snapshot.
        return RbnSnapshot(callsign=callsign, spots=[], last_seen=None, source="rbn")


async def _safe_fetch_uls(callsign: str) -> FccUlsRecord | None:
    """Run the FCC ULS lookup off-thread so the main loop never blocks
    on the (rare) cold-cache snapshot load."""
    try:
        return await asyncio.to_thread(fcc_uls.lookup, callsign)
    except Exception:  # pragma: no cover - defensive
        logger.exception("aggregate: uls lookup failed for %s", callsign)
        return None


@router.get(
    "/{cs}",
    response_model=UnifiedActivitySnapshot,
    summary="Aggregated live activity for a callsign",
    description=(
        "Concurrently queries PSK Reporter, the Reverse Beacon Network, "
        "and the FCC ULS bulk snapshot for a single callsign, then folds "
        "the results into one unified payload. The ``source`` field "
        "indicates which upstream supplied the chosen data: "
        "``psk_reporter`` > ``rbn`` > ``fcc_uls`` > ``none``. Per-source "
        "diagnostics are exposed under ``sources``. Never returns a 5xx "
        "on upstream failure — failed sources are reported via the "
        "``sources`` map with an ``error`` field."
    ),
)
async def get_activity(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
) -> UnifiedActivitySnapshot:
    callsign = _normalize_callsign(cs)

    # Fire all three concurrently. ``return_exceptions=True`` is belt-and-
    # braces — the _safe_* wrappers already swallow every known failure.
    psk_task = _safe_fetch_psk(callsign)
    rbn_task = _safe_fetch_rbn(callsign)
    uls_task = _safe_fetch_uls(callsign)
    psk_result, rbn_result, uls_result = await asyncio.gather(
        psk_task, rbn_task, uls_task, return_exceptions=False
    )

    # Build per-source diagnostics ------------------------------------------
    sources: dict[str, dict[str, Any]] = {}
    sources["psk_reporter"] = {
        "found": psk_result.found,
        "spot_count": psk_result.spot_count,
        "cached": psk_result.cached,
        "error": psk_result.error,
    }
    sources["rbn"] = {
        "found": bool(rbn_result.spots),
        "spot_count": len(rbn_result.spots),
        "last_seen": rbn_result.last_seen,
    }
    sources["fcc_uls"] = {
        "found": uls_result is not None,
        "is_active": bool(uls_result.is_active) if uls_result else False,
        "status": uls_result.status if uls_result else None,
    }

    # Always carry license context if we have it, regardless of which
    # live source was selected. This is what the UI displays in the
    # "License" sidebar.
    license_block = (
        _fcc_to_unified_license(uls_result) if uls_result is not None else None
    )

    # Select the "winning" source -------------------------------------------
    if psk_result.found and psk_result.spots:
        chosen_source = "psk_reporter"
        spots = [
            _psk_spot_to_unified(s) for s in psk_result.spots[:_UNIFIED_MAX_SPOTS]
        ]
        last_seen = (
            psk_result.last_seen.astimezone(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            if psk_result.last_seen
            else (spots[0].ts if spots else None)
        )
        return UnifiedActivitySnapshot(
            callsign=callsign,
            source=chosen_source,
            found=True,
            spot_count=psk_result.spot_count,
            last_seen=last_seen,
            bands=list(psk_result.bands),
            modes=list(psk_result.modes),
            receivers=list(psk_result.receivers),
            spots=spots,
            license=license_block,
            sources=sources,
        )

    if rbn_result.spots:
        chosen_source = "rbn"
        spots = [
            _rbn_spot_to_unified(s) for s in rbn_result.spots[:_UNIFIED_MAX_SPOTS]
        ]
        # Roll up bands / modes / receivers from the RBN spots (RBN's own
        # snapshot model doesn't expose these — the per-source endpoint
        # returns the raw list, the aggregator derives summaries).
        band_counter: dict[str, int] = {}
        mode_counter: dict[str, int] = {}
        rx_seen: list[str] = []
        rx_set: set[str] = set()
        for s in spots:
            if s.band:
                band_counter[s.band] = band_counter.get(s.band, 0) + 1
            if s.mode:
                mode_counter[s.mode] = mode_counter.get(s.mode, 0) + 1
            if s.spotter and s.spotter not in rx_set:
                rx_set.add(s.spotter)
                rx_seen.append(s.spotter)
        return UnifiedActivitySnapshot(
            callsign=callsign,
            source=chosen_source,
            found=True,
            spot_count=len(rbn_result.spots),
            last_seen=rbn_result.last_seen or (spots[0].ts if spots else None),
            bands=sorted(band_counter, key=lambda b: band_counter[b], reverse=True),
            modes=sorted(mode_counter, key=lambda m: mode_counter[m], reverse=True),
            receivers=rx_seen[:10],
            spots=spots,
            license=license_block,
            sources=sources,
        )

    if uls_result is not None:
        return UnifiedActivitySnapshot(
            callsign=callsign,
            source="fcc_uls",
            found=True,
            license=license_block,
            sources=sources,
        )

    return UnifiedActivitySnapshot(
        callsign=callsign,
        source="none",
        found=False,
        license=None,
        sources=sources,
    )
