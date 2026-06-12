"""Build the leaderboards.json artifact for the Century Club feature.

Run this script after DB rebuilds (or on a schedule).  It reads the
SQLite database at DB_PATH (default: /data/USA_Ham_Callbooks.sqlite),
computes six leaderboard categories, and writes data/leaderboards.json
alongside the DB.

The JSON artifact is then loaded lazily at runtime by
app.integrations.leaderboards — zero DB hits at request time.

Usage
-----
    python -m app.scripts.build_leaderboards
    DB_PATH=/data/USA_Ham_Callbooks.sqlite python build_leaderboards.py
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("build_leaderboards")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DB_PATH: str = os.environ.get(
    "DB_PATH",
    os.environ.get(
        "DB_PATH",
        "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
    ),
)

ULS_PATH: str = os.environ.get(
    "ULS_PATH",
    "/home/kasm-user/ham-callbook-site/data/uls.json",
)

OUT_PATH: str = os.environ.get(
    "LEADERBOARDS_OUT",
    "/home/kasm-user/ham-callbook-site/data/leaderboards.json",
)

DATASET_VERSION = "v2026.06"
TOP_N = 100
MIN_EDITIONS = 3
MIN_CLUB_APPEARANCES = 5

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def open_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA mmap_size=536870912")
    return conn


# ---------------------------------------------------------------------------
# ULS loader (active-callsign set)
# ---------------------------------------------------------------------------


def load_active_callsigns(path: str) -> set[str]:
    """Return the set of callsigns whose ULS status == 'A'."""
    if not os.path.exists(path):
        logger.warning("uls.json not found at %s; oldest_still_active will be empty", path)
        return set()
    t0 = time.perf_counter()
    with open(path, "rb") as fh:
        data = json.load(fh)
    active = {k.strip().upper() for k, v in data.items() if isinstance(v, dict) and v.get("status") == "A"}
    logger.info("Loaded %s active callsigns from uls.json in %.2fs", f"{len(active):,}", time.perf_counter() - t0)
    return active


# ---------------------------------------------------------------------------
# Category builders
# ---------------------------------------------------------------------------


def build_longest_issued(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Callsigns with the widest year spread across >= 3 editions."""
    sql = """
        SELECT callsign,
               MIN(year) AS first_year,
               MAX(year) AS last_year,
               MAX(year) - MIN(year) AS span_years,
               COUNT(DISTINCT year) AS edition_count,
               state
        FROM   entries
        WHERE  callsign IS NOT NULL
        GROUP  BY callsign
        HAVING edition_count >= ?
        ORDER  BY span_years DESC, edition_count DESC
        LIMIT  ?
    """
    rows = conn.execute(sql, (MIN_EDITIONS, TOP_N)).fetchall()
    return [
        {
            "rank": i + 1,
            "callsign": r["callsign"],
            "first_year": r["first_year"],
            "last_year": r["last_year"],
            "span_years": r["span_years"],
            "edition_count": r["edition_count"],
            "state": r["state"] or "",
        }
        for i, r in enumerate(rows)
    ]


