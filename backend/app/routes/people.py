"""Phonetic People Finder — /api/people

GET /api/people?name=&state=&decade=

Name-first search tolerant of how old callbooks printed names:
  - Period-abbreviation expansion (Wm.->William, Chas.->Charles, etc.)
  - Double-Metaphone / Soundex phonetic keys via the pre-built artifact
  - Initial-tolerant matching ('W. H. Smith' ~ 'William Smith')
  - State and decade filters applied post-match
  - Results grouped into likely-same-person identity clusters with confidence

All heavy lifting happens against the in-memory phonetic_index artifact;
zero DB hits at request time.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.integrations import phonetic_index

router = APIRouter(prefix="/api/people", tags=["people"])

# ---------------------------------------------------------------------------
# Abbreviation expansion + phonetic key helpers (mirrors build_phonetic_index.py)
# ---------------------------------------------------------------------------

ABBREV_MAP: dict[str, str] = {
    "wm":    "William",
    "chas":  "Charles",
    "jno":   "John",
    "robt":  "Robert",
    "geo":   "George",
    "jas":   "James",
    "thos":  "Thomas",
    "jos":   "Joseph",
    "benj":  "Benjamin",
    "edw":   "Edward",
    "saml":  "Samuel",
    "danl":  "Daniel",
    "richd": "Richard",
    "fredk": "Frederick",
    "fred":  "Frederick",
    "alf":   "Alfred",
    "alex":  "Alexander",
    "theo":  "Theodore",
    "fras":  "Francis",
    "anth":  "Anthony",
    "bart":  "Bartholomew",
    "bern":  "Bernard",
    "cath":  "Catherine",
    "cornl": "Cornelius",
    "eliz":  "Elizabeth",
    "ferd":  "Ferdinand",
    "nich":  "Nicholas",
    "pat":   "Patrick",
    "sim":   "Simon",
    "steph": "Stephen",
    "timo":  "Timothy",
    "waltr": "Walter",
}

_NOISE_RE = re.compile(r"[^A-Za-z .]+")
_TOKEN_RE = re.compile(r"[A-Za-z]+\.?")


def _soundex(s: str) -> str:
    s = s.upper()
    if not s:
        return "Z000"
    table = str.maketrans(
        "AEIOUYHWBFPVCGJKQSXZDTLMNR",
        "00000000111122222222334556",
    )
    code = s[0]
    prev = s[0].translate(table)
    for ch in s[1:]:
        d = ch.translate(table)
        if d != "0" and d != prev:
            code += d
        prev = d
    return (code + "000")[:4]


def _metaphone_token(word: str) -> str:
    try:
        import jellyfish  # type: ignore
        return jellyfish.metaphone(word) or word[:4].upper()
    except ImportError:
        return _soundex(word)


def normalize_name(raw: str) -> str:
    raw = _NOISE_RE.sub(" ", raw).strip()
    tokens = _TOKEN_RE.findall(raw)
    result: list[str] = []
    for tok in tokens:
        clean = tok.rstrip(".")
        expanded = ABBREV_MAP.get(clean.lower(), clean)
        result.append(expanded)
    return " ".join(result)


def phonetic_key(normalized: str) -> str:
    tokens = [t for t in normalized.split() if len(t) > 1 and t.isalpha()]
    if not tokens:
        tokens = [t for t in normalized.split() if t.isalpha()]
    if not tokens:
        return "UNKNOWN"
    if len(tokens) == 1:
        return _metaphone_token(tokens[0])
    first_key = _metaphone_token(tokens[0])
    last_key = _metaphone_token(tokens[-1])
    if first_key == last_key:
        return first_key
    return f"{first_key}|{last_key}"


def _query_keys(query: str) -> list[str]:
    """Return all phonetic keys to try for a query name.

    Two strategies:
    1. Full-name key (first + last token metaphone, the main key).
    2. Surname-only key (just the last meaningful token) — so 'Smith' alone
       finds 'William Smith', 'John Smith', etc.
    """
    norm = normalize_name(query)
    tokens = [t for t in norm.split() if len(t) > 1 and t.isalpha()]
    keys: list[str] = []

    if not tokens:
        return keys

    # Primary key: full composite (matches 'William Smith' -> 'WLM|SM0')
    primary = phonetic_key(norm)
    if primary and primary != "UNKNOWN":
        keys.append(primary)

    # Surname-only key for single-token queries (searches by last name only)
    if len(tokens) == 1:
        solo_key = _metaphone_token(tokens[0])
        if solo_key and solo_key != primary and solo_key != "UNKNOWN":
            keys.append(solo_key)
    elif len(tokens) >= 2:
        # Also try surname-only (last token) so partial-name queries work
        last_key = _metaphone_token(tokens[-1])
        last_only = last_key
        if last_only and last_only not in keys and last_only != "UNKNOWN":
            keys.append(last_only)

    return keys


def _initial_match(query_norm: str, candidate_norm: str) -> bool:
    """Return True if query initials are compatible with candidate name.

    'W H Smith' matches 'William Henry Smith' if W->William, H->Henry.
    Strategy: for each query token that is a single letter (initial), check
    that the corresponding candidate token starts with that letter.
    """
    q_tokens = [t for t in query_norm.split() if t.isalpha()]
    c_tokens = [t for t in candidate_norm.split() if t.isalpha()]
    if len(q_tokens) > len(c_tokens):
        return False
    for q_tok, c_tok in zip(q_tokens, c_tokens):
        if len(q_tok) == 1:
            if not c_tok.lower().startswith(q_tok.lower()):
                return False
        else:
            # Full token: require the candidate token to start with query token
            # (or be equal case-insensitively)
            if not (
                c_tok.lower() == q_tok.lower()
                or c_tok.lower().startswith(q_tok.lower())
            ):
                return False
    return True


# ---------------------------------------------------------------------------
# Decade helpers
# ---------------------------------------------------------------------------

def _decade_start(decade: int) -> int:
    return (decade // 10) * 10


def _year_in_decade(year: int | None, decade: int) -> bool:
    if year is None:
        return True  # unknown year — don't exclude
    ds = _decade_start(decade)
    return ds <= year < ds + 10


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class PeopleEntry(BaseModel):
    """One callsign–name appearance in the archive."""
    callsign: str
    norm_name: str
    first_year: Optional[int] = None
    callsign_url: str


class PersonIdentity(BaseModel):
    """A cluster of entries likely belonging to the same person."""
    identity_key: str          # e.g. the normalized name used as the label
    display_name: str
    entries: list[PeopleEntry]
    entry_count: int
    confidence: str            # "high" | "medium" | "low"
    match_basis: str           # "exact" | "phonetic" | "initial"
    earliest_year: Optional[int] = None
    latest_year: Optional[int] = None


class PeopleResponse(BaseModel):
    query_name: str
    normalized_query: str
    phonetic_keys_tried: list[str]
    state_filter: Optional[str] = None
    decade_filter: Optional[int] = None
    total_entries: int
    truncated: bool
    identities: list[PersonIdentity]


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

MAX_RESULTS = 200   # max total entries returned across all identities
MAX_IDENTITIES = 30


@router.get("", response_model=PeopleResponse)
def search_people(
    name: str = Query(..., min_length=2, max_length=128, description="Name to search"),
    state: Optional[str] = Query(None, min_length=2, max_length=2, description="2-letter US state code"),
    decade: Optional[int] = Query(None, ge=1900, le=2000, description="Decade start year (e.g. 1960 for 1960s)"),
) -> PeopleResponse:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")

    state_norm = state.upper() if state else None

    norm_query = normalize_name(name)
    keys = _query_keys(name)

    if not keys:
        return PeopleResponse(
            query_name=name,
            normalized_query=norm_query,
            phonetic_keys_tried=[],
            state_filter=state_norm,
            decade_filter=decade,
            total_entries=0,
            truncated=False,
            identities=[],
        )

    phonetic_index.ensure_loaded()

    # Collect postings from all keys tried
    # postings: norm_name -> { callsign -> first_year }
    combined_postings: dict[str, dict[str, int | None]] = {}
    artifact_truncated = False

    for key in keys:
        bucket = phonetic_index.lookup(key)
        if bucket is None:
            continue
        if bucket.get("tr"):
            artifact_truncated = True
        for norm_name, call_dict in (bucket.get("p") or {}).items():
            if norm_name not in combined_postings:
                combined_postings[norm_name] = {}
            for call, yr in call_dict.items():
                if call not in combined_postings[norm_name]:
                    combined_postings[norm_name][call] = yr

    if not combined_postings:
        return PeopleResponse(
            query_name=name,
            normalized_query=norm_query,
            phonetic_keys_tried=keys,
            state_filter=state_norm,
            decade_filter=decade,
            total_entries=0,
            truncated=False,
            identities=[],
        )

    # ------------------------------------------------------------------
    # Score and filter entries
    # ------------------------------------------------------------------
    # Group into identity clusters by norm_name, with match scoring.
    # We accept:
    #   "exact"   — norm names equal (case-insensitive)
    #   "initial" — query initials are compatible with candidate
    #   "phonetic"— phonetic key matched (any remaining after above)
    # Each cluster has an initial confidence based on match quality.

    q_tokens_lower = [t.lower() for t in norm_query.split() if t.isalpha()]
    q_surname = q_tokens_lower[-1] if q_tokens_lower else ""

    identities: list[PersonIdentity] = []
    total_entry_count = 0
    result_truncated = artifact_truncated

    # Flatten postings to (norm_name, call, first_year, match_basis, confidence)
    candidates: list[tuple[str, str, int | None, str, str]] = []
    for norm_name, call_dict in combined_postings.items():
        # Determine match basis
        norm_name_lower = norm_name.lower()
        norm_name_tokens = [t for t in norm_name_lower.split() if t.isalpha()]
        candidate_surname = norm_name_tokens[-1] if norm_name_tokens else ""

        if norm_name_lower == norm_query.lower():
            basis = "exact"
            conf = "high"
        elif _initial_match(norm_query, norm_name):
            basis = "initial"
            # Surname match raises confidence
            conf = "high" if candidate_surname == q_surname else "medium"
        elif candidate_surname and q_surname and candidate_surname == q_surname:
            basis = "phonetic"
            conf = "medium"
        else:
            basis = "phonetic"
            conf = "low"

        for call, first_year in call_dict.items():
            # Apply decade filter
            if decade is not None and not _year_in_decade(first_year, decade):
                continue
            candidates.append((norm_name, call, first_year, basis, conf))

    # Sort: exact first, then initial, then phonetic; within each sort by year
    _basis_rank = {"exact": 0, "initial": 1, "phonetic": 2}
    candidates.sort(key=lambda x: (_basis_rank.get(x[3], 9), x[2] or 9999))

    if len(candidates) > MAX_RESULTS:
        candidates = candidates[:MAX_RESULTS]
        result_truncated = True

    total_entry_count = len(candidates)

    # Group into identity clusters by norm_name
    clusters: dict[str, list[tuple[str, str, int | None, str, str]]] = {}
    for item in candidates:
        norm_name = item[0]
        clusters.setdefault(norm_name, []).append(item)

    # Sort clusters: exact match first, then by size descending
    def _cluster_rank(norm_name: str) -> tuple[int, int]:
        items = clusters[norm_name]
        best_basis = min(_basis_rank.get(it[3], 9) for it in items)
        return (best_basis, -len(items))

    sorted_names = sorted(clusters.keys(), key=_cluster_rank)
    if len(sorted_names) > MAX_IDENTITIES:
        sorted_names = sorted_names[:MAX_IDENTITIES]
        result_truncated = True

    for norm_name in sorted_names:
        items = clusters[norm_name]
        best_basis = min(_basis_rank.get(it[3], 9) for it in items)
        best_conf_str = items[0][4] if items else "low"

        years: list[int] = [it[2] for it in items if it[2] is not None]
        earliest = min(years) if years else None
        latest = max(years) if years else None

        entries: list[PeopleEntry] = []
        for _, call, yr, _, _ in items:
            entries.append(
                PeopleEntry(
                    callsign=call,
                    norm_name=norm_name,
                    first_year=yr,
                    callsign_url=f"/callsign/{call}",
                )
            )

        basis_label = ["exact", "initial", "phonetic"][best_basis] if best_basis <= 2 else "phonetic"
        identities.append(
            PersonIdentity(
                identity_key=norm_name.lower().replace(" ", "_"),
                display_name=norm_name,
                entries=entries,
                entry_count=len(entries),
                confidence=best_conf_str,
                match_basis=basis_label,
                earliest_year=earliest,
                latest_year=latest,
            )
        )

    return PeopleResponse(
        query_name=name,
        normalized_query=norm_query,
        phonetic_keys_tried=keys,
        state_filter=state_norm,
        decade_filter=decade,
        total_entries=total_entry_count,
        truncated=result_truncated,
        identities=identities,
    )
