"""Statistics endpoints — totals, growth, heatmap, integrity.

Powers the public stats / data-quality page. All endpoints return plain JSON
shaped for direct consumption by the Next.js frontend (ASCII oscilloscope
sparklines, growth charts, integrity tiles, etc).

The aggregations over ``entries`` (~7.74M rows) are expensive, so each
endpoint memoises its result in-process via :mod:`cachetools.TTLCache`.
The database is read-only and refreshed only when the image is rebuilt,
so a 1-hour TTL is plenty.

Preferred fast path: if the Data phase has materialised a
``stats_per_year`` table (year, count, states_count, etc.) we use that.
Otherwise we compute the aggregates live from ``entries`` — slower on the
first hit but still well within request budget thanks to
``idx_entries_year`` / ``idx_entries_state``.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from typing import Any, Dict, Iterable, List, Optional, Tuple

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stats", tags=["stats"])

# ---------------------------------------------------------------------------
# DB access
# ---------------------------------------------------------------------------

from app.db import DB_PATH as _DB_PATH  # honors the project-relative fallback
_conn_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _open_ro_connection(path: str) -> sqlite3.Connection:
    """Open a shared read-only SQLite connection.

    We open via URI with ``mode=ro`` so SQLite refuses any write attempts at
    the OS level — defence in depth on top of the read-only volume mount.
    ``check_same_thread=False`` is safe here because SQLite serialises
    access internally and FastAPI's threadpool is the only consumer.
    """
    uri = f"file:{path}?mode=ro&immutable=1"
    con = sqlite3.connect(uri, uri=True, check_same_thread=False, timeout=15.0)
    con.row_factory = sqlite3.Row
    # Read-only pragmas — make scans cheaper.
    con.execute("PRAGMA query_only = ON")
    con.execute("PRAGMA temp_store = MEMORY")
    con.execute("PRAGMA cache_size = -32000")  # 32 MiB page cache
    con.execute("PRAGMA mmap_size = 268435456")  # 256 MiB mmap
    return con


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _conn_lock:
            if _conn is None:
                if not os.path.exists(_DB_PATH):
                    raise HTTPException(
                        status_code=503,
                        detail=f"database not available at {_DB_PATH}",
                    )
                _conn = _open_ro_connection(_DB_PATH)
                log.info("stats: opened read-only sqlite at %s", _DB_PATH)
    return _conn


def get_db(request: Request) -> sqlite3.Connection:
    """FastAPI dependency — returns the shared read-only connection.

    Prefers a connection placed on ``app.state.db`` by ``app.main`` if one
    exists (canonical pattern), otherwise lazily opens its own.
    """
    state_conn = getattr(request.app.state, "db", None)
    if isinstance(state_conn, sqlite3.Connection):
        return state_conn
    return _get_conn()


# ---------------------------------------------------------------------------
# Caches & helpers
# ---------------------------------------------------------------------------

_CACHE_TTL_SECONDS = 3600
_overview_cache: TTLCache = TTLCache(maxsize=4, ttl=_CACHE_TTL_SECONDS)
_growth_cache: TTLCache = TTLCache(maxsize=4, ttl=_CACHE_TTL_SECONDS)
_heatmap_cache: TTLCache = TTLCache(maxsize=4, ttl=_CACHE_TTL_SECONDS)
_integrity_cache: TTLCache = TTLCache(maxsize=4, ttl=_CACHE_TTL_SECONDS)
_schema_cache: TTLCache = TTLCache(maxsize=16, ttl=_CACHE_TTL_SECONDS)


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    key = ("table", name)
    cached = _schema_cache.get(key)
    if cached is not None:
        return bool(cached)
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1",
        (name,),
    ).fetchone()
    exists = row is not None
    _schema_cache[key] = exists
    return exists


def _columns(con: sqlite3.Connection, table: str) -> List[str]:
    key = ("cols", table)
    cached = _schema_cache.get(key)
    if cached is not None:
        return list(cached)
    cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()]
    _schema_cache[key] = cols
    return cols


# US states + territories we treat as "real". Anything outside this set in the
# ``state`` column is treated as dirty OCR and excluded from heatmap/per-state
# aggregates (but still counted in totals).
_VALID_STATES: Tuple[str, ...] = (
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY",
    # Territories with US ham districts:
    "PR", "VI", "GU", "AS", "MP",
)
_VALID_STATES_SQL = "(" + ",".join("'" + s + "'" for s in _VALID_STATES) + ")"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class YearStat(BaseModel):
    year: int
    edition_count: int = Field(..., description="distinct editions for this year")
    entry_count: int = Field(..., description="total entries for this year")


class StateStat(BaseModel):
    state: str
    entry_count: int


class DatasetTotals(BaseModel):
    total_entries: int
    total_editions: int
    total_years: int
    distinct_callsigns: int
    distinct_states: int
    year_min: Optional[int]
    year_max: Optional[int]
    estimated_accuracy_pct: Optional[float]
    build_timestamp: Optional[str]
    source_url: Optional[str]


class StatsResponse(BaseModel):
    totals: DatasetTotals
    per_year: List[YearStat]
    per_state: List[StateStat]


class GrowthResponse(BaseModel):
    years: List[int]
    counts: List[int]
    delta_pct: List[Optional[float]] = Field(
        ...,
        description=(
            "Year-over-year percentage change vs the previous year present in "
            "the dataset. First year is null."
        ),
    )


class HeatmapResponse(BaseModel):
    years: List[int]
    states: List[str]
    # Sparse cell list — only non-zero entries.
    cells: List[Dict[str, Any]] = Field(
        ...,
        description="List of {year, state, count} entries; zero/missing cells omitted.",
    )
    max_count: int


class IntegritySource(BaseModel):
    edition: str
    second_source: Optional[str]
    a_entries: int
    b_entries: int
    overlap_pct: Optional[float]
    agree: Optional[int]
    conflicts: Optional[int]
    corrected: Optional[int]
    status: Optional[str]


class IntegrityAudit(BaseModel):
    edition: str
    examined: Optional[int]
    real_data_errors: Optional[int]
    ocr_noise_both: Optional[int]
    address_bleed: Optional[int]
    format_truncation: Optional[int]
    other: Optional[int]
    estimated_true_accuracy_pct: Optional[float]
    confidence: Optional[str]
    notes: Optional[str]


class IntegritySampleConfidence(BaseModel):
    edition: str
    sample_pages: Optional[int]
    c_callsigns: Optional[int]
    a_entries: Optional[int]
    b_entries: Optional[int]
    common_ac: Optional[int]
    ac_strict_pct: Optional[float]
    ac_fuzzy_pct: Optional[float]
    common_bc: Optional[int]
    bc_strict_pct: Optional[float]
    bc_fuzzy_pct: Optional[float]
    common_abc: Optional[int]
    abc_strict_pct: Optional[float]
    abc_fuzzy_pct: Optional[float]


class IntegritySummary(BaseModel):
    editions_with_xref: int
    editions_with_sample_audit: int
    editions_with_sample_confidence: int
    avg_overlap_pct: Optional[float]
    avg_estimated_true_accuracy_pct: Optional[float]
    total_corrections_applied: int
    confidence_breakdown: Dict[str, int]
    headline_estimated_accuracy_pct: Optional[float]


class IntegrityResponse(BaseModel):
    summary: IntegritySummary
    xref_sources: List[IntegritySource]
    sample_audits: List[IntegrityAudit]
    sample_confidence: List[IntegritySampleConfidence]


# ---------------------------------------------------------------------------
# Internal data builders
# ---------------------------------------------------------------------------


def _meta_map(con: sqlite3.Connection) -> Dict[str, str]:
    rows = con.execute("SELECT key, value FROM dataset_meta").fetchall()
    return {r["key"]: r["value"] for r in rows}


def _build_per_year(con: sqlite3.Connection) -> List[YearStat]:
    """Prefer materialised ``stats_per_year`` if it exists, else compute."""
    if _table_exists(con, "stats_per_year"):
        cols = set(_columns(con, "stats_per_year"))
        count_col = next(
            (c for c in ("entry_count", "count", "n", "total") if c in cols),
            None,
        )
        ed_col = next(
            (c for c in ("edition_count", "editions", "n_editions") if c in cols),
            None,
        )
        if "year" in cols and count_col:
            ed_expr = ed_col if ed_col else "0"
            rows = con.execute(
                f"SELECT year, {count_col} AS entry_count, {ed_expr} AS edition_count "
                "FROM stats_per_year WHERE year IS NOT NULL ORDER BY year"
            ).fetchall()
            return [
                YearStat(
                    year=int(r["year"]),
                    entry_count=int(r["entry_count"] or 0),
                    edition_count=int(r["edition_count"] or 0),
                )
                for r in rows
            ]

    # Fallback: derive editions-per-year from ``editions`` and entry counts
    # from ``entries``. Both queries are O(index scan).
    ed_rows = con.execute(
        "SELECT year, COUNT(*) AS n FROM editions WHERE year IS NOT NULL "
        "GROUP BY year"
    ).fetchall()
    ed_by_year = {int(r["year"]): int(r["n"]) for r in ed_rows}

    entry_rows = con.execute(
        "SELECT year, COUNT(*) AS n FROM entries WHERE year IS NOT NULL "
        "GROUP BY year ORDER BY year"
    ).fetchall()

    out: List[YearStat] = []
    for r in entry_rows:
        y = int(r["year"])
        out.append(
            YearStat(
                year=y,
                entry_count=int(r["n"]),
                edition_count=ed_by_year.get(y, 0),
            )
        )
    return out


def _build_per_state(con: sqlite3.Connection) -> List[StateStat]:
    rows = con.execute(
        f"SELECT state, COUNT(*) AS n FROM entries "
        f"WHERE state IN {_VALID_STATES_SQL} "
        "GROUP BY state ORDER BY n DESC"
    ).fetchall()
    return [StateStat(state=r["state"], entry_count=int(r["n"])) for r in rows]


def _build_totals(con: sqlite3.Connection, per_year: Iterable[YearStat]) -> DatasetTotals:
    meta = _meta_map(con)
    py_list = list(per_year)
    years = [s.year for s in py_list]
    total_entries_meta = meta.get("total_entries")
    try:
        total_entries = int(total_entries_meta) if total_entries_meta else None
    except ValueError:
        total_entries = None
    if total_entries is None:
        total_entries = int(
            con.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        )
    total_editions = int(
        con.execute("SELECT COUNT(*) FROM editions").fetchone()[0]
    )
    distinct_callsigns = int(
        con.execute(
            "SELECT COUNT(DISTINCT callsign) FROM entries WHERE callsign IS NOT NULL"
        ).fetchone()[0]
    )
    distinct_states = int(
        con.execute(
            f"SELECT COUNT(DISTINCT state) FROM entries WHERE state IN {_VALID_STATES_SQL}"
        ).fetchone()[0]
    )
    try:
        est = float(meta["estimated_accuracy_pct"]) if "estimated_accuracy_pct" in meta else None
    except ValueError:
        est = None
    return DatasetTotals(
        total_entries=total_entries,
        total_editions=total_editions,
        total_years=len(years),
        distinct_callsigns=distinct_callsigns,
        distinct_states=distinct_states,
        year_min=min(years) if years else None,
        year_max=max(years) if years else None,
        estimated_accuracy_pct=est,
        build_timestamp=meta.get("build_timestamp"),
        source_url=meta.get("source_url_leehite"),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=StatsResponse, summary="Dataset overview statistics")
def get_stats(con: sqlite3.Connection = Depends(get_db)) -> StatsResponse:
    cached = _overview_cache.get("overview")
    if cached is not None:
        return cached
    per_year = _build_per_year(con)
    per_state = _build_per_state(con)
    totals = _build_totals(con, per_year)
    resp = StatsResponse(totals=totals, per_year=per_year, per_state=per_state)
    _overview_cache["overview"] = resp
    return resp


@router.get(
    "/growth",
    response_model=GrowthResponse,
    summary="Chart-ready growth series (counts + YoY delta %)",
)
def get_growth(con: sqlite3.Connection = Depends(get_db)) -> GrowthResponse:
    cached = _growth_cache.get("growth")
    if cached is not None:
        return cached
    per_year = _build_per_year(con)
    years = [s.year for s in per_year]
    counts = [s.entry_count for s in per_year]
    delta_pct: List[Optional[float]] = []
    prev: Optional[int] = None
    for c in counts:
        if prev is None or prev == 0:
            delta_pct.append(None)
        else:
            delta_pct.append(round(((c - prev) / prev) * 100.0, 2))
        prev = c
    resp = GrowthResponse(years=years, counts=counts, delta_pct=delta_pct)
    _growth_cache["growth"] = resp
    return resp


@router.get(
    "/heatmap",
    response_model=HeatmapResponse,
    summary="Sparse per-state per-year entry counts",
)
def get_heatmap(con: sqlite3.Connection = Depends(get_db)) -> HeatmapResponse:
    cached = _heatmap_cache.get("heatmap")
    if cached is not None:
        return cached

    rows = con.execute(
        f"SELECT year, state, COUNT(*) AS n FROM entries "
        f"WHERE year IS NOT NULL AND state IN {_VALID_STATES_SQL} "
        "GROUP BY year, state"
    ).fetchall()

    years_set: set[int] = set()
    states_set: set[str] = set()
    cells: List[Dict[str, Any]] = []
    max_count = 0
    for r in rows:
        y = int(r["year"])
        s = r["state"]
        n = int(r["n"])
        if n <= 0:
            continue
        years_set.add(y)
        states_set.add(s)
        if n > max_count:
            max_count = n
        cells.append({"year": y, "state": s, "count": n})

    resp = HeatmapResponse(
        years=sorted(years_set),
        states=sorted(states_set),
        cells=cells,
        max_count=max_count,
    )
    _heatmap_cache["heatmap"] = resp
    return resp


@router.get(
    "/integrity",
    response_model=IntegrityResponse,
    summary="Cross-reference, sample-audit and correction quality summary",
)
def get_integrity(con: sqlite3.Connection = Depends(get_db)) -> IntegrityResponse:
    cached = _integrity_cache.get("integrity")
    if cached is not None:
        return cached

    xref_rows = con.execute(
        "SELECT edition, second_source, a_entries, b_entries, overlap_pct, "
        "       agree, conflicts, corrected, status "
        "FROM xref_2way_summary ORDER BY edition"
    ).fetchall()
    xref_sources = [
        IntegritySource(
            edition=r["edition"],
            second_source=r["second_source"],
            a_entries=int(r["a_entries"] or 0),
            b_entries=int(r["b_entries"] or 0),
            overlap_pct=r["overlap_pct"],
            agree=r["agree"],
            conflicts=r["conflicts"],
            corrected=r["corrected"],
            status=r["status"],
        )
        for r in xref_rows
    ]

    audit_rows = con.execute(
        "SELECT edition, examined, real_data_errors, ocr_noise_both, address_bleed, "
        "       format_truncation, other, estimated_true_accuracy_pct, confidence, notes "
        "FROM sample_audit ORDER BY edition"
    ).fetchall()
    sample_audits = [
        IntegrityAudit(
            edition=r["edition"],
            examined=r["examined"],
            real_data_errors=r["real_data_errors"],
            ocr_noise_both=r["ocr_noise_both"],
            address_bleed=r["address_bleed"],
            format_truncation=r["format_truncation"],
            other=r["other"],
            estimated_true_accuracy_pct=r["estimated_true_accuracy_pct"],
            confidence=r["confidence"],
            notes=r["notes"],
        )
        for r in audit_rows
    ]

    sc_rows = con.execute(
        "SELECT edition, sample_pages, c_callsigns, a_entries, b_entries, "
        "       common_ac, ac_strict_pct, ac_fuzzy_pct, "
        "       common_bc, bc_strict_pct, bc_fuzzy_pct, "
        "       common_abc, abc_strict_pct, abc_fuzzy_pct "
        "FROM sample_confidence ORDER BY edition"
    ).fetchall()
    sample_confidence = [
        IntegritySampleConfidence(
            edition=r["edition"],
            sample_pages=r["sample_pages"],
            c_callsigns=r["c_callsigns"],
            a_entries=r["a_entries"],
            b_entries=r["b_entries"],
            common_ac=r["common_ac"],
            ac_strict_pct=r["ac_strict_pct"],
            ac_fuzzy_pct=r["ac_fuzzy_pct"],
            common_bc=r["common_bc"],
            bc_strict_pct=r["bc_strict_pct"],
            bc_fuzzy_pct=r["bc_fuzzy_pct"],
            common_abc=r["common_abc"],
            abc_strict_pct=r["abc_strict_pct"],
            abc_fuzzy_pct=r["abc_fuzzy_pct"],
        )
        for r in sc_rows
    ]

    # ---- summary aggregates ----
    overlap_vals = [
        s.overlap_pct for s in xref_sources if s.overlap_pct is not None
    ]
    accuracy_vals = [
        a.estimated_true_accuracy_pct
        for a in sample_audits
        if a.estimated_true_accuracy_pct is not None
    ]
    corrections_total = int(
        con.execute("SELECT COUNT(*) FROM corrections_3way").fetchone()[0]
    )

    confidence_breakdown: Dict[str, int] = {}
    for a in sample_audits:
        key = (a.confidence or "unknown").lower()
        confidence_breakdown[key] = confidence_breakdown.get(key, 0) + 1

    meta = _meta_map(con)
    try:
        headline = (
            float(meta["estimated_accuracy_pct"])
            if "estimated_accuracy_pct" in meta
            else None
        )
    except ValueError:
        headline = None

    summary = IntegritySummary(
        editions_with_xref=sum(
            1 for s in xref_sources if (s.status or "").lower() != "empty"
        ),
        editions_with_sample_audit=len(sample_audits),
        editions_with_sample_confidence=len(sample_confidence),
        avg_overlap_pct=(
            round(sum(overlap_vals) / len(overlap_vals), 3)
            if overlap_vals
            else None
        ),
        avg_estimated_true_accuracy_pct=(
            round(sum(accuracy_vals) / len(accuracy_vals), 3)
            if accuracy_vals
            else None
        ),
        total_corrections_applied=corrections_total,
        confidence_breakdown=confidence_breakdown,
        headline_estimated_accuracy_pct=headline,
    )

    resp = IntegrityResponse(
        summary=summary,
        xref_sources=xref_sources,
        sample_audits=sample_audits,
        sample_confidence=sample_confidence,
    )
    _integrity_cache["integrity"] = resp
    return resp


__all__ = ["router", "get_db"]
