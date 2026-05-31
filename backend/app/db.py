"""SQLite connection management.

The callbook database is a single 2.4 GB SQLite file that lives outside the
container and is bind-mounted read-only at ``/data/USA_Ham_Callbooks.sqlite``.
We never write to it at request time — the Data phase has already built
FTS5 indexes and the ``callsign_history`` view in place.

This module exposes:

* :func:`open_connection` — open a SQLite connection in read-only WAL mode
  with sensible PRAGMAs and ``sqlite3.Row`` as the row factory.
* :func:`get_conn` — a ``contextmanager`` that yields a short-lived
  connection. Used by background tasks and one-off scripts.
* :data:`APP_CONN` — the long-lived process-wide connection opened at
  application startup and shared across requests (SQLite connections are
  safe to share across threads when ``check_same_thread=False`` and we
  only issue read-only queries).
* :func:`get_db` — FastAPI dependency that returns :data:`APP_CONN`.
* :func:`cached_entry_count` — cheap ``COUNT(*)`` cached at startup for
  use by the ``/health`` endpoint.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Iterator, Optional

def _default_db_path() -> str:
    """Pick a sane default ``DB_PATH`` for the current runtime.

    In the container the DB is bind-mounted at ``/data/USA_Ham_Callbooks.sqlite``;
    in host-mode dev (``uvicorn app.main:app`` run from a checkout) ``/data``
    does not exist, so fall back to a project-relative
    ``<repo>/data/USA_Ham_Callbooks.sqlite`` so developers can run the backend
    without having to set the env var explicitly.
    """
    container_path = "/data/USA_Ham_Callbooks.sqlite"
    if os.path.exists(container_path):
        return container_path
    # backend/app/db.py -> backend/app -> backend -> <repo>
    repo_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    return os.path.join(repo_root, "data", "USA_Ham_Callbooks.sqlite")


DB_PATH: str = os.environ.get("DB_PATH") or _default_db_path()

# Process-wide shared read-only connection. Populated by ``main.py`` on
# FastAPI startup so we don't pay the open cost per request.
APP_CONN: Optional[sqlite3.Connection] = None

# Cached row count for /health. Computing COUNT(*) on a 7.74M-row table is
# fast on the indexed entries table (~50ms cold, sub-ms warm with mmap),
# but we still memoize it because /health may be polled aggressively by
# Caddy / Docker / uptime checks.
_ENTRY_COUNT: Optional[int] = None


def _build_uri(db_path: str) -> str:
    """Build a SQLite URI that opens the file read-only.

    Using the ``file:`` URI form lets us pass ``mode=ro`` which makes the
    OS-level open use ``O_RDONLY`` — this is what allows the bind mount to
    be mounted read-only without SQLite tripping on its journal file.
    """
    # ``immutable=1`` would be even faster (skips locking, skips WAL) but
    # we deliberately do NOT set it: the Data phase may rebuild the DB and
    # docker-compose restart should pick up the new file without us having
    # to also bounce mmap assumptions. ``mode=ro`` is the sweet spot.
    return f"file:{db_path}?mode=ro"


def open_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Open a fresh read-only SQLite connection with our standard pragmas.

    Why ``check_same_thread=False``: FastAPI runs handlers in a thread
    pool (for sync defs) and in the event loop (for async defs). SQLite
    connections are thread-safe for read-only workloads in serialized
    mode, which is Python's default build. Sharing one connection across
    request threads is the documented pattern for read-mostly SQLite
    services and avoids the open/close cost on the hot path.
    """
    conn = sqlite3.connect(
        _build_uri(db_path),
        uri=True,
        check_same_thread=False,
        isolation_level=None,  # autocommit; we only read.
        timeout=30.0,
    )
    conn.row_factory = sqlite3.Row

    # PRAGMAs that matter for a large read-only FTS5 workload:
    #   journal_mode=WAL ........ allows concurrent readers (even though we
    #                             are read-only, WAL respects the file's
    #                             existing mode if it was created WAL).
    #   query_only=ON ........... belt-and-braces: refuse any write.
    #   temp_store=MEMORY ....... sort/group scratch in RAM, not /tmp.
    #   mmap_size=1 GiB ......... mmap the hot pages; massive speedup for
    #                             FTS5 range scans on a 2.4 GB DB.
    #   cache_size=-65536 ....... 64 MiB page cache per connection (the
    #                             negative number is "kibibytes").
    #   synchronous=NORMAL ...... irrelevant for RO but quiets warnings.
    pragmas = (
        "PRAGMA query_only = ON;",
        "PRAGMA temp_store = MEMORY;",
        "PRAGMA mmap_size = 1073741824;",
        "PRAGMA cache_size = -65536;",
        "PRAGMA synchronous = NORMAL;",
        "PRAGMA foreign_keys = OFF;",
    )
    for stmt in pragmas:
        conn.execute(stmt)

    # journal_mode is a no-op on a RO connection but we set it for
    # parity with any future RW maintenance path.
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
    except sqlite3.OperationalError:
        # RO open with a missing -wal sidecar will refuse this; ignore.
        pass

    return conn


@contextmanager
def get_conn(db_path: str = DB_PATH) -> Iterator[sqlite3.Connection]:
    """Yield a short-lived SQLite connection.

    Prefer :func:`get_db` (the FastAPI dependency) inside request handlers.
    Use this contextmanager from CLI scripts, background tasks, or tests
    where you want guaranteed cleanup.
    """
    conn = open_connection(db_path)
    try:
        yield conn
    finally:
        conn.close()


def set_app_conn(conn: sqlite3.Connection) -> None:
    """Install the process-wide connection. Called from FastAPI startup."""
    global APP_CONN
    APP_CONN = conn


def get_db() -> sqlite3.Connection:
    """FastAPI dependency: return the shared read-only connection.

    Raises a clear error if the app didn't go through startup (e.g. a unit
    test that imports a router directly without lifespan).
    """
    if APP_CONN is None:  # pragma: no cover - defensive
        raise RuntimeError(
            "SQLite connection not initialized. The FastAPI lifespan hook "
            "in app.main must run before requests are served."
        )
    return APP_CONN


def compute_entry_count(conn: sqlite3.Connection) -> int:
    """Cheap COUNT(*) over the entries table, memoized.

    Cached for the life of the process — the DB is read-only, so the count
    cannot change without a container restart (which clears the cache).
    """
    global _ENTRY_COUNT
    if _ENTRY_COUNT is None:
        row = conn.execute("SELECT COUNT(*) AS n FROM entries").fetchone()
        _ENTRY_COUNT = int(row["n"]) if row is not None else 0
    return _ENTRY_COUNT


def cached_entry_count() -> int:
    """Return the cached entry count, computing it if necessary."""
    if _ENTRY_COUNT is not None:
        return _ENTRY_COUNT
    return compute_entry_count(get_db())


def reset_caches() -> None:
    """Forget any memoized state. Useful for tests."""
    global _ENTRY_COUNT
    _ENTRY_COUNT = None
