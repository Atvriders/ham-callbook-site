"""Heuristics for detecting club/organization types from entity names.

Used by the club ingestion / classification pipeline to bucket entities into
broad categories before further enrichment.
"""

from __future__ import annotations

import re
from typing import Optional


# Order matters: more specific patterns should appear before generic ones.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("school", re.compile(r"\b(school|university|college|academy|institute of technology)\b", re.IGNORECASE)),
    ("scouting", re.compile(r"\b(scout|scouts|scouting|boy scouts|girl scouts|bsa|gsusa)\b", re.IGNORECASE)),
    ("military", re.compile(r"\b(mars|military|army|navy|air force|marine|coast guard|veterans|legion|vfw)\b", re.IGNORECASE)),
    ("emergency", re.compile(r"\b(ares|races|emergency|emcomm|skywarn|cert|red cross|fire|ems|sheriff|police)\b", re.IGNORECASE)),
    ("repeater", re.compile(r"\b(repeater|machine|linked system|reflector)\b", re.IGNORECASE)),
    ("contest", re.compile(r"\b(contest|contesting|dx|dxers|dxpedition)\b", re.IGNORECASE)),
    ("digital", re.compile(r"\b(digital|dmr|d-?star|fusion|ysf|allstar|echolink|aprs|packet|winlink)\b", re.IGNORECASE)),
    ("vhf_uhf", re.compile(r"\b(vhf|uhf|microwave|weak signal|6m|2m|70cm)\b", re.IGNORECASE)),
    ("qrp", re.compile(r"\b(qrp|low power|cw|morse)\b", re.IGNORECASE)),
    ("youth", re.compile(r"\b(youth|young|student|kids|junior)\b", re.IGNORECASE)),
    ("club", re.compile(r"\b(club|society|association|league|guild|group|net)\b", re.IGNORECASE)),
]

_DEFAULT_TYPE = "club"


def classify_club_type(name: Optional[str]) -> str:
    """Classify a club/organization name into a coarse type bucket.

    Returns one of: ``school``, ``scouting``, ``military``, ``emergency``,
    ``repeater``, ``contest``, ``digital``, ``vhf_uhf``, ``qrp``, ``youth``,
    ``club``, or ``unknown`` when no name is provided.
    """
    if not name or not name.strip():
        return "unknown"

    text = name.strip()
    for type_name, pattern in _PATTERNS:
        if pattern.search(text):
            return type_name
    return _DEFAULT_TYPE


__all__ = ["classify_club_type"]
