"""Random-entry routes for the callbook archive.

Two endpoints power the "shuffle" / "feeling lucky" features of the UI:

* ``GET /api/random`` — a single uniformly-random row from ``entries``.
* ``GET /api/random/notable`` — a random callsign with a story attached:
  appeared in 5+ editions, was held by multiple distinct people, or has
  the visual cadence of a vanity call (palindrome / repeated letters /
  initials / 1x1 stunt prefixes).

Performance notes
-----------------

``ORDER BY RANDOM()`` on a 7.74 M-row table is a full-scan sort. On this
dataset that is ~2.5 seconds of wall clock per call — unacceptable for a
"surprise me" button.

We use the **rowid-range trick** instead:

  1. Cache ``MIN(rowid)``, ``MAX(rowid)`` at module load (they are
     immutable for the life of the process — DB is read-only).
  2. Pick a uniform random integer in ``[min, max]``.
  3. Fetch the first row with ``rowid >= R`` (a single B-tree lookup —
     sub-millisecond).
  4. If we miss (rare: rowids are densely packed but a vacuum hole could
     exist), wrap around and retry a few times before giving up.

The notable endpoint is built from a *materialized candidate pool* —
~50k pre-computed "interesting" callsigns chosen once per process — so
that even the curated path is a single index lookup, not an aggregation.

The pool build runs lazily on first request and is cached in module
state. It takes ~2-4 seconds on the full corpus; subsequent requests are
instant.
"""

from __future__ import annotations

import random
import re
import sqlite3
import threading
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db

router = APIRouter(prefix="/api", tags=["random"])

# ---------------------------------------------------------------------------
# Response models — mirror frontend/lib/types.ts::Entry exactly.
# ---------------------------------------------------------------------------


class RandomEntry(BaseModel):
    """One callbook line, returned by ``/api/random``.

    Shape matches the ``Entry`` interface in ``frontend/lib/types.ts``
    so the same React components that render search hits can render
    random hits with no special-casing.
    """

    year: int
    edition: str
    callsign: str
    license_class: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = Field(default=None)
    raw_ocr: Optional[str] = None
    flag: Optional[str] = None
    source: str


class NotableEntry(RandomEntry):
    """A random entry plus the reason it was deemed "notable".

    ``reason`` is a stable machine-readable tag (``multi_edition``,
    ``multi_holder``, ``vanity``) that the frontend uses to pick the
    right marginalia badge ("seen in 47 editions", "3 holders",
    "vanity-style"). ``reason_detail`` is a short human-readable note
    that the UI can show verbatim.
    """

    reason: str
    reason_detail: str
    edition_count: int
    distinct_holder_count: int


# ---------------------------------------------------------------------------
# Rowid-range cache — populated once, immutable thereafter.
# ---------------------------------------------------------------------------

_ROWID_LOCK = threading.Lock()
_ROWID_BOUNDS: Optional[tuple[int, int]] = None


def _rowid_bounds(conn: sqlite3.Connection) -> tuple[int, int]:
    """Return ``(min_rowid, max_rowid)`` for the ``entries`` table.

    Cached at module scope; the underlying DB is mounted read-only so
    the bounds cannot change without a container restart.
    """
    global _ROWID_BOUNDS
    if _ROWID_BOUNDS is not None:
        return _ROWID_BOUNDS
    with _ROWID_LOCK:
        if _ROWID_BOUNDS is not None:
            return _ROWID_BOUNDS
        row = conn.execute(
            "SELECT MIN(rowid) AS lo, MAX(rowid) AS hi FROM entries"
        ).fetchone()
        if row is None or row["lo"] is None or row["hi"] is None:
            raise HTTPException(
                status_code=503,
                detail="entries table is empty — cannot draw a random row",
            )
        _ROWID_BOUNDS = (int(row["lo"]), int(row["hi"]))
        return _ROWID_BOUNDS


_ENTRY_COLS = (
    "year, edition, callsign, license_class, name, address, "
    "city, state, zip, raw_ocr, flag, source"
)


def _row_to_entry(row: sqlite3.Row) -> RandomEntry:
    return RandomEntry(
        year=int(row["year"]),
        edition=row["edition"],
        callsign=row["callsign"],
        license_class=row["license_class"],
        name=row["name"],
        address=row["address"],
        city=row["city"],
        state=row["state"],
        zip=row["zip"],
        raw_ocr=row["raw_ocr"],
        flag=row["flag"],
        source=row["source"],
    )


