"""Browse endpoints for the USA Ham Callbook Archive.

This router exposes the "shelf view" of the corpus: every year that has
records, every distinct edition that was OCR'd, and the four broad eras
into which 89 years of U.S. amateur radio licensing naturally divide.

The eras are not arbitrary marketing brackets — they correspond to real
regulatory and technological boundaries in U.S. amateur radio history:

* ``pre-1928``  — Before the 1927 International Radiotelegraph Conference
  in Washington, D.C. and the Federal Radio Commission. U.S. amateurs
  used unprefixed numeric callsigns ("1AW", "9ZN") with the leading
  digit indicating their inspection district. The Department of Commerce
  ran licensing; the Callbook was thin and parse quality is rough.
* ``1928-1962`` — The classic "W-prefix" era. The 1927 conference
  assigned ``W`` (and later ``K``) as U.S. amateur prefixes; the FRC
  (then FCC from 1934) standardized districting. Pre-incentive licensing,
  with Class A/B/C structure giving way to Novice/Technician/General/
  Advanced/Extra over the 1950s. The corpus is dense and well-formed
  through this period.
* ``1963-1997`` — The modern incentive-licensing era. The 1968 FCC rules
  cemented the Novice → Technician → General → Advanced → Extra ladder,
  ``K``/``N``/``WA``/``WB`` prefixes became routine, and vanity calls
  arrived in 1996. This is by volume the largest era in the corpus.
* ``2003``     — A single post-Y2K snapshot of the FCC ULS database that
  Lee Hite included for cross-reference. It is not a "Callbook" in the
  printed sense; it is the only year in the corpus after 1997.

The Data phase materializes :py:data:`stats_per_year` so the year and
era endpoints can answer in O(distinct_years) rows (~83 rows) without
ever scanning the 7.74M-row ``entries`` table at request time.

Endpoints
---------

* ``GET /api/browse/years``   — flat list of years, counts, and the era
  each year falls into.
* ``GET /api/browse/editions`` — every row of the ``editions`` table,
  with year, label, entry count, and parse-quality grade. Sorted by
  year then label for stable rendering.
* ``GET /api/browse/eras``    — per-era aggregates: span, year count,
  total entries, distinct callsigns, and a small curated list of
  representative notable callsigns drawn from amateur radio history,
  filtered to those actually present in the corpus.

Every endpoint returns JSON in shapes that mirror :mod:`frontend/lib/types.ts`.
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter(prefix="/api/browse", tags=["browse"])


# ---------------------------------------------------------------------------
# Era model — the canonical boundaries used throughout the codebase.
# ---------------------------------------------------------------------------

# Order matters: the first range that matches a year wins, so the four
# tuples below are exhaustive AND mutually exclusive for every year in
# the corpus (1909-1997 + 2003).
ERA_DEFINITIONS: tuple[tuple[str, int, int, str], ...] = (
    (
        "pre-1928",
        0,
        1927,
        "Pre-Washington Conference. Department of Commerce licensing, "
        "unprefixed numeric callsigns (1AW, 9ZN); thin, rough OCR.",
    ),
    (
        "1928-1962",
        1928,
        1962,
        "Classic W/K-prefix era under the FRC and early FCC. "
        "Class A/B/C licensing transitioning to Novice/Technician/"
        "General/Advanced/Extra by the late 1950s.",
    ),
    (
        "1963-1997",
        1963,
        1997,
        "Incentive-licensing era. Modern five-class ladder cemented in 1968; "
        "K/N/WA/WB prefixes routine; vanity calls arrive 1996. "
        "Largest era by volume in the corpus.",
    ),
    (
        # The spec names this era "2003" because that is the headline year
        # Lee Hite included as a post-Callbook ULS / DX-QSL-bureau reference
        # slice. The corpus also contains a 1999 snapshot of the same
        # bureau roster (same schema, no city/state), which we group under
        # the same era key — there is no separate "1999" era boundary in
        # the spec and the data is identical in character.
        "2003",
        1998,
        2003,
        "Post-Callbook ULS / DX-QSL-bureau snapshot. Drawn from the FCC "
        "Universal Licensing System and IARU QSL-manager rosters rather "
        "than a printed Radio Amateur Callbook edition. Mostly DXpedition "
        "and HQ-station callsigns with QSL-manager fields in place of "
        "city/state.",
    ),
)

# A flat literal of the four era keys, in chronological order, used both
# for response ordering and for the OpenAPI schema.
ERA_KEYS: tuple[str, ...] = tuple(e[0] for e in ERA_DEFINITIONS)


def era_for_year(year: int) -> str:
    """Return the era key for a given year.

    Falls back to ``"unknown"`` for any year outside the corpus envelope
    (which should not happen in production but keeps the function total).
    """
    for key, lo, hi, _desc in ERA_DEFINITIONS:
        if lo <= year <= hi:
            return key
    return "unknown"


# ---------------------------------------------------------------------------
# Curated notable callsigns per era.
#
# These are real callsigns from U.S. amateur radio history. The endpoint
# filters this list against the actual corpus and only returns the ones
# that have at least one row in ``entries`` — so the response is always
# a true subset of what the user can click through to.
#
# Pre-1928 picks emphasize ARRL founders and pioneers operating under
# Department of Commerce rules with unprefixed numeric calls.
# Mid-century picks include W1AW (ARRL HQ station), W6AM (Don Wallace —
# DXCC #1), and stations long associated with traffic handling.
# Modern-era picks emphasize contesting, EME, and digital-mode pioneers.
# ---------------------------------------------------------------------------

NOTABLE_CALLSIGNS_BY_ERA: dict[str, tuple[str, ...]] = {
    "pre-1928": (
        "1AW",   # Hiram Percy Maxim — ARRL co-founder
        "1MO",   # ARRL HQ (pre-W1AW)
        "1ZE",   # Maxim again, special experimental
        "2ZK",   # Geo. C. Cannon — early DX
        "8AHB",  # Early Ohio district pioneer
        "9ZN",   # R. H. G. Mathews — ARRL co-founder
        "1XM",   # MIT experimental station
        "6OI",   # West Coast pioneer
    ),
    "1928-1962": (
        "W1AW",   # ARRL HQ station, Newington CT
        "W6AM",   # Don C. Wallace — DXCC #1
        "W3DZZ",  # C. L. Buchanan — antenna pioneer
        "W2GHK",  # Long-running QSL bureau station
        "W4KFC",  # Victor C. Clark — Roanoke division
        "W1FH",   # C. Mellen
    ),
    "1963-1997": (
        "W1AW",   # ARRL HQ continues
        "K1JT",   # Joe Taylor — Nobel laureate, future WSJT author
        "K3WW",   # John Smith — top contester
        "W3LPL",  # Frank Donovan — contest/DX super-station
        "N6BV",   # Dean Straw — antenna author
        "WB6ACU", # John Garrett — packet pioneer
        "K6KPH",  # Maritime Radio Historical Society
        "W1BB",   # Stew Perry — 160m DX legend
    ),
    # The 2003 slice of the corpus is the FCC/QSL-bureau DXCC roster, not
    # a U.S.-domestic census. Its highest-volume callsigns are HQ stations
    # at international organizations and DX expedition calls — picked here
    # because they are the ones a user clicking through will actually find.
    "2003": (
        "4U1ITU",  # ITU HQ Geneva — most-logged callsign in the 2003 slice
        "4U0ITU",  # ITU HQ, secondary callsign
        "4U1VIC",  # UN Vienna International Centre
        "3V8BB",   # Scout HQ Tunis — frequent DXpedition target
        "5A1A",    # Libya — rare entity, QSL via N4AA
        "HF0POL",  # Polish Antarctic station, Arctowski base
    ),
}


# ---------------------------------------------------------------------------
# Pydantic response models.
# ---------------------------------------------------------------------------


class YearRow(BaseModel):
    """One year's coverage in the corpus."""

    year: int = Field(..., description="Calendar year of the entries.")
    count: int = Field(
        ...,
        description=(
            "Number of rows in ``entries`` for this year, taken from the "
            "materialized ``stats_per_year`` table built by the Data phase."
        ),
    )
    era: str = Field(
        ...,
        description=(
            "One of: pre-1928, 1928-1962, 1963-1997, 2003. See "
            "``ERA_DEFINITIONS`` for the boundary rationale."
        ),
    )
    distinct_callsigns: int = Field(
        ...,
        description="Distinct callsigns appearing in entries for this year.",
    )


