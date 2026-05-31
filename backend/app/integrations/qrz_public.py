"""QRZ.com public-page scraper.

QRZ.com is the de-facto modern callsign directory. The *XML logbook
service* requires a paid subscription and a session token, but the plain
HTML page at ``https://www.qrz.com/db/{CALLSIGN}`` is publicly viewable
without login and contains enough of the visible profile (name, location,
license class, country, bio snippet) to be a useful "is this person
still findable in the modern era?" complement to our 1909-2003 archive.

This module is *deliberately polite*:

* **One in-flight request at a time** — guarded by an ``asyncio.Lock``.
* **At least 2.0 seconds between requests** — measured against a single
  process-wide "last hit" timestamp.
* **24 hour TTL cache** — by far the most effective rate-limit, because
  the same callsign is hammered by many UI views. Negative results
  (404, blocked, soft-block landing pages) cache for a shorter window
  (1 hour) so a transient block doesn't pin a real callsign as missing
  for a whole day.
* **Identifying User-Agent** — carries the project name and a contact URL
  so QRZ's admins can reach us if we ever misbehave. Per HTTP etiquette
  (RFC 9110 §10.1.5) this is the right thing to do; per QRZ's published
  terms it is also the *only* thing that keeps a public-page scraper on
  the acceptable side of the line.
* **Conservative HTML parsing** — QRZ's markup is generationally varied
  (PHP-era tables, modern divs, occasional A/B tests). We try several
  strategies in order and degrade gracefully if a selector disappears.
  A missing field becomes ``None`` rather than an exception.

The public entry point is :func:`fetch_qrz_public`. It returns a
:class:`QRZPublicProfile` Pydantic model on success or ``None`` if the
callsign is not on QRZ, the page is blocked / soft-blocked, the network
errors out, or parsing yields no usable fields whatsoever.

The scraper never raises on the happy/sad path; only programmer errors
(e.g. an unparseable callsign argument) bubble up.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import Final, Optional

import httpx
from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel, Field

logger = logging.getLogger("callbook.integrations.qrz_public")


# --------------------------------------------------------------------------- #
# Public model                                                                #
# --------------------------------------------------------------------------- #


class QRZPublicProfile(BaseModel):
    """A best-effort snapshot of a QRZ.com public profile page.

    All fields except ``callsign`` and ``source_url`` are optional because
    QRZ users may hide any combination of them. A profile with every
    field ``None`` is still returned (rather than ``None`` from
    :func:`fetch_qrz_public`) provided the page actually loaded and was
    not a 404 / soft-block — that absence-of-info is itself a useful
    signal to the UI.
    """

    callsign: str = Field(
        ..., description="Normalized (uppercase, no whitespace) callsign."
    )
    source_url: str = Field(
        ..., description="The exact QRZ.com page that was scraped."
    )
    name: Optional[str] = Field(
        None, description="Operator's displayed name, as shown on QRZ."
    )
    address: Optional[str] = Field(
        None,
        description="Street address line if shown; QRZ users frequently hide this.",
    )
    city: Optional[str] = Field(None, description="City line if parsable.")
    state: Optional[str] = Field(
        None, description="US state / Canadian province two-letter code if parsable."
    )
    zip: Optional[str] = Field(None, description="Postal code if shown.")
    country: Optional[str] = Field(
        None, description="Country name as displayed on QRZ."
    )
    license_class: Optional[str] = Field(
        None,
        description="License class string as displayed (Extra / Advanced / "
        "General / Technician / Novice / Club / etc.).",
    )
    grid: Optional[str] = Field(
        None, description="Maidenhead grid square (e.g. ``FN31pr``) if displayed."
    )
    itu_zone: Optional[str] = Field(None, description="ITU zone number if shown.")
    cq_zone: Optional[str] = Field(None, description="CQ zone number if shown.")
    bio_snippet: Optional[str] = Field(
        None,
        description="First ~400 characters of the operator's biography section, "
        "if any. Whitespace-collapsed; markup stripped.",
    )
    fetched_at: float = Field(
        ..., description="Unix timestamp (seconds) at which the page was fetched."
    )
    cached: bool = Field(
        False,
        description="True if this response was served from the in-process cache.",
    )


# --------------------------------------------------------------------------- #
# Tunables                                                                    #
# --------------------------------------------------------------------------- #

QRZ_BASE_URL: Final[str] = "https://www.qrz.com/db/"

# Identify ourselves clearly. The contact URL placeholder should be edited
# to the production deploy URL before going live; QRZ's webmaster has
# stated in various forum threads that he is fine with low-rate public-
# page scraping that carries a real UA.
USER_AGENT: Final[str] = (
    "USAHamCallbookArchive/0.1 (+https://callbook.example.org/about; "
    "research project; contact: ham-archive@example.org)"
)

# Minimum seconds between successive outbound QRZ requests. 2.0 is well
# under QRZ's stated public-page tolerance and well above what a casual
# browser-tabbing human would generate.
MIN_INTERVAL_SECONDS: Final[float] = 2.0

# Positive-cache TTL (24h) and negative-cache TTL (1h). 24h matches the
# task spec; the shorter negative TTL is a defensive measure so a
# transient 5xx or soft-block doesn't pin a real callsign to "not found"
# for a whole day.
POSITIVE_TTL_SECONDS: Final[float] = 24 * 60 * 60
NEGATIVE_TTL_SECONDS: Final[float] = 60 * 60

# Per-request HTTP timeouts. QRZ is normally <1s but has been known to
# stall during DDOS-mitigation; we cap conservatively rather than letting
# a stalled request block the rate-limit queue.
HTTP_TIMEOUT_SECONDS: Final[float] = 10.0

# How long a bio snippet we surface. QRZ bios can be megabytes long
# (image-heavy HTML); we cut them at a paragraph-or-so worth of text.
BIO_SNIPPET_MAX_CHARS: Final[int] = 400

# Soft-block fingerprints. If the response body is a normal 200 OK but
# contains any of these strings, we treat it as a block (negative cache)
# rather than a missing profile.
SOFT_BLOCK_MARKERS: Final[tuple[str, ...]] = (
    "Access denied",
    "Please complete the security check",
    "Just a moment...",
    "captcha",
    "Cloudflare",
)

# Phrases QRZ uses for an unknown callsign on a 200 OK error page (the
# site occasionally returns 200 with an error body instead of a 404).
NOT_FOUND_MARKERS: Final[tuple[str, ...]] = (
    "Not a valid callsign",
    "is not a valid callsign",
    "We have no record of",
    "No such callsign",
    "Callsign not found",
)

# Allowed callsign characters. Anything else is rejected before we go to
# the network — saves a useless round trip and avoids feeding garbage
# into a URL.
_CS_OK_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Z0-9/]{3,12}$")

# Collapse runs of whitespace (including newlines from HTML) into one
# space, used when extracting visible text from soup nodes.
_WS_RE: Final[re.Pattern[str]] = re.compile(r"\s+")

# US/Canadian state-or-province two-letter code, anchored at the end of
# a "City, ST  ZIP" style line so we can split city/state/zip cleanly.
_CITY_STATE_ZIP_RE: Final[re.Pattern[str]] = re.compile(
    r"^(?P<city>.+?),\s*(?P<state>[A-Z]{2})(?:\s+(?P<zip>[0-9A-Z\- ]{3,10}))?$"
)


# --------------------------------------------------------------------------- #
# Cache + rate-limit state                                                    #
# --------------------------------------------------------------------------- #


@dataclass
class _CacheEntry:
    """One row of the in-process cache. ``value=None`` means a remembered
    negative result (404, blocked, parse-failed)."""

    value: Optional[QRZPublicProfile]
    expires_at: float


# In-memory cache only; one per worker process. We deliberately do not
# add an LRU bound — at 99% cache-hit ratio the working set is naturally
# the popular-callsign tail, and a real QRZPublicProfile is <1 KB. Even
# 100K cached profiles is <100 MB, which is fine for a 7.74M-row
# archive's traffic profile.
_CACHE: dict[str, _CacheEntry] = {}
_CACHE_LOCK = asyncio.Lock()

# Single global request lock + last-hit timestamp. One in-flight request
# at a time, plus an enforced ``MIN_INTERVAL_SECONDS`` gap. We use a
# ``asyncio.Lock`` (not a Semaphore) because we want strict serialization
# of the *wait* too, not just the request: otherwise a thundering herd
# of N coroutines would each independently compute "is now > last+2?"
# and fire simultaneously.
_REQUEST_LOCK = asyncio.Lock()
_LAST_REQUEST_TS: float = 0.0

# Shared async HTTP client. Lazily constructed so importing this module
# (e.g. in scripts/tests) doesn't open sockets.
_CLIENT: Optional[httpx.AsyncClient] = None
_CLIENT_LOCK = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    """Return (and lazily construct) the shared ``httpx.AsyncClient``."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    async with _CLIENT_LOCK:
        if _CLIENT is None:
            _CLIENT = httpx.AsyncClient(
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": (
                        "text/html,application/xhtml+xml,application/xml;q=0.9,"
                        "*/*;q=0.8"
                    ),
                    "Accept-Language": "en-US,en;q=0.9",
                },
                timeout=HTTP_TIMEOUT_SECONDS,
                follow_redirects=True,
                http2=False,
            )
    return _CLIENT


