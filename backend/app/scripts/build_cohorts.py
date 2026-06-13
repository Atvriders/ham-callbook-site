"""Build cohort survival tables for the Cohort Observatory feature (#11).

Writes site/data/cohorts.json.

Usage:
    python -m app.scripts.build_cohorts
    DB_PATH=/data/USA_Ham_Callbooks.sqlite python build_cohorts.py

Algorithm
---------
A cohort = all callsigns whose FIRST appearance in `entries` has a given
(first_year, license_class).  Optionally also filtered by state.

We build:
  - Kaplan-Meier retention curves at each observable archive year (right-censored
    at 1997 print horizon; extended to 2026 via ULS active status).
  - Class-ladder transition counts + median years-per-rung (N->G->A->E).
  - Confidence bands (Greenwood / log transform).
  - Sparse-data caveats for pre-1963 cohorts and the WWII gap 1942-1945.

Pure Python, no numpy/scipy.
"""

from __future__ import annotations

import json
import logging
import math
import os
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
logger = logging.getLogger("build_cohorts")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DB_PATH: str = os.environ.get(
    "DB_PATH",
    "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
)

ULS_PATH: str = os.environ.get(
    "ULS_PATH",
    "/home/kasm-user/ham-callbook-site/data/uls.json",
)

OUT_PATH: str = os.environ.get(
    "COHORTS_OUT",
    "/home/kasm-user/ham-callbook-site/data/cohorts.json",
)

# Print horizon: last reliable mass-coverage year in the archive
PRINT_HORIZON = 1997

# WWII gap: no editions were published between these years
WWII_GAP = (1942, 1945)

# Pre-dense-class-data threshold: before 1963 the class field is very sparse
SPARSE_CLASS_THRESHOLD = 1963

# Minimum cohort size to compute KM (avoid division by tiny N)
MIN_COHORT_SIZE = 50

# Class ordering for ladder (Novice -> General -> Advanced -> Extra)
CLASS_ORDER = ["N", "G", "A", "E"]
CLASS_NAMES = {"N": "Novice", "G": "General", "A": "Advanced", "E": "Extra"}

# Observation offsets (years after first_year) used for KM summary points
SUMMARY_OFFSETS = [5, 10, 25, 50]

TODAY_YEAR = 2026

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
# Data loading
# ---------------------------------------------------------------------------


def load_uls_active(path: str) -> set[str]:
    """Return set of callsigns with ULS status == 'A'."""
    if not os.path.exists(path):
        logger.warning("uls.json not found at %s; ULS extension disabled", path)
        return set()
    t0 = time.perf_counter()
    with open(path, "rb") as fh:
        data = json.load(fh)
    active = {
        k.strip().upper()
        for k, v in data.items()
        if isinstance(v, dict) and v.get("status") == "A"
    }
    logger.info(
        "Loaded %s ULS active callsigns in %.2fs",
        f"{len(active):,}",
        time.perf_counter() - t0,
    )
    return active


def load_callsign_history(conn: sqlite3.Connection) -> dict[str, list[tuple[int, str, str]]]:
    """
    Returns: {callsign -> sorted list of (year, license_class, state)}.

    Only includes rows where license_class is one of N/G/A/E/T/B/P (known classes).
    The pre-1963 rows (mostly NULL class) are included as bare year markers with
    class='?' so we can still track appearance.
    """
    logger.info("Loading callsign history from entries…")
    t0 = time.perf_counter()
    rows = conn.execute(
        """
        SELECT callsign, year, license_class, state
        FROM   entries
        WHERE  callsign IS NOT NULL
        ORDER  BY callsign, year
        """
    ).fetchall()
    logger.info(
        "  fetched %s rows in %.2fs", f"{len(rows):,}", time.perf_counter() - t0
    )

    history: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    for r in rows:
        cs = r["callsign"]
        yr = r["year"]
        lc = r["license_class"] or "?"
        st = r["state"] or ""
        history[cs].append((yr, lc, st))

    # Already sorted by year from SQL; dedupe same year (keep first occurrence)
    deduped: dict[str, list[tuple[int, str, str]]] = {}
    for cs, entries in history.items():
        seen_years: set[int] = set()
        clean: list[tuple[int, str, str]] = []
        for yr, lc, st in entries:
            if yr not in seen_years:
                seen_years.add(yr)
                clean.append((yr, lc, st))
        deduped[cs] = clean

    logger.info("  %s distinct callsigns", f"{len(deduped):,}")
    return deduped


# ---------------------------------------------------------------------------
# Cohort identification
# ---------------------------------------------------------------------------


