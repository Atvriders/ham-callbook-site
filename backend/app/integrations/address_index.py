"""Address Index integration — Address Clusters + Households artifact loaders.

Thread-safe lazy loaders for:
- ``data/address_clusters.json`` (multi-occupant address clusters, callsign index)
- ``data/households.json`` (co-resident same-surname clusters)

Both artifacts are produced by ``app.scripts.build_address_index``.

Public surface
--------------
``search_address(q, city, state, limit)``   -- normalized search across clusters
``get_cluster(cluster_key)``                -- exact cluster lookup
``clusters_for_callsign(cs)``               -- all cluster keys a callsign appears in
``get_households(state, limit, offset)``    -- paginated household browse
``get_household(cluster_key, surname)``     -- single household lookup
``ensure_loaded()``                         -- warm both caches
``reload()``                                -- force reload
``stats()``                                 -- diagnostics dict
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
from datetime import datetime
from typing import Any, Final

logger = logging.getLogger("callbook.backend.address_index")

# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #

ADDRESS_INDEX_PATH: Final[str] = os.environ.get(
    "ADDRESS_INDEX_PATH", "/data/address_clusters.json"
)
ADDRESS_INDEX_UPSTREAM_PATH: Final[str] = os.environ.get(
    "ADDRESS_INDEX_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/address_clusters.json",
)

HOUSEHOLDS_PATH: Final[str] = os.environ.get(
    "HOUSEHOLDS_PATH", "/data/households.json"
)
HOUSEHOLDS_UPSTREAM_PATH: Final[str] = os.environ.get(
    "HOUSEHOLDS_UPSTREAM_PATH",
    "/home/kasm-user/ham-callbook-site/data/households.json",
)

# --------------------------------------------------------------------------- #
# Normalization (mirrors build_address_index.py rules)                        #
# --------------------------------------------------------------------------- #

_STREET_TYPES: Final[dict[str, str]] = {
    "ST": "STREET", "AVE": "AVENUE", "AV": "AVENUE",
    "BLVD": "BOULEVARD", "BLV": "BOULEVARD",
    "DR": "DRIVE", "DRV": "DRIVE",
    "RD": "ROAD", "LN": "LANE",
    "CT": "COURT", "CRT": "COURT",
    "PL": "PLACE", "TER": "TERRACE", "TR": "TERRACE",
    "CIR": "CIRCLE", "PKWY": "PARKWAY", "PKY": "PARKWAY",
    "HWY": "HIGHWAY", "EXPY": "EXPRESSWAY", "WAY": "WAY",
}

_DIRECTIONALS: Final[dict[str, str]] = {
    "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST",
    "NE": "NORTHEAST", "NW": "NORTHWEST", "SE": "SOUTHEAST", "SW": "SOUTHWEST",
}

_APT_NOISE: Final[set[str]] = {"APT", "UNIT", "STE", "SUITE", "RM", "ROOM", "FL", "FLR", "#"}

_ORDINAL_RE = re.compile(r"^(\d+)(ST|ND|RD|TH)$")
_JUNK_RE = re.compile(r"^[.,;:\-]+$")


def normalize_address(raw: str) -> str:
    """Return a canonical uppercase key for a raw address string."""
    raw = re.sub(r"[ \t]+", " ", raw).strip().upper()
    raw = raw.strip(".,;:-")

    # PO Box normalization
    po_match = re.match(r"^P\.?\s*O\.?\s*BOX\s+(\d+)", raw) or re.match(r"^BOX\s+(\d+)", raw)
    if po_match:
        return f"BOX {po_match.group(1)}"

    tokens = raw.split()
    out: list[str] = []
    skip_rest = False
    for tok in tokens:
        if skip_rest:
            break
        if tok in _APT_NOISE:
            skip_rest = True
            break
        # ordinal
        m = _ORDINAL_RE.match(tok)
        if m:
            out.append(m.group(1))
            continue
        # junk lone char (not a digit)
        if len(tok) == 1 and not tok.isdigit():
            continue
        if _JUNK_RE.match(tok):
            continue
        # street type expansion
        if tok in _STREET_TYPES:
            out.append(_STREET_TYPES[tok])
            continue
        # directional expansion (only when it would be a prefix/suffix directional)
        if tok in _DIRECTIONALS:
            out.append(_DIRECTIONALS[tok])
            continue
        out.append(tok)

    return " ".join(out)


# --------------------------------------------------------------------------- #
# Cluster cache                                                                #
# --------------------------------------------------------------------------- #


class _AddressCache:
    """Thread-safe lazy loader for address_clusters.json."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._entries: dict[str, dict[str, Any]] = {}
        self._callsign_index: dict[str, list[str]] = {}
        self._generated: str | None = None
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None

    def _ensure_snapshot(self) -> None:
        if os.path.exists(ADDRESS_INDEX_PATH):
            return
        if not os.path.exists(ADDRESS_INDEX_UPSTREAM_PATH):
            logger.warning(
                "address_clusters artifact missing at %s and upstream at %s; "
                "address endpoints will return empty.",
                ADDRESS_INDEX_PATH, ADDRESS_INDEX_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(ADDRESS_INDEX_PATH) or ".", exist_ok=True)
            shutil.copy2(ADDRESS_INDEX_UPSTREAM_PATH, ADDRESS_INDEX_PATH)
            logger.info("Copied address_clusters %s -> %s", ADDRESS_INDEX_UPSTREAM_PATH, ADDRESS_INDEX_PATH)
        except OSError:
            logger.exception("Failed to copy address_clusters artifact")

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        path = ADDRESS_INDEX_PATH if os.path.exists(ADDRESS_INDEX_PATH) else ADDRESS_INDEX_UPSTREAM_PATH

        if not os.path.exists(path):
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse address_clusters artifact at %s", path)
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._entries = data.get("entries", {})
        self._callsign_index = data.get("callsign_index", {})
        self._generated = data.get("generated")
        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0
        logger.info(
            "Loaded address_clusters :: clusters=%d, callsign_index=%d, duration=%.2fs",
            len(self._entries), len(self._callsign_index), self._load_duration_s,
        )

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def reload(self) -> int:
        with self._lock:
            self._loaded = False
            self._entries = {}
            self._callsign_index = {}
            self._load_locked()
            return len(self._entries)

    def search(self, q: str, city: str | None, state: str | None, limit: int) -> list[dict[str, Any]]:
        self.ensure_loaded()
        norm_q = normalize_address(q)
        state_u = state.upper() if state else None
        city_u = city.upper() if city else None

        results: list[dict[str, Any]] = []
        for key, cluster in self._entries.items():
            parts = key.split("|")
            k_addr = parts[0] if parts else ""
            k_city = parts[1] if len(parts) > 1 else ""
            k_state = parts[2] if len(parts) > 2 else ""

            if state_u and k_state != state_u:
                continue
            if city_u and city_u not in k_city:
                continue
            if norm_q and norm_q not in k_addr and k_addr not in norm_q:
                # also try substring match on key
                if not k_addr.startswith(norm_q) and norm_q not in k_addr:
                    continue

            results.append({"cluster_key": key, **cluster})
            if len(results) >= limit:
                break

        return results

    def get_cluster(self, cluster_key: str) -> dict[str, Any] | None:
        self.ensure_loaded()
        cluster = self._entries.get(cluster_key)
        if cluster is None:
            return None
        return {"cluster_key": cluster_key, **cluster}

    def clusters_for_callsign(self, cs: str) -> list[dict[str, Any]]:
        self.ensure_loaded()
        keys = self._callsign_index.get(cs.upper(), [])
        results = []
        for k in keys:
            cluster = self._entries.get(k)
            if cluster:
                results.append({"cluster_key": k, **cluster})
        return results

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "cluster_count": len(self._entries),
            "callsign_index_count": len(self._callsign_index),
            "generated": self._generated,
            "load_duration_s": self._load_duration_s,
            "loaded_at": (
                datetime.utcfromtimestamp(self._loaded_at).isoformat() + "Z"
                if self._loaded_at else None
            ),
        }