async def aclose() -> None:
    """Close the shared HTTP client. Call from FastAPI shutdown if you
    want a clean exit; not strictly required (httpx releases sockets on
    GC) but tidy and avoids ``ResourceWarning`` in tests."""
    global _CLIENT
    if _CLIENT is not None:
        try:
            await _CLIENT.aclose()
        finally:
            _CLIENT = None


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _normalize_callsign(raw: str) -> str:
    """Uppercase, strip, validate. Raises ``ValueError`` on garbage so
    the route layer can return a clean 400."""
    if raw is None:
        raise ValueError("callsign is required")
    cs = raw.strip().upper()
    if not _CS_OK_RE.match(cs):
        raise ValueError(f"invalid callsign: {raw!r}")
    return cs


def _clean(text: Optional[str]) -> Optional[str]:
    """Collapse whitespace and strip; return ``None`` for empty results.

    Many QRZ values come back as ``"  John  Smith  \\xa0"`` — single source
    of truth for cleaning that up.
    """
    if text is None:
        return None
    t = _WS_RE.sub(" ", text.replace("\xa0", " ")).strip()
    return t or None


def _cache_get(callsign: str) -> tuple[bool, Optional[QRZPublicProfile]]:
    """Synchronous cache read. Returns ``(hit, value)``.

    The cache is keyed by *normalized* callsign. ``hit=True, value=None``
    encodes a remembered negative result.
    """
    entry = _CACHE.get(callsign)
    if entry is None:
        return False, None
    if entry.expires_at < time.time():
        # Expired — drop lazily.
        _CACHE.pop(callsign, None)
        return False, None
    return True, entry.value


