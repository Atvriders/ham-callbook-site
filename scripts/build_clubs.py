#!/usr/bin/env python3
"""
build_clubs.py — Club detection + aggregation for the ham callbook site.

Reads existing entries from /home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite,
detects rows whose name looks like a radio club (vs. a person), normalizes/canonicalizes
the club name, and builds:

  - club_detections  (one row per detected entry across editions/years)
  - clubs            (one row per unique normalized club, aggregated)
  - club_callsigns   (per-club, per-callsign history with first/last year)
  - clubs_fts        (FTS5 over display_name + normalized_name)

Idempotent: drops + rebuilds the club_* tables and clubs_fts each run, but never touches
the upstream entries table.

Usage:
    python3 scripts/build_clubs.py
"""

from __future__ import annotations

import os
import re
import sys
import time
import sqlite3
import unicodedata
from collections import Counter, defaultdict

# Honor HAM_DB_PATH > DB_PATH > the site default (same pattern as
# build_data_layer.py — see that script for the rationale).
DB_PATH = os.environ.get("HAM_DB_PATH") or os.environ.get("DB_PATH") \
    or "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite"

# --------------------------------------------------------------------------------------
# Club pattern detection
# --------------------------------------------------------------------------------------

# Whole-word boundaries inside an uppercased+space-collapsed string.
_CLUB_REGEXES: list[tuple[str, re.Pattern]] = [
    # university / college / school
    ("university", re.compile(r"\bUNIVERSITY\b.*\bRADIO\b")),
    ("university", re.compile(r"\bCOLLEGE\b.*\bRADIO\b")),
    ("school",     re.compile(r"\bHIGH\s+SCHOOL\b.*\bRADIO\b")),
    ("school",     re.compile(r"\bSCHOOL\b.*\bRADIO\b")),

    # scouts
    ("scouts",     re.compile(r"\bBOY\s+SCOUTS?\b")),
    ("scouts",     re.compile(r"\bGIRL\s+SCOUTS?\b")),
    ("scouts",     re.compile(r"\bSCOUTS\b.*\bRADIO\b")),

    # museum / railroad
    ("museum",     re.compile(r"\bMUSEUM\b.*\bRADIO\b")),
    ("museum",     re.compile(r"\bRAILROAD\b.*\bRADIO\b")),

    # repeater
    ("repeater",   re.compile(r"\bREPEATER\s+(?:CLUB|GROUP|ASSOC(?:IATION)?)\b")),
    ("repeater",   re.compile(r"\bREPEATER\s+STATION\b")),

    # dx
    ("dx",         re.compile(r"\bDX\s+CLUB\b")),
    ("dx",         re.compile(r"\bDX\s+SOCIETY\b")),
    ("dx",         re.compile(r"\bDX\s+ASSOC(?:IATION)?\b")),
    ("dx",         re.compile(r"\bDX\s+GROUP\b")),

    # league
    ("league",     re.compile(r"\bAMATEUR\s+RADIO\s+LEAGUE\b")),
    ("league",     re.compile(r"\bRELAY\s+LEAGUE\b")),
    ("league",     re.compile(r"\bARRL\s+(?:HQ|HEADQUARTERS)\b")),

    # society
    ("society",    re.compile(r"\bAMATEUR\s+RADIO\s+SOCIETY\b")),
    ("society",    re.compile(r"\bRADIO\s+SOCIETY\b")),
    ("society",    re.compile(r"\bWIRELESS\s+SOCIETY\b")),
    ("society",    re.compile(r"\bQRP\s+SOCIETY\b")),
    ("society",    re.compile(r"\bYL\s+SOCIETY\b")),

    # association
    ("association",re.compile(r"\bAMATEUR\s+RADIO\s+ASSOC(?:IATION)?\b")),
    ("association",re.compile(r"\bRADIO\s+ASSOC(?:IATION)?\b")),

    # group
    ("group",      re.compile(r"\bAMATEUR\s+RADIO\s+GROUP\b")),

    # generic club
    ("club",       re.compile(r"\bAMATEUR\s+RADIO\s+CLUB\b")),
    ("club",       re.compile(r"\bRADIO\s+CLUB\b")),
    ("club",       re.compile(r"\bWIRELESS\s+CLUB\b")),
    ("club",       re.compile(r"\bQRP\s+CLUB\b")),
    ("club",       re.compile(r"\bYL\s+CLUB\b")),

    # emergency / nets
    ("emergency",  re.compile(r"\bEMERGENCY\s+(?:COMMUNICATIONS?|RADIO|SERVICE|GROUP)\b")),
    ("net",        re.compile(r"\bTRAFFIC\s+NET\b")),
    ("net",        re.compile(r"\bNET\s+CONTROL\b")),

    # station-of/at phrasing
    ("station",    re.compile(r"\bAMATEUR\s+RADIO\s+STATION\s+(?:OF|AT)\b")),

    # dotted / undotted abbreviations as standalone tokens
    # A.R.C. / ARC / A R C
    ("club",       re.compile(r"(?:^|\s)A\.?\s*R\.?\s*C\.?(?:\s|$)")),
    ("society",    re.compile(r"(?:^|\s)A\.?\s*R\.?\s*S\.?(?:\s|$)")),
    ("association",re.compile(r"(?:^|\s)A\.?\s*R\.?\s*A\.?(?:\s|$)")),
    ("league",     re.compile(r"(?:^|\s)A\.?\s*R\.?\s*L\.?(?:\s|$)")),
    ("group",      re.compile(r"(?:^|\s)A\.?\s*R\.?\s*G\.?(?:\s|$)")),
    ("league",     re.compile(r"(?:^|\s)A\.?\s*R\.?\s*R\.?\s*L\.?(?:\s|$)")),
]

