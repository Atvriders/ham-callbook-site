"""Heritage Artifact Renderer — Feature #3.

Three endpoints:

  GET /api/story/{cs}    — deterministic plain-English bio JSON
  GET /badge/{cs}.svg    — Sodium-Vapor styled SVG badge (no deps)
  GET /card/{cs}.png     — Pillow-rendered share-card PNG

The story endpoint composes prose from queries already answered by the
callsign, holders, and activity integrations. No new DB tables; no new
artifact files. Results are deterministic and stable across requests.

The badge and card are pure render functions: badge is a hand-built SVG
string; card uses PIL (Pillow ≥ 9 is available in the backend image) to
rasterize a 1200×630 share-card in the Sodium Vapor colour scheme.

All three routes are safe to call even when FCC ULS data is missing —
they degrade gracefully to "no FCC status available".

Prefix: the badge and card endpoints intentionally omit /api so that
<meta og:image> can point at /card/W1AW.png (Caddy proxies bare paths).
"""

from __future__ import annotations

import io
import logging
import re
import sqlite3
import textwrap
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam
from fastapi.responses import Response
from pydantic import BaseModel

from app.db import get_db
from app.integrations import fcc_uls as _fcc_uls
from app.routes.callsign import (
    normalize_callsign,
    clean_ocr_name,
)

logger = logging.getLogger("callbook.backend.heritage")