class EditionRow(BaseModel):
    """One row of the ``editions`` reference table."""

    key: str = Field(..., description="Composite key, e.g. ``1937_Spring``.")
    year: int
    label: str = Field(
        ...,
        description=(
            "Edition label (BlueBook, CallBook, Spring/Summer/Fall/Winter, "
            "Edition, Consolidated, GovtStations, etc.)."
        ),
    )
    csv_file: Optional[str] = Field(
        None,
        description="Lee Hite source CSV filename for provenance display.",
    )
    entry_count: int = Field(
        ...,
        description="Number of rows imported from this edition's CSV.",
    )
    parse_quality: Optional[str] = Field(
        None,
        description=(
            "OCR cleanliness grade, e.g. ``'95% clean'``. Lower percentages "
            "tend to be the earliest editions where OCR struggles with the "
            "old typesetting and column gutters."
        ),
    )
    era: str = Field(..., description="Era this edition's year falls into.")


class NotableCallsign(BaseModel):
    """A representative callsign that appears in the corpus for an era."""

    callsign: str
    appearances: int = Field(
        ...,
        description="Total rows in ``entries`` for this callsign across the era.",
    )
    first_year: int
    last_year: int


class EraRow(BaseModel):
    """Per-era aggregate row."""

    key: str = Field(..., description="One of pre-1928 / 1928-1962 / 1963-1997 / 2003.")
    start_year: int
    end_year: int
    description: str = Field(
        ...,
        description="One-paragraph historical context for this era.",
    )
    year_count: int = Field(
        ...,
        description="Number of distinct years in the corpus that fall in this era.",
    )
    edition_count: int = Field(
        ...,
        description="Number of rows in the ``editions`` table within this era.",
    )
    total_entries: int = Field(
        ...,
        description="Sum of ``entry_count`` across every year in this era.",
    )
    distinct_callsigns: int = Field(
        ...,
        description=(
            "Sum of per-year ``distinct_callsigns`` from ``stats_per_year``. "
            "This double-counts callsigns that span multiple years within "
            "the era — it is an activity metric, not a unique-operator count."
        ),
    )
    notable_callsigns: list[NotableCallsign] = Field(
        default_factory=list,
        description=(
            "Curated representative callsigns for the era, filtered to "
            "those that have at least one row in ``entries``. Ordered by "
            "total appearances within the era, descending."
        ),
    )