# Fallback: name contains AMATEUR + one of (CLUB/SOCIETY/ASSOC/GROUP/LEAGUE)
_FALLBACK = re.compile(
    r"\bAMATEUR\b.*\b(?:CLUB|SOCIETY|ASSOC(?:IATION)?|GROUP|LEAGUE)\b"
)

# Anti-patterns: things that look like clubs but are people / non-orgs.
_ANTI = re.compile(
    r"\b(?:TRUSTEE|TRUSTEES|EXECUTOR|ESTATE\s+OF|C/O|CARE\s+OF)\b"
)


def detect_club(name_upper: str) -> tuple[bool, str | None]:
    """Return (is_club, club_type)."""
    if not name_upper:
        return False, None
    if _ANTI.search(name_upper):
        # could still be a club, but skip ambiguous trustee-style names
        # Actually trustees often hold club calls. Keep them if other pattern matches.
        pass
    for ctype, rx in _CLUB_REGEXES:
        if rx.search(name_upper):
            return True, ctype
    if _FALLBACK.search(name_upper):
        return True, "club"
    return False, None


# --------------------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------------------

_ABBREV_MAP = [
    # order matters: longer first
    (re.compile(r"\bARRL\b"), "AMATEUR RADIO RELAY LEAGUE"),
    (re.compile(r"\bA\.?R\.?R\.?L\.?\b"), "AMATEUR RADIO RELAY LEAGUE"),
    (re.compile(r"\bARC\b"),  "AMATEUR RADIO CLUB"),
    (re.compile(r"\bA\.?R\.?C\.?\b"), "AMATEUR RADIO CLUB"),
    (re.compile(r"\bARS\b"),  "AMATEUR RADIO SOCIETY"),
    (re.compile(r"\bA\.?R\.?S\.?\b"), "AMATEUR RADIO SOCIETY"),
    (re.compile(r"\bARA\b"),  "AMATEUR RADIO ASSOCIATION"),
    (re.compile(r"\bA\.?R\.?A\.?\b"), "AMATEUR RADIO ASSOCIATION"),
    (re.compile(r"\bARL\b"),  "AMATEUR RADIO LEAGUE"),
    (re.compile(r"\bA\.?R\.?L\.?\b"), "AMATEUR RADIO LEAGUE"),
    (re.compile(r"\bARG\b"),  "AMATEUR RADIO GROUP"),
    (re.compile(r"\bA\.?R\.?G\.?\b"), "AMATEUR RADIO GROUP"),
]

_RC_FOLLOWED = re.compile(r"\bRC\b(?=\s+\S)")  # RC only if something follows
_AMP = re.compile(r"\s*&\s*")
_GENERIC_SUFFIX = re.compile(
    r"\b(?:INC|INCORPORATED|LTD|LIMITED|LLC|CO|COMPANY|CORP|CORPORATION)\b\.?"
)
_NON_ALNUM = re.compile(r"[^A-Z0-9 ]+")
_WS = re.compile(r"\s+")


def _strip_diacritics(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )


