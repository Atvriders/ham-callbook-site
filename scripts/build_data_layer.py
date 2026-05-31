"""
Data-layer enhancement for the ham-callbook site.

Operates in-place on /home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite:

  1. FTS5 virtual table `entries_fts` (name, callsign, city, state) +
     INSERT/UPDATE/DELETE triggers to keep it in sync with `entries`.
  2. View `callsign_history`: per-callsign per-year holder records.
  3. View `previous_holders`: callsigns whose holder appears to have changed
     (>=2 distinct normalized surnames).
  4. Table `geocode_cache` seeded with US state / DC / territory centroids.
  5. Materialized table `stats_per_year` (entry_count, distinct_callsigns).
  6. ANALYZE + VACUUM.
  7. Sample query against `callsign_history` for W1AW.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time

DB_PATH = "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite"

# US state / DC / territory centroids.  Source: NOAA / USGS state-centroid
# tables, rounded to 4 decimals (sufficient for map starting positions).
STATE_CENTROIDS: list[tuple[str, float, float]] = [
    ("AL", 32.7794, -86.8287),
    ("AK", 64.0685, -152.2782),
    ("AZ", 34.2744, -111.6602),
    ("AR", 34.8938, -92.4426),
    ("CA", 37.1841, -119.4696),
    ("CO", 38.9972, -105.5478),
    ("CT", 41.6219, -72.7273),
    ("DE", 38.9896, -75.5050),
    ("DC", 38.9101, -77.0147),
    ("FL", 28.6305, -82.4497),
    ("GA", 32.6415, -83.4426),
    ("HI", 20.2927, -156.3737),
    ("ID", 44.3509, -114.6130),
    ("IL", 40.0417, -89.1965),
    ("IN", 39.8942, -86.2816),
    ("IA", 42.0751, -93.4960),
    ("KS", 38.4937, -98.3804),
    ("KY", 37.5347, -85.3021),
    ("LA", 31.0689, -91.9968),
    ("ME", 45.3695, -69.2428),
    ("MD", 39.0550, -76.7909),
    ("MA", 42.2596, -71.8083),
    ("MI", 44.3467, -85.4102),
    ("MN", 46.2807, -94.3053),
    ("MS", 32.7364, -89.6678),
    ("MO", 38.3566, -92.4580),
    ("MT", 47.0527, -109.6333),
    ("NE", 41.5378, -99.7951),
    ("NV", 39.3289, -116.6312),
    ("NH", 43.6805, -71.5811),
    ("NJ", 40.1907, -74.6728),
    ("NM", 34.4071, -106.1126),
    ("NY", 42.9538, -75.5268),
    ("NC", 35.5557, -79.3877),
    ("ND", 47.4501, -100.4659),
    ("OH", 40.2862, -82.7937),
    ("OK", 35.5889, -97.4943),
    ("OR", 43.9336, -120.5583),
    ("PA", 40.8781, -77.7996),
    ("RI", 41.6762, -71.5562),
    ("SC", 33.9169, -80.8964),
    ("SD", 44.4443, -100.2263),
    ("TN", 35.8580, -86.3505),
    ("TX", 31.4757, -99.3312),
    ("UT", 39.3055, -111.6703),
    ("VT", 44.0687, -72.6658),
    ("VA", 37.5215, -78.8537),
    ("WA", 47.3826, -120.4472),
    ("WV", 38.6409, -80.6227),
    ("WI", 44.6243, -89.9941),
    ("WY", 42.9957, -107.5512),
    # US territories that historically issued US callsigns.
    ("PR", 18.2208, -66.5901),
    ("VI", 18.3358, -64.8963),
    ("GU", 13.4443, 144.7937),
    ("AS", -14.2710, -170.1322),
    ("MP", 17.3308, 145.3847),
    # Edge-case codes that show up in old callbooks.
    ("CZ", 9.0820, -79.7674),   # Canal Zone
    ("PI", 12.8797, 121.7740),  # Philippines (pre-WWII US territory)
]


def log(msg: str) -> None:
    print(f"[data-layer] {msg}", flush=True)


def file_mb(path: str) -> float:
    return round(os.path.getsize(path) / (1024 * 1024), 2)


def run(conn: sqlite3.Connection, sql: str) -> None:
    conn.execute(sql)


def script(conn: sqlite3.Connection, sql: str) -> None:
    conn.executescript(sql)


def step_fts5(conn: sqlite3.Connection) -> None:
    log("FTS5: creating entries_fts virtual table")
    script(
        conn,
        """
        DROP TRIGGER IF EXISTS entries_ai;
        DROP TRIGGER IF EXISTS entries_ad;
        DROP TRIGGER IF EXISTS entries_au;
        DROP TABLE   IF EXISTS entries_fts;

        CREATE VIRTUAL TABLE entries_fts USING fts5(
            name,
            callsign,
            city,
            state,
            content='entries',
            content_rowid='rowid',
            tokenize='unicode61 remove_diacritics 2'
        );
        """,
    )

    log("FTS5: populating entries_fts (this is the slow step)")
    t0 = time.time()
    conn.execute(
        """
        INSERT INTO entries_fts(rowid, name, callsign, city, state)
        SELECT rowid, name, callsign, city, state
        FROM   entries
        WHERE  callsign IS NOT NULL
        """
    )
    conn.commit()
    log(f"FTS5: populated in {time.time() - t0:.1f}s")

    log("FTS5: installing sync triggers")
    script(
        conn,
        """
        CREATE TRIGGER entries_ai AFTER INSERT ON entries
        WHEN NEW.callsign IS NOT NULL
        BEGIN
            INSERT INTO entries_fts(rowid, name, callsign, city, state)
            VALUES (NEW.rowid, NEW.name, NEW.callsign, NEW.city, NEW.state);
        END;

        CREATE TRIGGER entries_ad AFTER DELETE ON entries
        WHEN OLD.callsign IS NOT NULL
        BEGIN
            INSERT INTO entries_fts(entries_fts, rowid, name, callsign, city, state)
            VALUES ('delete', OLD.rowid, OLD.name, OLD.callsign, OLD.city, OLD.state);
        END;

        CREATE TRIGGER entries_au AFTER UPDATE ON entries
        BEGIN
            INSERT INTO entries_fts(entries_fts, rowid, name, callsign, city, state)
            VALUES ('delete', OLD.rowid, OLD.name, OLD.callsign, OLD.city, OLD.state);
            INSERT INTO entries_fts(rowid, name, callsign, city, state)
            SELECT NEW.rowid, NEW.name, NEW.callsign, NEW.city, NEW.state
            WHERE NEW.callsign IS NOT NULL;
        END;
        """,
    )


def step_callsign_history(conn: sqlite3.Connection) -> None:
    log("View: callsign_history")
    script(
        conn,
        """
        DROP VIEW IF EXISTS callsign_history;
        CREATE VIEW callsign_history AS
        SELECT callsign, year, edition, name, city, state, license_class
        FROM   entries
        WHERE  callsign IS NOT NULL
        ORDER  BY callsign, year;
        """,
    )


def step_previous_holders(conn: sqlite3.Connection) -> None:
    log("View: previous_holders")
    script(
        conn,
        """
        DROP VIEW IF EXISTS previous_holders;
        CREATE VIEW previous_holders AS
        WITH normalized AS (
            SELECT callsign,
                   year,
                   name,
                   UPPER(REPLACE(REPLACE(name, '.', ''), ',', '')) AS norm_name,
                   city,
                   state
            FROM   entries
            WHERE  callsign IS NOT NULL
              AND  name IS NOT NULL
              AND  name != ''
        ),
        distinct_holders AS (
            SELECT callsign,
                   COUNT(DISTINCT norm_name)       AS distinct_holders_n,
                   GROUP_CONCAT(DISTINCT norm_name) AS all_norm_names,
                   MIN(year)                       AS first_year,
                   MAX(year)                       AS last_year
            FROM   normalized
            GROUP  BY callsign
        )
        SELECT *
        FROM   distinct_holders
        WHERE  distinct_holders_n >= 2;
        """,
    )


def step_geocode_cache(conn: sqlite3.Connection) -> None:
    log("Table: geocode_cache (seed state centroids)")
    script(
        conn,
        """
        CREATE TABLE IF NOT EXISTS geocode_cache (
            state      TEXT NOT NULL,
            city       TEXT NOT NULL DEFAULT '',
            lat        REAL NOT NULL,
            lon        REAL NOT NULL,
            source     TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (state, city)
        );
        CREATE INDEX IF NOT EXISTS idx_geocode_state ON geocode_cache(state);
        """,
    )
    conn.executemany(
        """
        INSERT OR REPLACE INTO geocode_cache(state, city, lat, lon, source, updated_at)
        VALUES (?, '', ?, ?, 'seed:us_state_centroid', datetime('now'))
        """,
        STATE_CENTROIDS,
    )
    conn.commit()


def step_stats_per_year(conn: sqlite3.Connection) -> None:
    log("Table: stats_per_year (materialized)")
    script(
        conn,
        """
        DROP TABLE IF EXISTS stats_per_year;
        CREATE TABLE stats_per_year AS
        SELECT year,
               COUNT(*)                AS entry_count,
               COUNT(DISTINCT callsign) AS distinct_callsigns
        FROM   entries
        GROUP  BY year;
        CREATE INDEX IF NOT EXISTS idx_stats_year ON stats_per_year(year);
        """,
    )


def step_analyze_vacuum(conn: sqlite3.Connection) -> None:
    log("ANALYZE")
    conn.execute("ANALYZE")
    conn.commit()
    log("VACUUM (this rewrites the entire DB; be patient)")
    # VACUUM cannot run inside a transaction.
    conn.isolation_level = None
    conn.execute("VACUUM")
    conn.isolation_level = ""


def sample_history(conn: sqlite3.Connection) -> list[dict]:
    log("Sample: callsign_history WHERE callsign='W1AW' LIMIT 20")
    cur = conn.execute(
        "SELECT callsign, year, edition, name, city, state, license_class "
        "FROM callsign_history WHERE callsign = 'W1AW' LIMIT 20"
    )
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return rows


def main() -> int:
    if not os.path.exists(DB_PATH):
        log(f"ERROR: DB not found at {DB_PATH}")
        return 1

    log(f"DB size before: {file_mb(DB_PATH)} MB")
    conn = sqlite3.connect(DB_PATH)

    # Pragmas tuned for a one-shot heavy build.
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous  = NORMAL;
        PRAGMA temp_store   = MEMORY;
        PRAGMA cache_size   = -2000000;   -- ~2 GB page cache
        PRAGMA mmap_size    = 30000000000;
        """
    )

    step_fts5(conn)
    step_callsign_history(conn)
    step_previous_holders(conn)
    step_geocode_cache(conn)
    step_stats_per_year(conn)
    step_analyze_vacuum(conn)

    sample = sample_history(conn)

    # Probe object existence so the caller can assert.
    def has_obj(name: str, kind: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type=? AND name=?", (kind, name)
        ).fetchone()
        return row is not None

    summary = {
        "fts5_built":                  has_obj("entries_fts", "table"),
        "callsign_history_view_built": has_obj("callsign_history", "view"),
        "previous_holders_view_built": has_obj("previous_holders", "view"),
        "geocode_cache_table_built":   has_obj("geocode_cache", "table"),
        "stats_view_built":            has_obj("stats_per_year", "table"),
        "db_size_mb_after":            file_mb(DB_PATH),
        "sample_callsign_history":     sample,
    }

    conn.close()
    print("RESULT_JSON_BEGIN")
    print(json.dumps(summary, indent=2))
    print("RESULT_JSON_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