# ---------------------------------------------------------------------------
# Endpoint: GET /api/browse/years
# ---------------------------------------------------------------------------


@router.get(
    "/years",
    response_model=list[YearRow],
    summary="Per-year coverage of the callbook corpus",
    response_description=(
        "One object per year present in ``stats_per_year``, sorted "
        "chronologically ascending."
    ),
)
def list_years(conn: sqlite3.Connection = Depends(get_db)) -> list[YearRow]:
    """List every year in the corpus with its entry count and era tag.

    Reads from the materialized ``stats_per_year`` table — never scans
    ``entries`` at request time. Returns ~83 rows.
    """
    rows = conn.execute(
        """
        SELECT year, entry_count, distinct_callsigns
        FROM   stats_per_year
        ORDER  BY year ASC
        """
    ).fetchall()

    return [
        YearRow(
            year=int(r["year"]),
            count=int(r["entry_count"]),
            era=era_for_year(int(r["year"])),
            distinct_callsigns=int(r["distinct_callsigns"]),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Endpoint: GET /api/browse/editions
# ---------------------------------------------------------------------------


@router.get(
    "/editions",
    response_model=list[EditionRow],
    summary="Every printed Callbook edition in the corpus",
    response_description=(
        "One object per row of the ``editions`` table — 99 editions "
        "spanning 1909-1997. Sorted by year ascending, then by label."
    ),
)
def list_editions(conn: sqlite3.Connection = Depends(get_db)) -> list[EditionRow]:
    """Return every row of the ``editions`` reference table.

    The corpus has 99 editions, so sending them all in one response is
    well under any reasonable payload budget (~12 KB JSON) and lets the
    frontend render a static shelf without pagination.
    """
    rows = conn.execute(
        """
        SELECT key, year, label, csv_file, entry_count, parse_quality
        FROM   editions
        ORDER  BY year ASC, label ASC
        """
    ).fetchall()

    return [
        EditionRow(
            key=r["key"],
            year=int(r["year"]),
            label=r["label"] or "",
            csv_file=r["csv_file"],
            # entry_count is NOT NULL in practice, but defend against
            # any historic rows that slipped through.
            entry_count=int(r["entry_count"] or 0),
            parse_quality=r["parse_quality"],
            era=era_for_year(int(r["year"])),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Endpoint: GET /api/browse/eras
# ---------------------------------------------------------------------------


def _notable_for_era(
    conn: sqlite3.Connection,
    era_key: str,
    start_year: int,
    end_year: int,
) -> list[NotableCallsign]:
    """Look up curated notable callsigns and filter to those in-corpus.

    For each candidate callsign we ask ``entries`` (indexed by callsign)
    for the count, min-year, and max-year *within this era's year span*.
    Candidates that produce zero rows are dropped — we never surface a
    "notable" pick that the user can't actually click through to.

    The results are sorted by appearances descending so the headline
    callsign for each era leads the list.
    """
    candidates = NOTABLE_CALLSIGNS_BY_ERA.get(era_key, ())
    if not candidates:
        return []

    results: list[NotableCallsign] = []
    for callsign in candidates:
        row = conn.execute(
            """
            SELECT COUNT(*) AS appearances,
                   MIN(year) AS first_year,
                   MAX(year) AS last_year
            FROM   entries
            WHERE  callsign = ?
              AND  year BETWEEN ? AND ?
            """,
            (callsign, start_year, end_year),
        ).fetchone()
        appearances = int(row["appearances"] or 0)
        if appearances == 0:
            continue
        results.append(
            NotableCallsign(
                callsign=callsign,
                appearances=appearances,
                first_year=int(row["first_year"]),
                last_year=int(row["last_year"]),
            )
        )

    results.sort(key=lambda n: n.appearances, reverse=True)
    return results


@router.get(
    "/eras",
    response_model=list[EraRow],
    summary="Per-era statistics with representative notable callsigns",
    response_description=(
        "Four objects, one per era key, in chronological order: "
        "pre-1928, 1928-1962, 1963-1997, 2003."
    ),
)
def list_eras(conn: sqlite3.Connection = Depends(get_db)) -> list[EraRow]:
    """Aggregate the corpus into the four historical eras.

    Pulls year totals from the materialized ``stats_per_year`` table and
    edition counts from ``editions``, then attaches a curated set of
    notable callsigns filtered against the actual corpus rows.
    """
    # Pull all per-year aggregates once — 83 rows, cheap.
    year_rows = conn.execute(
        """
        SELECT year, entry_count, distinct_callsigns
        FROM   stats_per_year
        """
    ).fetchall()

    # Pull edition counts per year once — 99 rows, cheap.
    edition_year_counts: dict[int, int] = {}
    for r in conn.execute("SELECT year, COUNT(*) AS n FROM editions GROUP BY year"):
        edition_year_counts[int(r["year"])] = int(r["n"])

    # Bucket per-year stats into eras.
    era_buckets: dict[str, dict[str, int]] = {
        key: {
            "year_count": 0,
            "edition_count": 0,
            "total_entries": 0,
            "distinct_callsigns": 0,
        }
        for key in ERA_KEYS
    }
    for r in year_rows:
        year = int(r["year"])
        key = era_for_year(year)
        if key == "unknown":
            # Should be impossible for the canonical 1909-1997+2003 corpus,
            # but skip rather than crash if a new year is ever added without
            # extending ERA_DEFINITIONS.
            continue
        bucket = era_buckets[key]
        bucket["year_count"] += 1
        bucket["total_entries"] += int(r["entry_count"] or 0)
        bucket["distinct_callsigns"] += int(r["distinct_callsigns"] or 0)
        bucket["edition_count"] += edition_year_counts.get(year, 0)

    response: list[EraRow] = []
    for key, start_year, end_year, description in ERA_DEFINITIONS:
        agg = era_buckets[key]
        response.append(
            EraRow(
                key=key,
                start_year=start_year,
                end_year=end_year,
                description=description,
                year_count=agg["year_count"],
                edition_count=agg["edition_count"],
                total_entries=agg["total_entries"],
                distinct_callsigns=agg["distinct_callsigns"],
                notable_callsigns=_notable_for_era(
                    conn, key, start_year, end_year
                ),
            )
        )
    return response
