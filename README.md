# USA Ham Callbook Archive

U.S. amateur radio license records, **1909 to present** — a searchable
public archive of **7.38 million historic records** across 92 published
callbook editions (1909–1997 + 2003), fused with **1.59 million current FCC
licenses** refreshed weekly from the FCC's Universal Licensing System.

Look up any callsign and see a century of its history: the printed-callbook
paper trail through the 20th century, then the live FCC record — current
holder, license status, operator lineage — up to this week.

**1,300,794 distinct historic callsigns. 14,339 detected radio clubs. Every
entry traceable to its source.**

## What you can do

- **Look up any callsign** and see its complete paper trail — every edition
  it appeared in, who held it, where they lived, decade by decade
- **Operator lineage** — when an operator changed callsigns (vanity grants,
  upgrades), the chain is reconstructed from FCC records: *"previously
  KA0CAJ"*, with links in both directions (271,725 lineage records)
- **FCC license record chains** — for callsigns reissued since 1997, the full
  holder succession with grant/expiry dates, straight from the FCC ULS
- **Historic district reorganizations** — the 1947 W9→W0 split (Iowa, Kansas,
  Minnesota, Missouri, Nebraska, the Dakotas, Colorado) and the 1928
  W-prefix addition are linked automatically: W0QQQ shows its pre-1947
  identity as W9QQQ
