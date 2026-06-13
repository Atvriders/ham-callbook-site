#!/usr/bin/env python3
"""build_defunct_clubs.py — Pre-compute the Defunct / Silent Club artifact.

Reads the callbook DB + uls.json, classifies clubs that were active in the
printed-era corpus and then vanished forever (no surviving FCC-active callsign),
and writes ``site/data/defunct_clubs.json``.

Usage
-----
    python3 scripts/build_defunct_clubs.py [OPTIONS]

Options
-------
    --gap INT           Years of silence before corpus end required (default 10)
    --min-appearances INT  Minimum edition appearances to exclude OCR phantoms (default 2)
    --min-span INT      Minimum year span (last - first) to exclude single-year noise (default 3)
    --db PATH           SQLite DB path (default auto-detected)
    --uls PATH          ULS JSON path (default auto-detected)
    --out PATH          Output JSON path (default auto-detected)

Era classification (based on actual corpus edition coverage)
------------------------------------------------------------
    pre_war              first_year <= 1942 AND last_year <= 1946
    mid_century          last_year <= 1965  (and not pre_war)
    incentive_licensing  last_year 1968–1978
    post_boom            everything else

Callsign fate codes
-------------------
    dead_missing    Callsign absent from ULS entirely — never re-assigned
    dead_expired    ULS status E — licence lapsed
    dead_cancelled  ULS status C or T — revoked/cancelled
    active          ULS status A — licence is alive (club is NOT defunct)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("build_defunct_clubs")

# ---------------------------------------------------------------------------
# Path resolution helpers
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parent.parent  # scripts/../


def _resolve_db(override: str | None) -> str:
    if override:
        return override
    candidates = [
        os.environ.get("DB_PATH", ""),
        str(_PROJECT_ROOT / "data" / "USA_Ham_Callbooks.sqlite"),
        "/data/USA_Ham_Callbooks.sqlite",
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    raise FileNotFoundError("Cannot locate USA_Ham_Callbooks.sqlite — pass --db")


def _resolve_uls(override: str | None) -> str:
    if override:
        return override
    candidates = [
        os.environ.get("ULS_JSON_PATH", ""),
        str(_PROJECT_ROOT / "data" / "uls.json"),
        "/data/uls.json",
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    raise FileNotFoundError("Cannot locate uls.json — pass --uls")


def _resolve_out(override: str | None) -> str:
    if override:
        return override
    env = os.environ.get("DEFUNCT_CLUBS_PATH", "")
    if env:
        return env
    return str(_PROJECT_ROOT / "data" / "defunct_clubs.json")


# ---------------------------------------------------------------------------
# Era classification
# ---------------------------------------------------------------------------

CORPUS_END = 1997


def classify_era(first_year: int | None, last_year: int | None) -> str:
    """Return era_class string for a defunct club."""
    fy = first_year or 0
    ly = last_year or 0
    if fy <= 1942 and ly <= 1946:
        return "pre_war"
    if ly <= 1965:
        return "mid_century"
    if 1968 <= ly <= 1978:
        return "incentive_licensing"
    return "post_boom"


ERA_LABELS: dict[str, str] = {
    "pre_war": "Pre-War",
    "mid_century": "Mid-Century",
    "incentive_licensing": "Incentive Licensing",
    "post_boom": "Post-Boom",
}

# ---------------------------------------------------------------------------
# Main build logic
# ---------------------------------------------------------------------------


def build(
    db_path: str,
    uls_path: str,
    out_path: str,
    gap: int,
    min_appearances: int,
    min_span: int,
) -> dict[str, Any]:
    t0 = time.perf_counter()

    # ------------------------------------------------------------------
    # Load ULS
    # ------------------------------------------------------------------
    log.info("Loading ULS: %s", uls_path)
    t_uls = time.perf_counter()
    with open(uls_path, encoding="utf-8") as fh:
        uls: dict[str, dict[str, Any]] = json.load(fh)
    log.info("ULS loaded: %d entries in %.1fs", len(uls), time.perf_counter() - t_uls)

    # ------------------------------------------------------------------
    # Open DB read-only
    # ------------------------------------------------------------------
    uri = f"file:{db_path}?mode=ro"
    log.info("Opening DB (read-only): %s", db_path)
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row

    threshold_year = CORPUS_END - gap

    # ------------------------------------------------------------------
    # Fetch structural candidates
    # ------------------------------------------------------------------
    log.info(
        "Gate: last_year <= %d, appearance_count >= %d, span >= %d",
        threshold_year,
        min_appearances,
        min_span,
    )
    cur = db.cursor()
    cur.execute(
        """
        SELECT slug, display_name, first_year, last_year,
               appearance_count, callsign_count,
               dominant_state, dominant_city, club_type
        FROM clubs
        WHERE last_year <= ?
          AND appearance_count >= ?
          AND (last_year - first_year) >= ?
        ORDER BY appearance_count DESC
        """,
        (threshold_year, min_appearances, min_span),
    )
    candidates = cur.fetchall()
    log.info("Structural candidates: %d", len(candidates))

    # ------------------------------------------------------------------
    # ULS cross-reference
    # ------------------------------------------------------------------
    clubs_out: list[dict[str, Any]] = []
    skipped_has_active = 0

    for row in candidates:
        slug: str = row["slug"]
        display_name: str = row["display_name"] or slug
        first_year: int | None = row["first_year"]
        last_year: int | None = row["last_year"]
        appearance_count: int = row["appearance_count"] or 0
        callsign_count: int = row["callsign_count"] or 0
        dominant_state: str | None = row["dominant_state"]
        dominant_city: str | None = row["dominant_city"]
        club_type: str | None = row["club_type"]

        # Fetch associated callsigns
        cur.execute(
            """
            SELECT callsign, first_year, last_year, appearance_count
            FROM club_callsigns
            WHERE slug = ?
            ORDER BY appearance_count DESC
            """,
            (slug,),
        )
        cs_rows = cur.fetchall()

        # Classify each callsign fate
        callsign_fates: list[dict[str, Any]] = []
        has_active = False
        for cs_row in cs_rows:
            cs: str = cs_row["callsign"]
            uls_rec = uls.get(cs)
            if uls_rec is None:
                fate = "dead_missing"
                uls_status = None
            elif uls_rec.get("status") == "A":
                fate = "active"
                uls_status = "A"
                has_active = True
            elif uls_rec.get("status") == "E":
                fate = "dead_expired"
                uls_status = "E"
            else:
                fate = "dead_cancelled"
                uls_status = uls_rec.get("status")
            callsign_fates.append(
                {
                    "callsign": cs,
                    "fate": fate,
                    "uls_status": uls_status,
                    "last_year": cs_row["last_year"],
                }
            )

        if has_active:
            skipped_has_active += 1
            continue

        era_class = classify_era(first_year, last_year)
        span_years = (last_year - first_year) if (first_year and last_year) else 0
        years_silent = (CORPUS_END - (last_year or CORPUS_END)) + (2026 - CORPUS_END)

        clubs_out.append(
            {
                "slug": slug,
                "display_name": display_name,
                "first_year": first_year,
                "last_year": last_year,
                "span_years": span_years,
                "appearance_count": appearance_count,
                "callsign_count": callsign_count,
                "dominant_state": dominant_state,
                "dominant_city": dominant_city,
                "club_type": club_type,
                "era_class": era_class,
                "years_silent": years_silent,
                "callsign_fates": callsign_fates,
            }
        )

    db.close()
    log.info(
        "Defunct: %d  |  Skipped (has active FCC call): %d",
        len(clubs_out),
        skipped_has_active,
    )

    # ------------------------------------------------------------------
    # Build indexes
    # ------------------------------------------------------------------
    by_state: dict[str, list[str]] = defaultdict(list)
    by_era: dict[str, list[str]] = defaultdict(list)
    era_counts: Counter[str] = Counter()
    state_counts: Counter[str] = Counter()

    for club in clubs_out:
        slug = club["slug"]
        state = club["dominant_state"]
        era = club["era_class"]
        by_era[era].append(slug)
        era_counts[era] += 1
        if state:
            by_state[state].append(slug)
            state_counts[state] += 1

    facets_by_era = {k: era_counts[k] for k in sorted(era_counts)}
    facets_by_state = {k: state_counts[k] for k in sorted(state_counts)}

    # ------------------------------------------------------------------
    # Assemble artifact
    # ------------------------------------------------------------------
    artifact: dict[str, Any] = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_version": str(CORPUS_END),
        "corpus_end": CORPUS_END,
        "gap_years": gap,
        "min_appearances": min_appearances,
        "min_span": min_span,
        "total": len(clubs_out),
        "facets": {
            "by_era": facets_by_era,
            "by_state": facets_by_state,
        },
        "indexes": {
            "by_state": dict(by_state),
            "by_era": dict(by_era),
        },
        "clubs": clubs_out,
    }

    elapsed = time.perf_counter() - t0
    log.info(
        "Build complete: %d defunct clubs in %.1fs",
        len(clubs_out),
        elapsed,
    )
    return artifact


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gap", type=int, default=10, help="Years of silence gate")
    parser.add_argument("--min-appearances", type=int, default=2)
    parser.add_argument("--min-span", type=int, default=3)
    parser.add_argument("--db", default=None, help="SQLite DB path")
    parser.add_argument("--uls", default=None, help="ULS JSON path")
    parser.add_argument("--out", default=None, help="Output JSON path")
    args = parser.parse_args()

    db_path = _resolve_db(args.db)
    uls_path = _resolve_uls(args.uls)
    out_path = _resolve_out(args.out)

    log.info("DB:  %s", db_path)
    log.info("ULS: %s", uls_path)
    log.info("OUT: %s", out_path)

    artifact = build(
        db_path=db_path,
        uls_path=uls_path,
        out_path=out_path,
        gap=args.gap,
        min_appearances=args.min_appearances,
        min_span=args.min_span,
    )

    # Write output
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, separators=(",", ":"))
    os.replace(tmp, out_path)

    size_kb = os.path.getsize(out_path) / 1024
    log.info("Wrote %s  (%.1f KB)", out_path, size_kb)

    # Summary to stdout
    facets = artifact["facets"]
    print(f"\n=== Defunct Club Artifact Summary ===")
    print(f"Total defunct clubs : {artifact['total']}")
    print(f"Gap threshold       : {artifact['gap_years']} years (last_year <= {int(artifact['dataset_version']) - artifact['gap_years']})")
    print(f"Min appearances     : {artifact['min_appearances']}")
    print(f"Min span            : {artifact['min_span']} years")
    print(f"\nBy era:")
    for era, count in sorted(facets["by_era"].items(), key=lambda x: -x[1]):
        print(f"  {ERA_LABELS.get(era, era):<25} {count:>4}")
    print(f"\nTop 15 states:")
    top_states = sorted(facets["by_state"].items(), key=lambda x: -x[1])[:15]
    for st, count in top_states:
        print(f"  {st}  {count}")
    print(f"\nOutput: {out_path}  ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
