"""Callsign routes.

Endpoints (mounted under ``/callsign`` by ``app.main``; Caddy adds ``/api``)
--------------------------------------------------------------------------
GET /callsign/{cs}            -> CallsignDetail (latest record + roll-ups)
GET /callsign/{cs}/history    -> CallsignHistoryItem[] (every edition)
GET /callsign/{cs}/holders    -> HoldersHistoryResult (grouped by holder)
GET /callsign/{cs}/nearby     -> NearbyCallsigns (12 suffix-adjacent calls)

All four endpoints serve from the ``entries`` table (and the
``callsign_history`` view) only — no writes, no FTS5 calls (those live in
the search router). The biggest cost is the holders endpoint, which scans
every row for the callsign; ``idx_entries_callsign`` keeps that O(rows-per-
callsign) which is in practice 1-99 rows.
"""

from __future__ import annotations

import re
import sqlite3
from collections import Counter, OrderedDict
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam
from pydantic import BaseModel, Field

from app.db import get_db
from app.integrations import fcc_uls
from app.integrations import uls_history as _uls_history

router = APIRouter(prefix="/api/callsign", tags=["callsign"])


# --------------------------------------------------------------------------- #
# Pydantic models                                                             #
# --------------------------------------------------------------------------- #

CALLSIGN_RE = re.compile(r"^[A-Z0-9/]{3,12}$")


class CallsignHistoryItem(BaseModel):
    callsign: str
    year: int
    edition: str | None
    name: str | None
    city: str | None
    state: str | None
    license_class: str | None
    # State on this edition looks like an OCR misread: the rest of the
    # callsign's history (the editions immediately before AND after) agrees on
    # a *different* state. Set only for sandwiched one-off outliers, so genuine
    # moves (state changes and stays) are never flagged.
    state_suspect: bool = False
    # What the surrounding history indicates the state should be (when suspect).
    state_consensus: str | None = None


class LicenseClassPeriod(BaseModel):
    license_class: str
    first_year: int
    last_year: int
    editions_count: int


class StateTenure(BaseModel):
    state: str
    first_year: int
    last_year: int
    editions_count: int


class CallsignLatest(BaseModel):
    callsign: str
    year: int
    edition: str | None
    name: str | None
    address: str | None
    city: str | None
    state: str | None
    zip: str | None
    license_class: str | None


class CallsignDetail(BaseModel):
    callsign: str
    found: bool = True
    latest: CallsignLatest
    first_seen_year: int
    last_seen_year: int
    editions_count: int = Field(
        ..., description="Total number of editions the callsign appears in."
    )
    distinct_years: int
    states_held: list[StateTenure]
    license_class_progression: list[LicenseClassPeriod]


class HolderGroup(BaseModel):
    holder_key: str = Field(
        ..., description="Normalized name used as the grouping key."
    )
    display_name: str = Field(
        ..., description="Most-frequent raw-name spelling for this holder."
    )
    name_variants: list[str] = Field(
        default_factory=list,
        description="All distinct raw-name spellings collapsed into this group.",
    )
    first_year: int
    last_year: int
    years: list[int]
    editions_count: int
    cities: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list)


class HoldersHistoryResult(BaseModel):
    callsign: str
    distinct_holders: int
    holders: list[HolderGroup]


class NearbyCallsign(BaseModel):
    callsign: str
    distance: int = Field(
        ..., description="Signed numeric distance in the suffix space."
    )
    last_year: int
    name: str | None
    state: str | None


class NearbyCallsigns(BaseModel):
    callsign: str
    prefix: str
    suffix: str
    nearby: list[NearbyCallsign]


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

