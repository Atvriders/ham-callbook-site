"""Nearby-hams API: address/ZIP/city input -> adaptive-radius local operators.

``GET /api/nearby?q=<free text>&limit=<n>`` — find the licensed hams
closest to a place. ``q`` may be a bare ZIP ("80301"), a full mailing
address containing a ZIP ("225 Main St, Newington, CT 06111"), or a
city ("Boulder, CO" / "Boulder CO" / just "Boulder").

Location parse order (per the feature contract):

1. First 5-digit ZIP anywhere in ``q`` → ZCTA centroid (``matched_by:
   "zip"``; unknown ZIP → 404).
2. Else a trailing 2-letter state after a city → the median centroid of
   that city's ZIPs as seen in the corpus itself (``"city-state"``).
3. Else the whole query as a city name; the state with the most licensed
   hams of that city name wins (``"city"``). Unknown city → 404;
   queries with no letters/digits at all → 400.

Adaptive radius over rings [3, 5, 10, 25, 50, 100, 250] mi:

* ``dense`` — ≥ ``limit`` hams already live within 10 mi (Beverly
  Hills): radius locks at 10, we return the nearest ``limit``.
* otherwise grow the ring until ≥ 12 hams are inside (or the 250 mi
  cap); anything past 10 mi sets ``expanded`` (rural Montana).

While the lazy ops index builds (first request after a cold start /
data release, ~30-45s) the endpoint answers
``{"index_ready": false, "building": true, "eta_s": N}`` and the
frontend polls. Results carry live FCC ULS status via the in-memory
snapshot (``status`` / ``status_label``, null for pre-ULS history).
"""

from __future__ import annotations

import re
import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import compute_entry_count, get_db
from ..integrations import fcc_uls
from ..nearby_index import INDEX, centroids

router = APIRouter(prefix="/api/nearby")

# --------------------------------------------------------------------------- #
# Parsing                                                                     #
# --------------------------------------------------------------------------- #

#: 5-digit ZIP (optionally ZIP+4) anywhere in the query.
_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")

#: Trailing "... <ST>" inside a single comma segment ("Boulder CO").
_CITY_ST_RE = re.compile(r"^(.*\S)[\s]+([A-Za-z]{2})$")

#: USPS state/territory abbreviations that appear in the corpus.
_STATE_CODES = frozenset(
    """
    AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI
    MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT
    VA WA WV WI WY PR VI GU AS MP
    """.split()
)

#: Radius rings, miles. <=10 is "local"; beyond is an expanded search.
_RINGS = (3.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0)
_LOCAL_RADIUS_MI = 10.0
_MIN_RESULTS = 12
_DEFAULT_LIMIT = 60
_MAX_LIMIT = 200


def _parse_location(raw: str) -> dict[str, Any]:
    """Resolve free text to a centroid. Raises 400/404 per the contract.

    Returns the response's ``query`` object: raw/zip/city/state/lat/lon/
    matched_by. City geocoding uses the built index (callers only invoke
    this once the index is ready).
    """
    q = raw.strip()
    if not q or not re.search(r"[A-Za-z0-9]", q):
        raise HTTPException(
            status_code=400,
            detail="Could not parse a location from the query. Try a ZIP "
            'code ("80301") or a city ("Boulder, CO").',
        )

    # 1) ZIP anywhere in the string (covers full mailing addresses).
    m = _ZIP_RE.search(q)
    if m:
        zip5 = m.group(1)
        cent = centroids().get(zip5)
        if cent is None:
            raise HTTPException(
                status_code=404,
                detail=f"ZIP code {zip5} is not a known US ZCTA.",
            )
        return {
            "raw": raw,
            "zip": zip5,
            "city": None,
            "state": None,
            "lat": cent[0],
            "lon": cent[1],
            "matched_by": "zip",
        }

    # 2) "City, ST" / "City ST" (state must be a real USPS code).
    parts = [p.strip() for p in q.split(",") if p.strip()]
    city: Optional[str] = None
    state: Optional[str] = None
    last = parts[-1]
    if len(parts) >= 2 and len(last) == 2 and last.upper() in _STATE_CODES:
        state = last.upper()
        city = parts[-2]
    else:
        m2 = _CITY_ST_RE.match(last)
        if m2 and m2.group(2).upper() in _STATE_CODES:
            state = m2.group(2).upper()
            city = m2.group(1)
        else:
            city = last  # 3) whole (last segment of the) query as a city

    if not re.search(r"[A-Za-z]", city):
        raise HTTPException(
            status_code=400,
            detail="Could not parse a city or ZIP from the query.",
        )

    hit = INDEX.city_centroid(city, state)
    if hit is None:
        where = f"{city}, {state}" if state else city
        raise HTTPException(
            status_code=404,
            detail=f"No known hams in the archive for '{where}' — try a ZIP code.",
        )
    lat, lon, resolved_state = hit
    return {
        "raw": raw,
        "zip": None,
        "city": city,
        "state": resolved_state,
        "lat": lat,
        "lon": lon,
        "matched_by": "city-state" if state else "city",
    }


