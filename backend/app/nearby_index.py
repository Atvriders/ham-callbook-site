"""Lazy "latest location per callsign" index powering ``GET /api/nearby``.

The main callbook DB has 9.26M rows spanning 1909-2003; a callsign can
appear in dozens of editions at many addresses. For "who is near me" we
only care about each callsign's LATEST location that carries a usable
5-digit ZIP (the ZIP must exist in the bundled ZCTA centroid set so we
can geocode it). That reduction — one scan of ``entries`` joined against
the 33,791 ZCTA centroids, keeping the max-year row per callsign — yields
~1.23M rows and takes ~30s, so we:

* build it **lazily** in a background thread on the first ``/api/nearby``
  request (the route answers ``{"building": true}`` meanwhile);
* persist it as a small standalone SQLite file at ``NEARBY_INDEX_PATH``
  (default ``/tmp/nearby_index.sqlite``) so restarts adopt it instantly;
* stamp it with the main DB's ``COUNT(entries)`` as a **version** — a new
  data release changes the count, which invalidates the stamp and
  triggers a transparent rebuild.

Geometry
--------

Distance queries do a **bounding-box prefilter** on the indexed
``(lat, lon)`` columns (cheap B-tree range scan), then exact
**haversine** on the survivors. Latitude degrees are ~69 mi everywhere;
longitude degrees shrink by cos(lat), which the box accounts for — so
Alaska (lat ~61-71) gets a proportionally wider box and Hawaii behaves
like the mainland. No wraparound handling is attempted (the ZCTA set has
no ZIPs across the antimeridian), and the final haversine is exact
regardless of the box.

Index schema
------------

``ops(callsign PK, name, city, state, zip, year, lat, lon)`` — one row
per callsign, its latest ZIP-bearing location, geocoded.
``zips(zip PK, lat, lon)`` — the ZCTA centroid set (kept for debugging).
``meta(key PK, value)`` — ``version`` / ``built_at`` / ``ops_count`` /
``build_duration_s``.

Indexes: ``ops(lat, lon)`` for the bounding box; ``ops(city COLLATE
NOCASE, state)`` for "Boulder, CO"-style geocoding from the corpus
itself; ``ops(zip)`` for diagnostics.

The "latest row wins" reduction leans on SQLite's documented bare-column
behaviour: in an aggregate query that uses ``MAX(year)``, bare columns
(name/city/state/zip and the joined lat/lon) are taken from the row that
supplied the max — exactly the semantics we want, in one pass, without
materializing 1.2M Python tuples.
"""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import sqlite3
import statistics
import threading
import time
from typing import Any, Final, Optional

from app.db import DB_PATH

logger = logging.getLogger("callbook.backend.nearby")


# --------------------------------------------------------------------------- #
# Paths & constants                                                           #
# --------------------------------------------------------------------------- #

#: Where the built index lives. On a container this should point at a
#: writable volume (it is a derived artifact — safe to delete any time).
NEARBY_INDEX_PATH: Final[str] = os.environ.get(
    "NEARBY_INDEX_PATH", "/tmp/nearby_index.sqlite"
)

#: Bundled ZCTA centroid set: {"12345": [lat, lon], ...} — 33,791 ZCTAs.
ZCTA_CENTROIDS_PATH: Final[str] = os.path.join(
    os.path.dirname(__file__), "static", "zcta_centroids.json.gz"
)

#: Mean Earth radius in statute miles (IUGG R1).
EARTH_RADIUS_MI: Final[float] = 3958.7613

#: Miles per degree of latitude (near-constant) — bounding-box math.
_MI_PER_DEG_LAT: Final[float] = 69.0
#: Miles per degree of longitude at the equator; scaled by cos(lat).
_MI_PER_DEG_LON_EQ: Final[float] = 69.172

#: Build-time estimate used for the ``eta_s`` field while the background
#: build runs. Measured ~30s on the dev box; padded for slower disks.
_EST_BUILD_S: Final[int] = 45

#: After a failed build, wait this long before a request may retry it
#: (prevents a hot retry loop hammering a broken disk every request).
_FAILED_RETRY_COOLDOWN_S: Final[float] = 60.0


# --------------------------------------------------------------------------- #
# ZCTA centroids (lazy, tiny)                                                 #
# --------------------------------------------------------------------------- #

_CENTROIDS: Optional[dict[str, tuple[float, float]]] = None
_CENTROIDS_LOCK = threading.Lock()