_CS_SPLIT_RE = re.compile(r"^([A-Z]+\d+)([A-Z]+)$")
_SUFFIX_TRAIL_RE = re.compile(r"\b(JR|SR|II|III|IV)\.?$")
_NAME_PUNCT_RE = re.compile(r"[^\w\s]+", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_callsign(raw: str) -> str:
    cs = (raw or "").strip().upper()
    if not CALLSIGN_RE.match(cs):
        raise HTTPException(status_code=400, detail=f"invalid callsign: {raw!r}")
    return cs


def normalize_name(raw: str | None) -> str:
    """Collapse minor OCR-noise variants of a person's name.

    Steps: uppercase -> strip diacritics-light punctuation (keep word chars
    and spaces) -> collapse whitespace -> drop trailing JR/SR/II/III/IV.
    Returns ``""`` for empty / None input.
    """
    if not raw:
        return ""
    s = raw.upper()
    s = _NAME_PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    # Drop trailing generational suffix, possibly repeated (e.g. "SMITH JR JR").
    while True:
        new = _SUFFIX_TRAIL_RE.sub("", s).strip()
        if new == s:
            break
        s = new
    return s


# ---------------------------------------------------------------------------
# OCR display-field cleaners (applied at API boundary for detail/history)
# These mirror the frontend ocrClean.ts functions so that external API
# consumers receive the same cleaned values the UI shows.
# ---------------------------------------------------------------------------

_LEAD_NOISE_RE = re.compile(r"""^['"\.\~&;:,\s]+""")
_TRAIL_NOISE_RE = re.compile(r"""['"\.\~&;:,\s]+$""")
_MID_NOISE_RE = re.compile(r"""\s[\.~&;:]+\s""")
_SPACED_LETTERS_RE = re.compile(r"\b(?:[A-Za-z]\s){2,}[A-Za-z]\b")

_TRAIL_COMPASS_RE = re.compile(r"\s+(?:N|S|E|W|NE|NW|SE|SW)$")
_TRAIL_ZIP_RE = re.compile(r"(?:^|\s+)[0-9bBlBoO&sS]{5,6}\s*$")
_TRAIL_STATE_RE = re.compile(r"\s+[A-Z]{2}\s*$")

_US_STATE_CODES: frozenset[str] = frozenset([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC", "PR", "VI", "GU", "AS", "MP",
])


def clean_ocr_name(raw: str | None) -> str | None:
    """Clean an operator name for display — strips leading/trailing noise,
    collapses spaced-out single letters (e.g. ``T h o m a s`` → ``Thomas``).
    Returns ``None`` when the input is empty/None (preserving the field's
    nullable contract for callers that treat ``None`` as "unknown")."""
    if not raw:
        return None
    s = _WS_RE.sub(" ", raw)
    s = _LEAD_NOISE_RE.sub("", s)
    s = _TRAIL_NOISE_RE.sub("", s)
    s = _SPACED_LETTERS_RE.sub(lambda m: m.group(0).replace(" ", ""), s)
    s = _MID_NOISE_RE.sub(" ", s)
    s = s.strip()
    return s if s else None


def clean_ocr_city(raw: str | None) -> str | None:
    """Clean a city field that may contain bleed of address, ZIP, or state tokens."""
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None

    # If there's a comma, isolate the most likely city token.
    if "," in s:
        last_comma = s.rfind(",")
        after = s[last_comma + 1:].strip()
        before = s[:last_comma].strip()
        # Keep afterLast unless it has no alphabetic chars (bare ZIP/code).
        if not re.search(r"[A-Za-z]", after):
            s = before
        else:
            s = after

    # Iteratively strip trailing noise: compass, ZIP-like, 2-char state.
    for _ in range(3):
        s = _TRAIL_COMPASS_RE.sub("", s)
        s = _TRAIL_ZIP_RE.sub("", s)
        s = _TRAIL_STATE_RE.sub("", s)

    s = _WS_RE.sub(" ", s).strip()
    # Pure non-alpha result is noise.
    if not s or not re.search(r"[A-Za-z]", s):
        return None
    return s


def clean_ocr_state(raw: str | None) -> str | None:
    """Return a validated 2-char US state/territory code, or None.
    Does NOT attempt to recover the state from the city field — that
    cross-field heuristic lives in the frontend only."""
    if not raw:
        return None
    norm = raw.strip().upper()
    if len(norm) == 2 and norm in _US_STATE_CODES:
        return norm
    return None


def split_callsign(cs: str) -> tuple[str, str] | tuple[None, None]:
    """Split callsign into (prefix, alpha-suffix). Returns (None, None) if it
    doesn't match the standard ``LETTERS+DIGITS+LETTERS`` shape (so portables
    like ``W1AW/4`` and oddities just yield no nearby list)."""
    m = _CS_SPLIT_RE.match(cs)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def suffix_to_int(suf: str) -> int:
    """Base-26 (A=1..Z=26) encoding of an all-uppercase suffix."""
    n = 0
    for ch in suf:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n


def int_to_suffix(n: int, length: int) -> str | None:
    """Inverse of :func:`suffix_to_int`. Returns None on underflow/overflow
    out of the fixed ``length``-letter space (so we don't cross e.g. ZZ->AAA).
    """
    min_n = suffix_to_int("A" * length)
    max_n = suffix_to_int("Z" * length)
    if n < min_n or n > max_n:
        return None
    out: list[str] = []
    for _ in range(length):
        n, r = divmod(n - 1, 26)
        out.append(chr(ord("A") + r))
    return "".join(reversed(out))


def _rows(cur: sqlite3.Cursor) -> Iterable[sqlite3.Row]:
    while True:
        batch = cur.fetchmany(512)
        if not batch:
            return
        yield from batch


# --------------------------------------------------------------------------- #
# Endpoints                                                                   #
# --------------------------------------------------------------------------- #


@router.get("/{cs}", response_model=CallsignDetail)
def get_callsign(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> CallsignDetail:
    callsign = normalize_callsign(cs)

    cur = db.execute(
        """
        SELECT year, edition, callsign, license_class, name,
               address, city, state, zip
        FROM   entries
        WHERE  callsign = ?
        ORDER  BY year DESC, edition DESC
        """,
        (callsign,),
    )
    rows = cur.fetchall()
    if not rows:
        # No historical (printed-callbook) corpus rows. Before 404-ing, check
        # the in-memory FCC ULS snapshot: a CURRENT-only callsign (granted in
        # the ULS era, never printed in the scanned callbooks) lives there but
        # not in the corpus. If we find it, synthesize a minimal CallsignDetail
        # from the ULS record so the detail page renders (empty printed history
        # + the live license panel) instead of "Signal lost".
        rec = fcc_uls.lookup(callsign)
        if rec is not None:
            grant_year = rec.grant_date_iso.year if rec.grant_date_iso else 0
            return CallsignDetail(
                callsign=callsign,
                latest=CallsignLatest(
                    callsign=callsign,
                    year=grant_year,
                    edition="FCC ULS (current)",
                    name=rec.full_name,
                    address=None,
                    city=None,
                    state=None,
                    zip=None,
                    license_class=None,
                ),
                first_seen_year=grant_year,
                last_seen_year=grant_year,
                editions_count=0,
                distinct_years=0,
                states_held=[],
                license_class_progression=[],
            )
        raise HTTPException(status_code=404, detail=f"callsign not found: {callsign}")

    latest = rows[0]
    years = [r["year"] for r in rows if r["year"] is not None]
    first_year = min(years) if years else 0
    last_year = max(years) if years else 0

    # States: order by most-recent appearance, with first/last/count.
    state_first: dict[str, int] = {}
    state_last: dict[str, int] = {}
    state_count: Counter[str] = Counter()
    for r in rows:
        st = (r["state"] or "").strip().upper()
        yr = r["year"]
        if not st or yr is None:
            continue
        state_count[st] += 1
        state_first[st] = min(state_first.get(st, yr), yr)
        state_last[st] = max(state_last.get(st, yr), yr)

    states_held = sorted(
        (
            StateTenure(
                state=st,
                first_year=state_first[st],
                last_year=state_last[st],
                editions_count=state_count[st],
            )
            for st in state_count
        ),
        key=lambda s: (-s.last_year, s.state),
    )

    # License-class progression: collapse consecutive same-class runs.
    by_year: dict[int, str] = {}
    for r in rows:
        lc = (r["license_class"] or "").strip().upper()
        yr = r["year"]
        if not lc or yr is None:
            continue
        # Prefer earliest-seen-in-year value; ordering by year DESC means we
        # overwrite; switch to setdefault to keep first.
        by_year.setdefault(yr, lc)

    progression: list[LicenseClassPeriod] = []
    for yr in sorted(by_year):
        lc = by_year[yr]
        if progression and progression[-1].license_class == lc:
            prev = progression[-1]
            progression[-1] = LicenseClassPeriod(
                license_class=lc,
                first_year=prev.first_year,
                last_year=yr,
                editions_count=prev.editions_count + 1,
            )
        else:
            progression.append(
                LicenseClassPeriod(
                    license_class=lc,
                    first_year=yr,
                    last_year=yr,
                    editions_count=1,
                )
            )

    return CallsignDetail(
        callsign=callsign,
        latest=CallsignLatest(
            callsign=callsign,
            year=latest["year"],
            edition=latest["edition"],
            name=clean_ocr_name(latest["name"]),
            address=latest["address"],
            city=clean_ocr_city(latest["city"]),
            state=clean_ocr_state(latest["state"]),
            zip=latest["zip"],
            license_class=latest["license_class"],
        ),
        first_seen_year=first_year,
        last_seen_year=last_year,
        editions_count=len(rows),
        distinct_years=len(set(years)),
        states_held=states_held,
        license_class_progression=progression,
    )


@router.get("/{cs}/history", response_model=list[CallsignHistoryItem])
def get_history(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> list[CallsignHistoryItem]:
    callsign = normalize_callsign(cs)
    cur = db.execute(
        """
        SELECT callsign, year, edition, name, city, state, license_class
        FROM   callsign_history
        WHERE  callsign = ?
        ORDER  BY year ASC, edition ASC
        """,
        (callsign,),
    )
    rows = cur.fetchall()
    if not rows:
        # A current-only callsign (present in the FCC ULS snapshot but never
        # printed in the scanned callbooks) has no printed-edition history.
        # Return an empty list rather than 404 so the detail page's history
        # fetch succeeds and the page renders the live license panel.
        if fcc_uls.lookup(callsign) is not None:
            return []
        raise HTTPException(status_code=404, detail=f"callsign not found: {callsign}")
    items = [
        CallsignHistoryItem(
            callsign=r["callsign"],
            year=r["year"],
            edition=r["edition"],
            name=clean_ocr_name(r["name"]),
            city=clean_ocr_city(r["city"]),
            state=clean_ocr_state(r["state"]),
            license_class=r["license_class"],
        )
        for r in rows
    ]
    _flag_suspect_states(items)
    return items


def _flag_suspect_states(items: list[CallsignHistoryItem]) -> None:
    """Mark a state as suspect when it is a one-off outlier sandwiched between a
    different, agreeing state — almost always an OCR misread on a dense/low-
    accuracy edition, NOT a real move (a move changes state and keeps it).

    For each record with a state, find the nearest state-bearing edition before
    and after it (chronological order). If both exist, are equal to each other,
    and differ from this record's state, flag it and record the surrounding
    consensus. Records at the very start/end (no bracket on one side) are left
    alone, so we never second-guess a genuine first or most-recent location.
    """
    states = [it.state for it in items]
    n = len(states)
    for i, st in enumerate(states):
        if not st:
            continue
        prev = next((states[j] for j in range(i - 1, -1, -1) if states[j]), None)
        nxt = next((states[j] for j in range(i + 1, n) if states[j]), None)
        if prev and nxt and prev == nxt and prev != st:
            items[i].state_suspect = True
            items[i].state_consensus = prev


@router.get("/{cs}/holders", response_model=HoldersHistoryResult)
def get_holders(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> HoldersHistoryResult:
    callsign = normalize_callsign(cs)
    cur = db.execute(
        """
        SELECT year, name, city, state
        FROM   entries
        WHERE  callsign = ?
        ORDER  BY year ASC
        """,
        (callsign,),
    )
    rows = cur.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"callsign not found: {callsign}")

    # Group by normalized name. Entries with empty names are tracked under a
    # synthetic "(unknown)" key only if no other holder swallows that year.
    groups: "OrderedDict[str, dict]" = OrderedDict()
    unknown_years: list[int] = []
    for r in rows:
        raw_name = (r["name"] or "").strip()
        key = normalize_name(raw_name)
        if not key:
            if r["year"] is not None:
                unknown_years.append(r["year"])
            continue
        g = groups.get(key)
        if g is None:
            g = {
                "key": key,
                "years": [],
                "variants": Counter(),
                "cities": Counter(),
                "states": Counter(),
            }
            groups[key] = g
        if r["year"] is not None:
            g["years"].append(r["year"])
        if raw_name:
            g["variants"][raw_name] += 1
        city = (r["city"] or "").strip()
        if city:
            g["cities"][city.title()] += 1
        state = (r["state"] or "").strip().upper()
        if state:
            g["states"][state] += 1

    # Drop "(unknown)" years that fall within the span of an identified holder
    # (it's almost certainly the same person, just an OCR miss). Only surface a
    # real "unknown" group if there are unknown years AND no identified holder.
    if unknown_years and not groups:
        groups["(unknown)"] = {
            "key": "(unknown)",
            "years": unknown_years,
            "variants": Counter(),
            "cities": Counter(),
            "states": Counter(),
        }

    holder_list: list[HolderGroup] = []
    for g in groups.values():
        years_sorted = sorted(set(g["years"]))
        if not years_sorted:
            continue
        variants = [v for v, _ in g["variants"].most_common()]
        display = variants[0] if variants else g["key"]
        holder_list.append(
            HolderGroup(
                holder_key=g["key"],
                display_name=display,
                name_variants=variants,
                first_year=years_sorted[0],
                last_year=years_sorted[-1],
                years=years_sorted,
                editions_count=len(g["years"]),
                cities=[c for c, _ in g["cities"].most_common(8)],
                states=[s for s, _ in g["states"].most_common(8)],
            )
        )

    holder_list.sort(key=lambda h: (h.first_year, h.last_year, h.holder_key))

    return HoldersHistoryResult(
        callsign=callsign,
        distinct_holders=len(holder_list),
        holders=holder_list,
    )


@router.get("/{cs}/nearby", response_model=NearbyCallsigns)
def get_nearby(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> NearbyCallsigns:
    callsign = normalize_callsign(cs)
    prefix, suffix = split_callsign(callsign)
    if prefix is None or suffix is None:
        # Unsplittable callsigns just get an empty list rather than a 4xx —
        # the lookup itself still succeeded.
        return NearbyCallsigns(callsign=callsign, prefix="", suffix="", nearby=[])

    target_n = suffix_to_int(suffix)
    sufflen = len(suffix)

    # Walk outward from target_n in alternating +1/-1 steps, generating
    # candidates of the same suffix length. Probe the DB in moderate batches
    # so we can stop early once we have 12 hits.
    candidates: list[tuple[str, int]] = []  # (candidate_cs, signed_distance)
    seen: set[str] = {callsign}
    step = 1
    # Hard cap so we don't loop forever on a very sparse band/prefix.
    MAX_PROBES = 4096
    probes = 0
    while probes < MAX_PROBES and len(candidates) < 12 * 8:
        for sign in (+1, -1):
            offset = sign * step
            n = target_n + offset
            cand_suf = int_to_suffix(n, sufflen)
            probes += 1
            if cand_suf is None:
                continue
            cand = f"{prefix}{cand_suf}"
            if cand in seen:
                continue
            seen.add(cand)
            candidates.append((cand, offset))
        step += 1
        # Once we have at least ~40 candidates queued, probe the DB; this
        # keeps individual SQL roundtrips cheap while still being able to
        # short-circuit early.
        if len(candidates) >= 32:
            break

    # Resolve in batches against the DB until we have 12 hits.
    hits: list[NearbyCallsign] = []
    # Process queue, refilling as needed.
    queue_idx = 0
    while len(hits) < 12 and (queue_idx < len(candidates) or probes < MAX_PROBES):
        # Refill the candidate queue if we've drained it.
        if queue_idx >= len(candidates) and probes < MAX_PROBES:
            for sign in (+1, -1):
                offset = sign * step
                n = target_n + offset
                cand_suf = int_to_suffix(n, sufflen)
                probes += 1
                if cand_suf is None:
                    continue
                cand = f"{prefix}{cand_suf}"
                if cand in seen:
                    continue
                seen.add(cand)
                candidates.append((cand, offset))
            step += 1
            continue

        # Probe up to 32 candidates per SQL roundtrip.
        batch = candidates[queue_idx : queue_idx + 32]
        queue_idx += len(batch)
        if not batch:
            continue

        placeholders = ",".join("?" for _ in batch)
        cs_to_offset = {c: o for c, o in batch}
        cur = db.execute(
            f"""
            SELECT callsign,
                   MAX(year)                                       AS last_year,
                   (SELECT name  FROM entries e2
                     WHERE e2.callsign = entries.callsign
                     ORDER BY year DESC LIMIT 1)                   AS last_name,
                   (SELECT state FROM entries e2
                     WHERE e2.callsign = entries.callsign
                     ORDER BY year DESC LIMIT 1)                   AS last_state
            FROM   entries
            WHERE  callsign IN ({placeholders})
            GROUP  BY callsign
            """,
            [c for c, _ in batch],
        )
        found_rows = {r["callsign"]: r for r in cur.fetchall()}
        # Preserve the order in which candidates were enqueued (closest first).
        for cand, offset in batch:
            r = found_rows.get(cand)
            if r is None:
                continue
            hits.append(
                NearbyCallsign(
                    callsign=cand,
                    distance=offset,
                    last_year=r["last_year"] or 0,
                    name=clean_ocr_name(r["last_name"]),
                    state=clean_ocr_state(r["last_state"]),
                )
            )
            if len(hits) >= 12:
                break

    # Final sort: by absolute distance ascending, ties to positive side first.
    hits.sort(key=lambda h: (abs(h.distance), -h.distance))
    return NearbyCallsigns(
        callsign=callsign,
        prefix=prefix,
        suffix=suffix,
        nearby=hits[:12],
    )


# --------------------------------------------------------------------------- #
# District-companion constants and model                                      #
# --------------------------------------------------------------------------- #

NOW_ZERO_STATES = ('CO', 'IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD')
REORG_YEAR = 1947
W_PREFIX_YEAR = 1928

# Regex for pre-1928 digit-only callsigns: 1-9 followed by 1-3 letters.
_DIGIT_ONLY_RE = re.compile(r'^([1-9])([A-Z]{1,3})$')
# Regex for W/K + digit + letters (standard post-1928 form).
_W_PREFIX_RE = re.compile(r'^([WK])([1-9])([A-Z]{1,4})$')


class DistrictCompanion(BaseModel):
    callsign: str
    companion: str | None = None
    direction: str | None = None     # 'renumbered_from' | 'continued_as' | 'w_prefix_added' | 'digit_predecessor'
    companion_first_year: int | None = None      # full span min(year) of the twin
    companion_last_year: int | None = None       # full span max(year) of the twin
    companion_last_year_pre_reorg: int | None = None  # only the now-0-state pre-reorg portion
    reorg_year: int = REORG_YEAR
    basis: str | None = None         # human-readable explanation


@router.get('/{cs}/district_companion', response_model=DistrictCompanion)
def get_district_companion(cs: str, db: sqlite3.Connection = Depends(get_db)) -> DistrictCompanion:
    cs_up = cs.strip().upper()
    try:
        prefix2 = cs_up[:2]
        suffix = cs_up[2:]

        # Cases A & B: W0/K0 <-> W9/K9 district reorg (1947).
        # Case B is checked before Case D so that a W9 call in a now-0 state
        # triggers the more specific reorg link rather than the 1928 W-prefix link.
        if prefix2 in ('W0', 'K0', 'W9', 'K9'):
            placeholders = ','.join(['?'] * len(NOW_ZERO_STATES))

            # Case A: W0/K0 -> look back to W9/K9 predecessor
            if prefix2 in ('W0', 'K0'):
                twin_prefix = prefix2[0] + '9'
                twin = twin_prefix + suffix
                row = db.execute(
                    f"SELECT MIN(year), MAX(year), COUNT(*) FROM entries "
                    f"WHERE callsign=? AND UPPER(state) IN ({placeholders}) AND year<=?",
                    (twin, *NOW_ZERO_STATES, REORG_YEAR),
                ).fetchone()
                if row and row[0] is not None and row[2] and row[2] > 0:
                    pre_max = row[1]
                    span = db.execute(
                        "SELECT MIN(year), MAX(year) FROM entries WHERE callsign=?",
                        (twin,),
                    ).fetchone()
                    return DistrictCompanion(
                        callsign=cs_up, companion=twin, direction='renumbered_from',
                        companion_first_year=span[0] if span else None,
                        companion_last_year=span[1] if span else None,
                        companion_last_year_pre_reorg=pre_max,
                        reorg_year=REORG_YEAR,
                        basis=f'W9->W0 district reorg Nov {REORG_YEAR}; {twin} held in '
                              f'now-0 state ({", ".join(NOW_ZERO_STATES)}) through {pre_max}',
                    )

            # Case B: W9/K9 -> link to W0/K0 successor (preferred over Case D for same call)
            else:
                twin_prefix = prefix2[0] + '0'
                twin = twin_prefix + suffix
                pre = db.execute(
                    f"SELECT MAX(year) FROM entries WHERE callsign=? AND UPPER(state) IN ({placeholders}) AND year<=?",
                    (cs_up, *NOW_ZERO_STATES, REORG_YEAR),
                ).fetchone()
                if pre and pre[0]:
                    span = db.execute(
                        "SELECT MIN(year), MAX(year) FROM entries WHERE callsign=?",
                        (twin,),
                    ).fetchone()
                    if span and span[0]:
                        return DistrictCompanion(
                            callsign=cs_up, companion=twin, direction='continued_as',
                            companion_first_year=span[0],
                            companion_last_year=span[1],
                            companion_last_year_pre_reorg=pre[0],
                            reorg_year=REORG_YEAR,
                            basis=f'W9->W0 district reorg Nov {REORG_YEAR}; this call held in '
                                  f'now-0 state through {pre[0]}, successor {twin} active from {span[0]}',
                        )
                # Case B did not match; fall through to Case D below.

        # Case C: digit-only input (e.g. "9AA") -> look up W{digit}{suffix} companion.
        m_digit = _DIGIT_ONLY_RE.match(cs_up)
        if m_digit:
            digit, letters = m_digit.group(1), m_digit.group(2)
            twin = f'W{digit}{letters}'
            # The W-form must exist with min(year) <= 1928 (i.e. it was active
            # right at or just after the 1928 W-prefix addition).
            twin_span = db.execute(
                "SELECT MIN(year), MAX(year) FROM entries WHERE callsign=?",
                (twin,),
            ).fetchone()
            if twin_span and twin_span[0] is not None and twin_span[0] <= W_PREFIX_YEAR:
                return DistrictCompanion(
                    callsign=cs_up, companion=twin, direction='w_prefix_added',
                    companion_first_year=twin_span[0],
                    companion_last_year=twin_span[1],
                    companion_last_year_pre_reorg=None,
                    reorg_year=W_PREFIX_YEAR,
                    basis=f'1928 W-prefix addition: digit-only callsigns gained W prefix; '
                          f'{cs_up} became {twin}',
                )

        # Case D: W{digit}{suffix} input (e.g. "W9AA") -> look up digit-only predecessor.
        # Only reached for W9/K9 calls that did NOT match Case B (no now-0-state entries).
        # Also handles W1-W8 and K1-K9 calls that have no reorg relevance.
        m_w = _W_PREFIX_RE.match(cs_up)
        if m_w:
            wk, digit, letters = m_w.group(1), m_w.group(2), m_w.group(3)
            # Find min year for the input callsign.
            my_span = db.execute(
                "SELECT MIN(year) FROM entries WHERE callsign=?",
                (cs_up,),
            ).fetchone()
            if my_span and my_span[0] is not None and my_span[0] <= W_PREFIX_YEAR:
                twin = f'{digit}{letters}'
                twin_span = db.execute(
                    "SELECT MIN(year), MAX(year) FROM entries WHERE callsign=?",
                    (twin,),
                ).fetchone()
                if twin_span and twin_span[0] is not None:
                    return DistrictCompanion(
                        callsign=cs_up, companion=twin, direction='digit_predecessor',
                        companion_first_year=twin_span[0],
                        companion_last_year=twin_span[1],
                        companion_last_year_pre_reorg=None,
                        reorg_year=W_PREFIX_YEAR,
                        basis=f'1928 W-prefix addition: this call was previously {twin}',
                    )

    except sqlite3.Error:
        return DistrictCompanion(callsign=cs_up)
    return DistrictCompanion(callsign=cs_up)


# --------------------------------------------------------------------------- #
# ULS History models + endpoint                                               #
# --------------------------------------------------------------------------- #


class UlsLicenseRecord(BaseModel):
    usi: str | None = None
    name: str | None = None
    status: str | None = None
    status_label: str | None = None
    grant: str | None = None
    expired: str | None = None
    cancel: str | None = None


class UlsHistoryResponse(BaseModel):
    callsign: str
    found: bool
    prev_call: str | None = None
    prev_class: str | None = None
    prev_class_label: str | None = None
    licenses: list[UlsLicenseRecord] = Field(default_factory=list)
    forward_links: list[str] = Field(
        default_factory=list,
        description="Callsigns whose AM.dat previous_callsign == this callsign (vanity successors).",
    )


def _build_uls_license(raw: dict) -> UlsLicenseRecord:
    """Normalize a single raw license dict from the artifact into a model."""
    status_raw = (raw.get("status") or "").strip().upper() or None
    status_label = _uls_history._STATUS_LABELS.get(status_raw, "Unknown") if status_raw else None
    return UlsLicenseRecord(
        usi=raw.get("usi") or None,
        name=raw.get("name") or None,
        status=status_raw,
        status_label=status_label,
        grant=raw.get("grant") or None,
        expired=raw.get("expired") or None,
        cancel=raw.get("cancel") or None,
    )


@router.get("/{cs}/uls_history", response_model=UlsHistoryResponse)
def get_uls_history(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
) -> UlsHistoryResponse:
    """Return ULS-era history for a callsign.

    Drawn from the pre-built ``uls_history.json`` artifact (AM.dat + HD.dat
    from the FCC weekly l_amat.zip dump).  Always returns HTTP 200 with
    ``found=false`` when no entry exists — never 404 or 500 for a valid
    callsign shape.

    ``forward_links`` lists callsigns whose ``AM.dat`` ``previous_callsign``
    field equals this callsign — i.e. licensees who upgraded *from* (or
    received the vanity re-issue of) this call after it was released.
    """
    callsign = normalize_callsign(cs)

    # forward_links is independent of whether the callsign itself has a record.
    fwd = _uls_history.forward_links(callsign)

    rec = _uls_history.get(callsign)
    if rec is None and not fwd:
        return UlsHistoryResponse(callsign=callsign, found=False, forward_links=fwd)

    if rec is None:
        # Only forward links — callsign itself has no prev_call or multi-license.
        return UlsHistoryResponse(callsign=callsign, found=True, forward_links=fwd)

    prev_call = (rec.get("prev_call") or "").strip().upper() or None
    prev_class_raw = (rec.get("prev_class") or "").strip().upper() or None
    prev_class_label = _uls_history._CLASS_LABELS.get(prev_class_raw) if prev_class_raw else None

    raw_licenses: list[dict] = rec.get("licenses") or []
    licenses = [_build_uls_license(lic) for lic in raw_licenses if isinstance(lic, dict)]

    return UlsHistoryResponse(
        callsign=callsign,
        found=True,
        prev_call=prev_call,
        prev_class=prev_class_raw,
        prev_class_label=prev_class_label,
        licenses=licenses,
        forward_links=fwd,
    )


# ---------------------------------------------------------------------------
# /api/callsign/{cs}/uls_chain  — shape consumed by the Next.js frontend
# ---------------------------------------------------------------------------

class UlsChainRecord(BaseModel):
    usi:          str | None = None
    holder:       str | None = None
    status:       str | None = None
    grant_date:   str | None = None
    expired_date: str | None = None
    cancel_date:  str | None = None
    # Callsign this *specific* (prior) holder later moved to, when the forward
    # link (AM.dat previous_callsign == this call) is attributable to this row
    # rather than to the current/active holder. See get_uls_chain.
    later_callsign: str | None = None


class UlsLineage(BaseModel):
    prev_callsign: str | None = None
    fwd_callsign:  str | None = None


class UlsChainResponse(BaseModel):
    callsign: str
    records:  list[UlsChainRecord] = Field(default_factory=list)
    lineage:  UlsLineage = Field(default_factory=UlsLineage)


@router.get("/{cs}/uls_chain", response_model=UlsChainResponse)
def get_uls_chain(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
) -> UlsChainResponse:
    """Frontend-facing alias for ULS history.

    Returns the same underlying data as ``/uls_history`` but in the field
    shape the Next.js callsign page expects: ``records[]`` with ``holder``,
    ``grant_date``, ``expired_date``, ``cancel_date``; and a ``lineage``
    object with ``prev_callsign`` / ``fwd_callsign``.
    """
    callsign = normalize_callsign(cs)

    fwd_list = _uls_history.forward_links(callsign)
    fwd_callsign = fwd_list[0] if fwd_list else None

    rec = _uls_history.get(callsign)
    prev_callsign: str | None = None
    records: list[UlsChainRecord] = []

    if rec is not None:
        prev_call_raw = (rec.get("prev_call") or "").strip().upper()
        prev_callsign = prev_call_raw or None

        raw_licenses: list[dict] = rec.get("licenses") or []
        for lic in raw_licenses:
            if not isinstance(lic, dict):
                continue
            status_raw = (lic.get("status") or "").strip().upper() or None
            records.append(UlsChainRecord(
                usi=lic.get("usi") or None,
                holder=lic.get("name") or None,
                status=status_raw,
                grant_date=lic.get("grant") or None,
                expired_date=lic.get("expired") or None,
                cancel_date=lic.get("cancel") or None,
            ))

    # ------------------------------------------------------------------
    # Forward-link attribution.
    #
    # ``fwd_callsign`` is "a callsign whose AM.dat previous_callsign == this
    # call" — i.e. somebody who upgraded *away from* this call after releasing
    # it.  When this call has had MULTIPLE licensees over time, that departure
    # belongs to a PRIOR holder, not to the current/active one.  Surfacing it
    # in the hero (which describes the current holder) reads as if the current
    # holder moved away, which is wrong (see AB0ZW / WD0EKE).
    #
    # Rule:
    #   * 0 or 1 license records  -> the lineage genuinely IS the (single)
    #     holder's; keep ``fwd_callsign`` in the hero lineage unchanged.
    #   * 2+ license records      -> the forward link is a prior holder's
    #     departure.  Drop it from the hero lineage and instead attribute it
    #     to the most-recent DEPARTED (non-current) holder row so it renders
    #     in the license-history section beside that specific person.
    # ------------------------------------------------------------------
    hero_fwd_callsign: str | None = fwd_callsign
    if fwd_callsign and len(records) >= 2:
        hero_fwd_callsign = None

        def _grant_key(r: UlsChainRecord) -> str:
            # Empty grant sorts first; ISO dates sort lexicographically.
            return r.grant_date or ""

        ordered = sorted(records, key=_grant_key)
        # Current holder = latest license by grant date. Anything earlier is a
        # departed predecessor; the departure (forward link) is attributed to
        # the most recent of those predecessors.
        predecessors = ordered[:-1]
        if predecessors:
            predecessors[-1].later_callsign = fwd_callsign
        else:
            # Defensive: no clear predecessor — fall back to keeping it in the
            # hero rather than dropping the datum entirely.
            hero_fwd_callsign = fwd_callsign

    return UlsChainResponse(
        callsign=callsign,
        records=records,
        lineage=UlsLineage(prev_callsign=prev_callsign, fwd_callsign=hero_fwd_callsign),
    )


__all__ = [
    "router",
    "normalize_callsign",
    "normalize_name",
    "split_callsign",
    "suffix_to_int",
    "int_to_suffix",
    "CallsignDetail",
    "CallsignHistoryItem",
    "HoldersHistoryResult",
    "HolderGroup",
    "NearbyCallsigns",
    "NearbyCallsign",
    "DistrictCompanion",
    "UlsLicenseRecord",
    "UlsHistoryResponse",
]