def _fetch_random_row(
    conn: sqlite3.Connection,
    *,
    where: str = "callsign IS NOT NULL",
    max_attempts: int = 8,
) -> sqlite3.Row:
    """Draw one random row from ``entries`` using the rowid-range trick.

    We pick a uniform integer in ``[lo, hi]`` and grab the first row
    with ``rowid >= R``. Rowids are densely packed (post-VACUUM in the
    Data phase), so a single attempt almost always succeeds. The retry
    loop covers the pathological case where a sequence of vacuum holes
    happens to span the chosen rowid.
    """
    lo, hi = _rowid_bounds(conn)
    sql = (
        f"SELECT {_ENTRY_COLS} FROM entries "
        f"WHERE rowid >= ? AND {where} "
        f"ORDER BY rowid LIMIT 1"
    )
    for _ in range(max_attempts):
        target = random.randint(lo, hi)
        row = conn.execute(sql, (target,)).fetchone()
        if row is not None:
            return row
        # Tail-of-table miss: wrap to the start and try again.
        row = conn.execute(
            f"SELECT {_ENTRY_COLS} FROM entries WHERE {where} "
            f"ORDER BY rowid LIMIT 1"
        ).fetchone()
        if row is not None:
            return row
    raise HTTPException(
        status_code=503,
        detail="Failed to draw a random row after retries",
    )


# ---------------------------------------------------------------------------
# Daily pick — deterministic "entry of the day".
#
# Same rowid-range trick as /random, but the RNG is a private
# ``random.Random`` seeded with today's ISO date, so every worker (and every
# request) lands on the SAME row for a given calendar day. The DB is
# read-only, so the pick is memoized per-day in module state — after the
# first request of the day this is a pure dict-tuple compare.
# ---------------------------------------------------------------------------

_DAILY_LOCK = threading.Lock()
# (iso_date, entry) — replaced wholesale when the date rolls over.
_DAILY_PICK: Optional[tuple[str, RandomEntry]] = None


def _fetch_daily_row(conn: sqlite3.Connection, seed: str) -> sqlite3.Row:
    """Deterministic variant of :func:`_fetch_random_row`.

    All randomness comes from a ``random.Random(seed)`` instance, so the
    retry sequence — and therefore the chosen row — is identical for every
    process that shares the same (immutable) database and seed.
    """
    rng = random.Random(seed)
    lo, hi = _rowid_bounds(conn)
    sql = (
        f"SELECT {_ENTRY_COLS} FROM entries "
        f"WHERE rowid >= ? AND callsign IS NOT NULL "
        f"ORDER BY rowid LIMIT 1"
    )
    for _ in range(8):
        target = rng.randint(lo, hi)
        row = conn.execute(sql, (target,)).fetchone()
        if row is not None:
            return row
    # Tail-of-table miss on every attempt (pathological): deterministic
    # wrap-around to the first eligible row.
    row = conn.execute(
        f"SELECT {_ENTRY_COLS} FROM entries WHERE callsign IS NOT NULL "
        f"ORDER BY rowid LIMIT 1"
    ).fetchone()
    if row is not None:
        return row
    raise HTTPException(
        status_code=503,
        detail="Failed to draw the daily row — entries table appears empty",
    )


# ---------------------------------------------------------------------------
# Notable-callsign pool.
#
# We pre-compute a pool of "interesting" callsigns and pick from it. Three
# kinds of interesting:
#
#   * multi_edition — callsign appears in >= 5 distinct editions.
#       Signal: a long-lived operator (or a popular re-issued call).
#
#   * multi_holder — at least 2 distinct normalized surnames in
#       ``previous_holders``. Signal: the call was reissued to a different
#       person at some point — there's a story there.
#
#   * vanity — the call *looks* like a vanity choice: 1x1 (W1A, K9X),
#       2x1 with a repeated suffix (WA1AA), palindrome (W7HRW would qualify
#       if mirrored), all-same-letter suffix (W1AAA). These are visual
#       heuristics over the call text itself — no aggregation needed.
# ---------------------------------------------------------------------------


_POOL_LOCK = threading.Lock()
# List of (callsign, reason, edition_count, distinct_holder_count).
_NOTABLE_POOL: Optional[list[tuple[str, str, int, int]]] = None


# Vanity heuristics.
# A callsign in this corpus is always [A-Z0-9]+ with at most one digit
# embedded; we split prefix/digit/suffix and judge on shape.
_CALLSIGN_RE = re.compile(r"^([A-Z]+)(\d)([A-Z]+)$")
# Older corpus rows sometimes have just letters (no digit) — the 1909
# BlueBook used unique 2-letter idents. Treat those as not-vanity.


