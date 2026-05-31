"""PSK Reporter integration.

PSK Reporter (https://pskreporter.info/) is the canonical clearinghouse
for digital-mode reception reports. Any callsign decoded by an SDR or
WSJT-X / JS8Call / FT8 station running the upload module shows up there
within seconds; the public XML feed exposes the last ~24h of those
spots per sender.

Endpoint
--------
``GET https://pskreporter.info/cgi-bin/pskquery5.pl
       ?senderCallsign={CALL}
       &lastSeconds=86400
       &flowStartSeconds=-86400``

Returns ``application/xml`` along these lines (whitespace mine)::

    <receptionReports currentSeconds="1717012345">
      <activeReceiver callsign="K1ABC" locator="FN42aa" frequency="14074000"/>
      ...
      <receptionReport
          receiverCallsign="K1ABC"
          receiverLocator="FN42aa"
          senderCallsign="W1AW"
          senderLocator="FN31pr"
          frequency="14074123"
          flowStartSeconds="1716998765"
          mode="FT8"
          sNR="-12"/>
      ...
      <lastSequenceNumber sequenceNumber="42"/>
      <maxFlowStartSeconds value="1717012300"/>
    </receptionReports>

Policy
------
PSK Reporter asks clients to back off to >=1 req/sec per source and to
cache results client-side for a few minutes. We do both:

* :class:`AsyncRateLimiter` enforces a >=1.0 s gap between *outgoing*
  HTTPS calls (process-wide, not per-callsign).
* A :class:`cachetools.TTLCache` keyed on the uppercase callsign holds
  parsed snapshots for ``CACHE_TTL_SECONDS`` (300 s).

Errors and empty responses are also cached (with a shorter TTL) so a
flapping upstream doesn't drag the route latency down.

Public surface
--------------
* :class:`ActivitySpot`           — one decoded reception (Pydantic v2).
* :class:`ActivitySnapshot`       — wrapper with metadata + spots list.
* :func:`fetch_psk_reporter`      — ``async`` entry point used by routes.
* :func:`parse_psk_xml`           — pure-function XML parser (testable).

Security
--------
The XML response is parsed with :mod:`defusedxml`, not the stdlib
``xml.etree.ElementTree``. ``defusedxml`` blocks XXE (external entity
injection), billion-laughs entity expansion, DTD network retrieval,
and related XML-deserialization attacks — all of which are real on a
third-party feed we don't control.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Final

import httpx
from cachetools import TTLCache
# defusedxml is a hardened drop-in replacement for the stdlib
# ``xml.etree.ElementTree`` parser. It refuses XXE (external entity)
# expansion, billion-laughs entity bombs, DTD retrieval over the
# network, and other classic XML-deserialization attacks. PSK Reporter
# is a third-party feed we don't control, so we *must* parse defensively.
from defusedxml.ElementTree import fromstring as _defused_fromstring
from defusedxml.ElementTree import ParseError as _DefusedParseError
from pydantic import BaseModel, Field

logger = logging.getLogger("callbook.backend.psk_reporter")


# --------------------------------------------------------------------------- #
# Configuration                                                               #
# --------------------------------------------------------------------------- #

PSK_REPORTER_URL: Final[str] = "https://pskreporter.info/cgi-bin/pskquery5.pl"

#: Time window we ask PSK Reporter for, in seconds (24h).
LAST_SECONDS: Final[int] = 86400

#: Per-callsign cache lifetime for *successful* parses.
CACHE_TTL_SECONDS: Final[int] = 300

#: Per-callsign cache lifetime for empty / error responses (shorter so
#: a station that just started transmitting shows up faster).
ERROR_TTL_SECONDS: Final[int] = 60

#: Cap on the number of distinct callsigns we keep in memory at once.
CACHE_MAX_ENTRIES: Final[int] = 4096

#: Minimum seconds between *any* outgoing requests to pskreporter.info.
#: PSK Reporter explicitly asks for <=1 req/sec from polite clients.
MIN_REQUEST_INTERVAL_S: Final[float] = 1.0

#: Per-request HTTPS timeout.
HTTP_TIMEOUT_S: Final[float] = 15.0

#: User-Agent we identify ourselves as. PSK Reporter logs these; a real
#: identifying string is the polite default.
USER_AGENT: Final[str] = "usa-ham-callbook-archive/0.1 (+https://callbook.example/)"


# --------------------------------------------------------------------------- #
# Pydantic models                                                             #
# --------------------------------------------------------------------------- #


class ActivitySpot(BaseModel):
    """One on-air reception report."""

    sender_callsign: str = Field(..., description="The transmitting station.")
    receiver_callsign: str | None = Field(
        None, description="The reporting receiver."
    )
    sender_locator: str | None = Field(
        None, description="Sender Maidenhead grid (e.g. FN42aa)."
    )
    receiver_locator: str | None = Field(
        None, description="Receiver Maidenhead grid."
    )
    frequency_hz: int | None = Field(
        None,
        description="Tuned frequency in Hz (PSK Reporter reports integers).",
    )
    band: str | None = Field(
        None, description="Amateur band derived from the frequency (e.g. '20m')."
    )
    mode: str | None = Field(None, description="Digital mode (FT8, FT4, ...).")
    snr_db: int | None = Field(None, description="Reported SNR in dB.")
    timestamp: datetime | None = Field(
        None, description="UTC timestamp of the reception."
    )
    flow_start_seconds: int | None = Field(
        None, description="Raw Unix epoch from the source feed."
    )


class ActivitySnapshot(BaseModel):
    """Aggregate of recent reception reports for a single callsign."""

    callsign: str
    source: str = Field(..., description="psk_reporter | rbn | fcc_uls | none")
    found: bool = Field(
        ...,
        description="True iff at least one spot was returned in the window.",
    )
    window_seconds: int = Field(
        LAST_SECONDS, description="Look-back window the source was queried with."
    )
    spot_count: int = 0
    last_seen: datetime | None = Field(
        None, description="UTC timestamp of the most recent spot, if any."
    )
    bands: list[str] = Field(
        default_factory=list,
        description="Distinct bands the callsign was heard on, sorted by spot count.",
    )
    modes: list[str] = Field(
        default_factory=list,
        description="Distinct modes the callsign was heard on, sorted by spot count.",
    )
    receivers: list[str] = Field(
        default_factory=list,
        description="Up to 10 distinct receivers, most-recent first.",
    )
    spots: list[ActivitySpot] = Field(
        default_factory=list,
        description="Most recent spots first; capped at 200 to keep payloads bounded.",
    )
    cached: bool = Field(
        False,
        description="True if the snapshot came from the in-process TTL cache.",
    )
    fetched_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="When the snapshot was assembled.",
    )
    error: str | None = Field(
        None,
        description="Populated if the source errored; spots will be empty.",
    )


# Cap on how many ``ActivitySpot`` rows we serialize, regardless of how
# many came back from PSK Reporter. 24h of FT8 spots for a busy
# DXpedition can be thousands; truncate to keep payloads sane.
_MAX_SPOTS_RETURNED: Final[int] = 200


# --------------------------------------------------------------------------- #
# Polite rate limiting                                                        #
# --------------------------------------------------------------------------- #


class AsyncRateLimiter:
    """Process-wide minimum-interval limiter for ``httpx`` calls.

    Not a token bucket — we just guarantee a hard floor of
    ``min_interval`` seconds between successive ``acquire()`` returns.
    That matches PSK Reporter's "<=1 req/sec" guidance exactly.

    The implementation deliberately uses a single :class:`asyncio.Lock`
    so concurrent callers serialize cleanly: caller B awaiting the lock
    sleeps off whatever portion of the interval caller A consumed.
    """

    __slots__ = ("_lock", "_min_interval", "_last_call")

    def __init__(self, min_interval: float) -> None:
        self._lock = asyncio.Lock()
        self._min_interval = float(min_interval)
        # ``-inf`` so the first ``acquire()`` never sleeps.
        self._last_call = float("-inf")

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._min_interval - (now - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()


_rate_limiter = AsyncRateLimiter(MIN_REQUEST_INTERVAL_S)


# --------------------------------------------------------------------------- #
# Cache                                                                       #
# --------------------------------------------------------------------------- #

# We store ActivitySnapshot instances directly. The TTLCache evicts on
# read after ``ttl`` seconds, so this is "best-effort 5 minutes". Note
# the cache itself is process-local — with two uvicorn workers we get
# at most 2 upstream calls per callsign per TTL window, which is well
# under PSK Reporter's 1 req/sec global cap.
_snapshot_cache: TTLCache[str, ActivitySnapshot] = TTLCache(
    maxsize=CACHE_MAX_ENTRIES, ttl=CACHE_TTL_SECONDS
)

# Separate, shorter-TTL cache for negatives / errors so a station that
# starts transmitting after a long quiet period is picked up faster.
_negative_cache: TTLCache[str, ActivitySnapshot] = TTLCache(
    maxsize=CACHE_MAX_ENTRIES, ttl=ERROR_TTL_SECONDS
)

# Coalesce concurrent requests for the same callsign into one upstream
# call. Per-key futures live just long enough to share a response.
_inflight: dict[str, asyncio.Future[ActivitySnapshot]] = {}
_inflight_lock = asyncio.Lock()


def _cache_get(callsign: str) -> ActivitySnapshot | None:
    snap = _snapshot_cache.get(callsign)
    if snap is not None:
        return snap
    return _negative_cache.get(callsign)


def _cache_put(callsign: str, snap: ActivitySnapshot) -> None:
    if snap.error is None and snap.spot_count > 0:
        _snapshot_cache[callsign] = snap
    else:
        _negative_cache[callsign] = snap


# --------------------------------------------------------------------------- #
# Band lookup                                                                 #
# --------------------------------------------------------------------------- #

# (low_hz, high_hz, label) — IARU Region-2 amateur band edges, generous
# enough that PSK Reporter's "tuned" vs "decoded" frequency fuzz never
# pushes a spot out of its band. Sorted high→low because most digital
# action lives 20m and above.
_BANDS: Final[tuple[tuple[int, int, str], ...]] = (
    (135_700, 137_800, "2200m"),
    (472_000, 479_000, "630m"),
    (1_800_000, 2_000_000, "160m"),
    (3_500_000, 4_000_000, "80m"),
    (5_330_000, 5_410_000, "60m"),
    (7_000_000, 7_300_000, "40m"),
    (10_100_000, 10_150_000, "30m"),
    (14_000_000, 14_350_000, "20m"),
    (18_068_000, 18_168_000, "17m"),
    (21_000_000, 21_450_000, "15m"),
    (24_890_000, 24_990_000, "12m"),
    (28_000_000, 29_700_000, "10m"),
    (50_000_000, 54_000_000, "6m"),
    (70_000_000, 71_000_000, "4m"),
    (144_000_000, 148_000_000, "2m"),
    (222_000_000, 225_000_000, "1.25m"),
    (420_000_000, 450_000_000, "70cm"),
    (902_000_000, 928_000_000, "33cm"),
    (1_240_000_000, 1_300_000_000, "23cm"),
    (2_300_000_000, 2_450_000_000, "13cm"),
)


def frequency_to_band(freq_hz: int | None) -> str | None:
    """Map a tuned frequency to a coarse band label, or ``None`` if OOB."""
    if freq_hz is None or freq_hz <= 0:
        return None
    for low, high, label in _BANDS:
        if low <= freq_hz <= high:
            return label
    return None


# --------------------------------------------------------------------------- #
# XML parsing                                                                 #
# --------------------------------------------------------------------------- #


def _safe_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_str(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return s or None


def _strip_ns(tag: str) -> str:
    """Strip an XML namespace from an ElementTree tag (``{ns}local`` -> ``local``)."""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def parse_psk_xml(xml_bytes: bytes, callsign: str) -> ActivitySnapshot:
    """Parse a raw PSK Reporter XML response into an ``ActivitySnapshot``.

    Pure function: no I/O, no global state, easy to unit-test against
    fixtures. The PSK Reporter feed is namespaced inconsistently across
    versions of the CGI, so we tolerate both ``receptionReport`` and the
    namespaced ``{ns}receptionReport`` tags.
    """
    cs_upper = callsign.upper()

    if not xml_bytes:
        return ActivitySnapshot(
            callsign=cs_upper,
            source="psk_reporter",
            found=False,
            spot_count=0,
            error="empty response",
        )

    try:
        # ``defusedxml.ElementTree.fromstring`` returns the same
        # ``xml.etree.ElementTree.Element`` shape, so the rest of the
        # parser is unchanged — only the *parse step* is hardened.
        root = _defused_fromstring(xml_bytes)
    except _DefusedParseError as exc:
        logger.warning("PSK Reporter XML parse failed for %s: %s", cs_upper, exc)
        return ActivitySnapshot(
            callsign=cs_upper,
            source="psk_reporter",
            found=False,
            spot_count=0,
            error=f"xml parse error: {exc}",
        )
    except Exception as exc:
        # defusedxml raises its own subclasses for entity-bomb /
        # external-entity attempts; catch broadly so a malformed feed
        # can never crash the route.
        logger.warning("PSK Reporter XML rejected for %s: %s", cs_upper, exc)
        return ActivitySnapshot(
            callsign=cs_upper,
            source="psk_reporter",
            found=False,
            spot_count=0,
            error=f"xml rejected: {exc}",
        )

    spots: list[ActivitySpot] = []
    for elem in root.iter():
        if _strip_ns(elem.tag) != "receptionReport":
            continue
        attrs = elem.attrib
        flow_start = _safe_int(attrs.get("flowStartSeconds"))
        ts: datetime | None = None
        if flow_start is not None:
            try:
                ts = datetime.fromtimestamp(flow_start, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                ts = None
        freq = _safe_int(attrs.get("frequency"))
        spots.append(
            ActivitySpot(
                sender_callsign=(
                    _safe_str(attrs.get("senderCallsign")) or cs_upper
                ).upper(),
                receiver_callsign=(
                    (_safe_str(attrs.get("receiverCallsign")) or "").upper()
                    or None
                ),
                sender_locator=_safe_str(attrs.get("senderLocator")),
                receiver_locator=_safe_str(attrs.get("receiverLocator")),
                frequency_hz=freq,
                band=frequency_to_band(freq),
                mode=_safe_str(attrs.get("mode")),
                snr_db=_safe_int(attrs.get("sNR")),
                timestamp=ts,
                flow_start_seconds=flow_start,
            )
        )

    # Sort newest-first. Spots without a timestamp sink to the bottom so
    # they don't masquerade as "latest".
    spots.sort(
        key=lambda s: s.flow_start_seconds if s.flow_start_seconds is not None else -1,
        reverse=True,
    )

    # Roll-ups: ordered by descending spot count for the band/mode lists,
    # most-recent-first for receivers (which is what an operator wants).
    band_counter: Counter[str] = Counter()
    mode_counter: Counter[str] = Counter()
    receivers_seen: list[str] = []
    receivers_set: set[str] = set()
    for s in spots:
        if s.band:
            band_counter[s.band] += 1
        if s.mode:
            mode_counter[s.mode] += 1
        if s.receiver_callsign and s.receiver_callsign not in receivers_set:
            receivers_set.add(s.receiver_callsign)
            receivers_seen.append(s.receiver_callsign)

    last_seen = spots[0].timestamp if spots else None
    truncated_spots = spots[:_MAX_SPOTS_RETURNED]

    return ActivitySnapshot(
        callsign=cs_upper,
        source="psk_reporter",
        found=bool(spots),
        spot_count=len(spots),
        last_seen=last_seen,
        bands=[b for b, _ in band_counter.most_common()],
        modes=[m for m, _ in mode_counter.most_common()],
        receivers=receivers_seen[:10],
        spots=truncated_spots,
    )


# --------------------------------------------------------------------------- #
# HTTP fetch                                                                  #
# --------------------------------------------------------------------------- #


async def _http_get(client: httpx.AsyncClient, callsign: str) -> bytes:
    """Perform the actual rate-limited HTTPS GET. Returns the raw body."""
    await _rate_limiter.acquire()
    params = {
        "senderCallsign": callsign,
        "lastSeconds": str(LAST_SECONDS),
        # Negative flowStartSeconds = "relative to now"; PSK Reporter
        # treats this as "everything in the last N seconds" which is
        # subtly different from ``lastSeconds`` alone (the latter is
        # honored only when no flowStart is given).
        "flowStartSeconds": str(-LAST_SECONDS),
    }
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/xml, text/xml;q=0.9, */*;q=0.1",
    }
    logger.debug("PSK Reporter GET callsign=%s", callsign)
    resp = await client.get(
        PSK_REPORTER_URL,
        params=params,
        headers=headers,
        timeout=HTTP_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.content


async def fetch_psk_reporter(
    callsign: str,
    *,
    client: httpx.AsyncClient | None = None,
    use_cache: bool = True,
) -> ActivitySnapshot:
    """Return an :class:`ActivitySnapshot` for ``callsign`` from PSK Reporter.

    Concurrent callers for the same callsign share one upstream HTTP
    call via the ``_inflight`` registry. The TTL cache is consulted
    before — and the parsed snapshot is written back after — every
    successful fetch.

    Errors (timeouts, HTTP 5xx, parse failures) are returned as a
    snapshot with ``source='psk_reporter'``, ``found=False``, and the
    ``error`` field populated. They are *also* cached briefly to keep
    the route responsive when the upstream is sick.
    """
    cs = (callsign or "").strip().upper()
    if not cs:
        return ActivitySnapshot(
            callsign="",
            source="psk_reporter",
            found=False,
            error="empty callsign",
        )

    if use_cache:
        cached = _cache_get(cs)
        if cached is not None:
            return cached.model_copy(update={"cached": True})

    # Coalesce concurrent fetches for the same callsign.
    async with _inflight_lock:
        existing = _inflight.get(cs)
        if existing is not None:
            future = existing
            owner = False
        else:
            future = asyncio.get_running_loop().create_future()
            _inflight[cs] = future
            owner = True

    if not owner:
        # Wait for the in-flight call to finish and return its result.
        snap = await future
        return snap.model_copy(update={"cached": True})

    # We own the fetch. Make sure we always resolve the future and
    # remove it from the registry, even on exceptions.
    owns_client = client is None
    try:
        if client is None:
            client = httpx.AsyncClient(
                http2=False,
                follow_redirects=True,
                timeout=HTTP_TIMEOUT_S,
            )
        try:
            xml_bytes = await _http_get(client, cs)
            snap = parse_psk_xml(xml_bytes, cs)
        except httpx.TimeoutException as exc:
            logger.warning("PSK Reporter timeout for %s: %s", cs, exc)
            snap = ActivitySnapshot(
                callsign=cs,
                source="psk_reporter",
                found=False,
                error=f"timeout: {exc}",
            )
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "PSK Reporter HTTP %s for %s",
                exc.response.status_code,
                cs,
            )
            snap = ActivitySnapshot(
                callsign=cs,
                source="psk_reporter",
                found=False,
                error=f"http {exc.response.status_code}",
            )
        except httpx.HTTPError as exc:
            logger.warning("PSK Reporter HTTP error for %s: %s", cs, exc)
            snap = ActivitySnapshot(
                callsign=cs,
                source="psk_reporter",
                found=False,
                error=f"http error: {exc}",
            )
        finally:
            if owns_client:
                await client.aclose()

        if use_cache:
            _cache_put(cs, snap)
        if not future.done():
            future.set_result(snap)
        return snap
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("PSK Reporter unexpected failure for %s", cs)
        snap = ActivitySnapshot(
            callsign=cs,
            source="psk_reporter",
            found=False,
            error=f"unexpected: {exc}",
        )
        if not future.done():
            future.set_result(snap)
        return snap
    finally:
        async with _inflight_lock:
            # Only remove the entry if it's still ours (in theory a
            # subsequent call could have replaced it, though our lock
            # discipline above prevents that).
            if _inflight.get(cs) is future:
                _inflight.pop(cs, None)


def clear_cache() -> None:
    """Drop both the success and negative caches. Test-only hook."""
    _snapshot_cache.clear()
    _negative_cache.clear()
