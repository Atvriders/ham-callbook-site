"""build_edition_diff.py — generate data/edition_diff.json.

Run standalone:
    DB_PATH=/path/to/USA_Ham_Callbooks.sqlite python3 build_edition_diff.py

For each consecutive qualifying edition pair (entry_count > 100), computes:
  - adds      : callsigns in B but not A
  - drops     : callsigns in A but not B
  - address_changes : same callsign, address/city/state changed
  - class_upgrades  : same callsign, license_class changed to a higher tier
  - net, retention_pct

Also computes WWII special cohort comparing 1941_Spring vs 1946_Fall.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("build_edition_diff")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DB_PATH = os.environ.get(
    "DB_PATH",
    str(Path(__file__).resolve().parents[3] / "data" / "USA_Ham_Callbooks.sqlite"),
)

OUTPUT_PATH = os.environ.get(
    "EDITION_DIFF_PATH",
    str(Path(__file__).resolve().parents[3] / "data" / "edition_diff.json"),
)

# License class ordering — higher index = higher tier
_CLASS_ORDER = {"N": 1, "T": 2, "P": 3, "G": 4, "A": 5, "E": 6}


def _is_upgrade(class_a: str | None, class_b: str | None) -> bool:
    if not class_a or not class_b:
        return False
    a = _CLASS_ORDER.get(class_a.strip().upper(), 0)
    b = _CLASS_ORDER.get(class_b.strip().upper(), 0)
    return b > a > 0


def compute_pair(conn: sqlite3.Connection, year_a: int, label_a: str, year_b: int, label_b: str) -> dict[str, Any]:
    """Compute diff metrics between two editions using year column (matches actual schema)."""
    t0 = time.perf_counter()

    # adds: in B but not A
    adds = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
            EXCEPT
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
        )
        """,
        (year_b, year_a),
    ).fetchone()[0]

    # drops: in A but not B
    drops = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
            EXCEPT
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
        )
        """,
        (year_a, year_b),
    ).fetchone()[0]

    total_a = conn.execute(
        "SELECT COUNT(DISTINCT callsign) FROM entries WHERE year=? AND callsign IS NOT NULL",
        (year_a,),
    ).fetchone()[0]
    total_b = conn.execute(
        "SELECT COUNT(DISTINCT callsign) FROM entries WHERE year=? AND callsign IS NOT NULL",
        (year_b,),
    ).fetchone()[0]

    retained = total_b - adds

    # address_changes: same callsign, address|city|state differ — sample top 10
    addr_rows = conn.execute(
        """
        SELECT a.callsign,
               a.address || '|' || COALESCE(a.city,'') || '|' || COALESCE(a.state,'') AS addr_a,
               b.address || '|' || COALESCE(b.city,'') || '|' || COALESCE(b.state,'') AS addr_b
        FROM entries a
        JOIN entries b ON a.callsign = b.callsign AND b.year = ?
        WHERE a.year = ?
          AND a.callsign IS NOT NULL
          AND (
              COALESCE(a.address,'') != COALESCE(b.address,'')
              OR COALESCE(a.city,'')    != COALESCE(b.city,'')
              OR COALESCE(a.state,'')   != COALESCE(b.state,'')
          )
        LIMIT 200
        """,
        (year_b, year_a),
    ).fetchall()
    address_changes = len(addr_rows)
    addr_samples = [r[0] for r in addr_rows[:10]]

    # class_upgrades: same callsign, class upgraded
    class_rows = conn.execute(
        """
        SELECT a.callsign, a.license_class AS cls_a, b.license_class AS cls_b
        FROM entries a
        JOIN entries b ON a.callsign = b.callsign AND b.year = ?
        WHERE a.year = ?
          AND a.license_class IS NOT NULL
          AND b.license_class IS NOT NULL
          AND a.license_class != b.license_class
        LIMIT 500
        """,
        (year_b, year_a),
    ).fetchall()
    upgrades = [(r[0], r[1], r[2]) for r in class_rows if _is_upgrade(r[1], r[2])]
    class_upgrades = len(upgrades)
    upgrade_samples = [r[0] for r in upgrades[:10]]

    retention_pct = round(retained / total_a * 100, 1) if total_a > 0 else 0.0
    net = total_b - total_a

    duration = round(time.perf_counter() - t0, 2)
    logger.info(
        "%s -> %s : adds=%d drops=%d retained=%d net=%+d addr_changes=%d upgrades=%d (%.2fs)",
        f"{year_a}_{label_a}", f"{year_b}_{label_b}",
        adds, drops, retained, net, address_changes, class_upgrades, duration,
    )

    return {
        "year_a": year_a,
        "edition_a": f"{year_a}_{label_a}",
        "year_b": year_b,
        "edition_b": f"{year_b}_{label_b}",
        "total_a": total_a,
        "total_b": total_b,
        "adds": adds,
        "drops": drops,
        "retained": retained,
        "net": net,
        "retention_pct": retention_pct,
        "address_changes": address_changes,
        "address_change_samples": addr_samples,
        "class_upgrades": class_upgrades,
        "class_upgrade_samples": upgrade_samples,
    }


def compute_wwii_cohort(conn: sqlite3.Connection) -> dict[str, Any]:
    """WWII special cohort: 1941_Spring vs first post-war editions."""
    pre_war_year = 1941
    post_war_year = 1946

    silent = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
            EXCEPT
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
        )
        """,
        (pre_war_year, post_war_year),
    ).fetchone()[0]

    returned = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
            INTERSECT
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
        )
        """,
        (pre_war_year, post_war_year),
    ).fetchone()[0]

    postwar_new = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
            EXCEPT
            SELECT DISTINCT callsign FROM entries WHERE year=? AND callsign IS NOT NULL
        )
        """,
        (post_war_year, pre_war_year),
    ).fetchone()[0]

    total_pre = conn.execute(
        "SELECT COUNT(DISTINCT callsign) FROM entries WHERE year=? AND callsign IS NOT NULL",
        (pre_war_year,),
    ).fetchone()[0]
    total_post = conn.execute(
        "SELECT COUNT(DISTINCT callsign) FROM entries WHERE year=? AND callsign IS NOT NULL",
        (post_war_year,),
    ).fetchone()[0]

    return {
        "pre_war_edition": f"{pre_war_year}_Spring",
        "post_war_edition": f"{post_war_year}_Fall",
        "total_pre_war": total_pre,
        "total_post_war": total_post,
        "silent_count": silent,
        "returned_count": returned,
        "postwar_new_count": postwar_new,
        "note": (
            "Callsigns in 1941_Spring but absent from 1946_Fall = 'silent'; "
            "present in both = 'returned'; first appearing in 1946+ = 'postwar_new'. "
            "Full callsign lists served live by /api/diff/wwii endpoint."
        ),
    }


