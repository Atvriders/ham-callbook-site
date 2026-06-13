"""Build address_clusters.json + households.json artifacts.

Reads the ham callbook SQLite DB (entries table), normalizes every
populated address row (year >= 1927), clusters by
(normalized_address, city, state) key, detects household clusters
(same address, shared or matching surnames, >=2 distinct callsigns),
then writes two JSON artifacts under site/data/:

  site/data/address_clusters.json   -- cluster_key -> list of entries
  site/data/households.json         -- household clusters

Usage
-----
    python -m app.scripts.build_address_index
    DB_PATH=/data/USA_Ham_Callbooks.sqlite OUT_DIR=/data python build_address_index.py

Design goals
------------
- Output must stay <150 MB total.
- Cluster key is (NORM_ADDR, CITY_UPPER, STATE_UPPER) joined by "|" so
  two "123 MAIN STREET"s in different cities never merge.
- Clusters with >40 distinct callsigns get suspect_large=True; entries
  are capped at 200 to bound file size (count is still accurate).
- Addresses that are empty, too short (<5 chars after normalization),
  or clearly too generic (bare city names, "BOX 1", etc.) are excluded.
- Only entries with year >= 1927 are processed (earlier data too noisy).
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("build_address_index")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
# scripts/ -> app/ -> backend/ -> ham-callbook-site/
_PROJECT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))

DB_PATH: str = os.environ.get(
    "DB_PATH",
    os.environ.get(
        "CALLBOOK_DB_PATH",
        os.path.join(_PROJECT, "data", "USA_Ham_Callbooks.sqlite"),
    ),
)

_DEFAULT_OUT = os.path.join(_PROJECT, "data")
OUT_DIR: str = os.environ.get("OUT_DIR", _DEFAULT_OUT)

CLUSTERS_OUT = os.path.join(OUT_DIR, "address_clusters.json")
HOUSEHOLDS_OUT = os.path.join(OUT_DIR, "households.json")

# ---------------------------------------------------------------------------
# Normalization tables
# ---------------------------------------------------------------------------

STREET_TYPES: dict[str, str] = {
    "ST": "STREET",
    "AVE": "AVENUE",
    "AV": "AVENUE",
    "BLVD": "BOULEVARD",
    "BLV": "BOULEVARD",
    "DR": "DRIVE",
    "DRV": "DRIVE",
    "RD": "ROAD",
    "LN": "LANE",
    "CT": "COURT",
    "CRT": "COURT",
    "PL": "PLACE",
    "TER": "TERRACE",
    "TR": "TERRACE",
    "WAY": "WAY",
    "CIR": "CIRCLE",
    "PKWY": "PARKWAY",
    "PKY": "PARKWAY",
    "HWY": "HIGHWAY",
    "EXPY": "EXPRESSWAY",
}

DIRECTIONALS: dict[str, str] = {
    "N": "NORTH",
    "S": "SOUTH",
    "E": "EAST",
    "W": "WEST",
    "NE": "NORTHEAST",
    "NW": "NORTHWEST",
    "SE": "SOUTHEAST",
    "SW": "SOUTHWEST",
}

# Tokens that start an apartment/unit suffix — strip these and everything after
APT_TOKENS = frozenset(
    ["APT", "UNIT", "STE", "SUITE", "RM", "ROOM", "FL", "FLR", "#", "NO", "NUM"]
)

# Ordinal suffixes to strip
_ORDINAL_RE = re.compile(r"^(\d+)(ST|ND|RD|TH)$", re.IGNORECASE)

# PO Box patterns
_POBOX_RE = re.compile(
    r"^(?:P\.?O\.?\s*BOX|BOX)\s*(\d+)", re.IGNORECASE
)

# Noise: lone punctuation-only tokens, very noisy OCR artifacts
_PUNCT_ONLY = re.compile(r"^[^A-Z0-9]+$", re.IGNORECASE)

# Generic non-address patterns to exclude entirely
_GENERIC_EXCLUSIONS = re.compile(
    r"^(GENERAL DELIVERY|RFD|ROUTE \d+|R\.?F\.?D|RR \d+|RURAL ROUTE)$",
    re.IGNORECASE,
)

# Minimum length for normalized address to be indexed
MIN_NORM_LEN = 5

# Clusters with > this many distinct callsigns are flagged suspect_large
SUSPECT_LARGE_THRESHOLD = 40

# Maximum entries stored per cluster (count still accurate)
MAX_ENTRIES_PER_CLUSTER = 200

# ---------------------------------------------------------------------------
# Core normalizer
# ---------------------------------------------------------------------------


def normalize_address(raw: str) -> str | None:
    """Return a canonical address key string, or None if not indexable."""
    if not raw or not raw.strip():
        return None

    addr = raw.upper().strip()

    # Check for PO Box first — these form their own cluster key
    m = _POBOX_RE.match(addr)
    if m:
        return f"BOX {m.group(1)}"

    # Split into tokens on whitespace and common separators
    # Replace commas, periods, semicolons, colons, hyphens with space
    addr = re.sub(r"[,;:.]", " ", addr)
    tokens = addr.split()

    if not tokens:
        return None

    # Strip leading/trailing lone punctuation tokens
    tokens = [t.strip(".,;:-") for t in tokens]
    tokens = [t for t in tokens if t]

    # Cut at apt/unit noise
    cut_idx = None
    for i, tok in enumerate(tokens):
        if tok in APT_TOKENS or tok.startswith("#"):
            cut_idx = i
            break
    if cut_idx is not None:
        tokens = tokens[:cut_idx]

    if not tokens:
        return None

    # Ordinal normalization: 1ST -> 1, 2ND -> 2, etc.
    normed: list[str] = []
    for tok in tokens:
        m2 = _ORDINAL_RE.match(tok)
        if m2:
            normed.append(m2.group(1))
        else:
            normed.append(tok)

    # Expand directionals (only if they appear as standalone prefix or suffix tokens)
    # Prefix directional (position 1 or after house number at position 0)
    result: list[str] = []
    for i, tok in enumerate(normed):
        if tok in DIRECTIONALS:
            result.append(DIRECTIONALS[tok])
        elif tok in STREET_TYPES:
            result.append(STREET_TYPES[tok])
        elif _PUNCT_ONLY.match(tok):
            pass  # drop pure-punctuation tokens
        elif len(tok) == 1 and not tok.isdigit():
            pass  # drop lone non-digit single chars (OCR noise)
        else:
            result.append(tok)

    if not result:
        return None

    normalized = " ".join(result)

    # Reject exclusion patterns
    if _GENERIC_EXCLUSIONS.match(normalized):
        return None

    # Reject if too short
    if len(normalized) < MIN_NORM_LEN:
        return None

    # Reject if it looks like just a city/place name with no house number.
    # Real street addresses almost always contain a digit (house number).
    # Exceptions: named estates, rural routes, "RFD" (already filtered above).
    # We require at least one digit for all non-PO-Box addresses to avoid
    # clustering city names ("SALT LAKE CITY", "EAST POINT GA") as addresses.
    if not any(c.isdigit() for c in normalized):
        return None

    return normalized


def make_cluster_key(norm_addr: str, city: str | None, state: str | None) -> str:
    city_part = (city or "").upper().strip()
    state_part = (state or "").upper().strip()
    return f"{norm_addr}|{city_part}|{state_part}"


# ---------------------------------------------------------------------------
# Surname extraction + household detection
# ---------------------------------------------------------------------------


def extract_surname(name: str) -> str | None:
    """Extract a normalized surname from a full name string."""
    if not name or not name.strip():
        return None
    # Name formats: "JOHN SMITH", "Smith, John", "John A Smith", etc.
    # Clean OCR noise
    cleaned = re.sub(r"[^A-Za-z\s\-]", " ", name).strip()
    parts = cleaned.split()
    if not parts:
        return None
    # Drop honorifics and generational suffixes
    drop_tokens = {"JR", "SR", "II", "III", "IV", "DR", "MR", "MRS", "MS", "PROF"}
    parts = [p.upper() for p in parts if p.upper() not in drop_tokens]
    if not parts:
        return None
    # Take the last token as surname (handles "JOHN SMITH" -> "SMITH")
    surname = parts[-1]
    # Must be at least 2 chars and alphabetic
    if len(surname) < 2 or not re.match(r"^[A-Z\-]+$", surname):
        return None
    return surname


def surnames_match(s1: str, s2: str) -> bool:
    """Return True if surnames are the same or one is a prefix of the other."""
    if s1 == s2:
        return True
    # Shared prefix: e.g. SMITH + SMITHJR, JONES + JONES-MILLER
    if s1.startswith(s2) or s2.startswith(s1):
        return True
    return False


# ---------------------------------------------------------------------------
# Main build logic
# ---------------------------------------------------------------------------


def build(db_path: str, out_dir: str) -> None:
    t0 = time.time()
    os.makedirs(out_dir, exist_ok=True)

    logger.info("Opening DB: %s", db_path)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    # Count rows for progress logging
    total_rows = con.execute(
        "SELECT COUNT(*) FROM entries WHERE year >= 1927 AND address IS NOT NULL AND address != ''"
    ).fetchone()[0]
    logger.info("Total rows to process: %d", total_rows)

    # Cluster accumulation: key -> {callsigns, entries}
    clusters: dict[str, dict[str, Any]] = {}

    batch_size = 50_000
    processed = 0
    skipped_normalization = 0
    skipped_no_city_state = 0

    # Stream all rows
    cur = con.execute(
        """
        SELECT callsign, year, edition, name, address, city, state
        FROM entries
        WHERE year >= 1927
          AND address IS NOT NULL AND address != ''
        ORDER BY callsign, year
        """
    )

    while True:
        rows = cur.fetchmany(batch_size)
        if not rows:
            break

        for row in rows:
            raw_addr = row["address"] or ""
            city = (row["city"] or "").strip()
            state = (row["state"] or "").strip()

            norm = normalize_address(raw_addr)
            if norm is None:
                skipped_normalization += 1
                continue

            # Require at least state for a meaningful cluster key
            if not state:
                skipped_no_city_state += 1
                continue

            key = make_cluster_key(norm, city, state)

            if key not in clusters:
                clusters[key] = {
                    "normalized_address": norm,
                    "city": city.upper() if city else "",
                    "state": state.upper(),
                    "callsigns": set(),
                    "entries": [],
                }

            cluster = clusters[key]
            cs = (row["callsign"] or "").strip().upper()
            cluster["callsigns"].add(cs)

            if len(cluster["entries"]) < MAX_ENTRIES_PER_CLUSTER:
                cluster["entries"].append(
                    {
                        "callsign": cs,
                        "year": row["year"],
                        "edition": row["edition"] or "",
                        "name": (row["name"] or "").strip(),
                        "raw_address": raw_addr,
                        "city": city,
                        "state": state,
                    }
                )

        processed += len(rows)
        if processed % 500_000 == 0:
            elapsed = time.time() - t0
            logger.info(
                "  processed %d / %d rows (%.0fs), clusters so far: %d",
                processed,
                total_rows,
                elapsed,
                len(clusters),
            )

    con.close()
    logger.info(
        "Scan complete: %d rows processed, %d skipped (bad norm), %d skipped (no state)",
        processed,
        skipped_normalization,
        skipped_no_city_state,
    )
    logger.info("Raw cluster count: %d", len(clusters))

    # ---------------------------------------------------------------------------
    # Post-process clusters: finalize counts, flag suspect_large, sort entries
    # ---------------------------------------------------------------------------

    distinct_addresses = len(clusters)
    multi_occupant = 0
    suspect_large_count = 0

    clusters_out: dict[str, Any] = {}
    for key, c in clusters.items():
        cs_set = c["callsigns"]
        cs_count = len(cs_set)
        entry_count = len(c["entries"])

        if cs_count > 1:
            multi_occupant += 1

        suspect = cs_count > SUSPECT_LARGE_THRESHOLD
        if suspect:
            suspect_large_count += 1

        # Sort entries by year then callsign
        sorted_entries = sorted(c["entries"], key=lambda e: (e["year"], e["callsign"]))

        clusters_out[key] = {
            "normalized_address": c["normalized_address"],
            "city": c["city"],
            "state": c["state"],
            "callsign_count": cs_count,
            "entry_count_total": entry_count,  # may be capped
            "suspect_large": suspect,
            "entries": sorted_entries,
        }

    # ---------------------------------------------------------------------------
    # Household detection
    # ---------------------------------------------------------------------------

    logger.info("Detecting household clusters...")
    households: list[dict[str, Any]] = []
    household_count = 0

    for key, c in clusters.items():
        entries = c["entries"]
        cs_set = c["callsigns"]
        if len(cs_set) < 2:
            continue

        # Group by callsign -> pick the most frequent name per callsign
        cs_names: dict[str, list[str]] = defaultdict(list)
        for e in entries:
            if e["name"]:
                cs_names[e["callsign"]].append(e["name"])

        # Extract a single representative surname per callsign
        cs_surname: dict[str, str] = {}
        for cs, names in cs_names.items():
            # Take most common name
            name_counts: dict[str, int] = defaultdict(int)
            for n in names:
                name_counts[n] += 1
            best_name = max(name_counts, key=lambda x: name_counts[x])
            sn = extract_surname(best_name)
            if sn:
                cs_surname[cs] = sn

        if len(cs_surname) < 2:
            continue

        # Group callsigns by surname family (using shared-prefix matching)
        # Build groups: list of (surname, [callsigns])
        assigned: set[str] = set()
        surname_groups: list[tuple[str, list[str]]] = []

        surnames = list(cs_surname.items())  # (cs, sn)
        for i, (cs_a, sn_a) in enumerate(surnames):
            if cs_a in assigned:
                continue
            group = [cs_a]
            assigned.add(cs_a)
            for j, (cs_b, sn_b) in enumerate(surnames):
                if j <= i or cs_b in assigned:
                    continue
                if surnames_match(sn_a, sn_b):
                    group.append(cs_b)
                    assigned.add(cs_b)
            if len(group) >= 2:
                surname_groups.append((sn_a, group))

        for surname, group_callsigns in surname_groups:
            # Collect entry years for this group
            group_cs_set = set(group_callsigns)
            years = [
                e["year"] for e in entries if e["callsign"] in group_cs_set
            ]
            if not years:
                continue

            hh_key = f"{key}|{surname}"
            households.append(
                {
                    "household_key": hh_key,
                    "cluster_key": key,
                    "normalized_address": clusters_out[key]["normalized_address"],
                    "city": clusters_out[key]["city"],
                    "state": clusters_out[key]["state"],
                    "surname": surname,
                    "callsigns": sorted(group_callsigns),
                    "callsign_count": len(group_callsigns),
                    "first_year": min(years),
                    "last_year": max(years),
                }
            )
            household_count += 1

    logger.info("Household clusters detected: %d", household_count)

    # ---------------------------------------------------------------------------
    # Write artifacts
    # ---------------------------------------------------------------------------

    generated = datetime.now(timezone.utc).isoformat()

    # ---------------------------------------------------------------------------
    # Split artifact into two files to stay <150 MB total:
    # 1. address_clusters.json  -- ONLY multi-occupant clusters (callsign_count>1)
    #    These are the useful "timeline" addresses. ~151k clusters.
    # 2. address_index.json     -- compact callsign -> [cluster_key, ...] lookup
    #    Enables "all addresses for a callsign" without loading all entries.
    # Single-callsign clusters are omitted from the clusters file but included
    # in the index so a callsign lookup still finds their address cluster key.
    # ---------------------------------------------------------------------------

    # ---------------------------------------------------------------------------
    # Split artifact to stay <150 MB total:
    # address_clusters.json -- ONLY multi-occupant clusters (callsign_count>1).
    #   These are the useful "timeline" addresses. ~151k clusters.
    #   Single-callsign clusters are omitted; they account for ~95% of file size
    #   but have no timeline value. The integration can fall back to a live DB
    #   query for single-callsign lookups.
    # ---------------------------------------------------------------------------

    multi_clusters_out = {
        k: v for k, v in clusters_out.items() if v["callsign_count"] > 1
    }

    # Also build a compact callsign->cluster_key lookup restricted to
    # multi-occupant clusters only (useful for cross-linking callsign pages).
    cs_to_keys: dict[str, list[str]] = defaultdict(list)
    for key, c in multi_clusters_out.items():
        for e in c["entries"]:
            cs = e["callsign"]
            if key not in cs_to_keys[cs]:
                cs_to_keys[cs].append(key)

    clusters_artifact = {
        "generated": generated,
        "total_clusters": distinct_addresses,
        "multi_occupant_clusters": multi_occupant,
        "suspect_large_clusters": suspect_large_count,
        "note": (
            "Multi-occupant only (callsign_count>1). "
            "callsign_index maps callsign -> cluster_keys for cross-linking."
        ),
        "callsign_index": dict(cs_to_keys),
        "entries": multi_clusters_out,
    }

    # Slim households: drop fields derivable from cluster_key or list length
    slim_households = [
        {
            "cluster_key": h["cluster_key"],
            "surname": h["surname"],
            "callsigns": h["callsigns"],
            "first_year": h["first_year"],
            "last_year": h["last_year"],
        }
        for h in households
    ]

    households_artifact = {
        "generated": generated,
        "total_households": household_count,
        "note": "household_key = cluster_key+'|'+surname. cluster_key = 'NORM_ADDR|CITY|STATE'.",
        "households": slim_households,
    }

    logger.info("Writing %s ...", CLUSTERS_OUT)
    with open(CLUSTERS_OUT, "w", encoding="utf-8") as f:
        json.dump(clusters_artifact, f, separators=(",", ":"))

    logger.info("Writing %s ...", HOUSEHOLDS_OUT)
    with open(HOUSEHOLDS_OUT, "w", encoding="utf-8") as f:
        json.dump(households_artifact, f, indent=2)

    # ---------------------------------------------------------------------------
    # Stats report
    # ---------------------------------------------------------------------------

    clusters_size = os.path.getsize(CLUSTERS_OUT)
    households_size = os.path.getsize(HOUSEHOLDS_OUT)
    total_size = clusters_size + households_size
    elapsed = time.time() - t0

    logger.info("=" * 60)
    logger.info("BUILD COMPLETE in %.1f seconds", elapsed)
    logger.info("  Rows processed:              %d", processed)
    logger.info("  Rows skipped (bad norm):     %d", skipped_normalization)
    logger.info("  Rows skipped (no state):     %d", skipped_no_city_state)
    logger.info("  Distinct normalized addresses: %d", distinct_addresses)
    logger.info("  Multi-occupant addresses:    %d", multi_occupant)
    logger.info("  Suspect-large clusters:      %d", suspect_large_count)
    logger.info("  Household clusters:          %d", household_count)
    logger.info(
        "  address_clusters.json:       %.1f MB", clusters_size / 1_048_576
    )
    logger.info(
        "  households.json:             %.1f MB", households_size / 1_048_576
    )
    logger.info(
        "  TOTAL:                       %.1f MB", total_size / 1_048_576
    )
    logger.info("=" * 60)

    # Print 10 worked examples
    _print_examples(clusters_out, households)


def _print_examples(
    clusters_out: dict[str, Any], households: list[dict[str, Any]]
) -> None:
    logger.info("")
    logger.info("=== WORKED EXAMPLES ===")

    # Example 1: ARRL HQ (multi-callsign, known address)
    arrl_key = "225 MAIN STREET|NEWINGTON|CT"
    if arrl_key in clusters_out:
        c = clusters_out[arrl_key]
        logger.info(
            "EX-1 ARRL HQ (%s): %d callsigns, years %d-%d",
            arrl_key,
            c["callsign_count"],
            c["entries"][0]["year"] if c["entries"] else 0,
            c["entries"][-1]["year"] if c["entries"] else 0,
        )
        for e in c["entries"][:5]:
            logger.info("  %d  %-10s  %s", e["year"], e["callsign"], e["name"])
    else:
        logger.info("EX-1: ARRL key not found (try nearby key)")
        # Find any key containing 225 MAIN
        for k, c in clusters_out.items():
            if "225 MAIN" in k and "NEWINGTON" in k:
                logger.info("  Found alt key: %s  cs=%d", k, c["callsign_count"])
                for e in c["entries"][:3]:
                    logger.info("  %d  %-10s  %s", e["year"], e["callsign"], e["name"])
                break

    # Example 2: Father/son household (Moss family, Mobile AL)
    for hh in households:
        if "MOSS" in hh["surname"] and hh["state"] == "AL":
            logger.info(
                "EX-2 Moss household (%s, %s %s): callsigns=%s years=%d-%d",
                hh["normalized_address"],
                hh["city"],
                hh["state"],
                hh["callsigns"],
                hh["first_year"],
                hh["last_year"],
            )
            break

    # Examples 3-6: top multi-occupant non-suspect clusters
    logger.info("EX-3 to EX-6: top multi-occupant non-suspect addresses")
    count = 0
    for key, c in sorted(
        clusters_out.items(), key=lambda x: -x[1]["callsign_count"]
    ):
        if c["suspect_large"] or c["callsign_count"] < 2:
            continue
        logger.info(
            "  %-50s  callsigns=%d  entries=%d",
            key,
            c["callsign_count"],
            c["entry_count_total"],
        )
        for e in c["entries"][:3]:
            logger.info("    %d  %-10s  %s", e["year"], e["callsign"], e["name"])
        count += 1
        if count >= 4:
            break

    # Examples 7-8: random household clusters
    logger.info("EX-7 to EX-8: sample household clusters")
    shown = 0
    for hh in households:
        if hh["callsign_count"] >= 2 and hh["callsign_count"] <= 4:
            logger.info(
                "  Household: %s  addr=%s  %s %s  callsigns=%s  years=%d-%d",
                hh["surname"],
                hh["normalized_address"],
                hh["city"],
                hh["state"],
                hh["callsigns"],
                hh["first_year"],
                hh["last_year"],
            )
            shown += 1
            if shown >= 2:
                break

    # Examples 9-10: suspect_large samples
    logger.info("EX-9 to EX-10: suspect_large clusters (false-merge candidates)")
    count = 0
    for key, c in clusters_out.items():
        if c["suspect_large"]:
            logger.info(
                "  SUSPECT %-50s  callsigns=%d", key, c["callsign_count"]
            )
            count += 1
            if count >= 2:
                break


if __name__ == "__main__":
    logger.info("DB_PATH: %s", DB_PATH)
    logger.info("OUT_DIR: %s", OUT_DIR)
    if not os.path.exists(DB_PATH):
        logger.error("DB not found: %s", DB_PATH)
        sys.exit(1)
    build(DB_PATH, OUT_DIR)
