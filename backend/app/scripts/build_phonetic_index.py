"""Build phonetic_index.json artifact for the Phonetic People Finder feature.

Reads every (name, callsign, year, state) row from ``entries``, normalizes and
expands period abbreviations (Wm.->William, etc.), computes a composite
metaphone key from the expanded name tokens, and writes a compact JSON sidecar.

Architecture
------------
Keying on *phonetic key* (first-token + last-token metaphone) collapses 3.4 M
distinct raw names into ~412 K multi-entry buckets (total >= 3).  Within each
bucket, entries are grouped by normalized-name then by callsign; only the first
year observed is stored per callsign (not a full year list) to keep the artifact
lean.  Each key is capped at MAX_PAIRS_PER_KEY distinct (name, call) pairs.

Keys with total_entries < MIN_TOTAL_PER_KEY are dropped (OCR-noise singletons
and doublets).

Target artifact size: ~75 MB at defaults (cap=50, min=3).

Posting structure per key::

    "WLM|SM0": {
        "t": 4210,            # total entries (including truncated)
        "tr": true,           # present-and-true only when truncated
        "p": {                # postings: norm_name -> {callsign: first_year}
            "William Smith": {"W6XYZ": 1955, "W5ABC": 1965},
            ...
        }
    }

Usage
-----
    python -m app.scripts.build_phonetic_index
    DB_PATH=/data/USA_Ham_Callbooks.sqlite \\
    PHONETIC_INDEX_OUT=/data/phonetic_index.json \\
        python -m app.scripts.build_phonetic_index
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

try:
    import jellyfish  # type: ignore
    _HAS_JELLYFISH = True
except ImportError:  # pragma: no cover
    _HAS_JELLYFISH = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("build_phonetic_index")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DB_PATH: str = os.environ.get(
    "DB_PATH",
    "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
)

PHONETIC_INDEX_OUT: str = os.environ.get(
    "PHONETIC_INDEX_OUT",
    os.path.join(os.path.dirname(DB_PATH), "phonetic_index.json"),
)

# Max distinct (normalized_name, callsign) pairs stored per phonetic key.
# After this cap the key is marked truncated=True.  50 keeps artifact ~75 MB.
MAX_PAIRS_PER_KEY: int = int(os.environ.get("MAX_PAIRS_PER_KEY", "50"))

# Drop keys whose total_entry_count is below this (removes OCR-noise singletons)
MIN_TOTAL_PER_KEY: int = int(os.environ.get("MIN_TOTAL_PER_KEY", "3"))

# ---------------------------------------------------------------------------
# Abbreviation expansion table
# ---------------------------------------------------------------------------

ABBREV_MAP: dict[str, str] = {
    "wm":    "William",
    "chas":  "Charles",
    "jno":   "John",
    "robt":  "Robert",
    "geo":   "George",
    "jas":   "James",
    "thos":  "Thomas",
    "jos":   "Joseph",
    "benj":  "Benjamin",
    "edw":   "Edward",
    "saml":  "Samuel",
    "danl":  "Daniel",
    "richd": "Richard",
    "fredk": "Frederick",
    "fred":  "Frederick",
    "alf":   "Alfred",
    "alex":  "Alexander",
    "theo":  "Theodore",
    "fras":  "Francis",
    "anth":  "Anthony",
    "bart":  "Bartholomew",
    "bern":  "Bernard",
    "cath":  "Catherine",
    "cornl": "Cornelius",
    "eliz":  "Elizabeth",
    "ferd":  "Ferdinand",
    "nich":  "Nicholas",
    "pat":   "Patrick",
    "sim":   "Simon",
    "steph": "Stephen",
    "timo":  "Timothy",
    "waltr": "Walter",
}

_NOISE_RE = re.compile(r"[^A-Za-z .]+")
_TOKEN_RE = re.compile(r"[A-Za-z]+\.?")


# ---------------------------------------------------------------------------
# Phonetic helpers
# ---------------------------------------------------------------------------

def _soundex(s: str) -> str:
    """Pure-Python Soundex fallback."""
    s = s.upper()
    if not s:
        return "Z000"
    table = str.maketrans("AEIOUYHWBFPVCGJKQSXZDTLMNR",
                          "000000000111122222222334556")
    code = s[0]
    prev = s[0].translate(table)
    for ch in s[1:]:
        d = ch.translate(table)
        if d != "0" and d != prev:
            code += d
        prev = d
    return (code + "000")[:4]


def _metaphone_token(word: str) -> str:
    if not word:
        return ""
    if _HAS_JELLYFISH:
        return jellyfish.metaphone(word) or word[:4].upper()
    return _soundex(word)


def normalize_name(raw: str) -> str:
    """Expand abbreviations and strip OCR noise; return cleaned name string."""
    raw = _NOISE_RE.sub(" ", raw).strip()
    tokens = _TOKEN_RE.findall(raw)
    result: list[str] = []
    for tok in tokens:
        clean = tok.rstrip(".")
        expanded = ABBREV_MAP.get(clean.lower(), clean)
        result.append(expanded)
    return " ".join(result)


def phonetic_key(normalized: str) -> str:
    """Composite key: metaphone of first substantive token + metaphone of last.

    'William Henry Smith' -> 'WLM|SM0'
    Single real token -> just that token's metaphone.
    Single initials are skipped (len<=1).
    """
    tokens = [t for t in normalized.split() if len(t) > 1 and t.isalpha()]
    if not tokens:
        tokens = [t for t in normalized.split() if t.isalpha()]
    if not tokens:
        return "UNKNOWN"
    if len(tokens) == 1:
        return _metaphone_token(tokens[0])
    first_key = _metaphone_token(tokens[0])
    last_key = _metaphone_token(tokens[-1])
    if first_key == last_key:
        return first_key
    return f"{first_key}|{last_key}"


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build() -> None:
    t_start = time.perf_counter()

    if not os.path.exists(DB_PATH):
        logger.error("DB not found at %s", DB_PATH)
        sys.exit(1)

    logger.info("Opening DB: %s", DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    logger.info("Pass 1: streaming entries …")

    # phonetic_key -> norm_name -> call -> first_year seen
    # Compact: only first_year stored per (name, call) pair.
    index: dict[str, dict[str, dict[str, int | None]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    # phonetic_key -> total count (all rows, before any cap)
    key_total: dict[str, int] = defaultdict(int)
    # phonetic_key -> distinct (norm_name, call) pairs stored so far
    key_pairs: dict[str, int] = defaultdict(int)

    distinct_raw_names: set[str] = set()

    row_count = 0
    skipped = 0

    cursor = conn.execute(
        "SELECT callsign, year, state, name FROM entries WHERE name IS NOT NULL"
    )

    for row in cursor:
        raw_name: str = row["name"]
        call: str = row["callsign"] or ""
        year_val = row["year"]
        year: int | None = int(year_val) if year_val is not None else None

        row_count += 1
        if row_count % 500_000 == 0:
            logger.info("  … %d rows, %d keys", row_count, len(index))

        if len(raw_name) < 3:
            skipped += 1
            continue

        distinct_raw_names.add(raw_name)

        norm = normalize_name(raw_name)
        if not norm or len(norm) < 3:
            skipped += 1
            continue

        pkey = phonetic_key(norm)
        key_total[pkey] += 1

        # Only store if under the pair cap AND call is non-empty
        if call and key_pairs[pkey] < MAX_PAIRS_PER_KEY:
            name_bucket = index[pkey][norm]
            if call not in name_bucket:
                # New (name, call) pair
                name_bucket[call] = year
                key_pairs[pkey] += 1
            elif year is not None:
                # Update: keep the earliest year for this (name, call)
                existing = name_bucket[call]
                if existing is None or year < existing:
                    name_bucket[call] = year

    conn.close()

    distinct_keys_total = len(key_total)
    logger.info(
        "Pass 1 done: %d rows, %d skipped, %d distinct raw names, %d phonetic keys",
        row_count, skipped, len(distinct_raw_names), distinct_keys_total,
    )

    # -- Pass 2: serialize, drop low-frequency keys --
    logger.info(
        "Pass 2: serializing (dropping keys with total < %d) …",
        MIN_TOTAL_PER_KEY,
    )

    out_index: dict[str, Any] = {}
    truncated_keys = 0
    keys_dropped = 0

    for pkey in key_total:
        total = key_total[pkey]
        if total < MIN_TOTAL_PER_KEY:
            keys_dropped += 1
            continue

        pairs_stored = key_pairs.get(pkey, 0)
        trunc = total > MAX_PAIRS_PER_KEY or pairs_stored >= MAX_PAIRS_PER_KEY
        if trunc:
            truncated_keys += 1

        # Postings: norm_name -> {call: first_year}
        postings: dict[str, dict[str, int | None]] = {}
        for norm_name, calls in index.get(pkey, {}).items():
            if calls:
                postings[norm_name] = dict(calls)

        if not postings:
            continue

        entry: dict[str, Any] = {"t": total, "p": postings}
        if trunc:
            entry["tr"] = True
        out_index[pkey] = entry

    logger.info(
        "Kept %d keys, dropped %d low-freq, %d truncated",
        len(out_index), keys_dropped, truncated_keys,
    )

    artifact = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset_version": "v2026.06",
        "builder": "build_phonetic_index",
        "phonetic_lib": "jellyfish.metaphone" if _HAS_JELLYFISH else "soundex_builtin",
        "max_pairs_per_key": MAX_PAIRS_PER_KEY,
        "min_total_per_key": MIN_TOTAL_PER_KEY,
        "stats": {
            "total_entries_scanned": row_count,
            "entries_skipped": skipped,
            "distinct_raw_names": len(distinct_raw_names),
            "distinct_phonetic_keys_total": distinct_keys_total,
            "keys_in_artifact": len(out_index),
            "keys_dropped_low_freq": keys_dropped,
            "truncated_keys": truncated_keys,
        },
        "abbrev_map": ABBREV_MAP,
        "index": out_index,
    }

    # -- Write atomically --
    os.makedirs(os.path.dirname(PHONETIC_INDEX_OUT) or ".", exist_ok=True)
    logger.info("Writing %s …", PHONETIC_INDEX_OUT)
    tmp_path = PHONETIC_INDEX_OUT + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp_path, PHONETIC_INDEX_OUT)

    size_mb = os.path.getsize(PHONETIC_INDEX_OUT) / 1_048_576
    elapsed = time.perf_counter() - t_start

    logger.info(
        "Done: %s  (%.1f MB, %.1f s)",
        PHONETIC_INDEX_OUT,
        size_mb,
        elapsed,
    )
    logger.info(
        "Stats: distinct_raw_names=%d  phonetic_keys_total=%d  "
        "artifact_keys=%d  dropped=%d  truncated=%d  size_mb=%.2f",
        len(distinct_raw_names),
        distinct_keys_total,
        len(out_index),
        keys_dropped,
        truncated_keys,
        size_mb,
    )


# ---------------------------------------------------------------------------
# Worked examples
# ---------------------------------------------------------------------------

_EXAMPLE_QUERIES = [
    "Robt. E. Kowalski",
    "Wm. H. Smith",
    "William Smith",
    "Robert Kowalski",
    "Chas. Jones",
    "Charles Jones",
    "Geo. Washington",
    "Jno. Miller",
    "Thos. Edison",
    "Saml. Morse",
]


def show_examples() -> None:
    print("\n--- Worked examples ---")
    print(f"{'Raw input':<30}  {'Normalized':<30}  {'Phonetic key'}")
    print("-" * 80)
    for q in _EXAMPLE_QUERIES:
        norm = normalize_name(q)
        pkey = phonetic_key(norm)
        print(f"{q:<30}  {norm:<30}  {pkey}")
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    show_examples()
    if "--examples-only" not in sys.argv:
        build()
