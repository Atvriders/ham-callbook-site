"""Reverse Beacon Network (RBN) integration.

The Reverse Beacon Network (https://www.reversebeacon.net/) is a worldwide
mesh of automated CW / RTTY / FT8 / PSK skimmer receivers that publish every
heard callsign as a "spot" — frequency, SNR, time, decoded mode and the
skimmer's own callsign. The live cluster traditionally runs over telnet
(``telnet.reversebeacon.net:7000``), but for HTTP consumers RBN exposes two
public surfaces:

1.  A JSON endpoint used by the dashboard widgets at
    ``https://www.reversebeacon.net/dxsd1/sk.php?s=0&r=25&cdx={CALL}`` which
    returns the most recent N spots where the spotted *DX* callsign matches
    ``{CALL}``. The payload is a JSON array (sometimes wrapped in an object
    keyed by spot id depending on flags). Each row has the fields::

        {
          "id":       "...",        # internal spot id
          "speed":    "28",         # CW WPM (or 0 for digital modes)
          "tx_mode":  "CW",         # mode the spotter decoded
          "freq":     "14025.3",    # frequency in kHz, stringified
          "dx":       "K1ABC",      # the *spotted* (DX) callsign
          "de":       "W3LPL",      # the *spotter* (skimmer) callsign
          "db":       "21",         # SNR in dB
          "time":     "1716998400", # unix epoch seconds (UTC)
          "tx_dxcc":  "291",        # ITU/DXCC of the DX
          "de_dxcc":  "291",
          ...
        }

    This is the primary path; it is cheap (no HTML parsing) and the JSON is
    stable across years of frontend refactors.

2.  A HTML fallback at
    ``https://www.reversebeacon.net/main.php?rows={N}&hours={H}&dxcall={CALL}``
    which renders a server-side spot table. We scrape this with BeautifulSoup
    when the JSON endpoint fails (e.g. RBN has rotated the dxsd1 URL again),
    so the activity card never goes empty for users while a single upstream
    surface is misbehaving.

The module exposes a single async entry point :func:`fetch_rbn`
that returns a normalized :class:`ActivitySnapshot` with at most
``MAX_SPOTS`` entries. Results are cached in-process for ``CACHE_TTL_S``
seconds (5 minutes) keyed by the *normalized uppercase callsign*, so
repeated frontend polls or browser refreshes do not hammer RBN.

We are deliberately gentle:

* one outbound request per cache window per callsign,
* a single-flight lock per callsign so simultaneous misses coalesce,
* a short connect+read timeout so a flaky RBN host cannot stall an
  ``/api/activity`` response forever,
* and a descriptive ``User-Agent`` so the RBN sysops can find us if our
  traffic ever becomes a problem.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx
from bs4 import BeautifulSoup
from cachetools import TTLCache
from pydantic import BaseModel, Field

logger = logging.getLogger("callbook.backend.rbn")


# --------------------------------------------------------------------------- #
# Configuration                                                               #
# --------------------------------------------------------------------------- #

# Endpoints. The ``dxsd1/sk.php`` path is what the live dashboard at
# https://www.reversebeacon.net/dxcc.php?f=0 hits under the hood; query
# parameters discovered empirically:
#   s=0   -> all spotters
#   r=N   -> max rows (RBN clips to ~250)
#   cdx=  -> filter by spotted (DX) callsign
RBN_JSON_URL = "https://www.reversebeacon.net/dxsd1/sk.php"
RBN_HTML_URL = "https://www.reversebeacon.net/main.php"

# Five-minute cache matches the psk_reporter integration and the typical
# RBN frontend refresh interval; shorter than that and we waste their
# bandwidth, longer and the "live" feeling on our activity card erodes.
CACHE_TTL_S: int = 300

# Cap how many distinct callsigns we keep cached at once. 1024 ≈ ~256 KB
# of JSON metadata which is trivial; the bound exists to keep a runaway
# crawler from blowing memory.
CACHE_MAX_ENTRIES: int = 1024

# Cap the number of spots we return — the UI sparkline + table tops out
# around 25-50 rows, and RBN can fire 100+ spots per minute on a busy
# contest weekend.
MAX_SPOTS: int = 50

# How far back to ask RBN for spots. The HTML page supports an ``hours=``
# parameter; the JSON endpoint already returns "recent" rows.
LOOKBACK_HOURS: int = 24

# Total HTTP budget. RBN normally responds in <300ms but during contests
# it can crawl; we cap at five seconds so the parent ``/api/activity``
# request stays snappy.
HTTP_TIMEOUT_S: float = 5.0

# Identify ourselves so the RBN admins can reach us if needed.
USER_AGENT = (
    "ham-callbook-archive/1.0 (+https://github.com/Atvriders/ham-callbook-site; "
    "contact: klassenjames0@gmail.com)"
)

# Callsigns are at most 12 chars after slashes (e.g. ``KH6/W1ABC/QRP``) and
# at least 3 chars; this matches the validator in ``routes/callsign.py``.
_CALLSIGN_RE = re.compile(r"^[A-Z0-9/]{3,12}$")


# --------------------------------------------------------------------------- #
# Pydantic models                                                             #
# --------------------------------------------------------------------------- #

class ActivitySpot(BaseModel):
    """One normalized spot — superset of the fields the UI needs.

    Mirrors the shape declared in ``frontend/lib/types.ts``::

        ts        ISO-8601 timestamp of the spot (UTC, with "Z")
        mode      mode reported by the spotter (CW, FT8, RTTY, ...)
        freq_khz  frequency in kHz
        snr       signal-to-noise ratio in dB
        spotter   spotter callsign
        rx_loc    receiver location — empty string for RBN since the
                  skimmer's Maidenhead grid is not in the JSON payload
                  (it can be looked up later via /dxsd1/skimmers.php).
    """

    ts: str = Field(..., description="ISO-8601 UTC timestamp of the spot.")
    mode: str = Field(..., description="Reported mode, e.g. CW, FT8, RTTY.")
    freq_khz: float = Field(..., description="Frequency in kHz.")
    snr: int = Field(..., description="Signal-to-noise ratio in dB.")
    spotter: str = Field(..., description="Spotter (skimmer) callsign.")
    rx_loc: str = Field(
        default="",
        description=(
            "Receiver Maidenhead grid if known; RBN's spot stream "
            "does not include it so this is typically empty."
        ),
    )


class ActivitySnapshot(BaseModel):
    """Aggregated /activity payload for a single callsign + single source."""

    callsign: str
    spots: list[ActivitySpot]
    last_seen: str | None = None
    source: str = "rbn"


# --------------------------------------------------------------------------- #
# Cache + single-flight                                                       #
# --------------------------------------------------------------------------- #

# Two parallel structures keyed by the canonical (uppercase, stripped)
# callsign:
#
#   _CACHE      stores the last successful snapshot for CACHE_TTL_S
#   _LOCKS      ensures that on a cache miss only one task talks to RBN
#               while siblings await the result
#
# We accept that the locks dict grows unbounded across the process lifetime
# in pathological cases; in practice the working set tracks the cache and
# stays well under a megabyte.
_CACHE: TTLCache[str, ActivitySnapshot] = TTLCache(
    maxsize=CACHE_MAX_ENTRIES, ttl=CACHE_TTL_S
)
_LOCKS: dict[str, asyncio.Lock] = {}


def _normalize_callsign(raw: str) -> str:
    """Uppercase, strip whitespace, validate against the callsign regex.

    Raising ``ValueError`` (not HTTPException) here keeps the integration
    layer framework-agnostic; the route handler translates to a 400.
    """
    cs = (raw or "").strip().upper()
    if not _CALLSIGN_RE.match(cs):
        raise ValueError(f"invalid callsign: {raw!r}")
    return cs


def _lock_for(callsign: str) -> asyncio.Lock:
    """Return (creating if needed) the per-callsign single-flight lock."""
    lock = _LOCKS.get(callsign)
    if lock is None:
        lock = asyncio.Lock()
        _LOCKS[callsign] = lock
    return lock


def _empty_snapshot(callsign: str) -> ActivitySnapshot:
    """Return an empty snapshot — used on upstream failure / no spots."""
    return ActivitySnapshot(callsign=callsign, spots=[], last_seen=None, source="rbn")


# --------------------------------------------------------------------------- #
# Parsing helpers                                                             #
# --------------------------------------------------------------------------- #

def _coerce_int(value: Any, default: int = 0) -> int:
    """Best-effort int coercion that survives RBN's stringly-typed fields."""
    if value is None:
        return default
    try:
        # Strip a trailing "dB" / leading "+" RBN sometimes emits.
        if isinstance(value, str):
            value = value.strip().lstrip("+").rstrip("dB").strip()
            if not value:
                return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _coerce_float(value: Any, default: float = 0.0) -> float:
    """Best-effort float coercion for the frequency field."""
    if value is None:
        return default
    try:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _ts_to_iso(value: Any) -> str:
    """Convert RBN's timestamp (unix-seconds string OR ``HH:MM:SSz`` HTML
    string) to an ISO-8601 UTC string with a ``Z`` suffix.

    The JSON endpoint emits unix seconds. The HTML fallback shows a
    wall-clock time like ``"1842z"`` or ``"18:42:11z"`` for "today UTC";
    we anchor that to today's date in UTC. If parsing fails we fall back
    to ``datetime.now(UTC)`` so the snapshot is never poisoned by a
    single malformed cell.
    """
    if value is None or value == "":
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Numeric (unix seconds) -------------------------------------------------
    try:
        epoch = int(float(value))
        # RBN can produce milliseconds on rare endpoints; detect and rescale.
        if epoch > 10_000_000_000:
            epoch //= 1000
        return (
            datetime.fromtimestamp(epoch, tz=timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ")
        )
    except (TypeError, ValueError):
        pass

    # Wall-clock fallback (HTML rows) ---------------------------------------
    s = str(value).strip().lower().rstrip("z").strip()
    today = datetime.now(timezone.utc).date()
    for fmt in ("%H:%M:%S", "%H:%M", "%H%M%S", "%H%M"):
        try:
            t = datetime.strptime(s, fmt).time()
            dt = datetime.combine(today, t, tzinfo=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row_to_spot(row: dict[str, Any]) -> ActivitySpot | None:
    """Translate one RBN JSON row into an :class:`ActivitySpot`.

    Returns ``None`` if the row is too malformed to be useful (missing
    spotter, zero frequency, etc.) so the caller can simply drop it.
    """
    spotter = str(row.get("de") or row.get("spotter") or "").strip().upper()
    if not spotter:
        return None

    freq_khz = _coerce_float(row.get("freq") or row.get("frequency"))
    if freq_khz <= 0:
        return None

    return ActivitySpot(
        ts=_ts_to_iso(row.get("time") or row.get("date") or row.get("ts")),
        mode=str(row.get("tx_mode") or row.get("mode") or "CW").strip().upper() or "CW",
        freq_khz=round(freq_khz, 2),
        snr=_coerce_int(row.get("db") or row.get("snr")),
        spotter=spotter,
        rx_loc=str(row.get("rx_loc") or row.get("grid") or "").strip().upper(),
    )


def _parse_json_payload(payload: Any) -> list[ActivitySpot]:
    """Normalize the RBN JSON payload into an ``[ActivitySpot]`` list.

    The dxsd1 endpoint has been observed to return either:

    * a top-level ``list`` of row dicts (newest first), or
    * a top-level ``dict`` keyed by spot-id, values are row dicts, or
    * a dict with a ``"spots"`` / ``"data"`` key wrapping one of the above.

    All three shapes are accepted here.
    """
    rows: Iterable[Any]
    if isinstance(payload, dict):
        # Unwrap common envelope keys, otherwise treat the dict's values
        # as the row iterable.
        for key in ("spots", "data", "rows", "result"):
            if key in payload and isinstance(payload[key], (list, dict)):
                payload = payload[key]
                break
        if isinstance(payload, dict):
            rows = payload.values()
        else:
            rows = payload
    elif isinstance(payload, list):
        rows = payload
    else:
        return []

    spots: list[ActivitySpot] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        spot = _row_to_spot(row)
        if spot is not None:
            spots.append(spot)
    return spots


# Map common variants of the column headers in the HTML table to our keys.
_HTML_HEADER_MAP = {
    "de": "de",
    "spotter": "de",
    "dx": "dx",
    "freq.": "freq",
    "freq": "freq",
    "frequency": "freq",
    "cq": "cq",
    "snr": "db",
    "db": "db",
    "speed": "speed",
    "wpm": "speed",
    "mode": "tx_mode",
    "type": "tx_mode",
    "time": "time",
    "date": "time",
    "utc": "time",
    "seen": "time",
}


def _parse_html_payload(html: str, dx_filter: str) -> list[ActivitySpot]:
    """Scrape the legacy main.php spot table.

    RBN's HTML uses a single ``<table>`` with a header row of ``<th>`` cells
    followed by data ``<tr>`` rows. Column order has shifted historically,
    so we resolve columns by header text rather than positional index.

    ``dx_filter`` is applied client-side too, defensive against the
    ``dxcall=`` query parameter being ignored.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Find the first table that has a header row mentioning "de" and "freq".
    target_table = None
    for table in soup.find_all("table"):
        header = table.find("tr")
        if header is None:
            continue
        header_text = " ".join(
            (th.get_text(" ", strip=True) or "").lower()
            for th in header.find_all(["th", "td"])
        )
        if "de" in header_text and ("freq" in header_text or "frequency" in header_text):
            target_table = table
            break
    if target_table is None:
        return []

    rows = target_table.find_all("tr")
    if len(rows) < 2:
        return []

    # Build header index map.
    header_cells = rows[0].find_all(["th", "td"])
    headers: list[str] = []
    for cell in header_cells:
        label = cell.get_text(" ", strip=True).lower()
        headers.append(_HTML_HEADER_MAP.get(label, label))

    spots: list[ActivitySpot] = []
    for tr in rows[1:]:
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue
        row: dict[str, Any] = {}
        for idx, cell in enumerate(cells):
            if idx >= len(headers):
                break
            row[headers[idx]] = cell.get_text(" ", strip=True)

        # Defensive DX filter — case-insensitive exact match.
        dx_val = str(row.get("dx") or "").strip().upper()
        if dx_val and dx_val != dx_filter:
            continue

        spot = _row_to_spot(row)
        if spot is not None:
            spots.append(spot)

    return spots


def _dedupe_and_sort(spots: list[ActivitySpot]) -> list[ActivitySpot]:
    """Drop near-duplicates (same spotter + freq within ~0.2 kHz, same minute)
    and sort newest-first. RBN often double-spots a single transmission when
    two skimmers within the same RX site decode it back-to-back."""
    seen: set[tuple[str, int, str]] = set()
    deduped: list[ActivitySpot] = []
    # Iterate newest-first so the *first* occurrence we keep is the freshest.
    for spot in sorted(spots, key=lambda s: s.ts, reverse=True):
        # Bucket frequency to the nearest 0.2 kHz and timestamp to the minute.
        freq_bucket = int(round(spot.freq_khz * 5))  # 1 unit == 0.2 kHz
        ts_minute = spot.ts[:16]  # YYYY-MM-DDTHH:MM
        key = (spot.spotter, freq_bucket, ts_minute)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(spot)
    return deduped


# --------------------------------------------------------------------------- #
# HTTP fetch                                                                  #
# --------------------------------------------------------------------------- #

async def _fetch_json(client: httpx.AsyncClient, callsign: str) -> list[ActivitySpot]:
    """Hit the dxsd1/sk.php JSON endpoint. Returns [] on any failure."""
    params = {
        "s": "0",
        "r": str(MAX_SPOTS),
        "cdx": callsign,
    }
    try:
        resp = await client.get(RBN_JSON_URL, params=params)
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        logger.info("RBN JSON fetch failed for %s: %s", callsign, exc)
        return []

    if resp.status_code != 200:
        logger.info(
            "RBN JSON for %s returned HTTP %s", callsign, resp.status_code
        )
        return []

    # RBN sometimes serves text/html with a JSON body on this endpoint, so
    # do not rely on resp.json() honoring the Content-Type.
    text = resp.text.strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        logger.info("RBN JSON for %s was not valid JSON (first 80b: %r)",
                    callsign, text[:80])
        return []

    return _parse_json_payload(payload)


async def _fetch_html(client: httpx.AsyncClient, callsign: str) -> list[ActivitySpot]:
    """Fallback: scrape main.php?dxcall=...&rows=...&hours=..."""
    params = {
        "rows": str(MAX_SPOTS),
        "hours": str(LOOKBACK_HOURS),
        "dxcall": callsign,
    }
    try:
        resp = await client.get(RBN_HTML_URL, params=params)
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        logger.info("RBN HTML fetch failed for %s: %s", callsign, exc)
        return []

    if resp.status_code != 200 or not resp.text:
        logger.info(
            "RBN HTML for %s returned HTTP %s (len=%s)",
            callsign, resp.status_code, len(resp.text or ""),
        )
        return []

    return _parse_html_payload(resp.text, dx_filter=callsign)


async def _fetch_uncached(callsign: str) -> ActivitySnapshot:
    """Run the network fetch (JSON primary, HTML fallback) without cache."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/html;q=0.9, */*;q=0.5",
    }
    timeout = httpx.Timeout(HTTP_TIMEOUT_S, connect=HTTP_TIMEOUT_S)
    async with httpx.AsyncClient(
        headers=headers,
        timeout=timeout,
        follow_redirects=True,
    ) as client:
        spots = await _fetch_json(client, callsign)
        if not spots:
            # Single fallback attempt against the HTML page. We do *not*
            # try both unconditionally — that would double our footprint
            # on the RBN servers for every miss.
            spots = await _fetch_html(client, callsign)

    if not spots:
        return _empty_snapshot(callsign)

    spots = _dedupe_and_sort(spots)[:MAX_SPOTS]
    last_seen = spots[0].ts if spots else None
    return ActivitySnapshot(
        callsign=callsign,
        spots=spots,
        last_seen=last_seen,
        source="rbn",
    )


# --------------------------------------------------------------------------- #
# Public entry point                                                          #
# --------------------------------------------------------------------------- #

async def fetch_rbn(callsign: str) -> ActivitySnapshot:
    """Return RBN spots for ``callsign``, caching for ``CACHE_TTL_S`` seconds.

    The ``callsign`` may be any case; it is normalized and validated against
    the standard ham-radio character set (``A-Z 0-9 /``, 3-12 chars). On
    a validation failure a :class:`ValueError` is raised so the FastAPI
    route can map it to a 400.

    The function never raises on network or parse failure — instead it
    returns an empty :class:`ActivitySnapshot` (``spots=[]``, ``last_seen=
    None``) so the caller can render a "no recent activity" UI state
    rather than a hard error.
    """
    cs = _normalize_callsign(callsign)

    # Fast path: still-warm cache. ``TTLCache.__contains__`` handles
    # expiry so we do not need an explicit time check.
    cached = _CACHE.get(cs)
    if cached is not None:
        return cached

    # Slow path: serialize concurrent misses for the same callsign so we
    # make exactly one outbound request per cache window.
    lock = _lock_for(cs)
    async with lock:
        cached = _CACHE.get(cs)
        if cached is not None:
            return cached

        start = time.monotonic()
        snapshot = await _fetch_uncached(cs)
        elapsed_ms = (time.monotonic() - start) * 1000
        logger.info(
            "RBN fetch %s: %d spots in %.0fms",
            cs, len(snapshot.spots), elapsed_ms,
        )

        _CACHE[cs] = snapshot
        return snapshot


# --------------------------------------------------------------------------- #
# Cache management (handy for tests / admin endpoints)                        #
# --------------------------------------------------------------------------- #

def cache_clear() -> None:
    """Drop every cached snapshot. Used by the test-suite fixtures."""
    _CACHE.clear()


def cache_info() -> dict[str, int]:
    """Tiny snapshot of cache state for ``/api/health`` style probes."""
    return {
        "size": len(_CACHE),
        "maxsize": _CACHE.maxsize,
        "ttl_seconds": int(_CACHE.ttl),
    }


__all__ = [
    "ActivitySnapshot",
    "ActivitySpot",
    "CACHE_TTL_S",
    "MAX_SPOTS",
    "cache_clear",
    "cache_info",
    "fetch_rbn",
]
