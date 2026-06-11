"""build_uls_history.py — Build data/uls_history.json from the FCC ULS l_amat.zip.

Reads AM.dat, HD.dat, EN.dat streaming from the zip (never loads a full .dat
into RAM). Writes a compact JSON artifact keyed by callsign. Inclusion criteria:
  - callsign has a previous_callsign (AM field idx 15), OR
  - callsign has more than one HD record (multiple license grant epochs)

Output schema per callsign:
  {
    "prev_call": "KA0CAJ" | null,
    "prev_class": "T" | null,
    "licenses": [
      {"usi": "...", "name": "...", "status": "A", "grant": "1998-12-04",
       "expired": "2003-05-04", "cancel": null},
      ...
    ] | null
  }

licenses=null when the callsign only has a prev_call entry and exactly one HD row.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
import zipfile
from collections import defaultdict
from datetime import datetime
from typing import Any

ZIP_PATH = "/home/kasm-user/leehite-callbooks/xref_out/uls/l_amat.zip"
OUT_PATH = "/home/kasm-user/ham-callbook-site/data/uls_history.json"
TMP_PATH = OUT_PATH + ".tmp"

ENCODING = "latin-1"


def _mmddyyyy_to_iso(s: str) -> str | None:
    """Convert 'MM/DD/YYYY' to 'YYYY-MM-DD', return None if blank/invalid."""
    s = s.strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _mmddyyyy_to_sortkey(s: str) -> str:
    """Return YYYYMMDD string for sorting; empty dates sort last."""
    s = s.strip()
    if not s:
        return "99999999"
    try:
        return datetime.strptime(s, "%m/%d/%Y").strftime("%Y%m%d")
    except ValueError:
        return "99999999"


def stream_dat(zf: zipfile.ZipFile, name: str):
    """Yield parsed pipe-delimited rows from a .dat file in the zip."""
    with zf.open(name) as raw:
        reader = io.TextIOWrapper(raw, encoding=ENCODING, errors="replace")
        for line in reader:
            line = line.rstrip("\r\n")
            if not line:
                continue
            yield line.split("|")


def build():
    t0 = time.time()
    print(f"Opening {ZIP_PATH} ...")

    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        members = zf.namelist()
        print(f"  Zip members: {members}")

        # ------------------------------------------------------------------ #
        # Pass 1 — AM.dat: collect prev_call / prev_class per callsign        #
        # ------------------------------------------------------------------ #
        print("Pass 1: AM.dat ...")
        # {callsign -> (prev_callsign, prev_class, usi)}
        am_prev: dict[str, tuple[str, str, str]] = {}
        am_count = 0
        for row in stream_dat(zf, "AM.dat"):
            if len(row) < 17:
                continue
            usi = row[1].strip()
            callsign = row[4].strip().upper()
            prev_cs = row[15].strip().upper()
            prev_class = row[16].strip() if len(row) > 16 else ""
            if not callsign:
                continue
            am_count += 1
            if prev_cs:
                am_prev[callsign] = (prev_cs, prev_class, usi)
        print(f"  AM rows: {am_count:,}  |  callsigns with prev_call: {len(am_prev):,}")

        # ------------------------------------------------------------------ #
        # Pass 2 — HD.dat: collect all license rows per callsign              #
        # ------------------------------------------------------------------ #
        print("Pass 2: HD.dat ...")
        # {callsign -> list of [usi, status, grant, expired, cancel]}
        hd_by_call: dict[str, list[list[str]]] = defaultdict(list)
        hd_count = 0
        for row in stream_dat(zf, "HD.dat"):
            if len(row) < 10:
                continue
            usi = row[1].strip()
            callsign = row[4].strip().upper()
            status = row[5].strip()
            grant = row[7].strip()
            expired = row[8].strip()
            cancel = row[9].strip()
            if not callsign or not usi:
                continue
            hd_count += 1
            hd_by_call[callsign].append([usi, status, grant, expired, cancel])
        print(f"  HD rows: {hd_count:,}  |  unique callsigns: {len(hd_by_call):,}")

        multi_hd_calls = {cs for cs, rows in hd_by_call.items() if len(rows) > 1}
        print(f"  Multi-license callsigns: {len(multi_hd_calls):,}")

        # ------------------------------------------------------------------ #
        # Pass 3 — EN.dat: collect name per USI (only USIs we need)           #
        # ------------------------------------------------------------------ #
        # Determine which USIs we need
        needed_usi: set[str] = set()
        # From multi-HD callsigns
        for cs in multi_hd_calls:
            for row in hd_by_call[cs]:
                needed_usi.add(row[0])
        # From prev_call callsigns (single HD — just need the one USI)
        for cs, (prev_cs, prev_cls, usi) in am_prev.items():
            if cs not in multi_hd_calls:
                # Only need name if we're emitting a licenses array
                # For prev_call-only entries, licenses=null, so we skip
                pass
            else:
                # already covered above
                pass

        print(f"Pass 3: EN.dat (need {len(needed_usi):,} USIs) ...")
        # {usi -> name_string}
        en_names: dict[str, str] = {}
        en_count = 0
        for row in stream_dat(zf, "EN.dat"):
            if len(row) < 11:
                continue
            usi = row[1].strip()
            if usi not in needed_usi:
                continue
            entity_name = row[7].strip()
            first = row[8].strip()
            last = row[10].strip()
            # Build display name: prefer "First Last" for individuals
            if first and last:
                name = f"{first} {last}"
            elif entity_name:
                name = entity_name
            elif last:
                name = last
            else:
                name = entity_name
            en_names[usi] = name
            en_count += 1
        print(f"  EN rows matched: {en_count:,}")

    # ---------------------------------------------------------------------- #
    # Build output dict                                                        #
    # ---------------------------------------------------------------------- #
    print("Building output ...")
    out: dict[str, Any] = {}

    # All callsigns that qualify (prev_call OR multi-HD)
    qualifying = set(am_prev.keys()) | multi_hd_calls

    prev_call_only = 0
    multi_license_count = 0

    for cs in qualifying:
        prev_cs: str | None = None
        prev_class: str | None = None

        if cs in am_prev:
            prev_cs, prev_class, _usi = am_prev[cs]
            prev_call_only += 1

        licenses = None
        if cs in multi_hd_calls:
            multi_license_count += 1
            rows = hd_by_call[cs]
            # Sort by grant_date ascending
            rows_sorted = sorted(rows, key=lambda r: _mmddyyyy_to_sortkey(r[2]))
            licenses = []
            for (usi, status, grant, expired, cancel) in rows_sorted:
                name = en_names.get(usi, "")
                licenses.append({
                    "usi": usi,
                    "name": name,
                    "status": status,
                    "grant": _mmddyyyy_to_iso(grant),
                    "expired": _mmddyyyy_to_iso(expired),
                    "cancel": _mmddyyyy_to_iso(cancel),
                })

        entry: dict[str, Any] = {
            "prev_call": prev_cs or None,
            "prev_class": (prev_class if prev_class else None),
            "licenses": licenses,
        }
        out[cs] = entry

    print(f"  Total qualifying callsigns: {len(out):,}")
    print(f"  With prev_call: {prev_call_only:,}")
    print(f"  With multi-license chains: {multi_license_count:,}")

    # ---------------------------------------------------------------------- #
    # Spot-checks before writing                                               #
    # ---------------------------------------------------------------------- #
    print("\n--- SPOT CHECK: AA0AA ---")
    aa0aa = out.get("AA0AA")
    if aa0aa:
        print(json.dumps(aa0aa, indent=2))
    else:
        print("  AA0AA not found in output")

    print("\n--- SPOT CHECK: KY6W ---")
    ky6w = out.get("KY6W")
    if ky6w:
        print(json.dumps(ky6w, indent=2))
    else:
        print("  KY6W not found in output")

    # ---------------------------------------------------------------------- #
    # Write atomically                                                         #
    # ---------------------------------------------------------------------- #
    print(f"\nWriting {TMP_PATH} ...")
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(TMP_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    os.replace(TMP_PATH, OUT_PATH)
    size_mb = os.path.getsize(OUT_PATH) / 1024 / 1024
    elapsed = time.time() - t0

    print(f"\n=== STATS ===")
    print(f"  Keys written:          {len(out):,}")
    print(f"  prev_call links:       {prev_call_only:,}")
    print(f"  multi-license chains:  {multi_license_count:,}")
    print(f"  File size:             {size_mb:.1f} MB")
    print(f"  Elapsed:               {elapsed:.1f}s")
    print(f"  Output:                {OUT_PATH}")


if __name__ == "__main__":
    build()