# --------------------------------------------------------------------------- #
# Households cache                                                             #
# --------------------------------------------------------------------------- #


class _HouseholdsCache:
    """Thread-safe lazy loader for households.json."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._households: list[dict[str, Any]] = []
        self._by_cluster: dict[str, list[dict[str, Any]]] = {}
        self._generated: str | None = None
        self._loaded_at: float | None = None
        self._load_duration_s: float | None = None

    def _ensure_snapshot(self) -> None:
        if os.path.exists(HOUSEHOLDS_PATH):
            return
        if not os.path.exists(HOUSEHOLDS_UPSTREAM_PATH):
            logger.warning(
                "households artifact missing at %s and upstream at %s; "
                "households endpoints will return empty.",
                HOUSEHOLDS_PATH, HOUSEHOLDS_UPSTREAM_PATH,
            )
            return
        try:
            os.makedirs(os.path.dirname(HOUSEHOLDS_PATH) or ".", exist_ok=True)
            shutil.copy2(HOUSEHOLDS_UPSTREAM_PATH, HOUSEHOLDS_PATH)
            logger.info("Copied households %s -> %s", HOUSEHOLDS_UPSTREAM_PATH, HOUSEHOLDS_PATH)
        except OSError:
            logger.exception("Failed to copy households artifact")

    def _load_locked(self) -> None:
        if self._loaded:
            return
        self._ensure_snapshot()
        t0 = time.perf_counter()

        path = HOUSEHOLDS_PATH if os.path.exists(HOUSEHOLDS_PATH) else HOUSEHOLDS_UPSTREAM_PATH

        if not os.path.exists(path):
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = 0.0
            return

        try:
            with open(path, "rb") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Failed to parse households artifact at %s", path)
            self._loaded = True
            self._loaded_at = time.time()
            self._load_duration_s = time.perf_counter() - t0
            return

        self._households = data.get("households", [])
        self._generated = data.get("generated")

        # index by cluster_key for fast lookup
        self._by_cluster = {}
        for hh in self._households:
            ck = hh.get("cluster_key", "")
            self._by_cluster.setdefault(ck, []).append(hh)

        self._loaded = True
        self._loaded_at = time.time()
        self._load_duration_s = time.perf_counter() - t0
        logger.info(
            "Loaded households :: count=%d, clusters=%d, duration=%.2fs",
            len(self._households), len(self._by_cluster), self._load_duration_s,
        )

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            self._load_locked()

    def reload(self) -> int:
        with self._lock:
            self._loaded = False
            self._households = []
            self._by_cluster = {}
            self._load_locked()
            return len(self._households)

    def browse(self, state: str | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
        self.ensure_loaded()
        rows = self._households
        if state:
            st = state.upper()
            rows = [h for h in rows if st in h.get("cluster_key", "")]
        total = len(rows)
        return rows[offset: offset + limit], total

    def for_cluster(self, cluster_key: str) -> list[dict[str, Any]]:
        self.ensure_loaded()
        return list(self._by_cluster.get(cluster_key, []))

    def get_one(self, cluster_key: str, surname: str) -> dict[str, Any] | None:
        self.ensure_loaded()
        hhs = self._by_cluster.get(cluster_key, [])
        s = surname.upper()
        for hh in hhs:
            if hh.get("surname", "").upper() == s:
                return hh
        return None

    def stats(self) -> dict[str, Any]:
        return {
            "loaded": self._loaded,
            "household_count": len(self._households),
            "cluster_count": len(self._by_cluster),
            "generated": self._generated,
            "load_duration_s": self._load_duration_s,
            "loaded_at": (
                datetime.utcfromtimestamp(self._loaded_at).isoformat() + "Z"
                if self._loaded_at else None
            ),
        }


# --------------------------------------------------------------------------- #
# Module-level singletons + public wrappers                                   #
# --------------------------------------------------------------------------- #

_ADDR_CACHE = _AddressCache()
_HH_CACHE = _HouseholdsCache()


def search_address(
    q: str,
    city: str | None = None,
    state: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    return _ADDR_CACHE.search(q, city=city, state=state, limit=limit)


def get_cluster(cluster_key: str) -> dict[str, Any] | None:
    return _ADDR_CACHE.get_cluster(cluster_key)


def clusters_for_callsign(cs: str) -> list[dict[str, Any]]:
    return _ADDR_CACHE.clusters_for_callsign(cs)


def get_households(
    state: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    return _HH_CACHE.browse(state=state, limit=limit, offset=offset)


def households_for_cluster(cluster_key: str) -> list[dict[str, Any]]:
    return _HH_CACHE.for_cluster(cluster_key)


def get_household(cluster_key: str, surname: str) -> dict[str, Any] | None:
    return _HH_CACHE.get_one(cluster_key, surname)


def ensure_loaded() -> None:
    _ADDR_CACHE.ensure_loaded()
    _HH_CACHE.ensure_loaded()


def reload() -> dict[str, int]:
    return {
        "address_clusters": _ADDR_CACHE.reload(),
        "households": _HH_CACHE.reload(),
    }


def stats() -> dict[str, Any]:
    return {
        "address_clusters": _ADDR_CACHE.stats(),
        "households": _HH_CACHE.stats(),
    }


__all__ = [
    "ADDRESS_INDEX_PATH",
    "HOUSEHOLDS_PATH",
    "normalize_address",
    "search_address",
    "get_cluster",
    "clusters_for_callsign",
    "get_households",
    "households_for_cluster",
    "get_household",
    "ensure_loaded",
    "reload",
    "stats",
]