def normalize_club_name(name: str) -> str:
    """Canonicalize a club name for grouping. Returns '' if name becomes empty."""
    if not name:
        return ""
    s = _strip_diacritics(name).upper()
    s = _AMP.sub(" AND ", s)
    # expand RC -> RADIO CLUB when followed by something
    s = _RC_FOLLOWED.sub("RADIO CLUB", s)
    for rx, repl in _ABBREV_MAP:
        s = rx.sub(repl, s)
    s = _GENERIC_SUFFIX.sub(" ", s)
    s = _NON_ALNUM.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    return s


def slugify(normalized: str) -> str:
    return normalized.lower().replace(" ", "-")


# --------------------------------------------------------------------------------------
# Wait for sibling
# --------------------------------------------------------------------------------------

def wait_for_sibling(db_path: str, timeout_s: int = 30 * 60, poll_s: int = 15) -> int:
    start = time.time()
    while True:
        elapsed = int(time.time() - start)
        if os.path.exists(db_path):
            try:
                conn = sqlite3.connect(db_path, timeout=5.0)
                cur = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?",
                    ("entries_fts",),
                )
                row = cur.fetchone()
                conn.close()
                if row:
                    return elapsed
            except sqlite3.Error:
                pass
        if elapsed >= timeout_s:
            raise TimeoutError(
                f"Timed out after {elapsed}s waiting for entries_fts in {db_path}"
            )
        time.sleep(poll_s)


# --------------------------------------------------------------------------------------
# Schema management
# --------------------------------------------------------------------------------------

