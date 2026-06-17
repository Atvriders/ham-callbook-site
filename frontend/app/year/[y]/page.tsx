/**
 * /year/[y] — Per-year edition browser.
 *
 * Server component for the "Year" view in the ham-callbook archive. One page
 * per calendar year of the corpus (1909-1997 plus 2003), composed from three
 * backend endpoints:
 *
 *   * GET /api/year/{y}/summary  — headline counts, top states, notable
 *                                  callsigns, list of editions.
 *   * GET /api/year/{y}/entries  — paginated entries with optional ?state=
 *                                  and ?class= filters.
 *   * GET /api/years             — full list of {year, entry_count} pairs;
 *                                  used to compute the year-over-year delta
 *                                  against the previous year in the corpus.
 *
 * Aesthetic is the locked Sodium Vapor palette — midnight #0a0e1a bg, sodium
 * amber #ffa30b accent, bone-cream #f5ecd9 text, Fraunces display +
 * JetBrains Mono data + Geist Sans body. All colors and font stacks come
 * from `lib/design.ts` — no hard-coded hex, no Inter, no purple, no
 * hover:scale-105 fluff.
 *
 * Layout follows the locked "asymmetric grid" motif: a wide main column
 * (header / edition cards / filters / entry table / tinted USMap) on the
 * left, with a narrow marginalia column on the right that carries the
 * historical-context side panel.
 */

import { colors, fontStacks, motifs } from "../../../lib/design";
import { cleanOCRName, cleanOCRCity, cleanOCRState, classLabelForCode } from "../../../lib/ocrClean";

// ---------------------------------------------------------------------------
// Wire types — mirror the FastAPI response models in app/routes/year.py.
// ---------------------------------------------------------------------------

interface YearEntry {
  year: number | null;
  edition: string | null;
  callsign: string | null;
  license_class: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  flag: string | null;
  source: string | null;
}

interface TopState {
  state: string;
  count: number;
}

interface NotableCallsign {
  callsign: string;
  name: string | null;
  state: string | null;
  license_class: string | null;
  city: string | null;
}

interface EditionInfo {
  key: string;
  label: string | null;
  entry_count: number | null;
  parse_quality: string | null;
}

interface YearSummary {
  year: number;
  entry_count: number;
  distinct_callsigns: number;
  top_states: TopState[];
  notable_callsigns: NotableCallsign[];
  editions: EditionInfo[];
}

interface EntriesPage {
  year: number;
  total: number;
  limit: number;
  offset: number;
  filters: { state: string | null; class: string | null };
  entries: YearEntry[];
}

interface YearCount {
  year: number;
  entry_count: number;
}

// ---------------------------------------------------------------------------
// Fetch helpers — same shape as lib/club_api.ts so server-component fetches
// keep one consistent pattern across the site.
// ---------------------------------------------------------------------------

const API_BASE: string = (typeof window === "undefined" ? (process.env.INTERNAL_API_BASE ?? "http://backend:8000") : "").replace(
  /\/+$/,
  "",
);

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// searchParams handling — Next.js 15 passes `params` and `searchParams` as
// Promises. The shapes below collapse arrays/empty strings to single values.
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v.find((x) => x && x.length > 0);
  return v && v.length > 0 ? v : undefined;
}

function isTwoLetterCode(s: string | undefined): s is string {
  return !!s && /^[A-Za-z]{2}$/.test(s);
}

function isClassLetter(s: string | undefined): s is string {
  return !!s && /^[A-Za-z]$/.test(s);
}

/**
 * Build a /year/{y} URL preserving the current filter set with one field
 * overridden. Used by every filter chip so they compose rather than reset.
 */
function filterHref(
  y: number,
  current: { state?: string; class?: string },
  override: { state?: string | null; class?: string | null },
): string {
  const params = new URLSearchParams();
  const nextState =
    override.state === null ? undefined : override.state ?? current.state;
  const nextClass =
    override.class === null ? undefined : override.class ?? current.class;
  if (nextState) params.set("state", nextState);
  if (nextClass) params.set("class", nextClass);
  const q = params.toString();
  return `/year/${y}${q ? `?${q}` : ""}`;
}