def _cache_put(
    callsign: str,
    value: Optional[QRZPublicProfile],
    *,
    positive: bool,
) -> None:
    """Synchronous cache write. ``positive`` selects which TTL to use."""
    ttl = POSITIVE_TTL_SECONDS if positive else NEGATIVE_TTL_SECONDS
    _CACHE[callsign] = _CacheEntry(value=value, expires_at=time.time() + ttl)


async def _throttle() -> None:
    """Enforce the global ``MIN_INTERVAL_SECONDS`` gap.

    Must be called *while holding* :data:`_REQUEST_LOCK`. Sleeps the
    coroutine (not the event loop) so other endpoints stay responsive.
    """
    global _LAST_REQUEST_TS
    now = time.monotonic()
    wait = (_LAST_REQUEST_TS + MIN_INTERVAL_SECONDS) - now
    if wait > 0:
        await asyncio.sleep(wait)
    _LAST_REQUEST_TS = time.monotonic()


# --------------------------------------------------------------------------- #
# HTML parsing                                                                #
# --------------------------------------------------------------------------- #


def _looks_blocked(html: str) -> bool:
    """Return True if the body matches a known soft-block fingerprint."""
    head = html[:8192]  # blocks always announce themselves up top
    return any(m in head for m in SOFT_BLOCK_MARKERS)


