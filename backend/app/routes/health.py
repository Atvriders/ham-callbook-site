"""Health and database-introspection routes.

Two endpoints are exposed under the ``/api/health`` prefix:

* ``GET /api/health`` — fast liveness probe. Returns ``ok``, the total entry
  count, the dataset schema version, and the Data-phase build timestamp.
  Suitable for Docker / Kubernetes / Caddy upstream health checks.

* ``GET /api/health/db`` — heavyweight database introspection. Lists every
  user table with its ``row_count`` (cached SQLite stats where available so
  the 7.74M-row ``entries`` table does not trigger a full scan), runs
  ``PRAGMA integrity_check``, and confirms the expected indexes from the
  Data-phase build script are present.

Both endpoints open a fresh read-only SQLite connection per request via the
``file:...?mode=ro`` URI. The Data phase guarantees the schema, but if the
DB or a critical table is missing we return ``503 Service Unavailable`` with
a structured error payload instead of leaking a traceback.
"""

from __future__ import annotations

import os
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# The Dockerfile sets ``DB_PATH=/data/USA_Ham_Callbooks.sqlite``. Falling back
# to the on-host path keeps ``uvicorn --reload`` development working without
# extra env wiring.
DB_PATH: str = os.environ.get(
    "DB_PATH",
    "/home/kasm-user/ham-callbook-site/data/USA_Ham_Callbooks.sqlite",
)

# Indexes the Data phase guarantees to exist. ``/api/health/db`` flips
# ``indexes_present`` to ``False`` if any one of these is missing — that is
# the canonical signal that the post-ingest build script has not been run
# against the mounted SQLite.
EXPECTED_INDEXES: tuple[str, ...] = (
    "idx_entries_callsign",
    "idx_entries_year",
    "idx_entries_state",
    "idx_entries_year_callsign",
    "idx_stats_year",
    "idx_geocode_state",
)

# Internal SQLite housekeeping tables we never want to surface in the
# ``tables`` array of ``/api/health/db``.
_HIDDEN_TABLE_PREFIXES: tuple[str, ...] = ("sqlite_",)


router = APIRouter(prefix="/api/health", tags=["health"])


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------


def _connect_ro() -> sqlite3.Connection:
    """Open a read-only SQLite connection.

    Using the URI form with ``mode=ro`` means the backend can never
    accidentally mutate the database, even if a future refactor forgets
    that the file is bind-mounted read-only by docker-compose.
    """
    if not os.path.exists(DB_PATH):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "ok": False,
                "error": "database_missing",
                "db_path": DB_PATH,
            },
        )

    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    # Plenty of cache for the introspection queries without hogging RAM
    # past the request lifetime (closed in the ``finally`` of each handler).
    conn.execute("PRAGMA query_only = ON")
    return conn


def _meta_map(conn: sqlite3.Connection) -> dict[str, str]:
    """Return ``dataset_meta`` as a plain dict, or ``{}`` if absent."""
    try:
        cur = conn.execute("SELECT key, value FROM dataset_meta")
    except sqlite3.OperationalError:
        return {}
    return {row["key"]: row["value"] for row in cur.fetchall()}


def _row_count(conn: sqlite3.Connection, table: str) -> int:
    """Cheap ``COUNT(*)`` that prefers the ANALYZE-populated ``sqlite_stat1``.

    The Data phase ends with ``ANALYZE``, so for tables that already have
    statistics we can return the estimate without scanning. We fall back to
    a real ``COUNT(*)`` for tables without stats (small lookup tables, FTS5
    shadow tables, etc.) so the value is always populated.
    """
    try:
        stat = conn.execute(
            "SELECT stat FROM sqlite_stat1 WHERE tbl = ? LIMIT 1",
            (table,),
        ).fetchone()
        if stat is not None and stat["stat"]:
            # sqlite_stat1.stat is a space-separated string; the first
            # token is the estimated row count for the table as a whole.
            head = str(stat["stat"]).split(" ", 1)[0]
            if head.isdigit():
                return int(head)
    except sqlite3.OperationalError:
        # sqlite_stat1 may not exist on a freshly-ingested DB.
        pass

    # Quoting via SQL is unsafe for identifiers, but ``table`` here is read
    # straight from ``sqlite_master`` — never user input — so it is safe to
    # interpolate after the same quoting SQLite itself accepts.
    safe = '"' + table.replace('"', '""') + '"'
    cur = conn.execute(f"SELECT COUNT(*) AS n FROM {safe}")
    return int(cur.fetchone()["n"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", summary="Liveness probe")
@router.get("/", include_in_schema=False)
def health() -> JSONResponse:
    """Lightweight liveness check: DB opens, ``dataset_meta`` is readable."""
    conn = _connect_ro()
    try:
        meta = _meta_map(conn)

        # Prefer the explicit count cached in ``dataset_meta`` (written by
        # the ingest pipeline); fall back to ``sqlite_stat1`` only if it is
        # missing, which keeps the endpoint sub-millisecond.
        db_entries: int | None = None
        if "total_entries" in meta and meta["total_entries"].isdigit():
            db_entries = int(meta["total_entries"])
        else:
            try:
                db_entries = _row_count(conn, "entries")
            except sqlite3.OperationalError:
                db_entries = None

        payload: dict[str, Any] = {
            "ok": True,
            "db_entries": db_entries,
            "schema_version": meta.get("schema_version"),
            "build_timestamp": meta.get("build_timestamp"),
        }
        return JSONResponse(payload)
    finally:
        conn.close()


@router.get("/db", summary="Database introspection")
def health_db() -> JSONResponse:
    """Deep DB health: per-table row counts, integrity check, index audit."""
    conn = _connect_ro()
    try:
        # ---- Tables ----------------------------------------------------
        master_rows = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' "
            "ORDER BY name"
        ).fetchall()

        tables: list[dict[str, Any]] = []
        for row in master_rows:
            name = row["name"]
            if any(name.startswith(p) for p in _HIDDEN_TABLE_PREFIXES):
                continue
            try:
                count = _row_count(conn, name)
            except sqlite3.OperationalError as exc:
                # Surface the problem instead of 500'ing the whole probe.
                tables.append(
                    {"name": name, "row_count": None, "error": str(exc)}
                )
                continue
            tables.append({"name": name, "row_count": count})

        # ---- Integrity check ------------------------------------------
        # ``integrity_check`` returns the literal string ``ok`` on success
        # or one row per problem otherwise. We return whichever shape we
        # see so operators can tell at a glance.
        integrity_rows = conn.execute(
            "PRAGMA integrity_check"
        ).fetchall()
        if len(integrity_rows) == 1:
            integrity_check: Any = integrity_rows[0][0]
        else:
            integrity_check = [r[0] for r in integrity_rows]

        # ---- Index audit ----------------------------------------------
        index_rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
        ).fetchall()
        present = {r["name"] for r in index_rows}
        missing = [ix for ix in EXPECTED_INDEXES if ix not in present]
        indexes_present = not missing

        payload: dict[str, Any] = {
            "tables": tables,
            "integrity_check": integrity_check,
            "indexes_present": indexes_present,
        }
        # Surface *which* expected indexes are missing — invaluable when
        # the Data phase has only been partially re-run.
        if missing:
            payload["missing_indexes"] = missing
        return JSONResponse(payload)
    finally:
        conn.close()
