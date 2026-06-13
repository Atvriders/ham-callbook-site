"""Build name_trends.json artifact for Feature #14: First-Name Voyager + YL Index.

Reads every (year, name, state) from ``entries`` for 1920-1997, extracts the
operator's FIRST NAME via a layered heuristic, computes:

  1. Per-first-name counts per edition-year (name voyager layer)
  2. YL index: estimated women-operator share per US state per decade,
     derived from SSA baby-names gender-probability data.

SSA baby-names zip is fetched from the public-domain source:
  https://www.ssa.gov/oact/babynames/names.zip
If the download fails the script degrades gracefully: the name-voyager layer
is still complete; the YL index block is omitted and a ``yl_degraded`` flag
is set in the artifact.

First-name extraction heuristic (in order):
  1. "LAST, FIRST MIDDLE"  — any name containing a comma splits on first comma;
     everything after the comma is the given-name field; take the first word.
  2. "FIRST [MIDDLE] LAST" — no comma; take first token if it is not a lone
     initial (len > 1 or ends with ".").  If the first token is an initial,
     the name is marked unclassifiable (initials-only cases like "W. H. Smith").
  3. Single-token name — unclassifiable.
  4. OCR junk (non-alpha chars dominate, len < 2 after stripping) — unclassifiable.

Unclassifiable names are excluded from the YL index computation and counted
separately.

Output artifact: data/name_trends.json

Top-level schema:
  {
    "generated": ISO8601,
    "dataset_version": "...",
    "yl_degraded": bool,           # true = SSA download failed
    "yl_degraded_reason": str|null,
    "min_year": 1920, "max_year": 1997,
    "archive_years": [...],        # distinct years in the window
    "total_rows_scanned": int,
    "total_classifiable": int,
    "total_unclassifiable": int,
    "distinct_first_names": int,   # names with count >= MIN_COUNT_THRESHOLD
    "voyager": {                   # name -> {year: count}
      "Elmer": {"1920": 47, "1921": 39, ...},
      ...
    },
    "top_names_by_era": {          # decade -> [{name, count}, ...] top 10
      "1920s": [...], "1930s": [...], ...
    },
    "yl_index": {                  # state -> {decade: {share, ci_lo, ci_hi, n, unclassifiable_n}}
      "CA": {
        "1960s": {"share": 0.034, "ci_lo": 0.031, "ci_hi": 0.037, "n": 4820, "unclassifiable_n": 201},
        ...
      },
      ...
    } | null
  }

Usage:
    python -m app.scripts.build_name_trends
    DB_PATH=/data/USA_Ham_Callbooks.sqlite \\
    NAME_TRENDS_OUT=/data/name_trends.json \\
        python -m app.scripts.build_name_trends
"""

from __future__ import annotations

import io
import json
import logging
import math
import os
import re
import sqlite3
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("build_name_trends")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DB_PATH: str = os.environ.get(
    "DB_PATH",
    "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
)

NAME_TRENDS_OUT: str = os.environ.get(
    "NAME_TRENDS_OUT",
    os.path.join(os.path.dirname(DB_PATH), "name_trends.json"),
)

SSA_URL = "https://www.ssa.gov/oact/babynames/names.zip"
# Mirror: tidytuesday repackaged SSA data as a CSV (same public-domain data)
SSA_MIRROR_CSV_URL = (
    "https://raw.githubusercontent.com/rfordatascience/tidytuesday"
    "/master/data/2022/2022-03-22/babynames.csv"
)
SSA_DOWNLOAD_TIMEOUT = int(os.environ.get("SSA_DOWNLOAD_TIMEOUT", "60"))

# Minimum total appearances across the archive for a first name to enter the
# voyager layer (filters OCR noise and ultra-rare entries).
MIN_COUNT_THRESHOLD = int(os.environ.get("MIN_NAME_COUNT", "10"))

# US states we track for the YL index.
US_STATES = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
})