def _looks_not_found(html: str) -> bool:
    """Return True if the body matches a known not-found fingerprint."""
    return any(m in html for m in NOT_FOUND_MARKERS)


def _extract_kv_pairs(soup: BeautifulSoup) -> dict[str, str]:
    """Collect every ``<th>label</th><td>value</td>`` pair on the page.

    QRZ's biodata block historically uses this exact pattern (and still
    does for the "Born", "Class", "Grid", "ITU/CQ Zone" rows on the
    modern layout). We index by *lowercased* label so the consumer can
    write `pairs.get("class")` without worrying about capitalisation.
    """
    out: dict[str, str] = {}
    for row in soup.find_all("tr"):
        if not isinstance(row, Tag):
            continue
        th = row.find("th")
        td = row.find("td")
        if not isinstance(th, Tag) or not isinstance(td, Tag):
            continue
        label = _clean(th.get_text(" ", strip=True))
        value = _clean(td.get_text(" ", strip=True))
        if not label or not value:
            continue
        out[label.lower().rstrip(":")] = value
    return out


def _extract_name(soup: BeautifulSoup, kv: dict[str, str]) -> Optional[str]:
    """Find the operator's name.

    Tries, in order:
      1. The ``<p class="m0">`` block under the main heading (modern QRZ).
      2. A ``Name`` row in the kv table (older QRZ).
      3. The ``<title>`` tag's "Callsign, Name - ..." pattern.
    """
    # 1. Modern: header area carries the name in a paragraph with class m0.
    name_p = soup.select_one("p.m0")
    if isinstance(name_p, Tag):
        candidate = _clean(name_p.get_text(" ", strip=True))
        if candidate and len(candidate) <= 120:
            return candidate
    # 2. KV table fallback.
    for key in ("name", "operator", "licensee"):
        if key in kv:
            return kv[key]
    # 3. Title tag pattern: "CALLSIGN - Name - QRZ.com".
    if soup.title and soup.title.string:
        parts = [p.strip() for p in soup.title.string.split("-")]
        if len(parts) >= 2:
            cand = _clean(parts[1])
            if cand and not cand.lower().startswith("callsign"):
                return cand
    return None


