"""Open Data Portal routes.

Endpoints
---------

GET /api/data/manifest
    Full MANIFEST.json payload: metadata + file listing.

GET /api/data/files
    File listing with optional ?year=1994&label=Winter filters.

GET /api/data/files/{filename}
    Metadata for a specific CSV file (no binary download — see serving note).

GET /api/data/download/{filename}
    Redirect to the static file served by Caddy (or FastAPI FileResponse
    in dev). Uses ``DATA_PORTAL_DOWNLOADS_PATH`` env var (defaults to
    /data/downloads).

GET /api/data/meta
    Integration cache stats (loaded, file_count, generated timestamp).

Download serving strategy
--------------------------

In production, Caddy can serve /data/downloads/ as a static directory by
adding a ``handle /downloads/*`` block — see wiring instructions.  The
``/api/data/download/{filename}`` endpoint falls back to a FastAPI
``FileResponse`` so bare-metal / dev environments work without Caddy.

When ``DATA_PORTAL_STATIC_REDIRECT`` env var is set to a URL prefix
(e.g. ``/downloads``), the endpoint issues a 302 to that prefix instead
of serving the file directly — zero read bandwidth through FastAPI.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

from app.integrations import data_portal as dp

router = APIRouter(prefix="/api/data", tags=["data-portal"])

# Where physical CSVs live inside the container / on-host dev.
_DOWNLOADS_DIR = Path(
    os.environ.get("DATA_PORTAL_DOWNLOADS_PATH", "/data/downloads")
)

# If set, download requests redirect to this static prefix instead of
# being served by FastAPI. E.g. "/downloads" → /downloads/1994_Winter.csv
_STATIC_REDIRECT_PREFIX: str | None = os.environ.get("DATA_PORTAL_STATIC_REDIRECT")

# Upstream fallback for bare-metal dev (no container volume).
_DOWNLOADS_UPSTREAM = Path(
    os.environ.get(
        "DATA_PORTAL_DOWNLOADS_UPSTREAM_PATH",
        "/home/kasm-user/ham-callbook-site/data/downloads",
    )
)


def _resolve_downloads_dir() -> Path:
    if _DOWNLOADS_DIR.exists():
        return _DOWNLOADS_DIR
    if _DOWNLOADS_UPSTREAM.exists():
        return _DOWNLOADS_UPSTREAM
    return _DOWNLOADS_DIR  # will 404 in the endpoint if file missing


def _validate_filename(filename: str) -> None:
    """Raise 400 if filename looks like a path-traversal attempt."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename",
        )
    if not filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .csv files are available for download",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/manifest", summary="Full data release manifest")
def get_manifest() -> JSONResponse:
    """Return the full MANIFEST.json payload."""
    manifest = dp.get_manifest()
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "manifest_not_loaded"},
        )
    return JSONResponse(manifest)


@router.get("/files", summary="List available CSV downloads")
def list_files(
    year: int | None = Query(None, description="Filter by edition year"),
    label: str | None = Query(None, description="Filter by edition label (e.g. Winter)"),
) -> JSONResponse:
    """Return the list of available per-edition CSV files."""
    files = dp.list_files(year=year, label=label)
    manifest = dp.get_manifest()
    return JSONResponse({
        "total": len(files),
        "dataset_version": manifest.get("dataset_version"),
        "columns": manifest.get("columns"),
        "license": manifest.get("license"),
        "files": files,
    })


@router.get("/files/{filename}", summary="Metadata for a single CSV file")
def get_file_meta(filename: str) -> JSONResponse:
    """Return metadata (size, sha256, row_count) for a named CSV file."""
    _validate_filename(filename)
    info = dp.get_file(filename)
    if info is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "file_not_found", "filename": filename},
        )
    return JSONResponse(info)


@router.get("/download/{filename}", summary="Download a CSV file")
def download_file(filename: str) -> Any:
    """Serve or redirect to the CSV download.

    If ``DATA_PORTAL_STATIC_REDIRECT`` is set, issues a 302 so Caddy
    (or another reverse-proxy) serves the bytes.  Otherwise streams via
    FastAPI ``FileResponse``.
    """
    _validate_filename(filename)

    # Verify the manifest knows about this file before serving.
    info = dp.get_file(filename)
    if info is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "file_not_in_manifest", "filename": filename},
        )

    if _STATIC_REDIRECT_PREFIX:
        redirect_url = f"{_STATIC_REDIRECT_PREFIX.rstrip('/')}/{filename}"
        return RedirectResponse(url=redirect_url, status_code=302)

    downloads_dir = _resolve_downloads_dir()
    file_path = downloads_dir / filename
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "file_missing_on_disk",
                "filename": filename,
                "looked_in": str(downloads_dir),
            },
        )

    return FileResponse(
        path=str(file_path),
        media_type="text/csv",
        filename=filename,
        headers={
            "X-Content-Sha256": info.get("sha256", ""),
            "X-Row-Count": str(info.get("row_count", "")),
        },
    )


@router.get("/meta", summary="Data portal integration stats")
def portal_meta() -> JSONResponse:
    """Return cache/integration health info."""
    return JSONResponse(dp.stats())