MIN_YEAR = 1920
MAX_YEAR = 1997

# ---------------------------------------------------------------------------
# Noise filter
# ---------------------------------------------------------------------------

_ALPHA_RE = re.compile(r"[A-Za-z]")
_NON_ALPHA_RE = re.compile(r"[^A-Za-z ,.\-']")


def _is_ocr_junk(raw: str) -> bool:
    """Return True if the string is dominated by non-alpha characters."""
    if not raw or len(raw) < 2:
        return True
    alpha_chars = len(_ALPHA_RE.findall(raw))
    return alpha_chars < len(raw) * 0.5 or alpha_chars < 2


# ---------------------------------------------------------------------------
# First-name extraction
# ---------------------------------------------------------------------------

def extract_first_name(raw: str) -> str | None:
    """Return the extracted first name, or None if unclassifiable.

    Returns the name title-cased for consistency.
    """
    if not raw or _is_ocr_junk(raw):
        return None

    # Strip non-alpha noise but keep commas, spaces, dots, hyphens, apostrophes.
    cleaned = _NON_ALPHA_RE.sub(" ", raw).strip()
    if len(cleaned) < 2:
        return None

    # Case 1: "LAST, FIRST MIDDLE ..." — comma-separated
    if "," in cleaned:
        parts = cleaned.split(",", 1)
        given_field = parts[1].strip()
        if not given_field:
            return None
        # First word of given field
        tokens = given_field.split()
        if not tokens:
            return None
        first = tokens[0].rstrip(".")
        # Single initial — unclassifiable
        if len(first) <= 1:
            return None
        return first.title()

    # Case 2: "FIRST [MIDDLE] LAST" — no comma
    tokens = cleaned.split()
    if len(tokens) < 2:
        # Single token — can't distinguish given from family name
        return None

    first = tokens[0].rstrip(".")
    # Initial only (single char or single char + dot) — unclassifiable
    if len(first) <= 1:
        return None

    # Check if the first token is an abbreviation like "W." (length 1 + dot).
    if re.match(r"^[A-Za-z]\.$", tokens[0]):
        return None

    return first.title()


# ---------------------------------------------------------------------------
# SSA baby-names download + gender-probability map
# ---------------------------------------------------------------------------