// ---------------------------------------------------------------------------
// Historical context — captions for the marginalia panel. Curated lightly
// from the well-known beats of 20th-century amateur radio.
// ---------------------------------------------------------------------------

interface HistoricalNote {
  yearMin: number;
  yearMax: number;
  title: string;
  body: string;
}

const HISTORY: HistoricalNote[] = [
  {
    yearMin: 1909,
    yearMax: 1911,
    title: "Wireless before regulation",
    body: "The Radio Act of 1912 has not yet passed. Amateur stations identify themselves loosely; the callbook is, in part, a self-organizing roster.",
  },
  {
    yearMin: 1912,
    yearMax: 1916,
    title: "First federal licenses",
    body: "The Radio Act of 1912 introduces formal amateur licensing. Allocations push amateurs to wavelengths below 200 m — the supposedly useless shortwave bands.",
  },
  {
    yearMin: 1917,
    yearMax: 1919,
    title: "Wartime shutdown",
    body: "April 1917: amateur radio is silenced by Presidential order for the duration of WWI. Many of these callsigns are reissued on return.",
  },
  {
    yearMin: 1920,
    yearMax: 1929,
    title: "The shortwave revolution",
    body: "1923: first amateur transatlantic two-way contacts. The hobby explodes; the ARRL's callbook lineage grows into the standard reference.",
  },
  {
    yearMin: 1930,
    yearMax: 1939,
    title: "Depression-era DXing",
    body: "Crystal control becomes practical; the 10-meter band opens for amateur use. Callbook editions become annual fixtures.",
  },
  {
    yearMin: 1940,
    yearMax: 1945,
    title: "World War II silence",
    body: "December 1941: amateur operations are suspended for the war. WERS (War Emergency Radio Service) keeps trained operators on the air domestically.",
  },
  {
    yearMin: 1946,
    yearMax: 1959,
    title: "Postwar boom",
    body: "Returning veterans pour into amateur radio. Surplus military gear floods the market. Novice and Technician classes are introduced in 1951.",
  },
  {
    yearMin: 1960,
    yearMax: 1974,
    title: "SSB and the solid-state era",
    body: "Single-sideband displaces AM on HF. Transistorized rigs replace tube finals. OSCAR satellites begin carrying amateur traffic from 1961.",
  },
  {
    yearMin: 1975,
    yearMax: 1989,
    title: "Computers reach the shack",
    body: "Packet radio, RTTY-on-a-microcomputer, and the first amateur BBSes. The callbook is now a 1,500-page brick.",
  },
  {
    yearMin: 1990,
    yearMax: 1997,
    title: "End of the printed era",
    body: "1991: no-code Technician license. The FCC's electronic ULS database (1998-) eventually displaces the printed callbook entirely.",
  },
  {
    yearMin: 1998,
    yearMax: 2010,
    title: "Digital callbook era",
    body: "QRZ, the FCC ULS, and online databases replace the printed annual volume. The 2003 edition is one of the last major print runs.",
  },
];

function historicalNoteFor(year: number): HistoricalNote | undefined {
  return HISTORY.find((h) => year >= h.yearMin && year <= h.yearMax);
}

// ---------------------------------------------------------------------------
// Decorative motif components — re-implemented locally so this page is a
// self-contained server component. (The clubs page uses the same pattern.)
// ---------------------------------------------------------------------------

function Scanlines() {
  const { opacity, spacingPx } = motifs.scanlines;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          rgba(255, 209, 102, 0.6) 0px,
          rgba(255, 209, 102, 0.6) 1px,
          transparent 1px,
          transparent ${spacingPx}px
        )`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

function Grain() {
  const { opacity, baseFrequency } = motifs.grain;
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
       <filter id='n'>
         <feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='2' stitchTiles='stitch'/>
         <feColorMatrix values='0 0 0 0 1  0 0 0 0 0.64  0 0 0 0 0.04  0 0 0 0.6 0'/>
       </filter>
       <rect width='100%' height='100%' filter='url(#n)'/>
     </svg>`,
  );
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        zIndex: 1,
      }}
    />
  );
}

