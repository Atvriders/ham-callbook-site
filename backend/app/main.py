"""FastAPI application entry point for the USA Ham Callbook Archive.

Responsibilities:

* Open the shared read-only SQLite connection at startup, close it at
  shutdown, and warm the ``entries`` row-count cache used by ``/health``.
* Wire up CORS (so the Next.js frontend container can call ``/api/*``
  in dev) and gzip compression (search responses can be sizeable).
* Mount the nine routers that make up the public API:

  - ``/search``    full-text search across ~7.74M rows via FTS5
  - ``/callsign``  per-callsign history (uses the ``callsign_history`` view)
  - ``/year``      browse a single edition / year
  - ``/state``     browse by state
  - ``/stats``     dataset-wide statistics
  - ``/activity``  live FCC ULS / PSK Reporter / RBN lookups
  - ``/random``    random entry (the "spin the dial" feature)
  - ``/health``    liveness + DB sanity
  - ``/browse``    paginated entry browsing

The OpenAPI docs are served at ``/docs`` and ``/redoc``; the JSON schema
at ``/openapi.json``. The frontend container does not consume these but
they are invaluable during development.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.db import (
    DB_PATH,
    compute_entry_count,
    open_connection,
    set_app_conn,
)
from app.routes import (
    activity,
    browse,
    callsign,
    health,
    random as random_route,
    search,
    state,
    stats,
    year,
)
from app.routes import clubs as clubs_router
from app.routes import club as club_router
from app.routes import callsign_club as callsign_club_router
from app.routes import records as records_router
from app.routes import diff as diff_router
from app.routes import qsl as qsl_router
from app.routes import data_portal as data_portal_router

logger = logging.getLogger("callbook.backend")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-5s %(name)s :: %(message)s",
)


# --------------------------------------------------------------------------- #
# Lifespan
# --------------------------------------------------------------------------- #

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open the shared SQLite connection and warm caches at startup.

    We deliberately keep a single long-lived connection per worker. Two
    workers × one connection each is enough for SQLite's serialized
    read-only access pattern, and avoids the ~5ms cost of opening + page
    cache warm-up on every request.
    """
    logger.info(
        "Opening SQLite read-only connection at %s (version=%s)",
        DB_PATH,
        __version__,
    )
    conn = open_connection(DB_PATH)
    set_app_conn(conn)

    # Warm the entry-count cache up front so /health is instant from the
    # first request. Also doubles as a smoke test that the DB schema is
    # what we expect.
    try:
        n = compute_entry_count(conn)
        logger.info("DB opened OK :: entries=%s", f"{n:,}")
    except Exception:  # pragma: no cover - startup diagnostic
        logger.exception("Failed to query entries count at startup")
        raise

    try:
        yield
    finally:
        logger.info("Closing SQLite connection")
        try:
            conn.close()
        except Exception:  # pragma: no cover - shutdown best-effort
            logger.exception("Error while closing SQLite connection")


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="USA Ham Callbook Archive API",
    description=(
        "Searchable archive of ~7.74 million U.S. amateur radio license "
        "records across 99 published callbook editions (1909-1997 + 2003). "
        "Backed by SQLite + FTS5; live mode also queries FCC ULS, PSK "
        "Reporter, and the Reverse Beacon Network."
    ),
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# --------------------------------------------------------------------------- #
# Middleware
# --------------------------------------------------------------------------- #

# CORS — in production Caddy fronts both the frontend and the API on the
# same origin so CORS is unused. In dev, the Next.js container hits the
# backend directly at http://localhost:8000, and we may also want to allow
# the bare container hostname for server-side fetches.
_default_origins = ",".join(
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://frontend:3000",
        "http://localhost",
        "http://127.0.0.1",
    ]
)
_origins_env = os.environ.get("CORS_ORIGINS", _default_origins)
_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,  # API is unauthenticated; no cookies in play.
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Query-Time-Ms"],
    max_age=600,
)

# GZip — search results and browse pages can be tens of KB of JSON; gzip
# typically cuts that 6-8x. ``minimum_size`` skips tiny payloads where
# the gzip header would be net-negative.
app.add_middleware(GZipMiddleware, minimum_size=1024)


# --------------------------------------------------------------------------- #
# Routers
# --------------------------------------------------------------------------- #

# Each router declares its own ``/api/...`` prefix internally so paths
# resolve correctly under both Caddy (which preserves ``/api/*`` when
# reverse-proxying) and the Next.js dev rewrite (which forwards
# ``/api/*`` → ``http://localhost:8000/api/*`` verbatim).
# Do NOT pass ``prefix=`` here — it would double-up the ``/api`` segment.
# Order matters only for OpenAPI grouping; FastAPI matches by path.
app.include_router(health.router, tags=["meta"])
app.include_router(search.router, tags=["search"])
app.include_router(callsign.router, tags=["callsign"])
app.include_router(year.router, tags=["browse"])
app.include_router(state.router, tags=["browse"])
app.include_router(browse.router, tags=["browse"])
app.include_router(stats.router, tags=["stats"])
app.include_router(activity.router, tags=["activity"])
app.include_router(random_route.router, tags=["fun"])
app.include_router(clubs_router.router)
app.include_router(club_router.router)
app.include_router(callsign_club_router.router)
app.include_router(records_router.router, tags=["records"])
app.include_router(diff_router.router, tags=["diff"])
app.include_router(qsl_router.router, tags=["qsl"])
app.include_router(data_portal_router.router, tags=["data-portal"])


# --------------------------------------------------------------------------- #
# Root
# --------------------------------------------------------------------------- #

@app.get("/", include_in_schema=False)
def root() -> JSONResponse:
    """Tiny root payload so an accidental hit on ``/`` doesn't 404.

    The real UI lives behind Caddy at ``/``; this only fires if someone
    pokes the backend container directly.
    """
    return JSONResponse(
        {
            "service": "usa-ham-callbook-archive",
            "version": __version__,
            "docs": "/docs",
            "health": "/health",
        }
    )