# --------------------------------------------------------------------------- #
# Endpoint                                                                    #
# --------------------------------------------------------------------------- #


@router.get(
    "",
    summary="Find licensed hams near an address, ZIP, or city.",
    response_description=(
        "Nearest operators with distance, latest known location, and live "
        "FCC ULS status; or a building/eta payload while the index warms."
    ),
)
def nearby(
    q: str = Query(
        ...,
        description='Free-text location: "80301", "Boulder, CO", or a full address with ZIP.',
    ),
    limit: int = Query(
        _DEFAULT_LIMIT,
        description=f"Max results (clamped to 1..{_MAX_LIMIT}).",
    ),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Adaptive-radius nearby search over each callsign's latest location."""
    limit = max(1, min(_MAX_LIMIT, limit))

    # Version-stamp the index with the entries count (cached after the
    # first call) — a new data release changes it and forces a rebuild.
    version = compute_entry_count(conn)
    if not INDEX.ensure(version):
        if INDEX.status == "failed":
            raise HTTPException(
                status_code=503,
                detail="The nearby index failed to build; it will retry shortly.",
            )
        return {"index_ready": False, "building": True, "eta_s": INDEX.eta_s()}

    loc = _parse_location(q)
    lat, lon = loc["lat"], loc["lon"]

    # Ring walk. One fetch covers all rings <= 10 mi; only genuinely
    # sparse areas pay for the wider boxes.
    local = INDEX.candidates_within(lat, lon, _LOCAL_RADIUS_MI)

    dense = len(local) >= limit
    expanded = False
    if dense:
        radius, in_radius = _LOCAL_RADIUS_MI, local
    else:
        radius, in_radius = _RINGS[-1], local
        for ring in _RINGS:
            hits = (
                [c for c in local if c[0] <= ring]
                if ring <= _LOCAL_RADIUS_MI
                else INDEX.candidates_within(lat, lon, ring)
            )
            if len(hits) >= _MIN_RESULTS or ring == _RINGS[-1]:
                radius, in_radius = ring, hits
                break
        expanded = radius > _LOCAL_RADIUS_MI

    results = []
    for dist, row in in_radius[:limit]:
        rec = fcc_uls.lookup(row["callsign"])
        results.append(
            {
                "callsign": row["callsign"],
                "name": row["name"],
                "city": row["city"],
                "state": row["state"],
                "zip": row["zip"],
                "distance_mi": round(dist, 1),
                "last_seen_year": int(row["year"]),
                "status": rec.status if rec else None,
                "status_label": rec.status_label if rec else None,
            }
        )

    return {
        "query": loc,
        "index_ready": True,
        "radius_mi": float(radius),
        "dense": dense,
        "expanded": expanded,
        "total_in_radius": len(in_radius),
        "results": results,
    }