def main() -> None:
    t_total = time.perf_counter()
    logger.info("DB: %s", DB_PATH)
    logger.info("Output: %s", OUTPUT_PATH)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA cache_size = -32768")  # 32 MB page cache

    # Load qualifying editions ordered by year
    editions = conn.execute(
        "SELECT key, year, label, entry_count FROM editions WHERE entry_count > 100 ORDER BY year"
    ).fetchall()

    logger.info("Found %d qualifying editions", len(editions))

    pairs: list[dict[str, Any]] = []
    for i in range(len(editions) - 1):
        key_a, year_a, label_a, _ = editions[i]
        key_b, year_b, label_b, _ = editions[i + 1]
        # Skip pairs more than 10 years apart (huge gaps aren't true "consecutive")
        if year_b - year_a > 10:
            logger.info(
                "Skipping %s -> %s (gap %d years > 10)",
                key_a, key_b, year_b - year_a,
            )
            continue
        pair = compute_pair(conn, year_a, label_a, year_b, label_b)
        pairs.append(pair)

    logger.info("Computing WWII cohort...")
    wwii = compute_wwii_cohort(conn)

    conn.close()

    out = {
        "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataset_version": "v2026.06",
        "pair_count": len(pairs),
        "pairs": pairs,
        "wwii_cohort": wwii,
    }

    Path(OUTPUT_PATH).parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)

    elapsed = round(time.perf_counter() - t_total, 1)
    logger.info("Wrote %s (%d pairs) in %.1fs", OUTPUT_PATH, len(pairs), elapsed)


if __name__ == "__main__":
    main()