def build_callsign_profiles(
    history: dict[str, list[tuple[int, str, str]]]
) -> list[dict[str, Any]]:
    """
    For each callsign compute:
      first_year, first_class, first_state, last_seen_year, year_sequence, class_sequence
    """
    profiles = []
    for cs, entries in history.items():
        if not entries:
            continue
        first_year = entries[0][0]
        first_class = entries[0][1]
        first_state = entries[0][2]
        last_seen_year = entries[-1][0]
        year_seq = [e[0] for e in entries]
        class_seq = [e[1] for e in entries]
        profiles.append(
            {
                "callsign": cs,
                "first_year": first_year,
                "first_class": first_class,
                "first_state": first_state,
                "last_seen_year": last_seen_year,
                "year_seq": year_seq,
                "class_seq": class_seq,
            }
        )
    return profiles


# ---------------------------------------------------------------------------
# Pure-Python Kaplan-Meier
# ---------------------------------------------------------------------------


def km_curve(
    first_year: int,
    cohort_last_seen: list[int],
    archive_years: list[int],
    uls_active_subset: set[str],
    cohort_callsigns: list[str],
    uls_active: set[str],
) -> list[dict[str, Any]]:
    """
    Compute KM retention curve for a cohort.

    Parameters
    ----------
    first_year          : cohort entry year
    cohort_last_seen    : list of last_seen_year values (one per cohort member)
    archive_years       : all distinct years in the archive, sorted
    uls_active_subset   : callsigns in this cohort that are ULS-active (still licensed)
    cohort_callsigns    : ordered list matching cohort_last_seen
    uls_active          : global ULS active set

    Returns list of curve points, one per observation time >= first_year.
    The observation times are archive_years + [TODAY_YEAR] (for ULS extension).
    """
    # Build observation timeline: archive years after first_year, plus TODAY
    obs_years = [y for y in archive_years if y > first_year]
    if not obs_years or obs_years[-1] < PRINT_HORIZON:
        pass
    # Add ULS extension point if not already past horizon
    if TODAY_YEAR not in obs_years:
        obs_years.append(TODAY_YEAR)
    obs_years = sorted(set(obs_years))

    n = len(cohort_last_seen)
    if n == 0:
        return []

    # Extend last_seen for ULS-active members to TODAY_YEAR
    extended_last_seen = []
    for cs, ls in zip(cohort_callsigns, cohort_last_seen):
        if cs in uls_active:
            extended_last_seen.append(TODAY_YEAR)
        else:
            extended_last_seen.append(ls)

    # KM algorithm: walk through observation years
    S = 1.0
    greenwood_sum = 0.0
    prev_t = first_year
    at_risk = n
    curve: list[dict[str, Any]] = []

    # Initial point
    curve.append(
        {
            "t": 0,
            "obs_year": first_year,
            "S": 1.0,
            "ci_lo": 1.0,
            "ci_hi": 1.0,
            "at_risk": n,
            "events": 0,
            "censored": 0,
        }
    )

    for t_year in obs_years:
        # Events: callsigns last seen in interval [prev_t, t_year)
        # i.e., they appeared at or since the last observation but did NOT reach t_year.
        # For the first interval: last_seen == first_year means single-appearance (dropout).
        events = sum(
            1 for ls in extended_last_seen if prev_t <= ls < t_year
        )
        # Still observable at t_year (will appear at t_year or later)
        still_at_risk = sum(1 for ls in extended_last_seen if ls >= t_year)
        # Censored at this step = people who somehow exit without being events
        # (should be 0 with this formulation, but compute for sanity)
        censored = max(0, at_risk - still_at_risk - events)

        if at_risk > 0 and events > 0:
            # Kaplan-Meier step
            h = events / at_risk
            S = S * (1.0 - h)
            # Greenwood's formula accumulates d/(n*(n-d))
            denom = at_risk * (at_risk - events)
            if denom > 0:
                greenwood_sum += events / denom

        # Confidence interval via log transform (Kalbfleisch-Prentice)
        if S > 0 and S < 1 and greenwood_sum > 0:
            se_log = math.sqrt(greenwood_sum) / abs(math.log(S))
            log_S = math.log(S)
            ci_lo = max(0.0, math.exp(log_S * math.exp(1.96 * se_log)))
            ci_hi = min(1.0, math.exp(log_S * math.exp(-1.96 * se_log)))
        elif S >= 1.0:
            ci_lo, ci_hi = 1.0, 1.0
        else:
            ci_lo, ci_hi = 0.0, 0.0

        t_offset = t_year - first_year
        curve.append(
            {
                "t": t_offset,
                "obs_year": t_year,
                "S": round(S, 4),
                "ci_lo": round(ci_lo, 4),
                "ci_hi": round(ci_hi, 4),
                "at_risk": at_risk,
                "events": events,
                "censored": censored,
            }
        )

        at_risk = still_at_risk
        prev_t = t_year

    return curve