router = APIRouter(tags=["heritage"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class StoryResponse(BaseModel):
    callsign: str
    headline: str
    prose: str
    facts: dict[str, Any]
    generated_at: str


# ---------------------------------------------------------------------------
# Prose helpers
# ---------------------------------------------------------------------------

_ERA_LABELS: dict[str, str] = {
    "pre-war": "pre-war era",
    "wwii": "World War II era",
    "golden": "golden age",
    "cold-war": "Cold War era",
    "modern": "modern era",
}


def _era(year: int) -> str:
    if year < 1941:
        return "pre-war era"
    if year <= 1945:
        return "World War II era"
    if year <= 1969:
        return "golden age of amateur radio"
    if year <= 1989:
        return "Cold War era"
    return "modern era"


def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return f"{n}th"
    return f"{n}{['th','st','nd','rd','th'][min(n % 10, 4)]}"


def _holder_clause(holders: list[dict[str, Any]]) -> str:
    """Produce a natural-language summary of the holder history."""
    n = len(holders)
    if n == 0:
        return ""
    if n == 1:
        h = holders[0]
        name = clean_ocr_name(h.get("display_name")) or "one operator"
        return f"It has been held by a single operator: {name}."
    # Multi-holder
    first_h = holders[0]
    last_h = holders[-1]
    first_name = clean_ocr_name(first_h.get("display_name")) or "an unknown operator"
    last_name = clean_ocr_name(last_h.get("display_name")) or "an unknown operator"
    if n == 2:
        return (
            f"The callsign has been held by two operators: first by {first_name}, "
            f"then by {last_name}."
        )
    return (
        f"The callsign has passed through {n} operators over the years. "
        f"The earliest recorded holder is {first_name}; "
        f"the most recent is {last_name}."
    )


def _fcc_clause(cs: str) -> str:
    rec = _fcc_uls.lookup(cs)
    if rec is None:
        return "No current FCC ULS record was found for this callsign."
    status = rec.status_label or rec.status or "unknown"
    name = rec.full_name or ""
    if rec.is_active:
        return (
            f"The FCC ULS shows this callsign as currently **Active**"
            + (f", licensed to {name}" if name else "")
            + "."
        )
    return (
        f"According to FCC ULS, the license status is **{status}**"
        + (f" (licensed to {name})" if name else "")
        + "."
    )


def _build_prose(
    cs: str,
    first_year: int,
    last_year: int,
    editions_count: int,
    distinct_holders: int,
    holders: list[dict[str, Any]],
    latest_state: str | None,
    latest_name: str | None,
) -> tuple[str, str, dict[str, Any]]:
    """Return (headline, prose, facts)."""

    span = last_year - first_year
    era = _era(first_year)

    # Headline
    if distinct_holders > 1:
        headline = (
            f"{cs} — {distinct_holders} holders, first issued {first_year}"
        )
    else:
        headline = f"{cs} — first issued {first_year}, {editions_count} editions"

    # Opening
    opening = (
        f"**{cs}** first appeared in the U.S. amateur radio callbooks in **{first_year}**"
        f", during the {era}."
    )

    # Span / presence
    if editions_count == 1:
        presence = f"It appears in just one callbook edition."
    elif span == 0:
        presence = (
            f"It appears in {editions_count} editions, all within the same year."
        )
    else:
        presence = (
            f"It spans **{span} years** of callbook history, appearing in "
            f"{editions_count} edition{'s' if editions_count != 1 else ''},"
            f" last recorded in **{last_year}**."
        )

    # Geography
    geo = ""
    if latest_state:
        geo = f"The most recent callbook listing places this station in **{latest_state}**."
    if latest_name:
        cleaned = clean_ocr_name(latest_name) or latest_name
        geo += f" The last recorded operator name is {cleaned}."

    # Holders
    holder_text = _holder_clause(holders)

    # FCC
    fcc_text = _fcc_clause(cs)

    # Close
    close = (
        "This record is drawn from the digitised U.S. Amateur Radio Callbook archive, "
        f"covering editions from 1909 to 2003."
    )

    prose_parts = [opening, presence]
    if geo:
        prose_parts.append(geo)
    if holder_text:
        prose_parts.append(holder_text)
    prose_parts.append(fcc_text)
    prose_parts.append(close)

    prose = " ".join(prose_parts)

    facts: dict[str, Any] = {
        "callsign": cs,
        "first_year": first_year,
        "last_year": last_year,
        "span_years": span,
        "editions_count": editions_count,
        "distinct_holders": distinct_holders,
        "latest_state": latest_state,
        "era": era,
    }

    return headline, prose, facts


# ---------------------------------------------------------------------------
# /api/story/{cs}
# ---------------------------------------------------------------------------

@router.get("/api/story/{cs}", response_model=StoryResponse)
def get_story(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> StoryResponse:
    callsign = normalize_callsign(cs)

    # 1. Basic callsign stats
    cur = db.execute(
        """
        SELECT year, name, state
        FROM   entries
        WHERE  callsign = ?
        ORDER  BY year DESC
        """,
        (callsign,),
    )
    rows = cur.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"callsign not found: {callsign}")

    years = [r["year"] for r in rows if r["year"] is not None]
    first_year = min(years)
    last_year = max(years)
    editions_count = len(rows)
    latest_state = (rows[0]["state"] or "").strip().upper() or None
    latest_name = rows[0]["name"]

    # 2. Holders (grouped by normalised name — same logic as callsign holders endpoint)
    from collections import Counter

    name_years: dict[str, list[int]] = {}
    for r in rows:
        raw_name = (r["name"] or "").strip()
        key = raw_name.upper() if raw_name else "(unknown)"
        yr = r["year"]
        if yr is None:
            continue
        name_years.setdefault(key, []).append(yr)

    # Sort by first year
    holder_list: list[dict[str, Any]] = sorted(
        [
            {"display_name": k, "first_year": min(ys), "last_year": max(ys)}
            for k, ys in name_years.items()
            if k != "(unknown)" or not name_years
        ],
        key=lambda h: h["first_year"],
    )
    distinct_holders = len(holder_list) if holder_list else 1

    headline, prose, facts = _build_prose(
        callsign,
        first_year,
        last_year,
        editions_count,
        distinct_holders,
        holder_list,
        latest_state,
        latest_name,
    )

    return StoryResponse(
        callsign=callsign,
        headline=headline,
        prose=prose,
        facts=facts,
        generated_at=datetime.utcnow().isoformat() + "Z",
    )


# ---------------------------------------------------------------------------
# /badge/{cs}.svg  — hand-built SVG, no external deps
# ---------------------------------------------------------------------------

_BADGE_W = 440
_BADGE_H = 44
_BG = "#0a0e1a"
_BORDER = "#2a3349"
_ACCENT = "#ffa30b"
_TEXT_DIM = "#a8b0c3"
_TEXT = "#f5ecd9"
_MONO = "JetBrains Mono, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"


def _build_svg(cs: str, first_year: int | None, holders: int | None, editions: int | None) -> str:
    first_str = str(first_year) if first_year else "?"
    holders_str = str(holders) if holders is not None else "?"
    editions_str = str(editions) if editions is not None else "?"

    label = f"{cs}  ·  first issued {first_str}  ·  {holders_str} holder{'s' if (holders or 0) != 1 else ''}  ·  {editions_str} editions"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{_BADGE_W}" height="{_BADGE_H}" viewBox="0 0 {_BADGE_W} {_BADGE_H}" role="img" aria-label="Ham callsign badge for {cs}">
  <title>{cs} — Amateur Radio Callbook Archive</title>
  <rect width="{_BADGE_W}" height="{_BADGE_H}" rx="6" fill="{_BG}" stroke="{_BORDER}" stroke-width="1"/>
  <!-- amber left accent bar -->
  <rect x="0" y="0" width="4" height="{_BADGE_H}" rx="3" fill="{_ACCENT}"/>
  <!-- callsign glyph -->
  <text x="16" y="28" font-family="{_MONO}" font-size="14" font-weight="700" fill="{_ACCENT}" letter-spacing="1">{cs}</text>
  <!-- separator dot -->
  <text x="78" y="28" font-family="{_MONO}" font-size="12" fill="{_BORDER}">·</text>
  <!-- metadata text -->
  <text x="92" y="28" font-family="{_MONO}" font-size="11" fill="{_TEXT_DIM}">first issued <tspan fill="{_TEXT}">{first_str}</tspan>  ·  <tspan fill="{_TEXT}">{holders_str}</tspan> holder{'s' if (holders or 0) != 1 else ''}  ·  <tspan fill="{_TEXT}">{editions_str}</tspan> editions</text>
</svg>"""


@router.get("/badge/{cs}.svg")
def get_badge(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    try:
        callsign = normalize_callsign(cs)
    except HTTPException:
        callsign = cs.strip().upper()[:12]

    # Lightweight query — just enough for badge facts
    cur = db.execute(
        """
        SELECT year, name
        FROM   entries
        WHERE  callsign = ?
        ORDER  BY year ASC
        """,
        (callsign,),
    )
    rows = cur.fetchall()

    first_year: int | None = None
    editions: int | None = None
    holders: int | None = None

    if rows:
        years = [r["year"] for r in rows if r["year"] is not None]
        first_year = min(years) if years else None
        editions = len(rows)
        names = {(r["name"] or "").strip().upper() for r in rows if (r["name"] or "").strip()}
        holders = max(len(names), 1)

    svg = _build_svg(callsign, first_year, holders, editions)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Type": "image/svg+xml; charset=utf-8",
        },
    )


# ---------------------------------------------------------------------------
# /card/{cs}.png  — Pillow share-card (1200×630)
# ---------------------------------------------------------------------------

_CARD_W = 1200
_CARD_H = 630
_CARD_BG = (10, 14, 26)          # #0a0e1a
_CARD_SURFACE = (19, 26, 45)     # #131a2d
_CARD_BORDER = (42, 51, 73)      # #2a3349
_CARD_ACCENT = (255, 163, 11)    # #ffa30b
_CARD_TEXT = (245, 236, 217)     # #f5ecd9
_CARD_DIM = (168, 176, 195)      # #a8b0c3


def _render_card_png(
    callsign: str,
    first_year: int | None,
    last_year: int | None,
    editions: int | None,
    holders: int | None,
    latest_name: str | None,
    latest_state: str | None,
) -> bytes:
    """Render the 1200×630 share card and return raw PNG bytes."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (_CARD_W, _CARD_H), _CARD_BG)
    draw = ImageDraw.Draw(img)

    # Background surface rectangle (inset)
    draw.rectangle([32, 32, _CARD_W - 32, _CARD_H - 32], fill=_CARD_SURFACE, outline=_CARD_BORDER, width=1)

    # Left amber accent bar
    draw.rectangle([32, 32, 48, _CARD_H - 32], fill=_CARD_ACCENT)

    # Try to use a built-in truetype font; fall back gracefully to default
    try:
        font_cs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 96)
        font_meta = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 28)
        font_label = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except (IOError, OSError):
        font_cs = ImageFont.load_default()
        font_meta = font_cs
        font_label = font_cs

    # Callsign — large amber
    draw.text((80, 140), callsign, font=font_cs, fill=_CARD_ACCENT)

    # Site name top-right
    draw.text((_CARD_W - 280, 52), "hamcallbook.archive", font=font_label, fill=_CARD_DIM)

    # Horizontal rule under callsign
    rule_y = 275
    draw.line([(80, rule_y), (_CARD_W - 80, rule_y)], fill=_CARD_BORDER, width=1)

    # Stats row
    stat_y = 310
    col_w = (_CARD_W - 160) // 3
    stats_pairs = [
        ("FIRST ISSUED", str(first_year) if first_year else "—"),
        ("HOLDERS", str(holders) if holders is not None else "—"),
        ("EDITIONS", str(editions) if editions is not None else "—"),
    ]
    for i, (lbl, val) in enumerate(stats_pairs):
        x = 80 + i * col_w
        draw.text((x, stat_y), lbl, font=font_label, fill=_CARD_DIM)
        draw.text((x, stat_y + 30), val, font=font_meta, fill=_CARD_TEXT)

    # Name / state line at bottom
    if latest_name or latest_state:
        parts = []
        if latest_name:
            cleaned = clean_ocr_name(latest_name)
            if cleaned:
                parts.append(cleaned)
        if latest_state:
            parts.append(latest_state)
        bottom_line = "  ·  ".join(parts)
        draw.text((80, _CARD_H - 100), bottom_line, font=font_meta, fill=_CARD_DIM)

    # Footer attribution
    draw.text((80, _CARD_H - 58), "U.S. Amateur Radio Callbook Archive  1909–2003", font=font_label, fill=_CARD_DIM)

    # Bottom amber rule
    draw.line([(80, _CARD_H - 68), (_CARD_W - 80, _CARD_H - 68)], fill=_CARD_ACCENT, width=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


@router.get("/card/{cs}.png")
def get_card(
    cs: str = PathParam(..., description="Callsign, case-insensitive."),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    try:
        callsign = normalize_callsign(cs)
    except HTTPException:
        callsign = cs.strip().upper()[:12]

    cur = db.execute(
        """
        SELECT year, name, state
        FROM   entries
        WHERE  callsign = ?
        ORDER  BY year DESC
        """,
        (callsign,),
    )
    rows = cur.fetchall()

    first_year: int | None = None
    last_year: int | None = None
    editions: int | None = None
    holders: int | None = None
    latest_name: str | None = None
    latest_state: str | None = None

    if rows:
        years = [r["year"] for r in rows if r["year"] is not None]
        first_year = min(years) if years else None
        last_year = max(years) if years else None
        editions = len(rows)
        names = {(r["name"] or "").strip().upper() for r in rows if (r["name"] or "").strip()}
        holders = max(len(names), 1)
        latest_name = rows[0]["name"]
        latest_state = (rows[0]["state"] or "").strip().upper() or None

    png_bytes = _render_card_png(
        callsign, first_year, last_year, editions, holders, latest_name, latest_state
    )

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
        },
    )