function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "2.5rem 0",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
      {label ? <span style={{ flexShrink: 0 }}>{label}</span> : null}
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny USMap — schematic 8x6 grid of US states tinted by entry density.
// We intentionally keep it small and grid-based; this is the "marginalia"
// version of the map, not the home page choropleth. Each state appears as
// a 2-letter cell with its background alpha proportional to that state's
// share of the year's entries.
// ---------------------------------------------------------------------------

// Schematic geographic grid for US states + DC. Each row is roughly a
// latitude band; columns are west-to-east. Empty strings leave a gap for
// rough geography. (PR/Guam/AK/HI tacked on at the bottom row.)
const US_MAP_GRID: string[][] = [
  ["",   "",   "",   "",   "",   "",   "",   "",   "",   "ME"],
  ["WA", "",   "MT", "ND", "MN", "WI", "",   "MI", "",   "NH"],
  ["OR", "ID", "WY", "SD", "IA", "",   "IL", "IN", "OH", "VT"],
  ["",   "NV", "UT", "CO", "NE", "MO", "KY", "WV", "PA", "NY"],
  ["CA", "AZ", "NM", "KS", "OK", "AR", "TN", "VA", "MD", "NJ"],
  ["",   "",   "",   "TX", "LA", "MS", "AL", "GA", "SC", "NC"],
  ["AK", "HI", "",   "",   "",   "",   "FL", "DC", "DE", "RI"],
  ["",   "",   "",   "",   "",   "",   "PR", "",   "",   "CT"],
];