- **Club search** — 14,339 radio clubs detected across the corpus, with
  multi-callsign timelines (a university club's calls across 60 years)
- **Full-text search** (SQLite FTS5, BM25-ranked) across names, callsigns,
  cities
- **Live cross-reference** — current FCC license status, plus recent on-air
  activity from PSK Reporter and the Reverse Beacon Network
- **Statistics** — license counts by year, state heatmaps, growth curves,
  and a public data-integrity report

## Data sources & accuracy

This archive is built from scanned printed books. Trust comes from showing
the work, so here is exactly where the data comes from and how good it is.

**Sources**

| Source | Coverage | What it provides |
|---|---|---|
| [leehite.org/callbooks](https://leehite.org/callbooks/) + archive.org | 1909–1997 | Scanned PDFs of 92 callbook editions |
| FCC ULS weekly dump (`l_amat.zip`) | 1997–**present** (refreshed weekly) | 1.59M current licenses — holder, status, grant dates, previous callsigns, full license history |
| ISO QSL-manager CDs | 1999, 2003 | International QSL routing records |

**Pipeline**

1. Pages OCR'd with Tesseract LSTM at 400–600 DPI (the PDFs' embedded
   Adobe-era text layers proved unreliable and were re-OCR'd from page
   images)
2. Era-aware parsers extract callsign / name / address / city / state /
   license class per entry
3. **Cross-validation**: a second independent OCR pass, a third sample-based
   pass, and anchoring against FCC ULS names — 21,277 three-way
   auto-corrections, 335,310 ULS confirmations, 190K+ targeted field
   corrections applied via a reviewable overrides file
4. Name and city dictionaries (built from 1.6M FCC records) repair common
   OCR substitutions (`Lamb8rt`→`Lambert`, `~Ianhattan`→`Manhattan`)

**Honest numbers**

- Name accuracy on post-1963 editions: **~95–99%** per edition (verified by
  sample audit against independent OCR + FCC records)
- Composite field-completeness score (name + city + state populated and
  sane): **~76%** across all 7.38M rows — the gap is dominated by dense
  1960s editions where the printed page itself omits or truncates
  city/state, and by pre-1928 records that predate any cross-checkable
  database
- Pre-1928 records are best-effort transcriptions of government station
  lists; no external source exists to verify them
- Every correction is logged. The `entries_overrides.csv` mechanism keeps
  hand fixes and ULS-derived fixes reviewable and reproducible across
  rebuilds
- `GET /api/stats/integrity` exposes the audit data live

Found an error? Open an issue with the callsign + year — corrections land in
the overrides file and survive every rebuild.

## Architecture

```
                 +-----------+          +----------------------------+
   browser ----> |   caddy   | --/api-> |  FastAPI (uvicorn :8000)   |
            3017 | (:80 in   |          |  search / callsign / clubs |
                 | container)|   /*     |  stats / activity / lineage|
                 +-----------+    |     +----------------------------+
                                  v            |            |
                 +-----------+        read-only mount   in-memory
                 |  Next.js  |             |                |
                 |  15 SSR   |     USA_Ham_Callbooks   uls.json (185MB)
                 | (:3000 in |      .sqlite (2.7GB)    uls_history.json
                 | container)|      FTS5 + 25 tables       (36MB)
                 +-----------+
```

| service  | role                                  | port                           |
| -------- | ------------------------------------- | ------------------------------ |
| caddy    | reverse proxy, gzip                   | host `${SITE_PORT:-3017}` → 80 |
| frontend | Next.js 15 App Router, SSR            | 3000 (container-internal)      |
| backend  | FastAPI + SQLite (read-only)          | 8000 (container-internal)      |

The SQLite database is mounted read-only into the backend container; the
backend never writes at request time.

## Deploy (Docker Compose)

Images are built by CI and pushed to the Gitea registry on every commit to
master.

```bash
git clone https://git.waterburp.com/Atvriders/ham-callbook-site
cd ham-callbook-site

# Data files are NOT in git (~3 GB total). Place them in ./data/:
#   USA_Ham_Callbooks.sqlite   (2.7 GB — the archive DB, FTS5 + clubs included)
#   uls.json                   (185 MB — current FCC snapshot)
#   uls_history.json           (36 MB — lineage + license chains)
#   leaderboards.json          (105 KB — Century Club rankings)
#   edition_diff.json          (47 KB — edition-pair churn stats)
#   downloads/                 (open-data exports + MANIFEST.json)

docker login git.waterburp.com
docker compose pull
docker compose up -d
# site at http://<host>:3017    (override: SITE_PORT=80 docker compose up -d)
```

`docker-compose.dev.yml` builds the images from source instead:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`

## Local development

```bash
# backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DB_PATH=$PWD/../data/USA_Ham_Callbooks.sqlite \
ULS_JSON_PATH=$PWD/../data/uls.json \
ULS_HISTORY_PATH=$PWD/../data/uls_history.json \
  .venv/bin/uvicorn app.main:app --port 8000

# frontend (dev server on :3017, proxies /api to :8000)
cd frontend && npm install && npm run dev
```

## API

All endpoints live under `/api`. Highlights — see `backend/app/routes/` for
the full set:

| Endpoint | Returns |
|---|---|
| `GET /api/search?q=&year=&state=` | FTS5 search, BM25-ranked, snippets |
| `GET /api/suggest?q=` | Prefix suggestions |
| `GET /api/callsign/{cs}` | Summary: span, editions, classes, states |
| `GET /api/callsign/{cs}/history` | Every edition appearance |
| `GET /api/callsign/{cs}/holders` | Distinct-holder clusters over time |
| `GET /api/callsign/{cs}/uls_history` | FCC lineage: previous callsign, license records, forward links |
| `GET /api/callsign/{cs}/district_companion` | 1947 W9↔W0 / 1928 W-prefix twin |
| `GET /api/callsign/{cs}/club` | Club association |
| `GET /api/clubs/search?q=` · `/api/club/{slug}` | Club search + detail with multi-callsign timeline |
| `GET /api/year/{year}/summary` · `/entries` | Per-year browse |
| `GET /api/state/{st}/summary` · `/entries` | Per-state browse |
| `GET /api/stats` · `/growth` · `/heatmap` · `/integrity` | Corpus statistics + audit transparency |
| `GET /api/activity/{cs}` | Live: FCC ULS + PSK Reporter + RBN |
| `GET /api/random` | A random entry (time-machine roulette) |
| `GET /api/health` | Liveness + row counts |

## Data pipeline (rebuilding from scratch)

The pipeline lives in a sibling working directory (`leehite-callbooks/`, not
in this repo) and produces the artifacts in `data/`:

```
PDFs ──tesseract──> ocr_v2/*.txt ──extract_all.py──> entries/*.csv
                                        │
entries_overrides.csv ──┐               v
                        ├──> build_sqlite.py ──> USA_Ham_Callbooks.sqlite
FCC l_amat.zip ─────────┘        │  (chains build_data_layer.py → FTS5 + views
                                 │   and build_clubs.py → club tables)
                                 v
              scripts/build_uls_history.py ──> uls_history.json
              scripts/uls_refresh.sh (weekly) ──> uls.json
```

`scripts/uls_refresh.sh` re-downloads the FCC weekly dump (published
Sundays), rebuilds `uls.json` + `uls_history.json`, and restarts the backend
— keeping "current FCC status" genuinely current.

## Design — "Sodium Vapor"

The visual direction is **not** generic dark-mode SaaS. It evokes vintage CRT
amber phosphor and the sodium-vapor street lamps of the radio-tube era —
warm, technical, brutalist-editorial.

- Palette: deep navy ground (`#0a0e1a`), parchment text (`#f5ecd9`), amber
  accent (`#ffa30b`) with a soft glow halo (`#ffd166`)
- Typography: **Fraunces** (variable serif with optical sizing) for
  headlines, **JetBrains Mono** for every callsign and data field, **Geist
  Sans** for body copy
- Motifs: subtle CRT scanlines on the hero, film-grain overlay for warmth,
  Morse-code dash dividers (`-- ·-· -·-·`), ASCII oscilloscope sparklines on
  timelines, asymmetric wide-left + narrow-marginalia grids, a pulsing TWR
  (transmit-receive) indicator dot in the header

The locked design tokens live in `frontend/lib/design.ts` and are the single
source of truth.

## Repository layout

```
backend/            FastAPI app (routes/, integrations/ for ULS·PSK·RBN·clubs)
frontend/           Next.js 15 App Router, Sodium Vapor design system
caddy/              Caddyfile (baked into the caddy image)
scripts/            build_data_layer.py · build_clubs.py ·
                    build_uls_history.py · uls_refresh.sh
data/               (gitignored) sqlite + uls.json + uls_history.json
.gitea/workflows/   CI: builds + pushes the three images on every master push
```

## Credits & sources

This archive stands entirely on the work of the people and institutions who
scanned, published, and freely released the underlying material. None of it
would exist without them.

**Scanned printed callbooks (the heart of the archive, 1909–1997)**
- **Lee Hite** — [leehite.org/callbooks](https://leehite.org/callbooks/) —
  the curated collection of *Radio Amateur Callbook* scans that the bulk of
  this corpus is OCR'd from. The single most important source.
- **Internet Archive** ([archive.org](https://archive.org)) and its
  **Digital Library of Amateur Radio & Communications (DLARC)** — additional
  edition scans and the home of the public-domain callbook collection.

**Pre-1928 government station lists**
- **U.S. Department of Commerce**, *Amateur Radio Stations of the United
  States* (1913–1931 series) — public-domain government publications, scans
  via the Internet Archive and **HathiTrust**.
- The early *Official Wireless Blue Book* annual editions (1909–1914).

**Current & historical FCC license data (1997–present)**
- **FCC Universal Licensing System (ULS)** — the free weekly `l_amat.zip`
  public bulk dump (names, status, grant/expiry dates, previous callsigns,
  license history). Refreshed weekly. A U.S. government public record.

**Name & demographic reference data**
- **U.S. Social Security Administration** — public-domain National Baby Names
  dataset, used (gender-association only, with explicit confidence bands) for
  the YL-index estimate.

**Live on-air activity**
- **PSK Reporter** ([pskreporter.info](https://pskreporter.info)) and the
  **Reverse Beacon Network** ([reversebeacon.net](https://reversebeacon.net))
  — recent spot data for the live-activity panels.

**A note on the publication**
*Radio Amateur Callbook* is a historic publication. This project exists for
historical research, genealogy, and amateur-radio heritage preservation. All
historical records remain attributed to their original publisher; the
structured data and derived analyses are released under ODC-BY (see
`/data`). Found an error in a record? Use the in-site "Suggest a correction"
button — fixes are reviewed and folded back into the dataset.