def _is_vanity_shape(call: str) -> bool:
    """Heuristic: does this callsign *look* like a vanity choice?

    True when:
      * 1x1 stunt call (1 letter, 1 digit, 1 letter) — e.g. K1A.
      * Suffix is a single repeated letter — e.g. W1AAA, KH6BBB.
      * Suffix is a palindrome of length >= 3 — e.g. W4ABA, KC0OTO.
      * Prefix+suffix is the same letter run — e.g. WA1AA.
    """
    m = _CALLSIGN_RE.match(call)
    if not m:
        return False
    prefix, _digit, suffix = m.group(1), m.group(2), m.group(3)
    # 1x1.
    if len(prefix) == 1 and len(suffix) == 1:
        return True
    # Repeated-letter suffix (length >= 2).
    if len(suffix) >= 2 and len(set(suffix)) == 1:
        return True
    # Palindrome suffix.
    if len(suffix) >= 3 and suffix == suffix[::-1]:
        return True
    # Prefix and suffix share the same single letter.
    if len(set(prefix)) == 1 and len(set(suffix)) == 1 and prefix[0] == suffix[0]:
        return True
    return False


def _build_notable_pool(conn: sqlite3.Connection) -> list[tuple[str, str, int, int]]:
    """Build the notable-callsign pool. Run once per process."""
    pool: list[tuple[str, str, int, int]] = []

    # Multi-edition: callsigns in >= 5 distinct editions.
    # Capped to keep the pool memory-bounded; even at the cap there is
    # plenty of variety for a "random notable" pick.
    cur = conn.execute(
        """
        SELECT callsign, COUNT(DISTINCT edition) AS n
        FROM   entries
        WHERE  callsign IS NOT NULL
        GROUP  BY callsign
        HAVING n >= 5
        LIMIT  20000
        """
    )
    multi_edition_counts: dict[str, int] = {}
    for row in cur.fetchall():
        multi_edition_counts[row["callsign"]] = int(row["n"])
        pool.append((row["callsign"], "multi_edition", int(row["n"]), 1))

    # Multi-holder: ``previous_holders`` is the curated view (>=2 distinct
    # normalized surnames). It's already filtered, so a flat sample is fine.
    cur = conn.execute(
        """
        SELECT callsign, distinct_holders_n
        FROM   previous_holders
        LIMIT  20000
        """
    )
    for row in cur.fetchall():
        call = row["callsign"]
        if not call:
            continue
        holders_n = int(row["distinct_holders_n"])
        pool.append(
            (
                call,
                "multi_holder",
                multi_edition_counts.get(call, 1),
                holders_n,
            )
        )

    # Vanity: scan distinct callsigns and pick the visually interesting
    # ones. The pool is bounded so even a 7.74M-row corpus walks a single
    # index in a few seconds.
    cur = conn.execute(
        """
        SELECT DISTINCT callsign
        FROM   entries
        WHERE  callsign IS NOT NULL
          AND  length(callsign) BETWEEN 3 AND 6
        """
    )
    vanity_added = 0
    for row in cur.fetchall():
        call = row["callsign"]
        if _is_vanity_shape(call):
            pool.append(
                (
                    call,
                    "vanity",
                    multi_edition_counts.get(call, 1),
                    1,
                )
            )
            vanity_added += 1
            if vanity_added >= 10000:
                break

    if not pool:
        raise HTTPException(
            status_code=503,
            detail="Could not build the notable-callsign pool — DB likely empty",
        )
    return pool


def _notable_pool(conn: sqlite3.Connection) -> list[tuple[str, str, int, int]]:
    """Return the cached notable pool, building it on first call."""
    global _NOTABLE_POOL
    if _NOTABLE_POOL is not None:
        return _NOTABLE_POOL
    with _POOL_LOCK:
        if _NOTABLE_POOL is not None:
            return _NOTABLE_POOL
        _NOTABLE_POOL = _build_notable_pool(conn)
        return _NOTABLE_POOL