def centroids() -> dict[str, tuple[float, float]]:
    """Return the ZCTA centroid map, loading it once per process (~30ms)."""
    global _CENTROIDS
    if _CENTROIDS is not None:
        return _CENTROIDS
    with _CENTROIDS_LOCK:
        if _CENTROIDS is not None:
            return _CENTROIDS
        with gzip.open(ZCTA_CENTROIDS_PATH, "rt", encoding="utf-8") as fh:
            raw = json.load(fh)
        _CENTROIDS = {
            z: (float(ll[0]), float(ll[1]))
            for z, ll in raw.items()
            if isinstance(ll, (list, tuple)) and len(ll) == 2
        }
        logger.info("ZCTA centroids loaded :: %d ZIPs", len(_CENTROIDS))
        return _CENTROIDS


# --------------------------------------------------------------------------- #
# Geometry                                                                    #
# --------------------------------------------------------------------------- #


def haversine_mi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in statute miles (exact for our purposes)."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = rlat2 - rlat1
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(a)))


def _bounding_box(
    lat: float, lon: float, radius_mi: float
) -> tuple[float, float, float, float]:
    """Return ``(lat_lo, lat_hi, lon_lo, lon_hi)`` enclosing the circle.

    The longitude span widens by 1/cos(lat) so high latitudes (Alaska)
    are not under-covered; ``cos`` is clamped away from zero to stay
    finite near the poles (no ZCTA is anywhere close, but be safe).
    """
    dlat = radius_mi / _MI_PER_DEG_LAT
    cos_lat = max(math.cos(math.radians(lat)), 0.01)
    dlon = radius_mi / (_MI_PER_DEG_LON_EQ * cos_lat)
    return (lat - dlat, lat + dlat, lon - dlon, lon + dlon)


# --------------------------------------------------------------------------- #
# Build helpers                                                               #
# --------------------------------------------------------------------------- #


def _attach_source(conn: sqlite3.Connection, db_path: str) -> None:
    """ATTACH the main callbook DB read-only, with the same immutable
    fallback :mod:`app.db` uses for WAL-on-read-only-mount setups."""
    try:
        conn.execute(
            "ATTACH DATABASE ? AS src", (f"file:{db_path}?mode=ro",)
        )
        conn.execute("SELECT 1 FROM src.sqlite_master LIMIT 1")
    except sqlite3.OperationalError as exc:
        msg = str(exc).lower()
        if "readonly" not in msg and "unable to open" not in msg:
            raise
        try:
            conn.execute("DETACH DATABASE src")
        except sqlite3.OperationalError:
            pass
        conn.execute(
            "ATTACH DATABASE ? AS src",
            (f"file:{db_path}?mode=ro&immutable=1",),
        )


def _build_index_file(tmp_path: str, version: int) -> dict[str, Any]:
    """Build the index into ``tmp_path`` (a fresh file). Returns stats.

    Runs entirely on a private connection — never touches the shared
    request-serving connection. One aggregate pass over ``entries``:

    * ``zip GLOB '[0-9]{5}*'`` keeps 5-digit and ZIP+4 forms, drops OCR
      fragments ("4371", letters, etc.);
    * the JOIN against ``zips`` (the centroid set) is the validity gate —
      a ZIP we cannot geocode contributes nothing;
    * ``GROUP BY callsign`` + ``MAX(year)`` keeps the latest such row.
    """
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    t0 = time.perf_counter()
    # Autocommit (isolation_level=None): the implicit transaction Python's
    # sqlite3 would otherwise open around INSERTs must not be alive when we
    # DETACH the source DB ("database src is locked" otherwise), and a
    # derived artifact needs no atomicity — we build to a temp file and
    # os.replace() it into place.
    conn = sqlite3.connect(f"file:{tmp_path}", uri=True, isolation_level=None)
    try:
        conn.executescript(
            """
            PRAGMA journal_mode = OFF;
            PRAGMA synchronous = OFF;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -262144;  -- 256 MiB for the GROUP BY sort
            CREATE TABLE zips (
                zip TEXT PRIMARY KEY,
                lat REAL NOT NULL,
                lon REAL NOT NULL
            ) WITHOUT ROWID;
            """
        )
        conn.executemany(
            "INSERT INTO zips (zip, lat, lon) VALUES (?, ?, ?)",
            ((z, ll[0], ll[1]) for z, ll in centroids().items()),
        )

        _attach_source(conn, DB_PATH)
        conn.execute(
            """
            CREATE TABLE ops AS
            SELECT e.callsign            AS callsign,
                   e.name                AS name,
                   e.city                AS city,
                   e.state               AS state,
                   substr(e.zip, 1, 5)   AS zip,
                   MAX(e.year)           AS year,
                   z.lat                 AS lat,
                   z.lon                 AS lon
            FROM   src.entries e
            JOIN   zips z ON z.zip = substr(e.zip, 1, 5)
            WHERE  e.callsign IS NOT NULL AND e.callsign != ''
              AND  e.zip GLOB '[0-9][0-9][0-9][0-9][0-9]*'
            GROUP  BY e.callsign
            """
        )
        conn.execute("DETACH DATABASE src")

        conn.execute("CREATE INDEX idx_ops_lat_lon ON ops(lat, lon)")
        conn.execute(
            "CREATE INDEX idx_ops_city ON ops(city COLLATE NOCASE, state)"
        )
        conn.execute("CREATE INDEX idx_ops_zip ON ops(zip)")

        ops_count = int(conn.execute("SELECT COUNT(*) FROM ops").fetchone()[0])
        duration = time.perf_counter() - t0
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [
                ("version", str(int(version))),
                ("built_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
                ("ops_count", str(ops_count)),
                ("build_duration_s", f"{duration:.1f}"),
            ],
        )
        conn.commit()
        return {"ops_count": ops_count, "build_duration_s": duration}
    finally:
        conn.close()


