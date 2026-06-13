"""Corrections Desk — Feature #8.

Endpoints
---------
POST /api/corrections
    Submit a suggested correction for a callsign record. Rate-limited by IP
    (10 submissions per hour). Validates field names and lengths, then inserts
    a pending row into the separate writable submissions.sqlite.

GET /api/corrections/queue
    Moderation list: all pending submissions, newest first. Includes a
    ?status= filter (pending/approved/rejected). No auth for v1 — access by
    obscurity only; the export script gates actual effect.

PATCH /api/corrections/{id}/status
    Approve or reject a submission (sets status field). Used by the moderator
    UI or a CLI.

GET /api/restore/worst
    Audit-ranked worst records from corrections_3way disagreements,
    uls_anchor mismatches, low sample_confidence editions, and dictionary-
    implausible names. Paginated (?page=0&page_size=50). Optional ?edition=
    facet. Each row includes a rank_reason label.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from collections import defaultdict
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# Writable corrections store — separate from the read-only main DB.
# Never overwritten by rebuilds. Gitignored via data/*.sqlite pattern.
SUBMISSIONS_DB_PATH: str = os.environ.get(
    "SUBMISSIONS_DB_PATH",
    "/home/kasm-user/ham-callbook-site/data/submissions.sqlite",
)

# Main read-only DB for /restore/worst queries.
DB_PATH: str = os.environ.get(
    "HAM_DB_PATH",
    os.environ.get("DB_PATH", "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite"),
)

router = APIRouter(tags=["corrections"])

# ---------------------------------------------------------------------------
# Submissions DB — thread-local read-write connection
# ---------------------------------------------------------------------------

_sub_local = threading.local()


def _sub_conn() -> sqlite3.Connection:
    """Thread-local read-write connection to submissions.sqlite."""
    c = getattr(_sub_local, "conn", None)
    if c is not None:
        try:
            c.execute("SELECT 1")
            return c
        except sqlite3.ProgrammingError:
            pass
    conn = sqlite3.connect(SUBMISSIONS_DB_PATH, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    # Ensure schema exists (idempotent — survives container restarts).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            callsign TEXT NOT NULL,
            year INTEGER,
            edition TEXT,
            field TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT NOT NULL,
            source_note TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','approved','rejected')),
            submitter_ip TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_callsign ON submissions(callsign)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sub_ts ON submissions(ts)")
    conn.commit()
    _sub_local.conn = conn
    return conn


# ---------------------------------------------------------------------------
# Main DB — thread-local read-only connection for /restore/worst
# ---------------------------------------------------------------------------

_main_local = threading.local()


def _main_conn() -> sqlite3.Connection:
    """Thread-local read-only connection to the main callbook DB."""
    c = getattr(_main_local, "conn", None)
    if c is not None:
        try:
            c.execute("SELECT 1")
            return c
        except sqlite3.ProgrammingError:
            pass
    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    _main_local.conn = conn
    return conn


# ---------------------------------------------------------------------------
# Rate limiting — in-process token bucket per IP
# ---------------------------------------------------------------------------

_rate_lock = threading.Lock()
# { ip: [timestamp, ...] }
_rate_window: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 10          # max submissions
_RATE_WINDOW_SEC = 3600   # per hour


def _check_rate(ip: str) -> None:
    """Raise 429 if this IP has exceeded the hourly limit."""
    now = time.time()
    cutoff = now - _RATE_WINDOW_SEC
    with _rate_lock:
        timestamps = _rate_window[ip]
        # Expire old entries
        _rate_window[ip] = [t for t in timestamps if t > cutoff]
        if len(_rate_window[ip]) >= _RATE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": f"Maximum {_RATE_LIMIT} submissions per hour.",
                },
            )
        _rate_window[ip].append(now)


# ---------------------------------------------------------------------------
# Allowed correction fields
# ---------------------------------------------------------------------------

ALLOWED_FIELDS = {
    "name", "address", "city", "state", "zip",
    "license_class", "callsign", "year", "edition", "raw_ocr",
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CorrectionSubmission(BaseModel):
    callsign: str = Field(..., min_length=1, max_length=20)
    year: Optional[int] = Field(None, ge=1900, le=2100)
    edition: Optional[str] = Field(None, max_length=50)
    field: str = Field(..., min_length=1, max_length=30)
    old_value: Optional[str] = Field(None, max_length=500)
    new_value: str = Field(..., min_length=1, max_length=500)
    source_note: Optional[str] = Field(None, max_length=1000)

    @field_validator("callsign")
    @classmethod
    def upper_callsign(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ALLOWED_FIELDS:
            raise ValueError(
                f"field must be one of: {', '.join(sorted(ALLOWED_FIELDS))}"
            )
        return v


class StatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")


# ---------------------------------------------------------------------------
# POST /api/corrections
# ---------------------------------------------------------------------------

@router.post("/api/corrections", status_code=201)
def submit_correction(body: CorrectionSubmission, request: Request) -> JSONResponse:
    """Submit a suggested correction. Rate-limited by IP (10/hour)."""
    ip = request.client.host if request.client else "unknown"
    _check_rate(ip)

    conn = _sub_conn()
    cur = conn.execute(
        """
        INSERT INTO submissions
            (callsign, year, edition, field, old_value, new_value, source_note, submitter_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            body.callsign,
            body.year,
            body.edition,
            body.field,
            body.old_value,
            body.new_value,
            body.source_note,
            ip,
        ),
    )
    conn.commit()
    return JSONResponse(
        {"ok": True, "id": cur.lastrowid, "status": "pending"},
        status_code=201,
    )