def build_longest_single_holder(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Longest contiguous run where the same normalised name held a callsign."""
    # Fetch all (callsign, year, norm_name) rows then compute runs in Python.
    sql = """
        SELECT callsign,
               year,
               UPPER(REPLACE(REPLACE(name, '.', ''), ',', '')) AS norm_name,
               state
        FROM   entries
        WHERE  callsign IS NOT NULL AND name IS NOT NULL AND name != ''
        ORDER  BY callsign, year
    """
    logger.info("longest_single_holder: fetching rows…")
    t0 = time.perf_counter()
    rows = conn.execute(sql).fetchall()
    logger.info("  …fetched %s rows in %.2fs", f"{len(rows):,}", time.perf_counter() - t0)

    # Group by callsign
    from collections import defaultdict

    cs_rows: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    for r in rows:
        cs_rows[r["callsign"]].append((r["year"], r["norm_name"] or "", r["state"] or ""))

    best: list[dict[str, Any]] = []
    for cs, entries_list in cs_rows.items():
        # Find longest contiguous run with same norm_name
        if len(entries_list) < MIN_EDITIONS:
            continue
        entries_list.sort(key=lambda x: x[0])
        run_start = 0
        best_run_len = 1
        best_run_start = 0
        for idx in range(1, len(entries_list)):
            if entries_list[idx][1] == entries_list[idx - 1][1]:
                run_len = idx - run_start + 1
                if run_len > best_run_len:
                    best_run_len = run_len
                    best_run_start = run_start
            else:
                run_start = idx
        if best_run_len < MIN_EDITIONS:
            continue
        seg = entries_list[best_run_start : best_run_start + best_run_len]
        span = seg[-1][0] - seg[0][0]
        state = seg[0][2]
        holder_name = seg[0][1]
        best.append(
            {
                "callsign": cs,
                "holder_name": holder_name,
                "first_year": seg[0][0],
                "last_year": seg[-1][0],
                "span_years": span,
                "run_editions": best_run_len,
                "state": state,
            }
        )

    best.sort(key=lambda x: (-x["span_years"], -x["run_editions"]))
    return [{"rank": i + 1, **item} for i, item in enumerate(best[:TOP_N])]


def build_oldest_still_active(
    conn: sqlite3.Connection, active: set[str]
) -> list[dict[str, Any]]:
    """Callsigns with earliest first appearance still active in ULS (status=A)."""
    if not active:
        return []
    sql = """
        SELECT callsign,
               MIN(year) AS first_year,
               MAX(year) AS last_year,
               COUNT(DISTINCT year) AS edition_count,
               state
        FROM   entries
        WHERE  callsign IS NOT NULL
        GROUP  BY callsign
        HAVING edition_count >= ?
        ORDER  BY first_year ASC
    """
    rows = conn.execute(sql, (MIN_EDITIONS,)).fetchall()
    result: list[dict[str, Any]] = []
    for r in rows:
        cs = r["callsign"]
        if cs not in active:
            continue
        result.append(
            {
                "callsign": cs,
                "first_year": r["first_year"],
                "last_year": r["last_year"],
                "edition_count": r["edition_count"],
                "state": r["state"] or "",
                "uls_status": "A",
            }
        )
        if len(result) >= TOP_N:
            break
    return [{"rank": i + 1, **item} for i, item in enumerate(result)]


def build_most_reissued(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Callsigns held by the most distinct operators over the archive span."""
    sql = """
        SELECT callsign,
               distinct_holders_n,
               first_year,
               last_year,
               all_norm_names
        FROM   previous_holders
        ORDER  BY distinct_holders_n DESC
        LIMIT  ?
    """
    rows = conn.execute(sql, (TOP_N,)).fetchall()
    # Fetch state for each
    state_sql = """
        SELECT state FROM entries WHERE callsign = ? AND state IS NOT NULL LIMIT 1
    """
    result = []
    for i, r in enumerate(rows):
        state_row = conn.execute(state_sql, (r["callsign"],)).fetchone()
        result.append(
            {
                "rank": i + 1,
                "callsign": r["callsign"],
                "distinct_holders": r["distinct_holders_n"],
                "first_year": r["first_year"],
                "last_year": r["last_year"],
                "state": state_row["state"] if state_row else "",
            }
        )
    return result


def build_longest_at_address(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Callsigns at the same address for the widest year span."""
    sql = """
        SELECT callsign,
               COALESCE(address,'') || '|' || COALESCE(city,'') || '|' || COALESCE(state,'') AS addr_key,
               state,
               MIN(year) AS first_year,
               MAX(year) AS last_year,
               MAX(year) - MIN(year) AS span_years,
               COUNT(DISTINCT year) AS edition_count
        FROM   entries
        WHERE  callsign IS NOT NULL
          AND  (address IS NOT NULL OR city IS NOT NULL)
        GROUP  BY callsign, addr_key
        HAVING edition_count >= ?
        ORDER  BY span_years DESC, edition_count DESC
        LIMIT  ?
    """
    rows = conn.execute(sql, (MIN_EDITIONS, TOP_N)).fetchall()
    return [
        {
            "rank": i + 1,
            "callsign": r["callsign"],
            "addr_key": r["addr_key"],
            "first_year": r["first_year"],
            "last_year": r["last_year"],
            "span_years": r["span_years"],
            "edition_count": r["edition_count"],
            "state": r["state"] or "",
        }
        for i, r in enumerate(rows)
    ]


def build_longest_running_clubs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Clubs by longest archive span (last_year - first_year, >= 5 appearances)."""
    sql = """
        SELECT slug,
               display_name,
               first_year,
               last_year,
               last_year - first_year AS span_years,
               appearance_count,
               dominant_state
        FROM   clubs
        WHERE  appearance_count >= ?
        ORDER  BY span_years DESC, appearance_count DESC
        LIMIT  ?
    """
    rows = conn.execute(sql, (MIN_CLUB_APPEARANCES, TOP_N)).fetchall()
    return [
        {
            "rank": i + 1,
            "slug": r["slug"],
            "display_name": r["display_name"],
            "first_year": r["first_year"],
            "last_year": r["last_year"],
            "span_years": r["span_years"],
            "appearance_count": r["appearance_count"],
            "state": r["dominant_state"] or "",
        }
        for i, r in enumerate(rows)
    ]


# ---------------------------------------------------------------------------
# by_state index
# ---------------------------------------------------------------------------


def build_by_state(categories: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """Top-10 per state per category."""
    by_state: dict[str, list[dict[str, Any]]] = {}
    for cat_name, rows in categories.items():
        state_counts: dict[str, int] = {}
        for row in rows:
            st = row.get("state") or ""
            if not st or len(st) != 2:
                continue
            state_counts[st] = state_counts.get(st, 0) + 1
            if state_counts[st] > 10:
                continue
            cs_or_slug = row.get("callsign") or row.get("slug") or ""
            entry = {
                "category": cat_name,
                "rank": row.get("rank", 0),
                "callsign": cs_or_slug,
            }
            by_state.setdefault(st, []).append(entry)
    return by_state


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    logger.info("build_leaderboards: DB=%s", DB_PATH)
    if not os.path.exists(DB_PATH):
        logger.error("DB not found: %s", DB_PATH)
        sys.exit(1)

    t_start = time.perf_counter()
    active = load_active_callsigns(ULS_PATH)

    conn = open_db(DB_PATH)
    try:
        logger.info("Building longest_issued…")
        longest_issued = build_longest_issued(conn)

        logger.info("Building longest_single_holder…")
        longest_single_holder = build_longest_single_holder(conn)

        logger.info("Building oldest_still_active…")
        oldest_still_active = build_oldest_still_active(conn, active)

        logger.info("Building most_reissued…")
        most_reissued = build_most_reissued(conn)

        logger.info("Building longest_at_address…")
        longest_at_address = build_longest_at_address(conn)

        logger.info("Building longest_running_clubs…")
        longest_running_clubs = build_longest_running_clubs(conn)
    finally:
        conn.close()

    categories: dict[str, list[dict[str, Any]]] = {
        "longest_issued": longest_issued,
        "longest_single_holder": longest_single_holder,
        "oldest_still_active": oldest_still_active,
        "most_reissued": most_reissued,
        "longest_at_address": longest_at_address,
        "longest_running_clubs": longest_running_clubs,
    }

    by_state = build_by_state(categories)

    artifact: dict[str, Any] = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_version": DATASET_VERSION,
        "categories": categories,
        "by_state": by_state,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, OUT_PATH)

    elapsed = time.perf_counter() - t_start
    sizes = {k: len(v) for k, v in categories.items()}
    logger.info(
        "Done in %.1fs. Category sizes: %s. Output: %s (%.1f KB)",
        elapsed,
        sizes,
        OUT_PATH,
        os.path.getsize(OUT_PATH) / 1024,
    )


if __name__ == "__main__":
    main()