def _reason_detail(reason: str, edition_count: int, holders: int) -> str:
    """Human-readable note matching the reason tag."""
    if reason == "multi_edition":
        return f"Appeared in {edition_count} editions of the Callbook."
    if reason == "multi_holder":
        if holders == 2:
            return "Held by two distinct operators across the corpus."
        return f"Held by {holders} distinct operators across the corpus."
    if reason == "vanity":
        return "Has the visual cadence of a vanity-style callsign."
    return "Notable callsign."


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/random",
    response_model=RandomEntry,
    summary="Return a single uniformly-random callbook entry.",
    response_description="One row from `entries`, drawn via rowid-range sampling.",
)
def random_entry(conn: sqlite3.Connection = Depends(get_db)) -> RandomEntry:
    """Draw one random ``entries`` row.

    Uses the rowid-range trick (constant time per pick) instead of
    ``ORDER BY RANDOM()`` (linear in the table size).
    """
    row = _fetch_random_row(conn)
    return _row_to_entry(row)


@router.get(
    "/random/daily",
    response_model=RandomEntry,
    summary="Return the deterministic 'entry of the day'.",
    response_description=(
        "One row from `entries`, chosen by a date-seeded RNG — stable for "
        "the whole calendar day, then re-rolled at midnight."
    ),
)
def random_daily_entry(conn: sqlite3.Connection = Depends(get_db)) -> RandomEntry:
    """Draw the day's deterministic ``entries`` row.

    Response shape mirrors ``/random`` exactly. The pick is seeded with
    ``date.today().isoformat()`` and memoized in module state, so repeat
    calls within a day are cache hits and every worker agrees on the row.
    """
    global _DAILY_PICK
    today = date.today().isoformat()
    pick = _DAILY_PICK
    if pick is not None and pick[0] == today:
        return pick[1]
    with _DAILY_LOCK:
        pick = _DAILY_PICK
        if pick is not None and pick[0] == today:
            return pick[1]
        row = _fetch_daily_row(conn, today)
        entry = _row_to_entry(row)
        _DAILY_PICK = (today, entry)
        return entry


@router.get(
    "/random/notable",
    response_model=NotableEntry,
    summary="Return a random callsign that has a 'story' attached.",
    response_description=(
        "One entry whose callsign appeared in 5+ editions, was held by "
        "multiple operators, or has a vanity-like shape."
    ),
)
def random_notable_entry(
    conn: sqlite3.Connection = Depends(get_db),
) -> NotableEntry:
    """Pick a random "notable" callsign and return one of its entries.

    Notable = appeared in ``>=5`` editions, OR has multiple distinct
    holders, OR has a vanity-shape callsign. We sample from a
    pre-computed pool (built lazily on first request) so the hot path
    is a single index lookup.
    """
    pool = _notable_pool(conn)
    callsign, reason, edition_count, holder_count = random.choice(pool)

    # Pull a representative row for this callsign. Prefer the row with
    # the richest non-null structured fields so the UI has something to
    # render — fall back to "first row" if every row is sparse.
    row = conn.execute(
        f"""
        SELECT {_ENTRY_COLS}
        FROM   entries
        WHERE  callsign = ?
        ORDER  BY
            (name IS NOT NULL)  DESC,
            (city IS NOT NULL)  DESC,
            (state IS NOT NULL) DESC,
            year                ASC
        LIMIT 1
        """,
        (callsign,),
    ).fetchone()

    if row is None:
        # Extremely unlikely — pool was built from `entries` — but be
        # defensive and fall back to a plain random row.
        row = _fetch_random_row(conn)
        return NotableEntry(
            **_row_to_entry(row).model_dump(),
            reason="multi_edition",
            reason_detail="Fallback random pick — notable pool miss.",
            edition_count=1,
            distinct_holder_count=1,
        )

    base = _row_to_entry(row)
    # Refresh edition_count for multi_holder / vanity picks so the
    # frontend always gets an accurate "seen in N editions" tag.
    if reason != "multi_edition":
        cur = conn.execute(
            "SELECT COUNT(DISTINCT edition) AS n FROM entries WHERE callsign = ?",
            (callsign,),
        ).fetchone()
        if cur is not None:
            edition_count = int(cur["n"])

    return NotableEntry(
        **base.model_dump(),
        reason=reason,
        reason_detail=_reason_detail(reason, edition_count, holder_count),
        edition_count=edition_count,
        distinct_holder_count=holder_count,
    )


# ---------------------------------------------------------------------------
# Test hooks — used by unit tests to bust the module-level caches without
# bouncing the whole interpreter. Not part of the public HTTP surface.
# ---------------------------------------------------------------------------


def _reset_caches_for_tests() -> None:
    """Forget cached rowid bounds, notable pool, and daily pick. Tests only."""
    global _ROWID_BOUNDS, _NOTABLE_POOL, _DAILY_PICK
    _ROWID_BOUNDS = None
    _NOTABLE_POOL = None
    _DAILY_PICK = None
