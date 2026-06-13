"""build_data_release.py — Open Data Portal artifact builder.

Produces per-edition CSV files and a MANIFEST.json for the Open Data Portal.

Outputs to data/downloads/ (relative to project root or DATA_DIR env var).
Each edition gets:
    {year}_{label}.csv          — all entries for that edition
    {year}_{label}.csv.sha256   — SHA-256 checksum

Plus a MANIFEST.json listing all files with size, sha256, row_count, etc.

Usage:
    python3 backend/app/scripts/build_data_release.py
    DB_PATH=... DATA_DIR=... python3 backend/app/scripts/build_data_release.py
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("build_data_release")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_PATH: str = os.environ.get(
    "DB_PATH",
    str(Path(__file__).resolve().parents[3] / "data" / "USA_Ham_Callbooks.sqlite"),
)

DATA_DIR: str = os.environ.get(
    "DATA_DIR",
    str(Path(__file__).resolve().parents[3] / "data"),
)

DOWNLOADS_DIR: Path = Path(DATA_DIR) / "downloads"

DATASET_VERSION = "v2026.06"

ENTRY_COLUMNS = [
    "year",
    "edition",
    "callsign",
    "license_class",
    "name",
    "address",
    "city",
    "state",
    "zip",
]

# Chunk size for streaming reads
CHUNK_SIZE = 10_000


def _safe_filename(year: int, label: str) -> str:
    """Build a filesystem-safe filename stem from edition key parts."""
    safe_label = re.sub(r"[^A-Za-z0-9_\-]", "_", label)
    return f"{year}_{safe_label}"


def _sha256_file(path: Path) -> str:
    """SHA-256 hex digest of a file, streaming."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def _connect_ro() -> sqlite3.Connection:
    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def _get_editions(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all editions with entry_count > 0 ordered by year."""
    rows = conn.execute(
        "SELECT key, year, label, entry_count FROM editions "
        "WHERE entry_count > 0 ORDER BY year, label"
    ).fetchall()
    return [dict(r) for r in rows]


def _write_edition_csv(
    conn: sqlite3.Connection,
    year: int,
    label: str,
    out_path: Path,
) -> int:
    """Stream edition entries to a CSV file. Returns row count written."""
    row_count = 0
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(ENTRY_COLUMNS)
        # Stream in chunks to avoid loading 400K+ rows into memory at once
        offset = 0
        while True:
            rows = conn.execute(
                "SELECT year, edition, callsign, license_class, name, "
                "address, city, state, zip "
                "FROM entries WHERE year = ? AND edition = ? "
                "ORDER BY callsign "
                "LIMIT ? OFFSET ?",
                (year, label, CHUNK_SIZE, offset),
            ).fetchall()
            if not rows:
                break
            for row in rows:
                writer.writerow([row[c] if row[c] is not None else "" for c in ENTRY_COLUMNS])
            row_count += len(rows)
            offset += CHUNK_SIZE
    return row_count


def build_release() -> dict[str, Any]:
    """Build all per-edition CSVs and MANIFEST.json. Returns the manifest dict."""
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

    conn = _connect_ro()

    # Dataset meta
    meta_rows = conn.execute("SELECT key, value FROM dataset_meta").fetchall()
    dataset_meta = {r["key"]: r["value"] for r in meta_rows}

    editions = _get_editions(conn)
    logger.info("Found %d editions with data", len(editions))

    manifest_files: list[dict[str, Any]] = []
    total_rows_written = 0
    t_start = time.perf_counter()

    for idx, ed in enumerate(editions, 1):
        year = ed["year"]
        label = ed["label"]
        stem = _safe_filename(year, label)
        csv_path = DOWNLOADS_DIR / f"{stem}.csv"
        sha_path = DOWNLOADS_DIR / f"{stem}.csv.sha256"

        logger.info("[%d/%d] Writing %s (%d entries)...", idx, len(editions), stem, ed["entry_count"])
        t0 = time.perf_counter()

        row_count = _write_edition_csv(conn, year, label, csv_path)
        sha256 = _sha256_file(csv_path)

        # Write sidecar
        sha_path.write_text(f"{sha256}  {stem}.csv\n", encoding="utf-8")

        size_bytes = csv_path.stat().st_size
        elapsed = time.perf_counter() - t0
        logger.info("  -> %d rows, %.1f KB, %.2fs", row_count, size_bytes / 1024, elapsed)

        manifest_files.append({
            "filename": f"{stem}.csv",
            "year": year,
            "edition_label": label,
            "edition_key": ed["key"],
            "row_count": row_count,
            "size_bytes": size_bytes,
            "sha256": sha256,
        })
        total_rows_written += row_count

    conn.close()

    manifest: dict[str, Any] = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_version": DATASET_VERSION,
        "build_timestamp": dataset_meta.get("build_timestamp"),
        "schema_version": dataset_meta.get("schema_version"),
        "total_editions": len(manifest_files),
        "total_rows": total_rows_written,
        "columns": ENTRY_COLUMNS,
        "license": "Public domain (US Government records)",
        "source": dataset_meta.get("source_url_leehite", "https://leehite.org/callbooks/"),
        "files": manifest_files,
    }

    manifest_path = DOWNLOADS_DIR / "MANIFEST.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    elapsed_total = time.perf_counter() - t_start
    logger.info(
        "Done: %d editions, %d total rows, %.1fs. Manifest: %s",
        len(manifest_files),
        total_rows_written,
        elapsed_total,
        manifest_path,
    )

    return manifest


if __name__ == "__main__":
    manifest = build_release()
    # Print brief summary to stdout
    print(json.dumps({
        "total_editions": manifest["total_editions"],
        "total_rows": manifest["total_rows"],
        "files": [
            {"filename": f["filename"], "size_bytes": f["size_bytes"], "sha256": f["sha256"][:16] + "..."}
            for f in manifest["files"][:3]
        ],
        "manifest": str(DOWNLOADS_DIR / "MANIFEST.json"),
    }, indent=2))