def _open_index_ro(path: str) -> sqlite3.Connection:
    """Open the built index read-only, shared across request threads."""
    conn = sqlite3.connect(
        f"file:{path}?mode=ro",
        uri=True,
        check_same_thread=False,
        isolation_level=None,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA mmap_size = 268435456")
    conn.execute("PRAGMA cache_size = -32768")
    return conn


def _read_meta(conn: sqlite3.Connection) -> dict[str, str]:
    try:
        return {
            r["key"]: r["value"]
            for r in conn.execute("SELECT key, value FROM meta")
        }
    except sqlite3.OperationalError:
        return {}


# --------------------------------------------------------------------------- #
# The lazy index                                                              #
# --------------------------------------------------------------------------- #


class NearbyIndex:
    """Thread-safe lazy builder + query interface for the ops index.

    States: ``idle`` → (adopt | ``building``) → ``ready`` | ``failed``.
    ``ensure()`` is non-blocking: it either adopts a valid on-disk file
    (fast restart), kicks off the background build, or reports progress.
    """

    def __init__(self, path: str = NEARBY_INDEX_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._status: str = "idle"  # idle | building | ready | failed
        self._conn: Optional[sqlite3.Connection] = None
        self._version: Optional[int] = None
        self._build_started_at: Optional[float] = None
        self._failed_at: Optional[float] = None
        self._last_error: Optional[str] = None
        self._build_stats: dict[str, Any] = {}

    # ----- lifecycle --------------------------------------------------------

    @property
    def status(self) -> str:
        return self._status

    def ensure(self, version: int) -> bool:
        """Make sure the index exists for ``version``; never blocks.

        Returns ``True`` when the index is ready to query. ``False``
        means a build is in flight (or recently failed) — the caller
        should answer with the "building" payload (or 503 on failure).
        """
        if self._status == "ready":  # lock-free fast path (bool read is atomic)
            return True
        with self._lock:
            if self._status == "ready":
                return True
            if self._status == "building":
                return False
            if self._status == "failed":
                if (
                    self._failed_at is not None
                    and time.monotonic() - self._failed_at
                    < _FAILED_RETRY_COOLDOWN_S
                ):
                    return False
                self._status = "idle"  # cooldown over — allow a retry

            # idle: try adopting an existing file before rebuilding.
            if self._try_adopt_locked(version):
                return True

            self._status = "building"
            self._build_started_at = time.monotonic()
            t = threading.Thread(
                target=self._build_in_background,
                args=(version,),
                name="nearby-index-build",
                daemon=True,
            )
            t.start()
            return False

    def _try_adopt_locked(self, version: int) -> bool:
        """Adopt ``self._path`` if present and version-stamped for this DB."""
        if not os.path.exists(self._path):
            return False
        try:
            conn = _open_index_ro(self._path)
        except sqlite3.Error:
            logger.warning(
                "Nearby index at %s unreadable — will rebuild.", self._path
            )
            return False
        meta = _read_meta(conn)
        if meta.get("version") != str(int(version)):
            logger.info(
                "Nearby index version stamp %r != current entries count %d — rebuilding.",
                meta.get("version"),
                version,
            )
            conn.close()
            return False
        self._conn = conn
        self._version = version
        self._build_stats = {
            "ops_count": int(meta.get("ops_count", "0")),
            "build_duration_s": float(meta.get("build_duration_s", "0") or 0),
            "adopted": True,
        }
        self._status = "ready"
        logger.info(
            "Adopted existing nearby index :: ops=%s, built_at=%s",
            meta.get("ops_count"),
            meta.get("built_at"),
        )
        return True

    def _build_in_background(self, version: int) -> None:
        """Thread target: build to a temp file, atomically move into place."""
        tmp_path = f"{self._path}.build.{os.getpid()}"
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            stats = _build_index_file(tmp_path, version)
            os.replace(tmp_path, self._path)
            conn = _open_index_ro(self._path)
            with self._lock:
                self._conn = conn
                self._version = version
                self._build_stats = stats
                self._status = "ready"
                self._failed_at = None
                self._last_error = None
            logger.info(
                "Nearby index built :: ops=%d, duration=%.1fs, path=%s",
                stats["ops_count"],
                stats["build_duration_s"],
                self._path,
            )
        except Exception as exc:  # pragma: no cover - disk/DB failures
            logger.exception("Nearby index build failed")
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
            with self._lock:
                self._status = "failed"
                self._failed_at = time.monotonic()
                self._last_error = str(exc)

    def eta_s(self) -> int:
        """Rough seconds remaining on the in-flight build (for polling UIs)."""
        if self._status != "building" or self._build_started_at is None:
            return 0
        elapsed = time.monotonic() - self._build_started_at
        return max(2, int(round(_EST_BUILD_S - elapsed)))

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def stats(self) -> dict[str, Any]:
        """Diagnostics (not part of the /api/nearby contract)."""
        return {
            "status": self._status,
            "path": self._path,
            "version": self._version,
            **self._build_stats,
        }

    # ----- queries (only valid when status == "ready") ----------------------

    def _require_conn(self) -> sqlite3.Connection:
        conn = self._conn
        if conn is None:  # pragma: no cover - guarded by route logic
            raise RuntimeError("nearby index queried before it was ready")
        return conn

    def candidates_within(
        self, lat: float, lon: float, radius_mi: float
    ) -> list[tuple[float, sqlite3.Row]]:
        """All ops within ``radius_mi`` of (lat, lon), nearest first.

        Bounding-box prefilter on the (lat, lon) index, then exact
        haversine; ties broken by callsign for deterministic paging.
        """
        lat_lo, lat_hi, lon_lo, lon_hi = _bounding_box(lat, lon, radius_mi)
        rows = self._require_conn().execute(
            """
            SELECT callsign, name, city, state, zip, year, lat, lon
            FROM   ops
            WHERE  lat BETWEEN ? AND ?
              AND  lon BETWEEN ? AND ?
            """,
            (lat_lo, lat_hi, lon_lo, lon_hi),
        ).fetchall()
        out: list[tuple[float, sqlite3.Row]] = []
        for r in rows:
            d = haversine_mi(lat, lon, r["lat"], r["lon"])
            if d <= radius_mi:
                out.append((d, r))
        out.sort(key=lambda t: (t[0], t[1]["callsign"]))
        return out

    def city_centroid(
        self, city: str, state: Optional[str] = None
    ) -> Optional[tuple[float, float, str]]:
        """Geocode a city from the index's own rows.

        Returns ``(lat, lon, state)`` — the median of the city's distinct
        ZIP centroids (median resists OCR outliers better than mean).
        With no state given, the state where that city name has the most
        licensed hams wins (matched_by="city" in the API). ``None`` when
        the corpus has never seen the city.
        """
        conn = self._require_conn()
        if state is None:
            best = conn.execute(
                """
                SELECT state, COUNT(*) AS n
                FROM   ops
                WHERE  city = ? COLLATE NOCASE AND state IS NOT NULL
                GROUP  BY state
                ORDER  BY n DESC
                LIMIT  1
                """,
                (city,),
            ).fetchone()
            if best is None:
                return None
            state = str(best["state"])
        rows = conn.execute(
            """
            SELECT DISTINCT zip, lat, lon
            FROM   ops
            WHERE  city = ? COLLATE NOCASE AND state = ?
            """,
            (city, state),
        ).fetchall()
        if not rows:
            return None
        lat = statistics.median(r["lat"] for r in rows)
        lon = statistics.median(r["lon"] for r in rows)
        return (float(lat), float(lon), state)


#: Process-wide singleton used by the /api/nearby route.
INDEX: NearbyIndex = NearbyIndex()


__all__ = [
    "EARTH_RADIUS_MI",
    "INDEX",
    "NEARBY_INDEX_PATH",
    "NearbyIndex",
    "ZCTA_CENTROIDS_PATH",
    "centroids",
    "haversine_mi",
]
