# USA Ham Callbook Archive

A searchable web archive of ~7.74 million U.S. amateur radio license records
across 99 published callbook editions spanning 1909-1997 plus 2003 — the
complete OCR'd corpus of historic Radio Amateur Callbook publications,
indexed, cross-referenced, and made browsable.

This site lets you:

- Look up a callsign and see every edition it appears in (the operator's
  paper trail across the 20th century)
- Trace a name or city to find who was on the air in a given town and year
- Browse statistics by year, state, and license class
- (Live mode) Cross-reference a historic callsign against current FCC ULS
  data and recent on-air activity from PSK Reporter / Reverse Beacon Network

## Architecture

```
                +-----------+         +---------------------------+
   browser ---> |   caddy   | --/api->|   FastAPI (uvicorn :8000) |
                |  (:80)    |         |   - /search, /callsign/*  |
                |  reverse  |         |   - /stats, /editions     |
                |   proxy   |         |   - SQLite + FTS5         |
                +-----------+         +---------------------------+
                      |                            |
                      |  /*                        |  read-only mount
                      v                            v
                +-----------+              +---------------+
                |  Next.js  |              | data/         |
                |  15 SSR   |              | USA_Ham_      |
                |  (:3000)  |              | Callbooks.db  |
                +-----------+              +---------------+
```

Three containers, one network, orchestrated by `docker-compose.yml`:

| service  | role                                | port      |
| -------- | ----------------------------------- | --------- |
| caddy    | reverse proxy, TLS, static cache    | 80, 443   |
| frontend | Next.js 15 App Router (TS, Tailwind v4) | 3000  |
| backend  | FastAPI + SQLite/FTS5 + httpx       | 8000      |

The SQLite database is mounted read-only into the backend container from
`./data/USA_Ham_Callbooks.sqlite`. The Data phase builds FTS5 indexes
(`entries_fts`) and a `callsign_history` view in place. The backend never
writes to the DB at request time.

## Stack

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS v4,
  Fraunces + JetBrains Mono + Geist Sans from Google Fonts, server
  components + streaming for search results.
- **Backend**: FastAPI, Pydantic v2, sqlite3 (stdlib) with FTS5, httpx for
  outbound calls to FCC ULS / PSK Reporter / RBN, Uvicorn.
- **Data**: SQLite, 2.4 GB. Tables: `entries`, `editions`, `xref_2way_summary`,
  `sample_confidence`, `sample_audit`, `corrections_3way`, `uls_anchor`,
  `dataset_meta`. After the Data phase: virtual FTS5 table `entries_fts`
  and view `callsign_history`.
- **Infra**: Docker Compose, Caddy 2 (automatic HTTPS in prod).

## Design — "Sodium Vapor"

The visual direction is **not** generic dark-mode SaaS. It evokes vintage CRT
amber phosphor and the sodium-vapor street lamps of the radio-tube era —
warm, technical, brutalist-editorial.

- Palette: deep navy ground (`#0a0e1a`), parchment text (`#f5ecd9`), amber
  accent (`#ffa30b`) with a soft glow halo (`#ffd166`).
- Typography: **Fraunces** (variable serif with optical sizing) for
  headlines, **JetBrains Mono** for every callsign and data field, **Geist
  Sans** for body copy.
- Motifs: subtle CRT scanlines on the hero, film-grain overlay for warmth,
  Morse-code dash dividers (`-- ·-· -·-·`), ASCII oscilloscope sparklines
  for the timeline, asymmetric wide-left + narrow-marginalia grids, a
  pulsing TWR (transmit-receive) indicator dot in the header.

The locked design tokens live in `frontend/lib/design.ts` and are the single
source of truth — every frontend agent imports from there.

## Running

Prerequisites: Docker and Docker Compose v2.

```bash
# from project root
docker compose up
```

That's it. Caddy will listen on `:80` (and `:443` in production with a real
domain), proxy `/api/*` to the FastAPI service, and serve the Next.js
frontend for everything else. First-run cold start is ~30 seconds while the
backend opens the 2.4 GB SQLite and warms its connection pool.

Visit `http://localhost/`.

### Development

For hot-reload dev without rebuilding containers each time:

```bash
# backend
cd backend && uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && pnpm dev
```

The frontend dev server proxies `/api` to `http://localhost:8000`.

### Data

The source SQLite (`USA_Ham_Callbooks.sqlite`, 2.4 GB) must be present at
`./data/USA_Ham_Callbooks.sqlite` before first boot. The Data phase script
adds FTS5 indexes and the `callsign_history` view in place; re-running it
is idempotent.

## Project layout

```
ham-callbook-site/
  backend/
    app/
      routes/          # FastAPI routers (search, callsign, stats, ...)
      integrations/    # FCC ULS, PSK Reporter, RBN clients
      main.py          # FastAPI app
      db.py            # SQLite connection pool
  frontend/
    app/               # Next.js 15 App Router pages
    components/ui/     # design-system primitives
    lib/
      design.ts        # locked Sodium-Vapor tokens
      types.ts         # shared API contract types
    public/
  caddy/
    Caddyfile
  data/
    USA_Ham_Callbooks.sqlite
  docker-compose.yml
  README.md
```

## License & sources

License records are public-domain U.S. government data, originally published
by the FCC and reprinted in the Radio Amateur Callbook (Lee Hite OCR
archive). This site adds search, cross-referencing, and history-tracking on
top of that public corpus.