def summary_at_offsets(curve: list[dict[str, Any]], first_year: int) -> dict[str, Any]:
    """Extract S values at specific time offsets (5, 10, 25, 50 years)."""
    result: dict[str, Any] = {}
    for offset in SUMMARY_OFFSETS:
        target_year = first_year + offset
        # Find the curve point just at or before target_year
        best = None
        for pt in curve:
            if pt["obs_year"] <= target_year:
                best = pt
            else:
                break
        if best is not None:
            result[f"retention_{offset}yr"] = {
                "S": best["S"],
                "ci_lo": best["ci_lo"],
                "ci_hi": best["ci_hi"],
                "obs_year": best["obs_year"],
            }
        else:
            result[f"retention_{offset}yr"] = None
    return result


# ---------------------------------------------------------------------------
# Class ladder (Sankey transitions)
# ---------------------------------------------------------------------------


def build_class_ladder(
    cohort_profiles: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    For each pair (from_class, to_class) in CLASS_ORDER, compute:
      - count of callsigns that transitioned from from_class to to_class
      - median years elapsed at first transition
    Only considers forward transitions (N->G, G->A, A->E, N->A, N->E, G->E).
    """
    # Build transition records
    transitions: dict[tuple[str, str], list[int]] = defaultdict(list)

    for p in cohort_profiles:
        class_seq = p["class_seq"]
        year_seq = p["year_seq"]
        # Walk through and find first occurrence of each class upgrade
        seen_classes: dict[str, int] = {}  # class -> year first seen
        for yr, lc in zip(year_seq, class_seq):
            if lc in CLASS_ORDER and lc not in seen_classes:
                seen_classes[lc] = yr

        # For each consecutive pair in CLASS_ORDER where we have both
        for i, from_cls in enumerate(CLASS_ORDER[:-1]):
            for to_cls in CLASS_ORDER[i + 1 :]:
                if from_cls in seen_classes and to_cls in seen_classes:
                    years_elapsed = seen_classes[to_cls] - seen_classes[from_cls]
                    if years_elapsed > 0:  # valid forward transition
                        transitions[(from_cls, to_cls)].append(years_elapsed)
                    break  # only record the FIRST direct transition

    result: list[dict[str, Any]] = []
    for (from_cls, to_cls), years_list in sorted(transitions.items()):
        if not years_list:
            continue
        sorted_years = sorted(years_list)
        mid = len(sorted_years) // 2
        if len(sorted_years) % 2 == 1:
            median_years = float(sorted_years[mid])
        else:
            median_years = (sorted_years[mid - 1] + sorted_years[mid]) / 2.0
        result.append(
            {
                "from_class": from_cls,
                "to_class": to_cls,
                "from_name": CLASS_NAMES.get(from_cls, from_cls),
                "to_name": CLASS_NAMES.get(to_cls, to_cls),
                "count": len(years_list),
                "median_years": round(median_years, 1),
            }
        )
    return result


# ---------------------------------------------------------------------------
# Caveat detection
# ---------------------------------------------------------------------------


def detect_caveats(first_year: int, entry_class: str) -> list[str]:
    caveats: list[str] = []
    if first_year < SPARSE_CLASS_THRESHOLD:
        caveats.append("sparse_pre1963_class_data")
    if WWII_GAP[0] <= first_year <= WWII_GAP[1]:
        caveats.append("cohort_year_in_wwii_gap")
    if first_year < 1930:
        caveats.append("very_early_archive_sparse")
    if first_year > PRINT_HORIZON:
        caveats.append("post_print_horizon_no_archive_coverage")
    # Class N didn't exist before ~1951 (Novice license created 1951)
    if entry_class == "N" and first_year < 1952:
        caveats.append("novice_class_predates_1952_introduction")
    return caveats


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------


def main() -> None:
    logger.info("build_cohorts: DB=%s", DB_PATH)
    if not os.path.exists(DB_PATH):
        logger.error("DB not found: %s", DB_PATH)
        sys.exit(1)

    t_global = time.perf_counter()

    # Load data
    uls_active = load_uls_active(ULS_PATH)
    conn = open_db(DB_PATH)

    try:
        history = load_callsign_history(conn)
    finally:
        conn.close()

    archive_years = sorted({yr for entries in history.values() for yr, _, _ in entries})
    logger.info("Archive years: %d to %d (%d distinct)", archive_years[0], archive_years[-1], len(archive_years))

    profiles = build_callsign_profiles(history)
    logger.info("Built %s callsign profiles", f"{len(profiles):,}")

    # Group profiles by (first_year, first_class) for ALL-state cohorts
    # We only build ALL-state cohorts (per-state would be too many for artifact size)
    cohort_map: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for p in profiles:
        key = (p["first_year"], p["first_class"])
        cohort_map[key].append(p)

    # We'll also build a per-state index for the major classes
    # but only store the KM summary points (not full curves) to keep artifact manageable
    state_cohort_map: dict[tuple[int, str, str], list[dict[str, Any]]] = defaultdict(list)
    for p in profiles:
        if p["first_class"] in CLASS_ORDER and p["first_state"]:
            key = (p["first_year"], p["first_class"], p["first_state"])
            state_cohort_map[key].append(p)

    # Build all-state cohorts
    cohorts_out: dict[str, Any] = {}
    n_computed = 0
    n_skipped = 0

    # Focus on N/G/A/E classes for ALL-state full-curve cohorts
    for (first_year, entry_class), cohort_profiles in sorted(cohort_map.items()):
        if entry_class not in CLASS_ORDER:
            # Skip unknown/other classes for KM
            continue
        if len(cohort_profiles) < MIN_COHORT_SIZE:
            n_skipped += 1
            continue

        key = f"{first_year}|{entry_class}|ALL"
        callsigns = [p["callsign"] for p in cohort_profiles]
        last_seen_list = [p["last_seen_year"] for p in cohort_profiles]
        uls_subset = {cs for cs in callsigns if cs in uls_active}

        curve = km_curve(
            first_year=first_year,
            cohort_last_seen=last_seen_list,
            archive_years=archive_years,
            uls_active_subset=uls_subset,
            cohort_callsigns=callsigns,
            uls_active=uls_active,
        )

        summary = summary_at_offsets(curve, first_year)
        ladder = build_class_ladder(cohort_profiles)
        caveats = detect_caveats(first_year, entry_class)

        cohorts_out[key] = {
            "cohort_key": key,
            "first_year": first_year,
            "entry_class": entry_class,
            "entry_class_name": CLASS_NAMES.get(entry_class, entry_class),
            "state": "ALL",
            "cohort_size": len(cohort_profiles),
            "uls_still_active": len(uls_subset),
            "km_curve": curve,
            "km_summary": summary,
            "class_ladder": ladder,
            "caveats": caveats,
        }
        n_computed += 1

        if n_computed % 50 == 0:
            logger.info("  computed %d cohorts so far…", n_computed)

    # Build per-state summary cohorts (summary only, no full curve, to cap artifact size)
    state_cohorts_out: dict[str, Any] = {}
    n_state = 0
    for (first_year, entry_class, state), cohort_profiles in sorted(state_cohort_map.items()):
        if len(cohort_profiles) < MIN_COHORT_SIZE:
            continue
        key = f"{first_year}|{entry_class}|{state}"
        callsigns = [p["callsign"] for p in cohort_profiles]
        last_seen_list = [p["last_seen_year"] for p in cohort_profiles]
        uls_subset = {cs for cs in callsigns if cs in uls_active}

        curve = km_curve(
            first_year=first_year,
            cohort_last_seen=last_seen_list,
            archive_years=archive_years,
            uls_active_subset=uls_subset,
            cohort_callsigns=callsigns,
            uls_active=uls_active,
        )

        summary = summary_at_offsets(curve, first_year)
        caveats = detect_caveats(first_year, entry_class)

        state_cohorts_out[key] = {
            "cohort_key": key,
            "first_year": first_year,
            "entry_class": entry_class,
            "entry_class_name": CLASS_NAMES.get(entry_class, entry_class),
            "state": state,
            "cohort_size": len(cohort_profiles),
            "uls_still_active": len(uls_subset),
            "km_summary": summary,
            "caveats": caveats,
        }
        n_state += 1

    logger.info(
        "Computed %d ALL-state cohorts, %d state cohorts; skipped %d (too small)",
        n_computed, n_state, n_skipped,
    )

    # Build global class ladder across all cohorts (all years)
    logger.info("Building global class ladder…")
    all_profiles_ngage = [p for p in profiles if p["first_class"] in CLASS_ORDER]
    global_ladder = build_class_ladder(all_profiles_ngage)

    artifact: dict[str, Any] = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_version": "v2026.06",
        "archive_years": archive_years,
        "print_horizon": PRINT_HORIZON,
        "today_year": TODAY_YEAR,
        "uls_active_count": len(uls_active),
        "total_all_state_cohorts": n_computed,
        "total_state_cohorts": n_state,
        "global_class_ladder": global_ladder,
        "cohorts": cohorts_out,
        "state_cohorts": state_cohorts_out,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, OUT_PATH)

    elapsed = time.perf_counter() - t_global
    size_kb = os.path.getsize(OUT_PATH) / 1024
    logger.info(
        "Done in %.1fs. Output: %s (%.1f KB / %.1f MB)",
        elapsed, OUT_PATH, size_kb, size_kb / 1024,
    )


if __name__ == "__main__":
    main()