function USMap({
  year,
  topStates,
  totalEntries,
  activeState,
}: {
  year: number;
  topStates: TopState[];
  totalEntries: number;
  activeState?: string;
}) {
  // Build a quick lookup from state code to its count.
  const counts = new Map<string, number>();
  for (const s of topStates) counts.set(s.state.toUpperCase(), s.count);
  const max = topStates.length > 0 ? topStates[0]!.count : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
        padding: "1rem 1.125rem 1.25rem",
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        borderRadius: "0.25rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: fontStacks.display,
            fontSize: "1rem",
            fontVariationSettings: '"opsz" 24',
            color: colors.text,
          }}
        >
          Density · {year}
        </h3>
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: colors.text_dim,
          }}
        >
          top {topStates.length} shown
        </span>
      </div>
      <div
        role="img"
        aria-label={`Schematic US map showing entry density for ${year}`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
          gap: "0.25rem",
        }}
      >
        {US_MAP_GRID.flat().map((code, i) => {
          if (!code) {
            return (
              <span
                key={`empty-${i}`}
                aria-hidden
                style={{
                  aspectRatio: "1",
                  background: "transparent",
                }}
              />
            );
          }
          const ct = counts.get(code) ?? 0;
          const ratio = max > 0 ? ct / max : 0;
          // Tint amber with the ratio; floor at 4% so the outline of the
          // continent is still visible even for zero-count states.
          const alpha = ct > 0 ? 0.12 + ratio * 0.78 : 0.04;
          const isActive = activeState === code;
          return (
            <a
              key={code}
              href={filterHref(year, {}, { state: isActive ? null : code })}
              title={
                ct > 0
                  ? `${code} · ${ct.toLocaleString()} entries`
                  : `${code} · not in top ${topStates.length}`
              }
              style={{
                aspectRatio: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: fontStacks.mono,
                fontSize: "0.55rem",
                letterSpacing: "0.05em",
                color: isActive
                  ? colors.bg
                  : ct > 0
                  ? colors.text
                  : colors.text_dim,
                background: isActive
                  ? colors.accent
                  : `rgba(255, 163, 11, ${alpha.toFixed(3)})`,
                border: `1px solid ${
                  isActive ? colors.accent : colors.border
                }`,
                borderRadius: "0.125rem",
                textDecoration: "none",
              }}
            >
              {code}
            </a>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.1em",
          color: colors.text_dim,
        }}
      >
        Total entries: {" "}
        <span style={{ color: colors.accent }}>
          {totalEntries.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function YearPage({
  params,
  searchParams,
}: {
  params: Promise<{ y: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { y } = await params;
  const sp = await searchParams;
  const year = parseInt(y, 10);

  if (!Number.isFinite(year) || year < 1909 || year > 2100) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: colors.bg,
          color: colors.text,
          fontFamily: fontStacks.body,
          padding: "5rem 2rem",
        }}
      >
        <h1
          style={{
            fontFamily: fontStacks.display,
            fontSize: "2.5rem",
            margin: 0,
          }}
        >
          Bad year — “{y}”
        </h1>
        <p style={{ color: colors.text_dim, marginTop: "1rem" }}>
          The path /year/{y} doesn’t parse as a calendar year.
        </p>
      </main>
    );
  }

  const stateFilter = firstParam(sp.state);
  const classFilter = firstParam(sp.class);
  const stateParam = isTwoLetterCode(stateFilter)
    ? stateFilter.toUpperCase()
    : undefined;
  const classParam = isClassLetter(classFilter)
    ? classFilter.toUpperCase()
    : undefined;

  // Build the entries query.
  const entriesQuery = new URLSearchParams();
  entriesQuery.set("limit", "50");
  if (stateParam) entriesQuery.set("state", stateParam);
  if (classParam) entriesQuery.set("class", classParam);

  // Fetch the three sources in parallel. Each is allowed to fail
  // independently — the page degrades gracefully on partial outages.
  const [summary, entries, years] = await Promise.all([
    apiGet<YearSummary>(`/api/year/${year}/summary`).catch(
      () => null as YearSummary | null,
    ),
    apiGet<EntriesPage>(
      `/api/year/${year}/entries?${entriesQuery.toString()}`,
    ).catch(() => null as EntriesPage | null),
    apiGet<YearCount[]>(`/api/years`).catch(() => [] as YearCount[]),
  ]);

  if (!summary) {
    return (
      <main
        style={{
          position: "relative",
          minHeight: "100vh",
          background: colors.bg,
          color: colors.text,
          fontFamily: fontStacks.body,
          padding: "5rem 2rem",
        }}
      >
        <Grain />
        <div style={{ position: "relative", zIndex: 2 }}>
          <h1
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(2.5rem, 6vw, 5rem)",
              fontVariationSettings: '"opsz" 96',
              margin: 0,
              textShadow: motifs.glow.textShadow,
            }}
          >
            {year}
          </h1>
          <p style={{ color: colors.text_dim, marginTop: "1rem" }}>
            No callbook data on file for {year}. The corpus runs 1909-1997 with
            a final 2003 edition; the in-between gaps are real (wartime
            suspensions, lost editions).
          </p>
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: "1.5rem",
              padding: "0.625rem 1rem",
              border: `1px solid ${colors.accent}`,
              color: colors.accent,
              fontFamily: fontStacks.mono,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontSize: "0.75rem",
              textDecoration: "none",
            }}
          >
            ← Back to archive
          </a>
        </div>
      </main>
    );
  }

  // Build the year timeline + delta.
  const sortedYears = [...years].sort((a, b) => a.year - b.year);
  const idx = sortedYears.findIndex((r) => r.year === year);
  const prev = idx > 0 ? sortedYears[idx - 1] : null;
  const next = idx >= 0 && idx < sortedYears.length - 1 ? sortedYears[idx + 1] : null;
  const delta =
    prev && prev.entry_count > 0
      ? ((summary.entry_count - prev.entry_count) / prev.entry_count) * 100
      : null;
  const deltaAbs =
    prev ? summary.entry_count - prev.entry_count : null;

  const history = historicalNoteFor(year);

  // ---- Year-band timeline data ------------------------------------------
  // Compute the position of this year within the corpus range, and the
  // relative magnitude of every other year, so the band can render the
  // entire archive as a sodium-glow waveform with the active year keyed.
  const allYears = sortedYears;
  const corpusMin = allYears[0]?.year ?? 1909;
  const corpusMax = allYears[allYears.length - 1]?.year ?? 2003;
  const maxCount =
    allYears.reduce((m, y) => Math.max(m, y.entry_count), 0) || 1;

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
      }}
    >
      <Grain />

      {/* --- HEADER ------------------------------------------------------ */}
      <section
        style={{
          position: "relative",
          padding: "4.5rem 2rem 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            <a
              href="/"
              style={{ color: colors.text_dim, textDecoration: "none" }}
            >
              ham-callbook
            </a>
            <span aria-hidden>·</span>
            <span>callbook year</span>
            <span aria-hidden>·</span>
            <span>{motifs.morseDividers.tight}</span>
          </div>
          <h1
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(5rem, 16vw, 12rem)",
              fontWeight: 600,
              fontVariationSettings: '"opsz" 144',
              lineHeight: 0.88,
              letterSpacing: "-0.03em",
              margin: 0,
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            {year}
          </h1>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "2rem 3rem",
              fontFamily: fontStacks.mono,
            }}
          >
            <StatCell
              label="Licensees"
              value={summary.entry_count.toLocaleString()}
            />
            <StatCell
              label="Distinct callsigns"
              value={summary.distinct_callsigns.toLocaleString()}
            />
            <StatCell
              label={prev ? `Δ vs ${prev.year}` : "Δ"}
              value={
                delta === null
                  ? "—"
                  : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`
              }
              sub={
                deltaAbs === null
                  ? undefined
                  : `${deltaAbs >= 0 ? "+" : ""}${deltaAbs.toLocaleString()}`
              }
              tone={
                delta === null
                  ? "neutral"
                  : delta >= 0
                  ? "up"
                  : "down"
              }
            />
            <StatCell
              label="Editions"
              value={summary.editions.length.toString().padStart(2, "0")}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            {prev ? (
              <a
                href={`/year/${prev.year}`}
                style={{ color: colors.text_dim, textDecoration: "none" }}
              >
                ← {prev.year}
              </a>
            ) : null}
            {next ? (
              <a
                href={`/year/${next.year}`}
                style={{ color: colors.text_dim, textDecoration: "none" }}
              >
                {next.year} →
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* --- YEAR-BAND TIMELINE ------------------------------------------ */}
      {/* One-memorable-thing: the entire corpus rendered as a sodium-glow
          oscilloscope band. Every year is a tick scaled to its entry
          count; the active year keyed amber with a halo, and every
          edition of this year is a notch above its tick. */}
      <section
        style={{
          position: "relative",
          padding: "1rem 2rem 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "0.625rem",
          }}
        >
          <span
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.62rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            {corpusMin} <span style={{ color: colors.accent_2 }}>————</span>{" "}
            corpus timeline
          </span>
          <span
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.62rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            you are here · {year} ·{" "}
            <span style={{ color: colors.accent }}>
              {summary.editions.length} edition
              {summary.editions.length === 1 ? "" : "s"}
            </span>{" "}
            <span style={{ color: colors.accent_2 }}>————</span> {corpusMax}
          </span>
        </div>
        <YearBand
          allYears={allYears}
          activeYear={year}
          editions={summary.editions}
          corpusMin={corpusMin}
          corpusMax={corpusMax}
          maxCount={maxCount}
        />
      </section>

      {/* --- TWO-COLUMN BODY --------------------------------------------- */}
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
          display: "grid",
          gridTemplateColumns: motifs.asymmetricGrid.gridTemplate,
          gap: "3rem",
        }}
      >
        {/* --- MAIN COLUMN ---------------------------------------------- */}
        <div style={{ minWidth: 0 }}>
          {/* Editions */}
          <SectionHeader title="Editions" hint={`${summary.editions.length} in this year`} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))",
              gap: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            {summary.editions.length === 0 ? (
              <div style={emptyStyle}>No editions recorded for {year}.</div>
            ) : (
              summary.editions.map((ed) => (
                <div
                  key={ed.key}
                  style={{
                    padding: "0.875rem 1rem",
                    border: `1px solid ${colors.border}`,
                    background: colors.surface,
                    borderRadius: "0.25rem",
                  }}
                >
                  <div
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: "0.7rem",
                      color: colors.accent,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                    }}
                  >
                    {ed.key}
                  </div>
                  <div
                    style={{
                      fontFamily: fontStacks.display,
                      fontSize: "0.95rem",
                      fontVariationSettings: '"opsz" 24',
                      marginTop: "0.25rem",
                      color: colors.text,
                    }}
                  >
                    {ed.label ?? "—"}
                  </div>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      display: "flex",
                      gap: "0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.7rem",
                      color: colors.text_dim,
                    }}
                  >
                    <span>
                      {ed.entry_count !== null
                        ? `${ed.entry_count.toLocaleString()} rows`
                        : "—"}
                    </span>
                    {ed.parse_quality ? (
                      <span style={{ color: colors.glow }}>
                        {ed.parse_quality}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>

          <MorseDivider label="filter" />

          {/* Filters */}
          <SectionHeader title="Filters" hint="state · license class" />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.375rem",
              marginBottom: "0.875rem",
            }}
          >
            <FilterChip
              href={filterHref(year, { state: stateParam, class: classParam }, { state: null })}
              label="ALL STATES"
              active={!stateParam}
            />
            {summary.top_states.map((s) => (
              <FilterChip
                key={s.state}
                href={filterHref(
                  year,
                  { state: stateParam, class: classParam },
                  { state: s.state === stateParam ? null : s.state },
                )}
                label={`${s.state} · ${s.count.toLocaleString()}`}
                active={stateParam === s.state}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.375rem",
              marginBottom: "1rem",
            }}
          >
            <FilterChip
              href={filterHref(year, { state: stateParam, class: classParam }, { class: null })}
              label="ALL CLASSES"
              active={!classParam}
            />
            {["E", "A", "G", "T", "N", "P", "C"].map((c) => (
              <FilterChip
                key={c}
                href={filterHref(
                  year,
                  { state: stateParam, class: classParam },
                  { class: c === classParam ? null : c },
                )}
                label={c}
                active={classParam === c}
              />
            ))}
          </div>

          {/* Entry table */}
          <SectionHeader
            title="Entries"
            hint={
              entries
                ? `${entries.entries.length.toLocaleString()} of ${entries.total.toLocaleString()}`
                : "—"
            }
          />
          {!entries ? (
            <div style={emptyStyle}>Entry table failed to load.</div>
          ) : entries.entries.length === 0 ? (
            <div style={emptyStyle}>
              No entries matched the current filters.
            </div>
          ) : (
            <EntryTable rows={entries.entries} />
          )}
        </div>

        {/* --- MARGINALIA ----------------------------------------------- */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
            minWidth: 0,
          }}
        >
          <USMap
            year={year}
            topStates={summary.top_states}
            totalEntries={summary.entry_count}
            activeState={stateParam}
          />

          {history ? (
            <div
              style={{
                padding: "1rem 1.125rem 1.25rem",
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                borderRadius: "0.25rem",
              }}
            >
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.65rem",
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: colors.accent,
                  marginBottom: "0.5rem",
                }}
              >
                {history.yearMin}–{history.yearMax}
              </div>
              <h3
                style={{
                  margin: 0,
                  fontFamily: fontStacks.display,
                  fontSize: "1.15rem",
                  fontVariationSettings: '"opsz" 30',
                  color: colors.text,
                  marginBottom: "0.5rem",
                  lineHeight: 1.2,
                }}
              >
                {history.title}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontFamily: fontStacks.body,
                  fontSize: "0.85rem",
                  lineHeight: 1.55,
                  color: colors.text_dim,
                }}
              >
                {history.body}
              </p>
            </div>
          ) : null}

          {summary.notable_callsigns.length > 0 ? (
            <div
              style={{
                padding: "1rem 1.125rem 1.25rem",
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                borderRadius: "0.25rem",
              }}
            >
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.65rem",
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: colors.text_dim,
                  marginBottom: "0.625rem",
                }}
              >
                Notable in {year}
              </div>
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {summary.notable_callsigns.map((n) => (
                  <li key={n.callsign}>
                    <a
                      href={`/callsign/${encodeURIComponent(n.callsign)}`}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "0.625rem",
                        color: colors.text,
                        textDecoration: "none",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "0.95rem",
                          color: colors.accent,
                          letterSpacing: "0.04em",
                          minWidth: "4.5rem",
                        }}
                      >
                        {n.callsign}
                      </span>
                      <span
                        style={{
                          fontFamily: fontStacks.body,
                          fontSize: "0.8rem",
                          color: colors.text_dim,
                        }}
                      >
                        {n.name ? cleanOCRName(n.name) || "—" : "—"}
                        {cleanOCRState(n.city, n.state) ? ` · ${cleanOCRState(n.city, n.state)}` : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept in the page module since they aren't reused.
// ---------------------------------------------------------------------------

function StatCell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const valueColor =
    tone === "up"
      ? colors.success
      : tone === "down"
      ? colors.danger
      : colors.accent;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <span
        style={{
          fontSize: "0.65rem",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "1.5rem",
          letterSpacing: "0.02em",
          color: valueColor,
          textShadow: motifs.glow.textShadow,
        }}
      >
        {value}
      </span>
      {sub ? (
        <span
          style={{
            fontSize: "0.7rem",
            color: colors.text_dim,
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function SectionHeader({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: "0.875rem",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: fontStacks.display,
          fontSize: "1.4rem",
          fontVariationSettings: '"opsz" 36',
          color: colors.text,
        }}
      >
        {title}
      </h2>
      {hint ? (
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: colors.text_dim,
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      style={{
        padding: "0.4rem 0.7rem",
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: active ? colors.bg : colors.text,
        background: active ? colors.accent : "transparent",
        border: `1px solid ${active ? colors.accent : colors.border}`,
        borderRadius: "0.25rem",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </a>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: "2rem 1rem",
  textAlign: "center",
  color: colors.text_dim,
  fontFamily: fontStacks.mono,
  fontSize: "0.85rem",
  letterSpacing: "0.1em",
  border: `1px dashed ${colors.border}`,
  borderRadius: "0.25rem",
};

// ---------------------------------------------------------------------------
// YearBand — sodium-glow oscilloscope ribbon showing where the active year
// sits inside the whole corpus. SVG, server-renderable, no client JS. Every
// year is a vertical bar scaled to entry count; the active year is keyed
// amber with a glow; every edition for the active year is a notch above its
// bar. Decade gridlines anchor the eye.
// ---------------------------------------------------------------------------
function YearBand({
  allYears,
  activeYear,
  editions,
  corpusMin,
  corpusMax,
  maxCount,
}: {
  allYears: YearCount[];
  activeYear: number;
  editions: EditionInfo[];
  corpusMin: number;
  corpusMax: number;
  maxCount: number;
}) {
  const VBW = 1000;
  const VBH = 120;
  const span = Math.max(1, corpusMax - corpusMin);
  // Index every year that has data — so we know where to draw bars even
  // for years outside the active one.
  const years = [...allYears].sort((a, b) => a.year - b.year);
  // Decade ticks across the corpus range.
  const decades: number[] = [];
  for (
    let d = Math.ceil(corpusMin / 10) * 10;
    d <= corpusMax;
    d += 10
  ) {
    decades.push(d);
  }
  const xFor = (y: number) => ((y - corpusMin) / span) * VBW;
  const activeX = xFor(activeYear);
  return (
    <div
      role="img"
      aria-label={`Corpus timeline showing ${activeYear} relative to the ${corpusMin}-${corpusMax} archive`}
      style={{
        position: "relative",
        border: `1px solid ${colors.border}`,
        borderRadius: "0.25rem",
        background: colors.surface,
        padding: "0.875rem 1rem 0.625rem",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        preserveAspectRatio="none"
        style={{
          display: "block",
          width: "100%",
          height: "120px",
        }}
      >
        <defs>
          <linearGradient id="yb-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity="0.55" />
            <stop offset="100%" stopColor={colors.accent_2} stopOpacity="0.15" />
          </linearGradient>
          <filter id="yb-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Decade gridlines */}
        {decades.map((d) => {
          const x = xFor(d);
          return (
            <g key={d}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={VBH - 14}
                stroke={colors.border}
                strokeWidth={0.5}
              />
              <text
                x={x}
                y={VBH - 2}
                fontFamily={fontStacks.mono}
                fontSize={7}
                fill={colors.text_dim}
                textAnchor="middle"
                letterSpacing={1}
              >
                {`'${String(d).slice(-2)}`}
              </text>
            </g>
          );
        })}

        {/* Baseline */}
        <line
          x1={0}
          x2={VBW}
          y1={VBH - 14}
          y2={VBH - 14}
          stroke={colors.border}
          strokeWidth={0.75}
        />

        {/* Every year bar — height scaled to entry count */}
        {years.map((y) => {
          const isActive = y.year === activeYear;
          const h =
            Math.max(2, (y.entry_count / maxCount) * (VBH - 30));
          const x = xFor(y.year);
          return (
            <rect
              key={y.year}
              x={x - 1.1}
              y={VBH - 14 - h}
              width={2.2}
              height={h}
              fill={isActive ? colors.accent : "url(#yb-grad)"}
              opacity={isActive ? 1 : 0.7}
              filter={isActive ? "url(#yb-glow)" : undefined}
            />
          );
        })}

        {/* Active-year vertical pin */}
        <line
          x1={activeX}
          x2={activeX}
          y1={0}
          y2={VBH - 14}
          stroke={colors.glow}
          strokeWidth={0.75}
          strokeDasharray="2 3"
          opacity={0.7}
        />

        {/* Edition notches above the active year */}
        {editions.map((ed, i) => {
          // Spread editions horizontally around the active year if more
          // than one, so they don't stack invisibly.
          const offset =
            editions.length > 1
              ? (i - (editions.length - 1) / 2) * 3
              : 0;
          const x = activeX + offset;
          return (
            <g key={ed.key}>
              <circle
                cx={x}
                cy={6}
                r={2.4}
                fill={colors.glow}
                filter="url(#yb-glow)"
              />
              <line
                x1={x}
                x2={x}
                y1={9}
                y2={18}
                stroke={colors.glow}
                strokeWidth={0.5}
                opacity={0.6}
              />
            </g>
          );
        })}

        {/* Active-year callout label */}
        <text
          x={activeX}
          y={28}
          fontFamily={fontStacks.mono}
          fontSize={8}
          fill={colors.accent}
          textAnchor={
            activeX > VBW - 80
              ? "end"
              : activeX < 80
              ? "start"
              : "middle"
          }
          letterSpacing={1.4}
        >
          {activeYear}
        </text>
      </svg>
    </div>
  );
}

