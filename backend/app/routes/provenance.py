"""Provenance routes — 'See the Source' v1.

Every historic record has a raw_ocr line parsed from a scanned PDF.
These endpoints surface:

  1. The raw_ocr line, as-OCR'd.
  2. The source edition name and a link to the scanned PDF (name only;
     the PDF binary is not served here — it lives in the callbooks dir).
  3. A best-effort page estimate: grep the callsign across the per-page
     ocr_v2/{stem}.NNNN.txt files and return the first hit.
  4. An on-demand rendered PNG of that page via pdftoppm, served at
     /api/provenance/page_image/{stem}/{page}.

Routes (prefix /api/provenance)
--------------------------------
GET /api/provenance/{cs}/{year}/{edition}
    Returns ProvenanceDetail for one (callsign, year, edition) triple.
    Never 404 for a valid callsign — missing fields are null and the UI
    degrades gracefully.

GET /api/provenance/page_image/{stem}/{page}
    Serve the cached (or freshly rendered) page PNG as image/png.
    Renders on first request; subsequent requests hit the cache.
    Returns 404 if the PDF is unavailable or pdftoppm fails.

HONEST SCOPE (repeated in API responses as 'page_note')
    Parser concatenated OCR pages; exact record→(page, bbox) does NOT
    exist.  Page numbers here are estimated by callsign-token match
    across per-page OCR text.  They are usually correct to ±1 page for
    single-district editions and may be off by a few pages for merged
    multi-district scans.
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
from typing import Final

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.db import get_db
from app.integrations import provenance as _prov

logger = logging.getLogger("callbook.backend.provenance")

router = APIRouter(prefix="/api/provenance", tags=["provenance"])

# --------------------------------------------------------------------------- #
# Validation                                                                   #
# --------------------------------------------------------------------------- #

_CS_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Z0-9/]{1,12}$")
# Allow alphanumeric + common punctuation in stem/edition names.
_STEM_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")

_PAGE_NOTE: Final[str] = (
    "Page estimated by callsign match across per-page OCR text. "
    "Exact page/position is not recorded — the original parser concatenated pages."
)


def _validate_cs(cs: str) -> str:
    upper = cs.strip().upper()
    if not upper or not _CS_RE.match(upper):
        raise HTTPException(status_code=400, detail=f"invalid callsign: {cs!r}")
    return upper


def _validate_stem(stem: str) -> str:
    if not stem or not _STEM_RE.match(stem):
        raise HTTPException(status_code=400, detail=f"invalid stem: {stem!r}")
    return stem


def _validate_page(page: int) -> int:
    if page < 1 or page > 9999:
        raise HTTPException(status_code=400, detail=f"page out of range: {page}")
    return page


# --------------------------------------------------------------------------- #
# Response models                                                              #
# --------------------------------------------------------------------------- #


class ProvenanceDetail(BaseModel):
    callsign: str
    year: int
    edition: str | None
    """Display label for the edition, e.g. 'Fall 1964'."""

    raw_ocr_line: str | None
    """The raw OCR text line as stored in the DB (may contain noise)."""

    has_ocr_pages: bool
    """True when per-page ocr_v2 files exist for this edition."""

    estimated_page: int | None
    """1-based page number estimated by callsign grep, or null."""

    page_image_url: str | None
    """URL path for the rendered page PNG, or null if unavailable."""

    page_note: str
    """Honest scope caveat — always present."""

    pdf_name: str | None
    """PDF filename (no extension) from the callbooks collection, or null."""

    edition_label: str
    """Human-readable edition label, e.g. 'Summer 1927 Radio Amateur Callbook'."""


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #


def _edition_label(year: int, edition: str | None, pdf_basename: str | None) -> str:
    """Build a friendly edition label for display."""
    if pdf_basename:
        # e.g. "Summer_1927_Radio_Amateur_Callbook" -> "Summer 1927 Radio Amateur Callbook"
        return pdf_basename.replace("_", " ").replace("-", " ").strip()
    if edition:
        return f"{edition} {year}"
    return str(year)


# --------------------------------------------------------------------------- #
# Endpoints                                                                    #
# --------------------------------------------------------------------------- #


@router.get("/{cs}/{year}/{edition}", response_model=ProvenanceDetail)
def get_provenance(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    year: int = PathParam(..., ge=1900, le=2100),
    edition: str = PathParam(..., description="Edition name, e.g. 'Summer'."),
    db: sqlite3.Connection = Depends(get_db),
) -> ProvenanceDetail:
    """Return provenance data for one (callsign, year, edition) record.

    Never raises 404 for a valid callsign shape — missing fields degrade to
    null.  Use the returned ``page_note`` to communicate estimation honesty.
    """
    callsign = _validate_cs(cs)

    # ---------- 1. Fetch raw_ocr from DB -----------------------------------
    row = db.execute(
        """
        SELECT raw_ocr
        FROM   entries
        WHERE  callsign = ?
          AND  year     = ?
          AND  edition  = ?
        LIMIT  1
        """,
        (callsign, year, edition),
    ).fetchone()

    raw_ocr: str | None = None
    if row:
        raw_ocr = (row["raw_ocr"] or "").strip() or None

    # ---------- 2. Resolve edition -> stem + PDF ---------------------------
    ocr_stem, pdf_basename = _prov.edition_stem_for(year, edition)
    has_ocr_pages = ocr_stem is not None
    label = _edition_label(year, edition, pdf_basename)

    # ---------- 3. Find estimated page (only when ocr_v2 files exist) ------
    estimated_page: int | None = None
    img_url: str | None = None

    if ocr_stem is not None:
        try:
            estimated_page = _prov.find_page_for_callsign(ocr_stem, callsign)
        except Exception:
            logger.exception(
                "Page grep failed for stem=%s cs=%s", ocr_stem, callsign
            )

    # ---------- 4. Trigger page render if page found + PDF available -------
    if estimated_page is not None and pdf_basename is not None:
        pdf_path = _prov.pdf_path_for(pdf_basename)
        cached = _prov.ensure_page_cached(ocr_stem, estimated_page, pdf_path)  # type: ignore[arg-type]
        if cached:
            img_url = _prov.page_image_url(ocr_stem, estimated_page)  # type: ignore[arg-type]

    return ProvenanceDetail(
        callsign=callsign,
        year=year,
        edition=edition,
        raw_ocr_line=raw_ocr,
        has_ocr_pages=has_ocr_pages,
        estimated_page=estimated_page,
        page_image_url=img_url,
        page_note=_PAGE_NOTE,
        pdf_name=pdf_basename,
        edition_label=label,
    )


@router.get("/page_image/{stem}/{page}", include_in_schema=True)
def serve_page_image(
    stem: str = PathParam(..., description="OCR v2 stem, e.g. '1927_Summer'."),
    page: int = PathParam(..., ge=1, le=9999, description="1-based page number."),
) -> FileResponse:
    """Serve the cached (or freshly rendered) page PNG.

    Renders the page on first request by shelling out to pdftoppm.
    Subsequent requests return the cached file.  Returns 404 if the PDF
    is not in the collection or pdftoppm fails.

    Note: the PNG is served directly as image/png so the frontend can
    embed it in an <img> tag without a proxy fetch.
    """
    stem = _validate_stem(stem)
    page = _validate_page(page)

    out_path = _prov.cached_png_path(stem, page)

    # Already cached — serve immediately without looking up the PDF.
    if os.path.isfile(out_path):
        return FileResponse(out_path, media_type="image/png")

    # Need to render.  Resolve edition from stem.
    # stem format: "YYYY_Edition" e.g. "1927_Summer"
    parts = stem.split("_", 1)
    year_int: int | None = None
    edition_str: str | None = None
    if len(parts) == 2 and parts[0].isdigit():
        year_int = int(parts[0])
        edition_str = parts[1]

    if year_int is None or edition_str is None:
        raise HTTPException(
            status_code=404,
            detail=f"Cannot resolve PDF for stem {stem!r}",
        )

    _, pdf_basename = _prov.edition_stem_for(year_int, edition_str)
    if pdf_basename is None:
        raise HTTPException(
            status_code=404,
            detail=f"No PDF mapped for stem {stem!r}",
        )

    pdf_path = _prov.pdf_path_for(pdf_basename)
    cached = _prov.ensure_page_cached(stem, page, pdf_path)
    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=f"Page render failed for {stem!r} page {page}",
        )
    return FileResponse(cached, media_type="image/png")


__all__ = ["router"]
