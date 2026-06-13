"""Build the printed_lineage.json artifact for the KN→K Novice lineage feature.

Run this script after DB rebuilds.  It reads the SQLite database at DB_PATH,
deterministically links KN<X>/WN<X> Novice callsigns to their K<X>/W<X>
upgrades using year-adjacency + name/address matching, and writes
data/printed_lineage.json alongside the DB.

Prefix rules implemented
------------------------
* KN<digit><suffix>  →  K<digit><suffix>   (KN = FCC Novice prefix, all districts)
* WN<digit><suffix>  →  W<digit><suffix>   (WN = equivalent W-district Novice)
* WV<digit><suffix>  →  W<digit><suffix>   (WV = early Novice variant, rare)

Scoring (emit only when score ≥ 4 AND both name AND address must contribute)
---------------------------------------------------------------------------
+2  Normalized last-name match (most reliable signal)
+2  Address head match (first 12 non-noise chars)
+1  First-token surname partial / initial match (fallback)
+1  City match (secondary address signal)

Gate: score >= 4 AND ("name" in basis OR "name_partial" in basis OR "name_prefix" in basis)
      AND ("address" in basis OR "address_partial" in basis).
This eliminates name-only or address-only matches that drove false-positive rate.

Confidence
----------
score ≥ 4  → "high"  (requires name + address both matched = 4 pts minimum)
score == 3 → "medium" (not emitted in v1; kept for future relaxation)

ULS confirmation
----------------
If uls_history.json is present, checks whether the upgrade call's ``prev_call``
equals the novice call.  Sets ``uls_confirmed: true`` when so.

Usage
-----
    python -m app.scripts.build_printed_lineage
    DB_PATH=/data/USA_Ham_Callbooks.sqlite python build_printed_lineage.py
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("build_printed_lineage")

# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# backend/app/scripts/ -> backend/app/ -> backend/ -> project root
_PROJECT_ROOT = os.path.abspath(
    os.path.join(_SCRIPT_DIR, "..", "..", "..")
)
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")

DB_PATH: str = os.environ.get(
    "DB_PATH",
    os.path.join(_DATA_DIR, "USA_Ham_Callbooks.sqlite"),
)

ULS_HISTORY_PATH: str = os.environ.get(
    "ULS_HISTORY_PATH",
    os.path.join(_DATA_DIR, "uls_history.json"),
)

PRINTED_LINEAGE_OUT: str = os.environ.get(
    "PRINTED_LINEAGE_OUT",
    os.path.join(_DATA_DIR, "printed_lineage.json"),
)

# --------------------------------------------------------------------------- #
# Novice prefix rules: (novice_prefix, upgrade_prefix)                        #
# --------------------------------------------------------------------------- #

PREFIX_PAIRS: list[tuple[str, str]] = [
    ("KN", "K"),
    ("WN", "W"),
    ("WV", "W"),
]

# --------------------------------------------------------------------------- #
# Normalization helpers                                                        #
# --------------------------------------------------------------------------- #

# Characters that often appear as OCR noise in addresses
_NOISE_RE = re.compile(r"[^A-Z0-9 ]")
_MULTI_SPACE = re.compile(r" {2,}")

# Period-abbreviation expansion table (old callbook printing convention)
_ABBR = {
    "WM": "WILLIAM",
    "CHAS": "CHARLES",
    "JNO": "JOHN",
    "ROBT": "ROBERT",
    "GEO": "GEORGE",
    "JAS": "JAMES",
    "THOS": "THOMAS",
    "JOS": "JOSEPH",
    "BENJ": "BENJAMIN",
    "EDW": "EDWARD",
    "SAML": "SAMUEL",
    "DANL": "DANIEL",
    "RICHD": "RICHARD",
    "FREDK": "FREDERICK",
    "ALBT": "ALBERT",
    "ANDW": "ANDREW",
    "NATHL": "NATHANIEL",
    "HY": "HENRY",
    "THOS": "THOMAS",
}


def _expand_abbr(token: str) -> str:
    """Expand a period-abbreviation token if known."""
    clean = token.rstrip(".")
    return _ABBR.get(clean, clean)


def normalize_name(raw: str | None) -> str:
    """Uppercase, strip noise, expand abbreviations.

    Returns '' on empty/None input.
    """
    if not raw:
        return ""
    upper = raw.upper()
    # Strip common OCR punctuation that isn't part of a name
    clean = re.sub(r"[^A-Z .\-]", " ", upper)
    clean = _MULTI_SPACE.sub(" ", clean).strip()
    tokens = clean.split()
    expanded = [_expand_abbr(t) for t in tokens]
    return " ".join(expanded)


def normalize_addr(raw: str | None) -> str:
    """Uppercase, strip punctuation/noise, collapse spaces."""
    if not raw:
        return ""
    upper = raw.upper()
    clean = _NOISE_RE.sub(" ", upper)
    clean = _MULTI_SPACE.sub(" ", clean).strip()
    return clean


def _last_name_token(name_norm: str) -> str:
    """Return the longest token, presumed to be the surname.

    Old callbooks often printed 'JOHN H SMITH' or 'SMITH JOHN H'.
    We take the longest token (>3 chars) as the most likely surname.
    """
    tokens = [t for t in name_norm.split() if len(t) > 3]
    if not tokens:
        return ""
    return max(tokens, key=len)


def _first_token(name_norm: str) -> str:
    """Return the first space-delimited token of a normalized name."""
    parts = name_norm.split()
    return parts[0] if parts else ""


# --------------------------------------------------------------------------- #
# Scoring                                                                      #
# --------------------------------------------------------------------------- #


def score_pair(
    nov_name: str,
    nov_addr: str,
    nov_city: str,
    upg_name: str,
    upg_addr: str,
    upg_city: str,
) -> tuple[int, list[str]]:
    """Compute a match score and list of match bases.

    Parameters are already normalized strings ('' if unavailable).
    Returns (score, basis_list).
    """
    score = 0
    basis: list[str] = []

    # ---- Name scoring ----
    nov_last = _last_name_token(nov_name)
    upg_last = _last_name_token(upg_name)

    if nov_last and upg_last and len(nov_last) >= 4:
        if nov_last == upg_last:
            score += 2
            basis.append("name")
        elif nov_last in upg_name or upg_last in nov_name:
            # Partial surname match (handles OCR drift like HIBBARD vs HIBBARO)
            score += 1
            basis.append("name_partial")
        elif nov_last[:4] == upg_last[:4]:
            # 4-char prefix match (OCR truncation)
            score += 1
            basis.append("name_prefix")

    # ---- Address scoring ----
    nov_head = nov_addr[:12] if nov_addr else ""
    upg_head = upg_addr[:12] if upg_addr else ""
    if nov_head and upg_head and len(nov_head) >= 5:
        if nov_head == upg_head:
            score += 2
            basis.append("address")
        elif nov_addr[:8] == upg_addr[:8]:
            score += 1
            basis.append("address_partial")

    # ---- City scoring (secondary signal only, no solo credit) ----
    nov_city_n = normalize_addr(nov_city)[:10]
    upg_city_n = normalize_addr(upg_city)[:10]
    if nov_city_n and upg_city_n and len(nov_city_n) >= 4 and nov_city_n == upg_city_n:
        score += 1
        if "address" not in basis and "address_partial" not in basis:
            basis.append("city")

    return score, basis


# --------------------------------------------------------------------------- #
# Canonical value helpers (mode / first non-null)                              #
# --------------------------------------------------------------------------- #


def _mode(values: list[str | None]) -> str:
    """Return the most-frequent non-empty string, or '' if none."""
    counts: dict[str, int] = {}
    for v in values:
        if v and v.strip():
            counts[v.strip()] = counts.get(v.strip(), 0) + 1
    if not counts:
        return ""
    return max(counts, key=lambda k: counts[k])


# --------------------------------------------------------------------------- #
# Main builder                                                                 #
# --------------------------------------------------------------------------- #


def build(db_path: str, uls_history_path: str, out_path: str) -> dict[str, Any]:
    """Build and return the lineage artifact dict."""
    t0 = time.perf_counter()
    logger.info("Opening DB: %s", db_path)

    if not os.path.exists(db_path):
        logger.error("DB not found: %s", db_path)
        sys.exit(1)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # ------------------------------------------------------------------ #
    # Load ULS history for confirmation check                              #
    # ------------------------------------------------------------------ #
    uls_prev_call: dict[str, str] = {}  # upgrade_call -> prev_call (uppercased)
    if os.path.exists(uls_history_path):
        logger.info("Loading ULS history: %s", uls_history_path)
        try:
            with open(uls_history_path, "rb") as fh:
                uls_data: dict[str, Any] = json.load(fh)
            for cs, rec in uls_data.items():
                if isinstance(rec, dict):
                    pc = rec.get("prev_call")
                    if pc and isinstance(pc, str):
                        uls_prev_call[cs.upper()] = pc.strip().upper()
            logger.info("  ULS prev_call entries: %d", len(uls_prev_call))
        except Exception:
            logger.warning("Failed to load ULS history — skipping confirmation", exc_info=True)
    else:
        logger.warning("ULS history not found at %s — skipping confirmation", uls_history_path)

    # ------------------------------------------------------------------ #
    # Step 1: Aggregate novice calls                                       #
    # ------------------------------------------------------------------ #
    logger.info("Aggregating novice calls ...")

    # Build GLOB patterns for all novice prefixes
    novice_globs = [f"{np}[0-9]*" for np, _ in PREFIX_PAIRS]
    glob_sql = " OR ".join(f"callsign GLOB ?" for _ in novice_globs)

    # Fetch all entries for novice calls
    cur.execute(
        f"""
        SELECT callsign, year, name, address, city, state
        FROM entries
        WHERE ({glob_sql})
          AND year IS NOT NULL
        ORDER BY callsign, year
        """,
        novice_globs,
    )

    # Group by callsign: first_year, last_year, canonical name/addr/city
    from collections import defaultdict

    novice_rows: dict[str, dict[str, Any]] = {}  # callsign -> aggregated

    _tmp_names: dict[str, list[str | None]] = defaultdict(list)
    _tmp_addrs: dict[str, list[str | None]] = defaultdict(list)
    _tmp_cities: dict[str, list[str | None]] = defaultdict(list)
    _tmp_years: dict[str, list[int]] = defaultdict(list)

    for row in cur.fetchall():
        cs = row["callsign"].upper().strip()
        yr = row["year"]
        _tmp_years[cs].append(yr)
        _tmp_names[cs].append(row["name"])
        _tmp_addrs[cs].append(row["address"])
        _tmp_cities[cs].append(row["city"])

    for cs in _tmp_years:
        years = _tmp_years[cs]
        # Determine which novice prefix this callsign uses
        prefix = None
        for np, _ in PREFIX_PAIRS:
            if cs.startswith(np) and len(cs) > len(np) and cs[len(np)].isdigit():
                prefix = np
                break
        if prefix is None:
            continue  # malformed, skip

        nov_name = normalize_name(_mode(_tmp_names[cs]))
        nov_addr = normalize_addr(_mode(_tmp_addrs[cs]))
        nov_city = normalize_addr(_mode(_tmp_cities[cs]))

        novice_rows[cs] = {
            "callsign": cs,
            "prefix": prefix,
            "digit": cs[len(prefix)],
            "suffix": cs[len(prefix) + 1:],
            "nov_first": min(years),
            "nov_last": max(years),
            "nov_name": nov_name,
            "nov_addr": nov_addr,
            "nov_city": nov_city,
        }

    logger.info("  Novice callsigns found: %d", len(novice_rows))

    # ------------------------------------------------------------------ #
    # Step 2: Aggregate upgrade candidates                                 #
    # ------------------------------------------------------------------ #
    logger.info("Aggregating upgrade candidate calls ...")

    # All K/W calls that are NOT KN/WN/WV themselves
    upgrade_globs = list({up for _, up in PREFIX_PAIRS})  # ['K', 'W']
    upgrade_globs_patterns = [f"{up}[0-9]*" for up in upgrade_globs]
    exclude_patterns = [f"{np}[0-9]*" for np, _ in PREFIX_PAIRS]

    upg_glob_sql = " OR ".join(f"callsign GLOB ?" for _ in upgrade_globs_patterns)
    exc_glob_sql = " OR ".join(f"callsign GLOB ?" for _ in exclude_patterns)

    cur.execute(
        f"""
        SELECT callsign, year, name, address, city
        FROM entries
        WHERE ({upg_glob_sql})
          AND NOT ({exc_glob_sql})
          AND year IS NOT NULL
        ORDER BY callsign, year
        """,
        upgrade_globs_patterns + exclude_patterns,
    )

    upg_tmp_names: dict[str, list[str | None]] = defaultdict(list)
    upg_tmp_addrs: dict[str, list[str | None]] = defaultdict(list)
    upg_tmp_cities: dict[str, list[str | None]] = defaultdict(list)
    upg_tmp_years: dict[str, list[int]] = defaultdict(list)

    for row in cur.fetchall():
        cs = row["callsign"].upper().strip()
        yr = row["year"]
        upg_tmp_years[cs].append(yr)
        upg_tmp_names[cs].append(row["name"])
        upg_tmp_addrs[cs].append(row["address"])
        upg_tmp_cities[cs].append(row["city"])

    # Build upgrade index keyed by (upgrade_prefix, digit, suffix)
    upg_index: dict[tuple[str, str, str], dict[str, Any]] = {}

    for cs in upg_tmp_years:
        # Determine upgrade prefix
        upg_prefix = None
        for up in upgrade_globs:
            if cs.startswith(up) and len(cs) > len(up) and cs[len(up)].isdigit():
                upg_prefix = up
                break
        if upg_prefix is None:
            continue
        digit = cs[len(upg_prefix)]
        suffix = cs[len(upg_prefix) + 1:]
        if not suffix:
            continue

        years = upg_tmp_years[cs]
        upg_first = min(years)

        # Canonical name/addr from first year entries
        min_year = min(years)
        upg_name = normalize_name(_mode(
            [n for n, y in zip(upg_tmp_names[cs], upg_tmp_years[cs]) if y == min_year]
        ))
        upg_addr = normalize_addr(_mode(
            [a for a, y in zip(upg_tmp_addrs[cs], upg_tmp_years[cs]) if y == min_year]
        ))
        upg_city = normalize_addr(_mode(
            [c for c, y in zip(upg_tmp_cities[cs], upg_tmp_years[cs]) if y == min_year]
        ))

        upg_index[(upg_prefix, digit, suffix)] = {
            "callsign": cs,
            "upg_prefix": upg_prefix,
            "digit": digit,
            "suffix": suffix,
            "upg_first": upg_first,
            "upg_name": upg_name,
            "upg_addr": upg_addr,
            "upg_city": upg_city,
        }

    logger.info("  Upgrade candidates indexed: %d", len(upg_index))

    # ------------------------------------------------------------------ #
    # Step 3: Match and score                                              #
    # ------------------------------------------------------------------ #
    logger.info("Matching novice → upgrade pairs ...")

    links: dict[str, Any] = {}
    reverse: dict[str, str] = {}
    skipped_year = 0
    skipped_score = 0
    total_candidates = 0

    for nov_cs, nov in novice_rows.items():
        prefix = nov["prefix"]  # 'KN', 'WN', 'WV'
        digit = nov["digit"]
        suffix = nov["suffix"]

        # Which upgrade prefix does this Novice map to?
        upg_prefix: str | None = None
        for np, up in PREFIX_PAIRS:
            if np == prefix:
                upg_prefix = up
                break
        if upg_prefix is None:
            continue

        upg = upg_index.get((upg_prefix, digit, suffix))
        if upg is None:
            continue

        total_candidates += 1

        # Year gate: upgrade must first appear within [-1, nov_last + 3]
        if not (nov["nov_first"] - 1 <= upg["upg_first"] <= nov["nov_last"] + 3):
            skipped_year += 1
            continue

        # Score
        sc, basis = score_pair(
            nov["nov_name"], nov["nov_addr"], nov["nov_city"],
            upg["upg_name"], upg["upg_addr"], upg["upg_city"],
        )

        # Require BOTH a name signal AND an address signal, plus score >= 4.
        # This ensures we never emit on name-only or address-only matches,
        # which drove the false-positive rate above 15% in the 25-sample audit.
        has_name = any(b in basis for b in ("name", "name_partial", "name_prefix"))
        has_addr = any(b in basis for b in ("address", "address_partial"))
        if sc < 4 or not has_name or not has_addr:
            skipped_score += 1
            continue

        confidence = "high" if sc >= 4 else "medium"
        upg_cs = upg["callsign"]

        # ULS confirmation: check if upgrade_call.prev_call == novice_call
        uls_confirmed = (uls_prev_call.get(upg_cs) == nov_cs)

        # Build label
        label = _make_label(prefix, upg_prefix, nov_cs, upg_cs, upg["upg_first"])

        link = {
            "novice_call": nov_cs,
            "upgrade_call": upg_cs,
            "prefix_type": prefix,
            "novice_first_year": nov["nov_first"],
            "novice_last_year": nov["nov_last"],
            "upgrade_first_year": upg["upg_first"],
            "score": sc,
            "confidence": confidence,
            "match_basis": basis,
            "uls_confirmed": uls_confirmed,
            "label": label,
        }

        links[nov_cs] = link
        reverse[upg_cs] = nov_cs

    elapsed = time.perf_counter() - t0
    logger.info(
        "Done: %d links emitted | %d candidates | %d year-gated | %d score-gated | %.1fs",
        len(links),
        total_candidates,
        skipped_year,
        skipped_score,
        elapsed,
    )

    # ------------------------------------------------------------------ #
    # Step 4: ULS confirmation stats                                       #
    # ------------------------------------------------------------------ #
    uls_confirmed_count = sum(1 for lk in links.values() if lk["uls_confirmed"])
    logger.info(
        "ULS-confirmed links: %d / %d (%.1f%%)",
        uls_confirmed_count,
        len(links),
        100 * uls_confirmed_count / max(len(links), 1),
    )

    # ------------------------------------------------------------------ #
    # Step 5: Build artifact                                               #
    # ------------------------------------------------------------------ #
    artifact: dict[str, Any] = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_version": "v2026.06",
        "total_links": len(links),
        "prefix_pairs": {np: up for np, up in PREFIX_PAIRS},
        "links": links,
        "reverse": reverse,
    }

    con.close()
    return artifact


def _make_label(
    nov_prefix: str,
    upg_prefix: str,
    nov_call: str,
    upg_call: str,
    upg_first_year: int,
) -> str:
    """Return a human-readable upgrade label."""
    action = "upgraded to" if upg_prefix != nov_prefix[0] else "upgraded to"
    return f"Likely {action} {upg_call}, ~{upg_first_year}"


# --------------------------------------------------------------------------- #
# Entry point                                                                  #
# --------------------------------------------------------------------------- #


def main() -> None:
    artifact = build(DB_PATH, ULS_HISTORY_PATH, PRINTED_LINEAGE_OUT)

    out_dir = os.path.dirname(PRINTED_LINEAGE_OUT)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    logger.info("Writing artifact → %s", PRINTED_LINEAGE_OUT)
    with open(PRINTED_LINEAGE_OUT, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(PRINTED_LINEAGE_OUT) / 1024
    logger.info(
        "Artifact written: %d links, %.1f KB",
        artifact["total_links"],
        size_kb,
    )

    # Quick stats breakdown
    high = sum(1 for lk in artifact["links"].values() if lk["confidence"] == "high")
    medium = sum(1 for lk in artifact["links"].values() if lk["confidence"] == "medium")
    uls_conf = sum(1 for lk in artifact["links"].values() if lk["uls_confirmed"])
    by_prefix: dict[str, int] = {}
    for lk in artifact["links"].values():
        p = lk["prefix_type"]
        by_prefix[p] = by_prefix.get(p, 0) + 1

    logger.info("  high=%d  medium=%d  uls_confirmed=%d", high, medium, uls_conf)
    logger.info("  by prefix: %s", by_prefix)


if __name__ == "__main__":
    main()