# ---------------------------------------------------------------------------
# GET /api/corrections/queue
# ---------------------------------------------------------------------------

@router.get("/api/corrections/queue")
def corrections_queue(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> JSONResponse:
    """Moderation queue. Filter by ?status=pending|approved|rejected."""
    conn = _sub_conn()
    params: list[Any] = []
    where = ""
    if status_filter in ("pending", "approved", "rejected"):
        where = "WHERE status = ?"
        params.append(status_filter)

    rows = conn.execute(
        f"""
        SELECT id, ts, callsign, year, edition, field,
               old_value, new_value, source_note, status, submitter_ip
        FROM submissions
        {where}
        ORDER BY ts DESC
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    total = conn.execute(
        f"SELECT COUNT(*) FROM submissions {where}", params
    ).fetchone()[0]

    return JSONResponse(
        {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": [dict(r) for r in rows],
        }
    )


# ---------------------------------------------------------------------------
# PATCH /api/corrections/{id}/status
# ---------------------------------------------------------------------------

@router.patch("/api/corrections/{sub_id}/status")
def update_status(sub_id: int, body: StatusUpdate) -> JSONResponse:
    """Approve or reject a submission."""
    conn = _sub_conn()
    cur = conn.execute(
        "UPDATE submissions SET status = ? WHERE id = ?",
        (body.status, sub_id),
    )
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="submission not found")
    return JSONResponse({"ok": True, "id": sub_id, "status": body.status})


# ---------------------------------------------------------------------------
# GET /api/restore/worst  — audit-ranked bad records
# ---------------------------------------------------------------------------

# Dictionary-implausible name heuristics: names with only digits/symbols,
# very short (<3 chars), or containing OCR noise patterns.
_IMPLAUSIBLE_NAME_SQL = """
    (
        -- Too short (likely OCR fragment)
        length(trim(name)) < 3
        -- Starts with a digit (e.g. "55112" in name field)
        OR trim(name) GLOB '[0-9]*'
        -- Contains OCR noise: 'NOW' suffix from "address bleed"
        OR name LIKE '% NOW'
        -- All-numeric word clusters
        OR name GLOB '[0-9][0-9][0-9][0-9][0-9]*'
    )
"""


@router.get("/api/restore/worst")
def worst_records(
    page: int = Query(0, ge=0),
    page_size: int = Query(50, ge=1, le=200),
    edition: Optional[str] = Query(None),
) -> JSONResponse:
    """
    Returns records most likely to contain errors, ranked from:
    1. corrections_3way disagreements (decision_rule not '2of3_majority' is fine;
       rows where chosen differs from all sources = suspect)
    2. uls_anchor CONFLICT rows
    3. Low-confidence editions (ac_strict_pct < 50 from sample_confidence)
    4. Implausible names in the entries table

    Each row includes a rank_reason label. Paginated by ?page= / ?page_size=.
    Optional ?edition= facet.
    """
    conn = _main_conn()
    offset = page * page_size
    edition_clause = "AND edition = ?" if edition else ""
    edition_params: list[Any] = [edition] if edition else []

    # Build a UNION of suspect records from all audit sources.
    # Each branch selects: callsign, year, edition, name, rank_score, rank_reason
    # Higher rank_score = more suspicious.

    query = f"""
    WITH suspects AS (

        -- Source 1: corrections_3way where all three sources disagreed
        -- (decision_rule='2of3_majority' means two agreed, which is fine;
        --  'fallback_*' rules suggest deeper disagreement)
        SELECT
            c.callsign,
            c.year,
            NULL AS edition,
            NULL AS name,
            3 AS rank_score,
            'three-source disagreement (fallback rule)' AS rank_reason
        FROM corrections_3way c
        WHERE c.decision_rule LIKE 'fallback%'
        {edition_clause.replace('edition','NULL')}

        UNION ALL

        -- Source 2: uls_anchor CONFLICT rows
        SELECT
            u.callsign,
            NULL AS year,
            u.edition,
            NULL AS name,
            2 AS rank_score,
            'ULS name conflict (OCR vs FCC record)' AS rank_reason
        FROM uls_anchor u
        WHERE u.decision = 'CONFLICT'
        {'AND u.edition = ?' if edition else ''}

        UNION ALL

        -- Source 3: entries in low-confidence editions (wrapped to allow LIMIT)
        SELECT callsign, year, edition, name, rank_score, rank_reason
        FROM (
            SELECT
                e.callsign,
                e.year,
                e.edition,
                e.name,
                1 AS rank_score,
                'low-confidence edition (OCR accuracy <50%)' AS rank_reason
            FROM entries e
            JOIN sample_confidence sc ON sc.edition = e.edition
            WHERE sc.ac_strict_pct < 50
            {'AND e.edition = ?' if edition else ''}
            LIMIT 5000
        )

        UNION ALL

        -- Source 4: implausible names in entries (wrapped to allow LIMIT)
        SELECT callsign, year, edition, name, rank_score, rank_reason
        FROM (
            SELECT
                e.callsign,
                e.year,
                e.edition,
                e.name,
                2 AS rank_score,
                'implausible name (OCR artifact or address bleed)' AS rank_reason
            FROM entries e
            WHERE {_IMPLAUSIBLE_NAME_SQL}
            {'AND e.edition = ?' if edition else ''}
            LIMIT 5000
        )

    )
    SELECT callsign, year, edition, name, MAX(rank_score) AS rank_score,
           GROUP_CONCAT(DISTINCT rank_reason) AS rank_reason
    FROM suspects
    GROUP BY callsign, year, edition
    ORDER BY rank_score DESC, callsign
    LIMIT ? OFFSET ?
    """

    # Build params list matching the conditional placeholders above
    params: list[Any] = []
    # Source 2 edition filter
    if edition:
        params.append(edition)
    # Source 3 edition filter
    if edition:
        params.append(edition)
    # Source 4 edition filter
    if edition:
        params.append(edition)
    params.extend([page_size, offset])

    try:
        rows = conn.execute(query, params).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Count (approximate — avoid full re-scan)
    count_query = f"""
    WITH suspects AS (
        SELECT callsign, CAST(year AS TEXT) AS yr, NULL AS ed FROM corrections_3way
        WHERE decision_rule LIKE 'fallback%'
        UNION ALL
        SELECT callsign, NULL AS yr, edition AS ed FROM uls_anchor WHERE decision = 'CONFLICT'
            {'AND edition = ?' if edition else ''}
        UNION ALL
        SELECT callsign, CAST(year AS TEXT) AS yr, edition AS ed FROM (
            SELECT e.callsign, e.year, e.edition FROM entries e
            JOIN sample_confidence sc ON sc.edition = e.edition
            WHERE sc.ac_strict_pct < 50
                {'AND e.edition = ?' if edition else ''}
            LIMIT 5000
        )
        UNION ALL
        SELECT callsign, CAST(year AS TEXT) AS yr, edition AS ed FROM (
            SELECT e.callsign, e.year, e.edition FROM entries e
            WHERE {_IMPLAUSIBLE_NAME_SQL}
                {'AND e.edition = ?' if edition else ''}
            LIMIT 5000
        )
    )
    SELECT COUNT(DISTINCT callsign || COALESCE(yr,'') || COALESCE(ed,''))
    FROM suspects
    """
    count_params: list[Any] = []
    if edition:
        count_params.extend([edition, edition, edition])
    total_count = conn.execute(count_query, count_params).fetchone()[0]

    return JSONResponse(
        {
            "page": page,
            "page_size": page_size,
            "total": total_count,
            "items": [
                {
                    "callsign": r["callsign"],
                    "year": r["year"],
                    "edition": r["edition"],
                    "name": r["name"],
                    "rank_score": r["rank_score"],
                    "rank_reason": r["rank_reason"],
                }
                for r in rows
            ],
        }
    )