def init_schema(conn: sqlite3.Connection) -> None:
    _retry_locked(conn.executescript,
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous  = NORMAL;
        PRAGMA temp_store   = MEMORY;

        DROP TABLE IF EXISTS clubs_fts;
        DROP TABLE IF EXISTS club_callsigns;
        DROP TABLE IF EXISTS clubs;
        DROP TABLE IF EXISTS club_detections;

        CREATE TABLE club_detections (
            rowid_entries    INTEGER PRIMARY KEY,
            callsign         TEXT,
            year             INTEGER,
            edition          TEXT,
            raw_name         TEXT,
            normalized_name  TEXT,
            slug             TEXT,
            city             TEXT,
            state            TEXT,
            club_type        TEXT
        );

        CREATE TABLE clubs (
            slug              TEXT PRIMARY KEY,
            display_name      TEXT,
            normalized_name   TEXT,
            callsign_count    INTEGER,
            appearance_count  INTEGER,
            first_year        INTEGER,
            last_year         INTEGER,
            dominant_state    TEXT,
            dominant_city     TEXT,
            club_type         TEXT
        );

        CREATE TABLE club_callsigns (
            slug              TEXT,
            callsign          TEXT,
            first_year        INTEGER,
            last_year         INTEGER,
            appearance_count  INTEGER,
            location_summary  TEXT,
            PRIMARY KEY (slug, callsign)
        );
        """
    )


def build_indexes(conn: sqlite3.Connection) -> list[str]:
    stmts = [
        "CREATE INDEX IF NOT EXISTS idx_club_detections_slug     ON club_detections(slug)",
        "CREATE INDEX IF NOT EXISTS idx_club_detections_callsign ON club_detections(callsign)",
        "CREATE INDEX IF NOT EXISTS idx_club_detections_year     ON club_detections(year)",
        "CREATE INDEX IF NOT EXISTS idx_club_callsigns_callsign  ON club_callsigns(callsign)",
        "CREATE INDEX IF NOT EXISTS idx_club_callsigns_slug      ON club_callsigns(slug)",
        "CREATE INDEX IF NOT EXISTS idx_clubs_normalized_name    ON clubs(normalized_name)",
        "CREATE INDEX IF NOT EXISTS idx_clubs_callsign_count     ON clubs(callsign_count)",
    ]
    names = []
    for s in stmts:
        _retry_locked(conn.execute, s)
        names.append(s.split()[5])  # the index name
    _retry_locked(conn.execute,
        "CREATE VIRTUAL TABLE IF NOT EXISTS clubs_fts USING fts5("
        "display_name, normalized_name, content='clubs', content_rowid='rowid', "
        "tokenize='unicode61 remove_diacritics 2')"
    )
    _retry_locked(conn.execute,
        "INSERT INTO clubs_fts(rowid, display_name, normalized_name) "
        "SELECT rowid, display_name, normalized_name FROM clubs"
    )
    names.append("clubs_fts")
    return names


# --------------------------------------------------------------------------------------
# Column discovery
# --------------------------------------------------------------------------------------

def pick_columns(conn: sqlite3.Connection) -> dict[str, str | None]:
    cols = {r[1].lower(): r[1] for r in conn.execute("PRAGMA table_info(entries)")}

    def find(*candidates: str) -> str | None:
        for c in candidates:
            if c.lower() in cols:
                return cols[c.lower()]
        return None

    return {
        "name":     find("name", "full_name", "operator", "licensee", "licensee_name"),
        "callsign": find("callsign", "call", "call_sign"),
        "year":     find("year", "edition_year", "yr"),
        "edition":  find("edition", "edition_name", "source_edition", "book"),
        "city":     find("city", "town", "qth_city"),
        "state":    find("state", "st", "qth_state", "province"),
    }


# --------------------------------------------------------------------------------------
# Main flow
# --------------------------------------------------------------------------------------

def title_case_smart(s: str) -> str:
    """Cheap title-case that preserves common ham acronyms."""
    if not s:
        return s
    parts = s.split()
    out = []
    keep_upper = {
        "ARC", "ARS", "ARA", "ARL", "ARG", "ARRL", "DX", "HQ",
        "YL", "QRP", "USA", "US", "USAF", "USN", "USMC", "AFB",
        "RV", "TV", "FM", "AM", "VHF", "UHF", "HF", "MIT", "UCLA",
        "USC", "BYU", "RIT", "UC", "NYU", "WPI", "MARC", "WARC",
    }
    for p in parts:
        u = p.upper()
        if u in keep_upper:
            out.append(u)
        elif len(p) <= 3 and p.isupper():
            out.append(p)
        else:
            out.append(p.capitalize())
    return " ".join(out)


def best_display_name(raw_names: list[str]) -> str:
    """Pick the most common raw_name, then title-case it nicely."""
    if not raw_names:
        return ""
    counts = Counter(raw_names)
    # Prefer the most common; tie-break by longer, then mixed-case presence.
    def score(item):
        name, cnt = item
        mixed = any(c.islower() for c in name) and any(c.isupper() for c in name)
        return (cnt, len(name), 1 if mixed else 0)
    top = max(counts.items(), key=score)[0]
    # If it's ALL CAPS, smart title-case it; otherwise leave as-is.
    if top.isupper():
        return title_case_smart(top.lower())
    return top


def _retry_locked(func, *args, max_tries: int = 60, sleep_s: float = 2.0, **kwargs):
    """Retry sqlite operations that fail with 'database is locked' / 'busy'."""
    last_err = None
    for attempt in range(max_tries):
        try:
            return func(*args, **kwargs)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "locked" in msg or "busy" in msg:
                last_err = e
                time.sleep(sleep_s)
                continue
            raise
    raise last_err if last_err else RuntimeError("retry exhausted")


def _exec_retry(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> sqlite3.Cursor:
    return _retry_locked(conn.execute, sql, params)


def _executemany_retry(conn: sqlite3.Connection, sql: str, rows: list) -> None:
    _retry_locked(conn.executemany, sql, rows)


def _commit_retry(conn: sqlite3.Connection) -> None:
    _retry_locked(conn.commit)


def main() -> dict:
    waited = wait_for_sibling(DB_PATH)
    conn = sqlite3.connect(DB_PATH, timeout=300.0, isolation_level="DEFERRED")
    # Tell SQLite to internally wait up to 5 minutes on a busy DB before raising.
    conn.execute("PRAGMA busy_timeout = 300000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous  = NORMAL")
    conn.execute("PRAGMA temp_store   = MEMORY")
    conn.execute("PRAGMA cache_size   = -200000")  # ~200MB

    cmap = pick_columns(conn)
    if not cmap["name"] or not cmap["callsign"]:
        raise RuntimeError(f"entries table missing required cols; got {cmap}")

    init_schema(conn)

    # Stream rows from entries
    select_cols = [
        f'e.rowid AS rid',
        f'{cmap["callsign"]} AS cs',
        f'{cmap["name"]} AS nm',
    ]
    select_cols.append(f'{cmap["year"]} AS yr' if cmap["year"] else "NULL AS yr")
    select_cols.append(f'{cmap["edition"]} AS ed' if cmap["edition"] else "NULL AS ed")
    select_cols.append(f'{cmap["city"]} AS ct' if cmap["city"] else "NULL AS ct")
    select_cols.append(f'{cmap["state"]} AS sta' if cmap["state"] else "NULL AS sta")
    sql = (
        f'SELECT {", ".join(select_cols)} '
        f'FROM entries e '
        f'WHERE {cmap["name"]} IS NOT NULL AND {cmap["name"]} <> ""'
    )

    print(f"[clubs] scanning entries... cols={cmap}", flush=True)

    batch: list[tuple] = []
    inserted = 0
    scanned  = 0
    BATCH = 5000

    cur = conn.cursor()
    insert_sql = (
        "INSERT OR REPLACE INTO club_detections "
        "(rowid_entries, callsign, year, edition, raw_name, normalized_name, slug, city, state, club_type) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)"
    )

    read_cur = conn.execute(sql)
    while True:
        rows = read_cur.fetchmany(20000)
        if not rows:
            break
        for rid, cs, nm, yr, ed, ct, sta in rows:
            scanned += 1
            if not nm:
                continue
            upper = _strip_diacritics(nm).upper()
            upper = _WS.sub(" ", upper).strip()
            is_club, ctype = detect_club(upper)
            if not is_club:
                continue
            normalized = normalize_club_name(nm)
            if not normalized or len(normalized) < 4:
                continue
            slug = slugify(normalized)
            batch.append((
                rid,
                (cs or "").upper().strip() or None,
                int(yr) if isinstance(yr, (int, float)) and yr else (
                    int(yr) if isinstance(yr, str) and yr.isdigit() else None
                ),
                ed,
                nm,
                normalized,
                slug,
                ct,
                sta,
                ctype,
            ))
            if len(batch) >= BATCH:
                _executemany_retry(conn, insert_sql, batch)
                _commit_retry(conn)
                inserted += len(batch)
                batch.clear()
        if scanned % 200000 == 0:
            print(f"[clubs] scanned={scanned} detected={inserted+len(batch)}", flush=True)

    if batch:
        _executemany_retry(conn, insert_sql, batch)
        inserted += len(batch)
        batch.clear()
    _commit_retry(conn)

    print(f"[clubs] detection done: scanned={scanned} detections={inserted}", flush=True)

    # ---------------- Aggregate clubs + club_callsigns ----------------

    # Build clubs row-by-row in Python so we can pick the best display_name from raw_name
    # multiset, and dominant state/city.
    print("[clubs] aggregating clubs...", flush=True)

    # Stream by slug for memory efficiency
    _retry_locked(conn.execute, "CREATE INDEX IF NOT EXISTS tmp_idx_cd_slug ON club_detections(slug)")
    slug_count_cur = conn.execute(
        "SELECT slug, COUNT(*) AS n FROM club_detections GROUP BY slug"
    )
    slugs = [r[0] for r in slug_count_cur.fetchall()]
    print(f"[clubs] distinct slugs = {len(slugs)}", flush=True)

    club_insert = (
        "INSERT INTO clubs "
        "(slug, display_name, normalized_name, callsign_count, appearance_count, "
        " first_year, last_year, dominant_state, dominant_city, club_type) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)"
    )
    cc_insert = (
        "INSERT INTO club_callsigns "
        "(slug, callsign, first_year, last_year, appearance_count, location_summary) "
        "VALUES (?,?,?,?,?,?)"
    )

    club_rows: list[tuple] = []
    cc_rows:   list[tuple] = []
    CL_BATCH = 2000

    for slug in slugs:
        rows = conn.execute(
            "SELECT callsign, year, raw_name, normalized_name, city, state, club_type "
            "FROM club_detections WHERE slug = ?",
            (slug,),
        ).fetchall()
        if not rows:
            continue

        raw_names    = [r[2] for r in rows if r[2]]
        normalized   = rows[0][3]
        years        = [r[1] for r in rows if isinstance(r[1], int)]
        states       = [r[5] for r in rows if r[5]]
        cities       = [r[4] for r in rows if r[4]]
        ctypes       = [r[6] for r in rows if r[6]]

        callsign_to_years: dict[str, list[int]] = defaultdict(list)
        callsign_to_count: Counter = Counter()
        callsign_to_loc:   dict[str, Counter] = defaultdict(Counter)
        for cs, yr, _rn, _nn, city, state, _ct in rows:
            if not cs:
                continue
            callsign_to_count[cs] += 1
            if isinstance(yr, int):
                callsign_to_years[cs].append(yr)
            loc = ", ".join([p for p in (city, state) if p])
            if loc:
                callsign_to_loc[cs][loc] += 1

        callsign_count = len(callsign_to_count)
        appearance_count = len(rows)
        first_year = min(years) if years else None
        last_year  = max(years) if years else None
        dominant_state = Counter(states).most_common(1)[0][0] if states else None
        dominant_city  = Counter(cities).most_common(1)[0][0] if cities else None
        # most common club_type, falling back to 'club'
        club_type = Counter(ctypes).most_common(1)[0][0] if ctypes else "club"
        display = best_display_name(raw_names) or normalized

        club_rows.append((
            slug, display, normalized, callsign_count, appearance_count,
            first_year, last_year, dominant_state, dominant_city, club_type,
        ))

        for cs, cnt in callsign_to_count.items():
            yrs = callsign_to_years.get(cs, [])
            fy = min(yrs) if yrs else None
            ly = max(yrs) if yrs else None
            loc_counter = callsign_to_loc.get(cs)
            loc_summary = loc_counter.most_common(1)[0][0] if loc_counter else None
            cc_rows.append((slug, cs, fy, ly, cnt, loc_summary))

        if len(club_rows) >= CL_BATCH:
            _executemany_retry(conn, club_insert, club_rows)
            _commit_retry(conn)
            club_rows.clear()
        if len(cc_rows) >= CL_BATCH * 4:
            _executemany_retry(conn, cc_insert, cc_rows)
            _commit_retry(conn)
            cc_rows.clear()

    if club_rows:
        _executemany_retry(conn, club_insert, club_rows)
        club_rows.clear()
    if cc_rows:
        _executemany_retry(conn, cc_insert, cc_rows)
        cc_rows.clear()

    _exec_retry(conn, "DROP INDEX IF EXISTS tmp_idx_cd_slug")
    _commit_retry(conn)

    # ---------------- Indexes + FTS ----------------
    print("[clubs] building indexes + FTS...", flush=True)
    index_names = build_indexes(conn)
    conn.commit()

    # ---------------- Stats ----------------
    cd_n     = conn.execute("SELECT COUNT(*) FROM club_detections").fetchone()[0]
    clubs_n  = conn.execute("SELECT COUNT(*) FROM clubs").fetchone()[0]
    cc_n     = conn.execute("SELECT COUNT(*) FROM club_callsigns").fetchone()[0]

    sample_row = conn.execute(
        "SELECT slug, display_name, normalized_name, callsign_count, appearance_count, "
        "first_year, last_year, dominant_state, dominant_city, club_type "
        "FROM clubs WHERE callsign_count >= 2 ORDER BY appearance_count DESC LIMIT 1"
    ).fetchone()

    sample = {}
    if sample_row:
        (s_slug, s_disp, s_norm, s_csc, s_apc,
         s_fy, s_ly, s_st, s_ct, s_type) = sample_row
        history = conn.execute(
            "SELECT callsign, first_year, last_year, appearance_count, location_summary "
            "FROM club_callsigns WHERE slug = ? ORDER BY first_year IS NULL, first_year",
            (s_slug,),
        ).fetchall()
        sample = {
            "slug": s_slug,
            "display_name": s_disp,
            "normalized_name": s_norm,
            "callsign_count": s_csc,
            "appearance_count": s_apc,
            "first_year": s_fy,
            "last_year": s_ly,
            "dominant_state": s_st,
            "dominant_city": s_ct,
            "club_type": s_type,
            "callsign_history": [
                {
                    "callsign": h[0],
                    "first_year": h[1],
                    "last_year": h[2],
                    "appearance_count": h[3],
                    "location_summary": h[4],
                }
                for h in history
            ],
        }

    # ANALYZE (no VACUUM since sibling may still be writing)
    print("[clubs] ANALYZE...", flush=True)
    _retry_locked(conn.execute, "ANALYZE")
    _commit_retry(conn)
    conn.close()

    return {
        "waited_seconds": waited,
        "clubs_detected": cd_n,           # total entry-rows matched as clubs
        "distinct_clubs": clubs_n,        # distinct slugs
        "clubs_table_rows": clubs_n,
        "club_callsigns_rows": cc_n,
        "indexes_built": index_names,
        "sample_club": sample,
    }


if __name__ == "__main__":
    try:
        result = main()
    except Exception as e:
        print(f"[clubs] FAILED: {e}", file=sys.stderr)
        raise
    import json
    print("RESULT_JSON:" + json.dumps(result, default=str))