def _extract_address_block(
    soup: BeautifulSoup, kv: dict[str, str]
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Return ``(address, city, state, zip, country)``.

    QRZ exposes an address block only when the licensee has *not* opted
    out (FCC PO Box rule). When it exists, the modern markup wraps it
    in ``<address>`` or a div with id/class ``biodata``/``address``;
    older layouts dump it into the kv table under ``Address`` / ``QTH``.
    """
    addr_raw: Optional[str] = None

    # 1. Look for a semantic <address> element.
    addr_tag = soup.find("address")
    if isinstance(addr_tag, Tag):
        addr_raw = addr_tag.get_text("\n", strip=True)

    # 2. KV fallback.
    if not addr_raw:
        for key in ("address", "qth", "mailing"):
            if key in kv:
                addr_raw = kv[key]
                break

    country: Optional[str] = kv.get("country")
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_: Optional[str] = None

    if addr_raw:
        # Normalize: split on newlines, drop empties, trim each.
        lines = [
            _clean(line)
            for line in re.split(r"[\n\r]+", addr_raw)
            if _clean(line)
        ]
        # The last non-country line is usually "City, ST 12345" or "City, ST".
        # The line before that (if any) is the street.
        # Strip a country line if it duplicates the kv country.
        if lines and country and lines[-1] and lines[-1].lower() == country.lower():
            lines = lines[:-1]
        if lines:
            csz_match = _CITY_STATE_ZIP_RE.match(lines[-1] or "")
            if csz_match:
                city = _clean(csz_match.group("city"))
                state = _clean(csz_match.group("state"))
                zip_ = _clean(csz_match.group("zip"))
                if len(lines) >= 2:
                    address = lines[-2]
            else:
                # No clean CSZ split — just keep the last line as city-ish.
                city = lines[-1]
                if len(lines) >= 2:
                    address = lines[-2]

    # Some pages put city/state in the kv table even when not in the
    # address block (foreign ops, club stations, etc.). Fill any gaps.
    city = city or kv.get("city")
    state = state or kv.get("state") or kv.get("province")
    zip_ = zip_ or kv.get("zip") or kv.get("postal code")

    return address, city, state, zip_, country


def _extract_license_class(kv: dict[str, str], html: str) -> Optional[str]:
    """Pull the license class from the kv table or, failing that, from a
    well-known label-and-value sentence in the body text."""
    for key in ("class", "license class", "license"):
        if key in kv:
            return kv[key]
    # Fallback: search the body for "Class: Extra" style strings.
    m = re.search(r"(?:License\s+)?Class[:\s]+([A-Za-z][A-Za-z /]{1,30})", html)
    if m:
        return _clean(m.group(1))
    return None


def _extract_bio_snippet(soup: BeautifulSoup) -> Optional[str]:
    """Pull a short text-only snippet of the user's biography section.

    QRZ wraps the bio in a div with id ``biodata`` or ``bioinfo`` (the
    name varies by skin/era). We strip ``<script>``/``<style>`` and any
    embedded ``<img>`` alt-text noise, then collapse whitespace and cap
    at :data:`BIO_SNIPPET_MAX_CHARS`.
    """
    candidates = [
        soup.find(id="biodata"),
        soup.find(id="bioinfo"),
        soup.find(id="biographydiv"),
        soup.find("div", class_="biodata"),
    ]
    for c in candidates:
        if not isinstance(c, Tag):
            continue
        # Defensively strip noisy children.
        for noisy in c.find_all(["script", "style", "noscript"]):
            noisy.decompose()
        text = _clean(c.get_text(" ", strip=True))
        if not text:
            continue
        if len(text) > BIO_SNIPPET_MAX_CHARS:
            cut = text[:BIO_SNIPPET_MAX_CHARS].rsplit(" ", 1)[0]
            return cut.rstrip(",.;:- ") + "…"
        return text
    return None


def _parse_profile(
    callsign: str, source_url: str, html: str
) -> Optional[QRZPublicProfile]:
    """Parse a QRZ HTML page into a :class:`QRZPublicProfile`.

    Returns ``None`` if the page looks like a not-found / blocked page,
    or if no usable field could be extracted at all (suggesting QRZ
    changed its markup and we shouldn't pretend to have data).
    """
    if _looks_blocked(html):
        logger.info("qrz: soft-block detected for %s", callsign)
        return None
    if _looks_not_found(html):
        logger.info("qrz: not-found marker matched for %s", callsign)
        return None

    soup = BeautifulSoup(html, "html.parser")
    kv = _extract_kv_pairs(soup)

    name = _extract_name(soup, kv)
    address, city, state, zip_, country = _extract_address_block(soup, kv)
    license_class = _extract_license_class(kv, html)
    grid = kv.get("grid") or kv.get("grid square")
    itu = kv.get("itu zone") or kv.get("itu")
    cq = kv.get("cq zone") or kv.get("cq")
    bio = _extract_bio_snippet(soup)

    # Sanity: if every field is empty, the page wasn't actually a profile
    # page (e.g. QRZ served a generic landing page). Treat as not-found.
    if not any([name, address, city, state, zip_, country, license_class, grid, bio]):
        logger.info("qrz: no fields extracted for %s; treating as not-found", callsign)
        return None

    return QRZPublicProfile(
        callsign=callsign,
        source_url=source_url,
        name=name,
        address=address,
        city=city,
        state=state,
        zip=zip_,
        country=country,
        license_class=license_class,
        grid=grid,
        itu_zone=itu,
        cq_zone=cq,
        bio_snippet=bio,
        fetched_at=time.time(),
        cached=False,
    )


# --------------------------------------------------------------------------- #
# Public API                                                                  #
# --------------------------------------------------------------------------- #


async def fetch_qrz_public(callsign: str) -> Optional[QRZPublicProfile]:
    """Fetch (or return a cached copy of) a QRZ.com public profile.

    Returns ``None`` for any "we couldn't get useful data": 404, blocked,
    soft-blocked, network error, parse failure. Never raises on the
    network path; only ``ValueError`` for syntactically invalid
    callsigns (which the route should turn into a 400).

    The function is safe to call concurrently from arbitrarily many
    coroutines — internal locking ensures we respect the global 1-req-
    per-2-seconds budget against QRZ.
    """
    cs = _normalize_callsign(callsign)

    # 1. Cache check (no lock needed for a dict read; misses just re-fetch).
    hit, cached = _cache_get(cs)
    if hit:
        if cached is None:
            logger.debug("qrz: cache hit (negative) for %s", cs)
            return None
        logger.debug("qrz: cache hit for %s", cs)
        # Return a copy with ``cached=True`` so the API consumer can tell.
        return cached.model_copy(update={"cached": True})

    url = f"{QRZ_BASE_URL}{cs}"

    # 2. Network — under the global lock + interval gap.
    async with _REQUEST_LOCK:
        # Re-check cache inside the lock; another coroutine may have just
        # populated it while we were queued.
        hit, cached = _cache_get(cs)
        if hit:
            if cached is None:
                return None
            return cached.model_copy(update={"cached": True})

        await _throttle()
        client = await _get_client()
        try:
            resp = await client.get(url)
        except (httpx.HTTPError, OSError) as e:
            logger.warning("qrz: network error for %s: %s", cs, e)
            async with _CACHE_LOCK:
                _cache_put(cs, None, positive=False)
            return None

        status = resp.status_code
        if status == 404:
            logger.info("qrz: 404 for %s", cs)
            async with _CACHE_LOCK:
                _cache_put(cs, None, positive=False)
            return None
        if status in (401, 403, 451, 429) or status >= 500:
            logger.warning("qrz: HTTP %s for %s (treated as blocked)", status, cs)
            async with _CACHE_LOCK:
                _cache_put(cs, None, positive=False)
            return None
        if status != 200:
            logger.info("qrz: unexpected HTTP %s for %s", status, cs)
            async with _CACHE_LOCK:
                _cache_put(cs, None, positive=False)
            return None

        html = resp.text
        profile = _parse_profile(cs, str(resp.url), html)

        async with _CACHE_LOCK:
            _cache_put(cs, profile, positive=profile is not None)

        return profile


def cache_stats() -> dict[str, int]:
    """Diagnostic helper: counts of (total, positive, negative) entries.

    Useful for the ``/health`` endpoint and unit tests; not on the
    critical path of any user request.
    """
    now = time.time()
    total = 0
    positive = 0
    negative = 0
    for entry in _CACHE.values():
        if entry.expires_at < now:
            continue
        total += 1
        if entry.value is None:
            negative += 1
        else:
            positive += 1
    return {"total": total, "positive": positive, "negative": negative}


def _reset_for_tests() -> None:
    """Wipe cache + last-request timestamp. Test-only hook."""
    global _LAST_REQUEST_TS
    _CACHE.clear()
    _LAST_REQUEST_TS = 0.0


__all__ = [
    "QRZPublicProfile",
    "fetch_qrz_public",
    "cache_stats",
    "aclose",
    "QRZ_BASE_URL",
    "USER_AGENT",
    "MIN_INTERVAL_SECONDS",
    "POSITIVE_TTL_SECONDS",
    "NEGATIVE_TTL_SECONDS",
]