def _fetch_url(url: str, label: str) -> bytes | None:
    """Generic URL fetcher. Returns bytes or None on failure."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; ham-callbook-site research tool; "
                    "contact: opensource)"
                )
            },
        )
        with urllib.request.urlopen(req, timeout=SSA_DOWNLOAD_TIMEOUT) as resp:
            data = resp.read()
        logger.info("%s: downloaded %d bytes.", label, len(data))
        return data
    except Exception as exc:
        logger.warning("%s download failed: %s", label, exc)
        return None


def _fetch_ssa_zip() -> bytes | None:
    """Attempt to download the SSA names zip. Returns bytes or None on failure."""
    data = _fetch_url(SSA_URL, "SSA names.zip")
    if data is not None and data[:2] != b"PK":
        logger.warning(
            "SSA response does not look like a zip file (got %r...)", data[:50]
        )
        return None
    return data


def _build_gender_map_from_zip(ssa_bytes: bytes) -> dict[str, tuple[float, float]]:
    """Parse SSA yob*.txt files from zip. Returns name -> (p_female, total)."""
    logger.info("Parsing SSA names zip (%d bytes)...", len(ssa_bytes))
    male_counts: dict[str, int] = defaultdict(int)
    female_counts: dict[str, int] = defaultdict(int)

    with zipfile.ZipFile(io.BytesIO(ssa_bytes)) as zf:
        for name in zf.namelist():
            if not name.startswith("yob") or not name.endswith(".txt"):
                continue
            try:
                year = int(name[3:7])
            except ValueError:
                continue
            # Only load names from years relevant to operators born ~1880-1980
            if year < 1880 or year > 1980:
                continue
            with zf.open(name) as fh:
                for line in fh:
                    line = line.decode("ascii", errors="ignore").strip()
                    if not line:
                        continue
                    parts = line.split(",")
                    if len(parts) != 3:
                        continue
                    firstname, sex, cnt_str = parts
                    try:
                        cnt = int(cnt_str)
                    except ValueError:
                        continue
                    firstname = firstname.title()
                    if sex == "F":
                        female_counts[firstname] += cnt
                    elif sex == "M":
                        male_counts[firstname] += cnt

    all_names = set(male_counts) | set(female_counts)
    gender_map: dict[str, tuple[float, float]] = {}
    for n in all_names:
        f = female_counts.get(n, 0)
        m = male_counts.get(n, 0)
        total = f + m
        if total == 0:
            continue
        gender_map[n] = (f / total, total)

    logger.info("Gender map (zip): %d names parsed.", len(gender_map))
    return gender_map


def _build_gender_map_from_csv(csv_bytes: bytes) -> dict[str, tuple[float, float]]:
    """Parse tidytuesday babynames CSV. Returns name -> (p_female, total).

    CSV format: year,sex,name,n,prop
    Sex values: F / M
    We restrict to birth years 1880-1980 to match operator birth cohorts.
    """
    logger.info("Parsing SSA mirror CSV (%d bytes)...", len(csv_bytes))
    male_counts: dict[str, int] = defaultdict(int)
    female_counts: dict[str, int] = defaultdict(int)

    lines = csv_bytes.decode("utf-8", errors="ignore").splitlines()
    header = True
    for line in lines:
        if header:
            header = False
            continue
        parts = line.split(",")
        if len(parts) < 4:
            continue
        try:
            year = int(parts[0])
        except ValueError:
            continue
        if year < 1880 or year > 1980:
            continue
        sex = parts[1].strip().upper()
        firstname = parts[2].strip().title()
        try:
            cnt = int(parts[3])
        except ValueError:
            continue
        if sex == "F":
            female_counts[firstname] += cnt
        elif sex == "M":
            male_counts[firstname] += cnt

    all_names = set(male_counts) | set(female_counts)
    gender_map: dict[str, tuple[float, float]] = {}
    for n in all_names:
        f = female_counts.get(n, 0)
        m = male_counts.get(n, 0)
        total = f + m
        if total == 0:
            continue
        gender_map[n] = (f / total, total)

    logger.info("Gender map (CSV): %d names parsed.", len(gender_map))
    return gender_map


def build_gender_map() -> tuple[dict[str, tuple[float, float]], str | None]:
    """Fetch SSA data and build gender map.

    Tries: (1) official SSA zip, (2) tidytuesday CSV mirror.
    Returns (gender_map, error_reason).  On success error_reason is None.
    """
    # Try official zip first
    ssa_bytes = _fetch_ssa_zip()
    if ssa_bytes is not None:
        try:
            return _build_gender_map_from_zip(ssa_bytes), None
        except Exception as exc:
            logger.warning("SSA zip parse error: %s — trying mirror CSV.", exc)

    # Fall back to mirror CSV
    logger.info("Trying SSA mirror CSV from %s ...", SSA_MIRROR_CSV_URL)
    csv_bytes = _fetch_url(SSA_MIRROR_CSV_URL, "SSA mirror CSV")
    if csv_bytes is not None:
        try:
            return _build_gender_map_from_csv(csv_bytes), None
        except Exception as exc:
            logger.warning("SSA mirror CSV parse error: %s", exc)

    reason = (
        "Both SSA names.zip (ssa.gov) and mirror CSV (tidytuesday/GitHub) "
        "failed to download or parse. YL index omitted; name voyager is complete."
    )
    return {}, reason


# ---------------------------------------------------------------------------
# YL index computation
# ---------------------------------------------------------------------------

def _decade_label(year: int) -> str:
    return f"{(year // 10) * 10}s"


def compute_yl_index(
    state_decade_firstnames: dict[str, dict[str, list[str]]],
    gender_map: dict[str, tuple[float, float]],
) -> dict[str, dict[str, dict[str, Any]]]:
    """Compute per-state per-decade YL share with Wilson-score confidence interval.

    For each state+decade we have a list of extracted first names (one per entry).
    For each name we look up p_female from the gender map.

    Names not in the gender map (p_female indeterminate) are excluded from the
    computation and counted as 'unclassifiable_n'.

    We model the share as a weighted mean of p_female values, treating each
    operator as a Bernoulli trial with success probability = p_female.

    Confidence interval: Wilson score for a proportion p observed over n trials
    (we round weighted p to nearest integer count).
    """
    result: dict[str, dict[str, dict[str, Any]]] = {}

    for state, decade_map in sorted(state_decade_firstnames.items()):
        result[state] = {}
        for decade, names in sorted(decade_map.items()):
            classifiable: list[float] = []
            unclassifiable_n = 0
            for nm in names:
                if nm in gender_map:
                    pf, _ = gender_map[nm]
                    classifiable.append(pf)
                else:
                    unclassifiable_n += 1

            n = len(classifiable)
            if n < 10:
                # Too sparse — report but mark as unreliable
                result[state][decade] = {
                    "share": None,
                    "ci_lo": None,
                    "ci_hi": None,
                    "n": n,
                    "unclassifiable_n": unclassifiable_n,
                    "sparse": True,
                }
                continue

            # Weighted mean p_female
            p = sum(classifiable) / n

            # Wilson score 95% CI
            z = 1.96
            denom = 1 + z * z / n
            centre = (p + z * z / (2 * n)) / denom
            margin = (z / denom) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
            ci_lo = max(0.0, centre - margin)
            ci_hi = min(1.0, centre + margin)

            result[state][decade] = {
                "share": round(p, 4),
                "ci_lo": round(ci_lo, 4),
                "ci_hi": round(ci_hi, 4),
                "n": n,
                "unclassifiable_n": unclassifiable_n,
                "sparse": False,
            }

    return result


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build() -> None:
    t_start = time.perf_counter()

    if not os.path.exists(DB_PATH):
        logger.error("DB not found at %s", DB_PATH)
        sys.exit(1)

    # --- Try SSA download (with mirror fallback) ---
    logger.info("Fetching SSA baby-names data (primary + mirror fallback)...")
    gender_map, yl_degraded_reason = build_gender_map()
    yl_degraded = bool(yl_degraded_reason)
    if yl_degraded:
        logger.warning("YL index will be omitted: %s", yl_degraded_reason)
    else:
        logger.info("Gender map ready with %d names.", len(gender_map))

    # --- Stream the DB ---
    logger.info("Opening DB: %s", DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    logger.info(
        "Streaming entries for years %d-%d ...", MIN_YEAR, MAX_YEAR
    )

    # name -> year -> count (for voyager)
    name_year_counts: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))

    # state -> decade_label -> [first_name, ...] (for YL index)
    state_decade_firstnames: dict[str, dict[str, list[str]]] = defaultdict(
        lambda: defaultdict(list)
    )

    # Aggregate name counts across all years (for threshold filtering)
    name_total_counts: dict[str, int] = defaultdict(int)

    total_rows = 0
    total_classifiable = 0
    total_unclassifiable = 0
    archive_years: set[int] = set()

    sql = """
        SELECT year, name, state
        FROM   entries
        WHERE  year >= ? AND year <= ? AND name IS NOT NULL
        ORDER  BY year
    """
    cursor = conn.execute(sql, (MIN_YEAR, MAX_YEAR))

    for row in cursor:
        year: int = row["year"]
        raw_name: str = row["name"]
        state: str | None = row["state"]
        total_rows += 1
        archive_years.add(year)

        first_name = extract_first_name(raw_name)

        if first_name is None:
            total_unclassifiable += 1
            continue

        total_classifiable += 1
        name_year_counts[first_name][year] += 1
        name_total_counts[first_name] += 1

        # Accumulate for YL index if state is a US state
        if state and state in US_STATES:
            decade = _decade_label(year)
            state_decade_firstnames[state][decade].append(first_name)

        if total_rows % 500_000 == 0:
            logger.info(
                "  %d rows scanned ... classifiable=%d, unclassifiable=%d",
                total_rows,
                total_classifiable,
                total_unclassifiable,
            )

    conn.close()

    logger.info(
        "Scan complete: %d rows, %d classifiable, %d unclassifiable.",
        total_rows,
        total_classifiable,
        total_unclassifiable,
    )

    # --- Apply minimum-count threshold to voyager layer ---
    distinct_first_names_total = len(name_year_counts)
    voyager: dict[str, dict[str, int]] = {}
    for name, year_map in name_year_counts.items():
        if name_total_counts[name] >= MIN_COUNT_THRESHOLD:
            voyager[name] = {str(y): c for y, c in sorted(year_map.items())}

    distinct_first_names_kept = len(voyager)
    logger.info(
        "Voyager layer: %d distinct first names before threshold, %d after (threshold=%d).",
        distinct_first_names_total,
        distinct_first_names_kept,
        MIN_COUNT_THRESHOLD,
    )

    # --- Top names by era ---
    # Accumulate per-decade totals from the voyager layer
    decade_name_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for name, year_map in name_year_counts.items():
        if name_total_counts[name] < MIN_COUNT_THRESHOLD:
            continue
        for yr_str, cnt in year_map.items():
            decade = _decade_label(int(yr_str))
            decade_name_counts[decade][name] += cnt

    top_names_by_era: dict[str, list[dict[str, Any]]] = {}
    for decade, nc in sorted(decade_name_counts.items()):
        top_10 = sorted(nc.items(), key=lambda x: -x[1])[:10]
        top_names_by_era[decade] = [{"name": n, "count": c} for n, c in top_10]

    # --- YL index ---
    yl_index: dict[str, Any] | None = None
    if not yl_degraded:
        logger.info("Computing YL index (%d states)...", len(state_decade_firstnames))
        yl_index = compute_yl_index(state_decade_firstnames, gender_map)
        logger.info("YL index computed for %d states.", len(yl_index))

    # --- Build artifact ---
    dataset_version = datetime.now(timezone.utc).strftime("%Y%m%d")
    artifact: dict[str, Any] = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "dataset_version": dataset_version,
        "yl_degraded": yl_degraded,
        "yl_degraded_reason": yl_degraded_reason,
        "min_year": MIN_YEAR,
        "max_year": MAX_YEAR,
        "archive_years": sorted(archive_years),
        "total_rows_scanned": total_rows,
        "total_classifiable": total_classifiable,
        "total_unclassifiable": total_unclassifiable,
        "distinct_first_names": distinct_first_names_kept,
        "min_count_threshold": MIN_COUNT_THRESHOLD,
        "voyager": voyager,
        "top_names_by_era": top_names_by_era,
        "yl_index": yl_index,
    }

    # --- Write ---
    out_dir = os.path.dirname(NAME_TRENDS_OUT)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    tmp_path = NAME_TRENDS_OUT + ".tmp"
    logger.info("Writing artifact to %s ...", NAME_TRENDS_OUT)
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, separators=(",", ":"))
    os.replace(tmp_path, NAME_TRENDS_OUT)

    elapsed = time.perf_counter() - t_start
    size_mb = os.path.getsize(NAME_TRENDS_OUT) / 1_048_576

    logger.info(
        "Done. distinct_names=%d, yl_degraded=%s, artifact=%.2f MB, elapsed=%.1fs",
        distinct_first_names_kept,
        yl_degraded,
        size_mb,
        elapsed,
    )


if __name__ == "__main__":
    build()