function EntryTable({ rows }: { rows: YearEntry[] }) {
  return (
    <div
      role="table"
      aria-label="Entries in this year"
      style={{
        display: "grid",
        gridTemplateColumns:
          "minmax(5rem, auto) minmax(0, 2fr) minmax(0, 1.4fr) minmax(3rem, auto) minmax(3.5rem, auto) minmax(4rem, auto)",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <div role="row" style={{ display: "contents" }}>
        {["Callsign", "Name", "City", "State", "Class", "Edition"].map(
          (label, i) => (
            <div
              key={label}
              role="columnheader"
              style={{
                padding: "0.5rem 0.625rem",
                fontFamily: fontStacks.mono,
                fontSize: "0.625rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.text_dim,
                borderBottom: `1px solid ${colors.border}`,
                textAlign: i >= 3 ? "right" : "left",
              }}
            >
              {label}
            </div>
          ),
        )}
      </div>

      {rows.map((r, i) => (
        <a
          key={`${r.callsign}-${r.edition}-${i}`}
          role="row"
          href={
            r.callsign
              ? `/callsign/${encodeURIComponent(r.callsign)}`
              : "#"
          }
          style={{
            display: "contents",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <div
            role="cell"
            style={{
              padding: "0.625rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.875rem",
              color: colors.accent,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {r.callsign ?? "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.625rem",
              fontFamily: fontStacks.body,
              fontSize: "0.875rem",
              color: colors.text,
              borderBottom: `1px solid ${colors.border}`,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.name ? cleanOCRName(r.name) || "—" : "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.625rem",
              fontFamily: fontStacks.body,
              fontSize: "0.875rem",
              color: colors.text_dim,
              borderBottom: `1px solid ${colors.border}`,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {cleanOCRCity(r.city, r.state) || "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.625rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.825rem",
              color: colors.text,
              textAlign: "right",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {cleanOCRState(r.city, r.state) || "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.625rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.825rem",
              color: colors.glow,
              textAlign: "right",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {classLabelForCode(r.license_class, r.year)}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.625rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              color: colors.text_dim,
              textAlign: "right",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {r.edition ?? "—"}
          </div>
        </a>
      ))}
    </div>
  );
}
