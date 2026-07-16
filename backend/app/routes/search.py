"""
Smart search route for the ham-callbook API.

Endpoints
---------
GET /api/search   — FTS5-backed search with intent detection + facets.
GET /api/suggest  — Top-8 autocomplete suggestions for callsign prefixes / names.

Intent detection
----------------
* Callsign pattern ([AKNW][A-Z]?\\d[A-Z]{1,3}) -> bias toward `callsign` column.
* 2-letter all-caps US state code -> filter on state.
* Single capitalized word (city-shaped) -> bias toward `city`.
* Multiple letter words -> name search (FTS5 across name).

All hits are scored using the FTS5 bm25() function (lower is better);
the response inverts to a 0..1 scale so the UI can treat higher as better.

Caching
-------
A process-local cachetools.TTLCache holds the last 100 result envelopes
keyed by the full query+filters+limit+offset+sort tuple. TTL = 5 minutes.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
from typing import Optional

from cachetools import TTLCache
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.integrations import fcc_uls

# ---------------------------------------------------------------------------
# DB connection (thread-local, read-only).
# ---------------------------------------------------------------------------

# Reuse db.py's resolved path — it has a project-relative fallback that finds
# the DB even when no DB_PATH env var is set (which search.py's old hardcoded
# "/data/..." default did not, causing /api/search to 500 while /api/health
# stayed up). HAM_DB_PATH still wins if explicitly set.
from app.db import DB_PATH as _DB_DEFAULT  # noqa: E402

DB_PATH = os.environ.get("HAM_DB_PATH") or os.environ.get("DB_PATH") or _DB_DEFAULT

_LOCAL = threading.local()


def _conn() -> sqlite3.Connection:
    """Per-thread read-only SQLite connection with sane pragmas."""
    c = getattr(_LOCAL, "conn", None)
    if c is not None:
        return c
    # immutable=1 so this read-only opener works when the DB (WAL mode) sits on
    # a read-only mount (./data:/data:ro) — plain mode=ro can't create the -shm.
    uri = f"file:{DB_PATH}?mode=ro&immutable=1"
    c = sqlite3.connect(uri, uri=True, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(
        """
        PRAGMA query_only   = ON;
        PRAGMA temp_store   = MEMORY;
        PRAGMA cache_size   = -65536;
        PRAGMA mmap_size    = 1073741824;
        """
    )
    _LOCAL.conn = c
    return c


# ---------------------------------------------------------------------------
# Response models (mirror frontend/lib/types.ts).
# ---------------------------------------------------------------------------


class SearchHit(BaseModel):
    kind: str = Field(..., description="callsign | name | city")
    score: float
    callsign: str
    year: int
    edition: str
    name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    snippet: str


class FacetYear(BaseModel):
    year: int
    count: int


class FacetState(BaseModel):
    state: str
    count: int


class SearchFacets(BaseModel):
    years: list[FacetYear]
    states: list[FacetState]


class SearchResults(BaseModel):
    hits: list[SearchHit]
    total: int
    facets: SearchFacets


class SuggestItem(BaseModel):
    value: str
    kind: str  # "callsign" | "name"
    count: int


class SuggestResults(BaseModel):
    q: str
    items: list[SuggestItem]


# ---------------------------------------------------------------------------
# In-process result cache.
# ---------------------------------------------------------------------------

_RESULT_CACHE: TTLCache = TTLCache(maxsize=100, ttl=300)
_SUGGEST_CACHE: TTLCache = TTLCache(maxsize=200, ttl=300)
_CACHE_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Query intent detection.
# ---------------------------------------------------------------------------

CALLSIGN_RE = re.compile(r"^[AKNW][A-Z]?\d[A-Z]{1,3}$", re.IGNORECASE)
CALLSIGN_PREFIX_RE = re.compile(r"^[AKNW][A-Z]?\d[A-Z]{0,3}$", re.IGNORECASE)
STATE_RE = re.compile(r"^[A-Z]{2}$")

# Recognized 2-letter US state / territory codes.
US_STATES: frozenset[str] = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY", "PR", "VI", "GU", "AS", "MP", "CZ", "PI",
})


def _classify_query(q: str) -> str:
    """Return one of: callsign, callsign_prefix, state, city, name."""
    stripped = q.strip()
    if not stripped:
        return "name"
    if CALLSIGN_RE.match(stripped):
        return "callsign"
    upper = stripped.upper()
    if STATE_RE.match(upper) and upper in US_STATES:
        return "state"
    if CALLSIGN_PREFIX_RE.match(stripped) and any(ch.isdigit() for ch in stripped):
        return "callsign_prefix"
    words = [w for w in re.split(r"\s+", stripped) if w]
    if len(words) == 1 and words[0].isalpha() and words[0][:1].isupper():
        # Single capitalized word — could be a city OR a surname.
        # Bias toward city only when the user later picks a state filter; for
        # the generic case treat as a name search (most useful default).
        return "name"
    return "name"


# ---------------------------------------------------------------------------
# FTS5 query building.
# ---------------------------------------------------------------------------

# Characters that MUST NOT leak into an FTS5 MATCH expression unquoted.
_FTS_UNSAFE = re.compile(r'["\']')


def _fts_token(word: str) -> str:
    """Quote a single token for FTS5, escaping embedded double quotes."""
    cleaned = _FTS_UNSAFE.sub(" ", word).strip()
    if not cleaned:
        return ""
    # FTS5 phrase quoting: wrap in double quotes; an embedded quote is
    # already stripped above so simple wrapping suffices.
    return f'"{cleaned}"'


def _build_fts_match(q: str, intent: str) -> str:
    """Build an FTS5 MATCH expression appropriate to the detected intent."""
    q = q.strip()
    words = [w for w in re.split(r"\s+", q) if w]
    if not words:
        return ""

    if intent == "callsign":
        # Exact-ish callsign hit: weight column 'callsign'.
        cs = _fts_token(q.upper())
        return f"callsign:{cs}"

    if intent == "callsign_prefix":
        # Prefix match on callsign column.
        bare = _FTS_UNSAFE.sub("", q.upper()).strip()
        if not bare:
            return ""
        return f'callsign:"{bare}"*'

    if intent == "state":
        st = _fts_token(q.upper())
        return f"state:{st}"

    # Name search across name+city, prefix-matched per token.
    parts: list[str] = []
    for w in words:
        bare = _FTS_UNSAFE.sub("", w).strip()
        if not bare:
            continue
        # Prefix * lets "smit" match "smith"; surrounding quotes preserve
        # any unicode punctuation we DIDN'T strip.
        parts.append(f'(name:"{bare}"* OR city:"{bare}"*)')
    return " AND ".join(parts)


# ---------------------------------------------------------------------------
# Snippet helper.
# ---------------------------------------------------------------------------

# entries_fts columns: 0=name, 1=callsign, 2=city, 3=state.
SNIPPET_COL_BY_INTENT = {
    "callsign":        1,
    "callsign_prefix": 1,
    "state":           3,
    "name":            0,
    "city":            2,
}


# ---------------------------------------------------------------------------
# Current-license (FCC ULS) augmentation.
# ---------------------------------------------------------------------------

# Label shown in the `edition` slot for the synthetic current-license hit so
# the UI can clearly distinguish a live ULS record from a printed-callbook row.
_ULS_EDITION_LABEL = "FCC ULS (current)"


def _uls_hit(callsign: str) -> Optional[SearchHit]:
    """Build a synthetic SearchHit from the in-memory FCC ULS snapshot for an
    exact callsign, or ``None`` if the snapshot has no entry.

    This is what lets a CURRENT-only callsign (licensed after the last printed
    callbook, hence absent from the historical FTS corpus) still surface in
    /api/search. The snapshot is already resident in memory, so this is an
    O(1) dict lookup + a cheap model build — safe to call on the hot path for
    callsign-shaped queries only.

    The hit reuses ``kind="callsign"`` (a value the frontend's SearchHit union
    already understands, so existing click-routing works) and stamps a distinct
    ``edition`` label plus a "still licensed" snippet so the UI/operator can
    tell it apart from a printed row. ``year`` carries the ULS grant year (or 0
    if unknown).
    """
    rec = fcc_uls.lookup(callsign)
    if rec is None:
        return None

    grant_year = 0
    if rec.grant_date_iso is not None:
        grant_year = rec.grant_date_iso.year

    status_label = rec.status_label or "Unknown"
    name = rec.full_name or None
    bits: list[str] = [f"{rec.callsign} — current FCC license"]
    if name:
        bits.append(name)
    bits.append(status_label)
    if rec.grant_date:
        bits.append(f"granted {rec.grant_date}")
    snippet = " · ".join(bits)

    # Active licenses score highest (1.0); any other status slightly lower so
    # historical exact-callsign hits (which carry their own normalized score)
    # interleave sensibly when both are present.
    score = 1.0 if rec.is_active else 0.95

    return SearchHit(
        kind="callsign",
        score=score,
        callsign=rec.callsign,
        year=grant_year,
        edition=_ULS_EDITION_LABEL,
        name=name,
        city=None,
        state=None,
        snippet=snippet,
    )


# ---------------------------------------------------------------------------
# Router.
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api", tags=["search"])

# Whitelisted sort modes -> ORDER BY clauses. Only these exact strings are
# ever interpolated into SQL; anything else 400s before query build. The
# non-default modes keep bm25 `score` as a tie-breaker so relevance still
# orders rows within a year / callsign.
_SORT_ORDER_BY: dict[str, str] = {
    "score":     "score",                  # bm25 relevance — the default
    "year":      "e.year ASC, score",
    "year_desc": "e.year DESC, score",
    "callsign":  "e.callsign ASC, score",
}


@router.get("/search", response_model=SearchResults)
def search(
    q: str = Query(..., min_length=1, max_length=128, description="Search text"),
    year: Optional[int] = Query(None, ge=1900, le=2100),
    state: Optional[str] = Query(None, min_length=2, max_length=2),
    edition: Optional[str] = Query(None, min_length=1, max_length=64),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0, le=10_000),
    sort: Optional[str] = Query(
        None,
        description=(
            "Result ordering: score (bm25 relevance — default), "
            "year, year_desc, callsign."
        ),
    ),
) -> SearchResults:
    q_norm = q.strip()
    if not q_norm:
        raise HTTPException(status_code=400, detail="empty query")

    state_norm = state.upper() if state else None
    if state_norm is not None and state_norm not in US_STATES:
        raise HTTPException(status_code=400, detail=f"unknown state: {state}")

    sort_norm = (sort or "score").strip().lower()
    if sort_norm not in _SORT_ORDER_BY:
        raise HTTPException(
            status_code=400,
            detail=f"unknown sort: {sort!r} (expected one of "
                   f"{sorted(_SORT_ORDER_BY)})",
        )

    intent = _classify_query(q_norm)
    match_expr = _build_fts_match(q_norm, intent)
    if not match_expr:
        raise HTTPException(status_code=400, detail="query produced no searchable tokens")

    cache_key = (q_norm.lower(), intent, year, state_norm, edition, limit, offset, sort_norm)
    with _CACHE_LOCK:
        cached = _RESULT_CACHE.get(cache_key)
    if cached is not None:
        return cached

    snippet_col = SNIPPET_COL_BY_INTENT.get(intent, 0)

    # WHERE clauses against the joined entries row (e.year, e.state, e.edition).
    where_extra: list[str] = []
    params: list = [match_expr]
    if year is not None:
        where_extra.append("e.year = ?")
        params.append(year)
    if state_norm is not None:
        where_extra.append("UPPER(e.state) = ?")
        params.append(state_norm)
    if edition is not None:
        where_extra.append("e.edition = ?")
        params.append(edition)
    extra_sql = ("AND " + " AND ".join(where_extra)) if where_extra else ""

    conn = _conn()

    t0 = time.time()

    # ---- Hits ------------------------------------------------------------
    # bm25() lower = better; we cap fetch at limit+offset+1 to know if more.
    hit_sql = f"""
        SELECT
            e.callsign     AS callsign,
            e.year         AS year,
            e.edition      AS edition,
            e.name         AS name,
            e.city         AS city,
            e.state        AS state,
            bm25(entries_fts) AS score,
            snippet(entries_fts, {snippet_col}, '<mark>', '</mark>', '...', 12) AS snippet
        FROM entries_fts
        JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
        {extra_sql}
        ORDER BY {_SORT_ORDER_BY[sort_norm]}
        LIMIT ? OFFSET ?
    """
    hit_params = params + [limit, offset]
    try:
        hit_rows = conn.execute(hit_sql, hit_params).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=400, detail=f"FTS error: {exc}") from exc

    # Normalize score to 0..1 (higher=better). bm25 returns non-positive
    # values where 0 is a perfect match; we clip & invert.
    raw_scores = [r["score"] for r in hit_rows]
    if raw_scores:
        worst = min(raw_scores)  # most-negative
        span = abs(worst) or 1.0
    else:
        span = 1.0

    def _norm(s: float) -> float:
        return round(min(1.0, max(0.0, 1.0 - (abs(s) / span))), 4)

    # ---- Total -----------------------------------------------------------
    count_sql = f"""
        SELECT COUNT(*) AS n
        FROM entries_fts
        JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
        {extra_sql}
    """
    total = int(conn.execute(count_sql, params).fetchone()["n"])

    # ---- Facets (top-10 year + state) -----------------------------------
    facet_year_sql = f"""
        SELECT e.year AS year, COUNT(*) AS c
        FROM entries_fts
        JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
        {extra_sql}
        GROUP BY e.year
        ORDER BY c DESC, e.year DESC
        LIMIT 10
    """
    facet_state_sql = f"""
        SELECT UPPER(e.state) AS state, COUNT(*) AS c
        FROM entries_fts
        JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
        {extra_sql}
          AND e.state IS NOT NULL
          AND TRIM(e.state) != ''
        GROUP BY UPPER(e.state)
        ORDER BY c DESC, state ASC
        LIMIT 10
    """
    year_facet_rows = conn.execute(facet_year_sql, params).fetchall()
    state_facet_rows = conn.execute(facet_state_sql, params).fetchall()

    hits: list[SearchHit] = []
    hit_kind = {
        "callsign":        "callsign",
        "callsign_prefix": "callsign",
        "state":           "city",
        "name":            "name",
        "city":            "city",
    }.get(intent, "name")
    for r in hit_rows:
        hits.append(
            SearchHit(
                kind=hit_kind,
                score=_norm(r["score"]),
                callsign=r["callsign"] or "",
                year=int(r["year"]) if r["year"] is not None else 0,
                edition=r["edition"] or "",
                name=r["name"],
                city=r["city"],
                state=r["state"],
                snippet=r["snippet"] or "",
            )
        )

    # ---- Current-license augmentation (FCC ULS) -------------------------
    # For an exact callsign-shaped query, also surface the live FCC ULS
    # record so a CURRENT-only callsign — one licensed after the last printed
    # callbook and therefore absent from the historical FTS corpus — still
    # returns a hit. Constraints keep this conservative & fast:
    #   * only the exact `callsign` intent (single O(1) in-memory snapshot get);
    #   * only the first page (offset == 0), so paging stays a pure corpus walk;
    #   * skip when a year/state/edition filter is active — those columns
    #     describe printed editions, which a single ULS record can't satisfy.
    if intent == "callsign" and offset == 0 and not where_extra:
        uls_hit = _uls_hit(q_norm.upper())
        if uls_hit is not None:
            # Additive: prepend the live record ahead of the historical rows
            # (which are older printed editions of the same callsign). Bump the
            # total so the count reflects the extra surfaced result, and trim
            # back to `limit` so we never overflow the requested page size.
            hits = ([uls_hit] + hits)[:limit]
            total += 1

    result = SearchResults(
        hits=hits,
        total=total,
        facets=SearchFacets(
            years=[FacetYear(year=int(r["year"]), count=int(r["c"]))
                   for r in year_facet_rows if r["year"] is not None],
            states=[FacetState(state=r["state"], count=int(r["c"]))
                    for r in state_facet_rows if r["state"]],
        ),
    )

    # Sanity: don't poison the cache with absurdly slow outliers (>15s).
    if time.time() - t0 < 15.0:
        with _CACHE_LOCK:
            _RESULT_CACHE[cache_key] = result

    return result


# ---------------------------------------------------------------------------
# Suggest endpoint.
# ---------------------------------------------------------------------------


@router.get("/suggest", response_model=SuggestResults)
def suggest(
    q: str = Query(..., min_length=1, max_length=64),
) -> SuggestResults:
    q_norm = q.strip()
    if not q_norm:
        return SuggestResults(q=q, items=[])

    cache_key = q_norm.lower()
    with _CACHE_LOCK:
        cached = _SUGGEST_CACHE.get(cache_key)
    if cached is not None:
        return cached

    conn = _conn()
    items: list[SuggestItem] = []
    seen: set[tuple[str, str]] = set()

    # 1) Callsign prefix suggestions when q looks remotely like a callsign.
    looks_like_call = bool(re.match(r"^[AKNWaknw]", q_norm)) and any(ch.isdigit() for ch in q_norm)
    if looks_like_call or CALLSIGN_PREFIX_RE.match(q_norm):
        bare = re.sub(r"[^A-Z0-9]", "", q_norm.upper())
        if bare:
            try:
                rows = conn.execute(
                    """
                    SELECT callsign AS v, COUNT(*) AS c
                    FROM entries
                    WHERE callsign LIKE ? || '%'
                    GROUP BY callsign
                    ORDER BY c DESC, callsign ASC
                    LIMIT 8
                    """,
                    (bare,),
                ).fetchall()
                for r in rows:
                    key = ("callsign", r["v"])
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(
                        SuggestItem(value=r["v"], kind="callsign", count=int(r["c"]))
                    )
            except sqlite3.OperationalError:
                pass

    # 2) Name suggestions (FTS5 prefix) when q has letters.
    if len(items) < 8 and re.search(r"[A-Za-z]", q_norm):
        bare = re.sub(r'["\']', "", q_norm).strip()
        if bare:
            try:
                fts_expr = f'name:"{bare}"*'
                rows = conn.execute(
                    """
                    SELECT e.name AS v, COUNT(*) AS c
                    FROM entries_fts
                    JOIN entries e ON e.rowid = entries_fts.rowid
                    WHERE entries_fts MATCH ?
                      AND e.name IS NOT NULL
                      AND TRIM(e.name) != ''
                    GROUP BY e.name
                    ORDER BY c DESC, e.name ASC
                    LIMIT ?
                    """,
                    (fts_expr, 8 - len(items)),
                ).fetchall()
                for r in rows:
                    key = ("name", r["v"])
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(
                        SuggestItem(value=r["v"], kind="name", count=int(r["c"]))
                    )
            except sqlite3.OperationalError:
                pass

    result = SuggestResults(q=q, items=items[:8])
    with _CACHE_LOCK:
        _SUGGEST_CACHE[cache_key] = result
    return result
