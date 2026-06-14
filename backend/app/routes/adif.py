"""ADIF Time Machine — point-in-time QSO holder resolution.

POST /api/adif/resolve
    Accepts a multipart ADIF file (≤5 MB), resolves every QSO callsign to
    the archive/ULS holder *as of the QSO date*, flags reissues, returns
    annotated JSON + stats.  Fully stateless — nothing is stored.

All DB access is read-only (no writes). Single batched query per unique
callsign to minimise round-trips.
"""

from __future__ import annotations

import io
import logging
import re
import sqlite3
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.db import DB_PATH as _DB_PATH
from app.integrations import fcc_uls

logger = logging.getLogger("callbook.backend.adif")

router = APIRouter(prefix="/api/adif", tags=["adif"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_BYTES = 5 * 1024 * 1024   # 5 MB
MAX_QSOS  = 50_000

# ADIF tag regex — matches <TAGNAME:len>value (or <EOR> / <EOH>)
_TAG_RE = re.compile(r"<([A-Z_0-9]+)(?::\d+(?::[A-Z])?)?>([^<]*)", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class AnnotatedQso(BaseModel):
    call: str
    qso_date: str                  # raw from ADIF, YYYYMMDD
    band: str | None
    mode: str | None
    holder_at_time: str | None     # best-guess name for that year
    first_year: int | None         # earliest archive year for this call
    is_reissue: bool               # name changed between bracketing editions
    is_heritage: bool              # first_year ≤ qso_year − 50
    resolved: bool                 # True if we found any archive/ULS data


class DecadeBin(BaseModel):
    decade: str
    count: int


class HeritageListing(BaseModel):
    callsign: str
    first_year: int | None
    qso_date: str
    holder_at_time: str | None
    current_holder: str | None


class AdifAnalysisResult(BaseModel):
    qso_count: int
    resolved_count: int
    unresolved_calls: list[str]
    reissued_calls: list[str]
    oldest_first_licensed: dict[str, Any] | None
    decade_histogram: list[DecadeBin]
    heritage_qso_count: int
    heritage_calls: list[HeritageListing]
    heritage_csv_lines: list[str]
    annotated_qsos: list[AnnotatedQso]


# ---------------------------------------------------------------------------
# ADIF parser
# ---------------------------------------------------------------------------

def _parse_adif(text: str) -> list[dict[str, str]]:
    """Parse ADIF text into a list of QSO dicts. Simple, stateless."""
    # Skip optional header (everything before <EOH>)
    eoh = text.upper().find("<EOH>")
    if eoh != -1:
        text = text[eoh + 5:]

    qsos: list[dict[str, str]] = []
    current: dict[str, str] = {}
    pos = 0
    text_upper = text.upper()

    while pos < len(text):
        # Find next tag
        m = re.search(r"<([A-Z_0-9]+)(?::\d+(?::[A-Z])?)?>", text_upper[pos:])
        if not m:
            break
        tag_start = pos + m.start()
        tag_end   = pos + m.end()
        tag_name  = m.group(1).upper()

        if tag_name in ("EOR", "EOH"):
            if tag_name == "EOR" and current:
                qsos.append(current)
                current = {}
                if len(qsos) >= MAX_QSOS:
                    break
            pos = tag_end
            continue

        # Extract length from original (not upper-cased) text for slicing
        orig_m = re.search(r"<[^>]+:(\d+)", text[tag_start:tag_end], re.IGNORECASE)
        if orig_m:
            length = int(orig_m.group(1))
            value = text[tag_end : tag_end + length]
            pos = tag_end + length
        else:
            # No length field (e.g. <EOR>) — already handled above; skip
            pos = tag_end
            continue

        current[tag_name] = value.strip()

    # Capture trailing QSO without explicit EOR
    if current and len(qsos) < MAX_QSOS:
        qsos.append(current)

    return qsos


# ---------------------------------------------------------------------------
# Point-in-time resolver (core logic)
# ---------------------------------------------------------------------------

def _strip_portable(cs: str) -> str:
    """Strip /portable suffixes like /QRP /4 /M /P."""
    return cs.split("/")[0].strip()


def _resolve_calls(
    unique_calls: list[str],
    conn: sqlite3.Connection,
) -> dict[str, dict[str, Any]]:
    """Batch-query the DB for all unique callsigns.

    Returns a dict keyed by callsign with:
        rows: [(year, name, license_class, state), ...] sorted by year
        first_year: int | None
    """
    if not unique_calls:
        return {}

    placeholders = ",".join("?" * len(unique_calls))
    sql = (
        f"SELECT callsign, year, name, license_class, state "
        f"FROM entries WHERE callsign IN ({placeholders}) ORDER BY callsign, year"
    )
    cursor = conn.cursor()
    cursor.execute(sql, unique_calls)
    rows = cursor.fetchall()

    result: dict[str, dict[str, Any]] = {}
    for cs, year, name, lic_class, state in rows:
        if cs not in result:
            result[cs] = {"rows": [], "first_year": year}
        result[cs]["rows"].append((year, name, lic_class, state))

    # Ensure first_year is the minimum
    for cs, data in result.items():
        data["first_year"] = min(r[0] for r in data["rows"])

    return result


def _holder_at_date(
    qso_year: int,
    archive_rows: list[tuple[int, str, str | None, str | None]],
    uls_rec: Any | None,
) -> tuple[str | None, bool, bool]:
    """Return (holder_name, is_reissue, resolved).

    Algorithm:
    1. Find the latest archive row with year <= qso_year (prior).
    2. Find the earliest archive row with year > qso_year (next).
    3. If prior exists: holder = prior name.
       If next exists and name(prior) != name(next) [normalized]: is_reissue = True.
    4. If no prior but next exists: holder = next name, is_reissue = False (uncertain).
    5. If no archive rows at all: fall back to ULS.
    """
    if not archive_rows:
        # No archive data — try ULS
        if uls_rec is not None:
            grant_year = None
            gd = getattr(uls_rec, "grant_date", None)
            if gd and isinstance(gd, str) and len(gd) >= 4:
                try:
                    grant_year = int(gd[:4])
                except ValueError:
                    pass
            if grant_year is None or grant_year <= qso_year:
                name = getattr(uls_rec, "full_name", None)
                return (name, False, name is not None)
        return (None, False, False)

    prior: tuple[int, str, str | None, str | None] | None = None
    nxt: tuple[int, str, str | None, str | None] | None = None

    for row in archive_rows:
        if row[0] <= qso_year:
            prior = row
        elif nxt is None:
            nxt = row

    def _norm_name(n: str | None) -> str:
        if not n:
            return ""
        # Lower, strip punctuation tokens, collapse whitespace
        s = re.sub(r"[^a-z0-9 ]", " ", (n or "").lower())
        return " ".join(s.split()[:3])   # compare first 3 tokens only

    is_reissue = False
    if prior is not None:
        holder = prior[1]
        if nxt is not None:
            if _norm_name(prior[1]) != _norm_name(nxt[1]):
                # Names differ across the bracket → likely reissued in the gap
                # Confirm via ULS: if current ULS grant is after qso_year it's reissue
                grant_year = None
                if uls_rec is not None:
                    gd = getattr(uls_rec, "grant_date", None)
                    if gd and isinstance(gd, str) and len(gd) >= 4:
                        try:
                            grant_year = int(gd[:4])
                        except ValueError:
                            pass
                if grant_year is None or grant_year > qso_year:
                    is_reissue = True
        return (holder, is_reissue, True)

    # No prior edition; use next as forward hint
    holder = nxt[1] if nxt else None  # type: ignore[union-attr]
    return (holder, False, holder is not None)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/resolve", response_model=AdifAnalysisResult)
async def resolve_adif(file: UploadFile = File(...)) -> AdifAnalysisResult:
    """Parse an ADIF log and resolve each QSO callsign to its period-correct holder."""
    # Size guard
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="ADIF file exceeds 5 MB limit.")

    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode file as UTF-8.")

    qsos = _parse_adif(text)
    if not qsos:
        raise HTTPException(status_code=400, detail="No QSO records found in ADIF file.")

    # Gather unique bare callsigns
    unique_bare: set[str] = set()
    for q in qsos:
        cs_raw = q.get("CALL", "").strip().upper()
        if cs_raw:
            unique_bare.add(_strip_portable(cs_raw))

    unique_list = sorted(unique_bare)

    # DB batch query (immutable=1 so a WAL DB on a read-only mount opens)
    conn = sqlite3.connect(f"file:{_DB_PATH}?mode=ro&immutable=1", uri=True)
    try:
        archive_map = _resolve_calls(unique_list, conn)
    finally:
        conn.close()

    # ULS lookups (in-memory, O(1) per call)
    uls_map: dict[str, Any] = {}
    for cs in unique_list:
        rec = fcc_uls.lookup(cs)
        if rec is not None:
            uls_map[cs] = rec

    # -----------------------------------------------------------------------
    # Build annotated QSOs
    # -----------------------------------------------------------------------
    annotated: list[AnnotatedQso] = []
    reissued_set: set[str] = set()
    unresolved_set: set[str] = set()
    heritage_listings: list[HeritageListing] = []
    decade_counts: dict[str, int] = defaultdict(int)
    oldest_entry: dict[str, Any] | None = None

    for q in qsos:
        cs_raw = q.get("CALL", "").strip().upper()
        if not cs_raw:
            continue
        bare = _strip_portable(cs_raw)
        qso_date = q.get("QSO_DATE", "").strip()
        band = q.get("BAND", "").strip() or None
        mode = q.get("MODE", "").strip() or None

        # Parse year
        qso_year: int | None = None
        if len(qso_date) >= 4:
            try:
                qso_year = int(qso_date[:4])
            except ValueError:
                pass

        arch = archive_map.get(bare)
        uls_rec = uls_map.get(bare)

        first_year: int | None = arch["first_year"] if arch else None
        archive_rows: list[tuple] = arch["rows"] if arch else []

        if qso_year is not None:
            holder, is_reissue, resolved = _holder_at_date(qso_year, archive_rows, uls_rec)
        else:
            holder = None
            is_reissue = False
            resolved = bool(arch or uls_rec)

        is_heritage = bool(
            first_year is not None and qso_year is not None and first_year <= qso_year - 50
        )

        if is_reissue:
            reissued_set.add(bare)
        if not resolved:
            unresolved_set.add(bare)

        # Decade histogram
        if qso_year is not None:
            decade_key = f"{(qso_year // 10) * 10}s"
            decade_counts[decade_key] += 1

        # Heritage
        if is_heritage:
            current_holder: str | None = None
            if uls_rec:
                current_holder = getattr(uls_rec, "full_name", None)
            heritage_listings.append(HeritageListing(
                callsign=bare,
                first_year=first_year,
                qso_date=qso_date,
                holder_at_time=holder,
                current_holder=current_holder,
            ))

        # Track oldest first-licensed op worked
        if first_year is not None and resolved:
            if oldest_entry is None or first_year < oldest_entry["year"]:
                oldest_entry = {
                    "callsign": bare,
                    "year": first_year,
                    "name": holder,
                    "state": (archive_rows[0][3] if archive_rows else None),
                }

        annotated.append(AnnotatedQso(
            call=bare,
            qso_date=qso_date,
            band=band,
            mode=mode,
            holder_at_time=holder,
            first_year=first_year,
            is_reissue=is_reissue,
            is_heritage=is_heritage,
            resolved=resolved,
        ))

    # Decade histogram sorted
    decade_hist = [
        DecadeBin(decade=k, count=v)
        for k, v in sorted(decade_counts.items())
    ]

    # Heritage CSV
    heritage_csv_lines = [
        "callsign,first_year,qso_date,holder_at_time,current_holder"
    ] + [
        f"{h.callsign},{h.first_year or ''},{h.qso_date},"
        f"{(h.holder_at_time or '').replace(',', ' ')},"
        f"{(h.current_holder or '').replace(',', ' ')}"
        for h in heritage_listings
    ]

    resolved_count = sum(1 for a in annotated if a.resolved)

    return AdifAnalysisResult(
        qso_count=len(annotated),
        resolved_count=resolved_count,
        unresolved_calls=sorted(unresolved_set),
        reissued_calls=sorted(reissued_set),
        oldest_first_licensed=oldest_entry,
        decade_histogram=decade_hist,
        heritage_qso_count=len(heritage_listings),
        heritage_calls=heritage_listings,
        heritage_csv_lines=heritage_csv_lines,
        annotated_qsos=annotated,
    )
