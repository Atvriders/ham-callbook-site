/**
 * /state/[s] — Per-state Sodium Vapor archive view.
 *
 * Server component that aggregates two backend endpoints into one editorial
 * page:
 *
 *   * GET /api/state/{s}/summary?year=...  — headline totals, peak year,
 *                                            top-10 cities, optional year scope.
 *   * GET /api/state/{s}/entries?year=...  — a dense table of up to 200 rows
 *                                            for the current year filter.
 *   * GET /api/years                       — full list of {year, entry_count}
 *                                            pairs so we can render the year
 *                                            selector chips without a second
 *                                            roundtrip per render.
 *
 * Layout, top → bottom:
 *
 *   1. HERO — Two-letter state code in giant Fraunces (opsz 144), the full
 *      state name set as eyebrow, and a stat strip with total entries,
 *      distinct callsigns, peak year + count.
 *   2. TOP CITIES TILE ROW — A horizontally-scrolling rail of city tiles
 *      sorted by share of state entries. Each tile shows the city name in
 *      Fraunces with its count in JetBrains Mono.
 *   3. YEAR SELECTOR — Chips for every year that has data for this state.
 *      Active year highlighted amber; "ALL YEARS" chip resets the filter.
 *   4. DATA TABLE — Dense entries grid (callsign, name, city, year, edition,
 *      class). Uses the shared <DataTable /> component.
 *
 * All chrome built from the locked Sodium Vapor design tokens — no Inter, no
 * purple, no shadcn. Decorative motifs (Grain, Scanlines, MorseDivider) are
 * inlined locally so this server component has zero dependency on a client
 * subtree.
 */

import Link from "next/link";

import { colors, fontStacks, motifs } from "../../../lib/design";
import { cleanOCRCity } from "../../../lib/ocrClean";
import EntriesTable from "./EntriesTable";

// ---------------------------------------------------------------------------
// Wire types — mirror the FastAPI models in app/routes/state.py.
// ---------------------------------------------------------------------------

interface CityCount {
  city: string;
  count: number;
}

interface StateSummary {
  state: string;
  total_entries: number;
  distinct_callsigns: number;
  peak_year: number | null;
  peak_year_count: number | null;
  top_cities: CityCount[];
  year: number | null;
}

interface StateEntry {
  year: number | null;
  edition: string | null;
  callsign: string | null;
  license_class: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface YearCount {
  year: number;
  entry_count: number;
}

// ---------------------------------------------------------------------------
// State-code → full name map. Inlined because we only need it on this page;
// promoting to lib/ would be premature.
// ---------------------------------------------------------------------------

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "US Virgin Islands", GU: "Guam", AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

// ---------------------------------------------------------------------------
// Fetch helpers — same shape as /year/[y] so server-component fetches keep
// one consistent pattern across the site.
// ---------------------------------------------------------------------------

const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(
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
// searchParams helpers — Next.js 15 passes both params and searchParams as
// Promises. Year is the only filter on this page.
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v.find((x) => x && x.length > 0);
  return v && v.length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Decorative motifs — replicated locally so the page is a single self-
// contained server component (mirrors the pattern in /year/[y]).
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

function isTwoLetter(s: string | undefined): s is string {
  return !!s && /^[A-Za-z]{2}$/.test(s);
}

function isYear(s: string | undefined): s is string {
  return !!s && /^\d{4}$/.test(s);
}

// ---------------------------------------------------------------------------
// State silhouettes — hand-tuned simplified SVG path data per state. Not
// cartographically perfect (and intentionally so — they read as glyphs, not
// as Wikipedia outlines). Stored as a viewBox + path string so the renderer
// can apply a sodium-vapor glow filter to whatever path we have. Falls back
// to a stamped rounded square for codes we haven't traced yet.
// ---------------------------------------------------------------------------

interface StateSilhouette {
  viewBox: string;
  path: string;
}

const STATE_SILHOUETTES: Record<string, StateSilhouette> = {
  CA: { viewBox: "0 0 100 200", path: "M22 4 L52 6 L58 24 L60 48 L72 68 L74 92 L86 120 L92 152 L84 180 L76 196 L42 192 L36 168 L24 142 L10 108 L8 76 L14 44 L18 22 Z" },
  TX: { viewBox: "0 0 200 200", path: "M14 28 L96 26 L100 8 L132 8 L138 26 L186 30 L186 88 L196 96 L196 124 L176 130 L160 158 L150 180 L132 196 L116 178 L96 168 L72 168 L52 152 L40 130 L24 108 L14 88 Z" },
  FL: { viewBox: "0 0 200 140", path: "M8 28 L120 22 L150 30 L172 28 L184 44 L184 70 L194 96 L184 124 L162 134 L142 124 L130 100 L114 78 L96 70 L70 70 L48 62 L28 50 L14 42 Z" },
  NY: { viewBox: "0 0 200 140", path: "M10 60 L40 56 L60 36 L94 24 L130 22 L162 12 L188 20 L194 50 L184 78 L158 96 L130 100 L96 110 L76 124 L60 128 L34 122 L18 104 L10 86 Z" },
  AK: { viewBox: "0 0 200 140", path: "M14 80 L46 60 L78 56 L116 42 L154 28 L186 24 L196 46 L172 62 L138 70 L116 86 L98 102 L82 118 L60 128 L36 124 L18 110 Z" },
  HI: { viewBox: "0 0 200 80", path: "M20 30 L36 22 L48 30 L42 42 Z M60 36 L78 28 L92 40 L82 50 Z M104 40 L124 34 L138 46 L126 54 Z M150 46 L172 40 L188 52 L176 62 Z" },
  WA: { viewBox: "0 0 200 120", path: "M10 28 L186 18 L194 56 L184 92 L160 104 L120 108 L84 102 L52 110 L24 100 L10 76 Z" },
  OR: { viewBox: "0 0 200 120", path: "M10 16 L188 8 L194 84 L172 106 L120 108 L72 110 L34 102 L10 84 Z" },
  NV: { viewBox: "0 0 140 200", path: "M14 12 L120 14 L130 64 L132 110 L120 152 L100 180 L72 192 L48 178 L30 152 L18 120 L10 80 L8 46 Z" },
  ID: { viewBox: "0 0 140 200", path: "M40 8 L130 12 L132 60 L122 88 L112 114 L122 144 L120 188 L36 192 L28 168 L22 136 L18 100 L14 64 L20 32 Z" },
  MT: { viewBox: "0 0 200 120", path: "M14 28 L62 20 L78 12 L186 18 L194 64 L182 96 L130 108 L74 110 L34 102 L10 76 Z" },
  WY: { viewBox: "0 0 200 140", path: "M14 12 L186 16 L188 124 L14 128 Z" },
  CO: { viewBox: "0 0 200 140", path: "M14 12 L186 16 L188 124 L14 128 Z" },
  UT: { viewBox: "0 0 140 200", path: "M14 12 L96 14 L96 60 L130 64 L130 188 L18 192 L14 140 Z" },
  AZ: { viewBox: "0 0 160 200", path: "M14 12 L146 16 L150 178 L60 188 L20 184 L10 160 L12 80 Z" },
  NM: { viewBox: "0 0 160 200", path: "M14 12 L146 14 L150 188 L14 192 Z" },
  ND: { viewBox: "0 0 200 120", path: "M10 24 L188 14 L196 96 L156 108 L94 110 L40 104 L12 96 Z" },
  SD: { viewBox: "0 0 200 120", path: "M14 16 L188 12 L196 88 L168 104 L116 108 L72 102 L28 96 L10 84 Z" },
  NE: { viewBox: "0 0 200 120", path: "M8 36 L60 20 L100 12 L188 18 L196 80 L170 100 L116 108 L72 100 L28 92 L10 80 Z" },
  KS: { viewBox: "0 0 200 120", path: "M12 16 L188 18 L196 100 L14 104 Z" },
  OK: { viewBox: "0 0 200 140", path: "M10 32 L40 22 L60 30 L188 18 L196 96 L176 108 L96 116 L48 114 L20 102 Z" },
  MN: { viewBox: "0 0 160 200", path: "M16 12 L80 8 L90 24 L150 30 L146 90 L138 130 L150 168 L134 190 L82 190 L46 184 L20 168 L12 140 L8 100 L10 60 Z" },
  IA: { viewBox: "0 0 200 140", path: "M14 24 L188 18 L196 84 L166 110 L92 124 L46 120 L18 108 L8 84 Z" },
  MO: { viewBox: "0 0 200 200", path: "M14 28 L60 20 L188 18 L196 80 L182 124 L172 168 L156 192 L72 188 L28 174 L12 140 L10 80 Z" },
  AR: { viewBox: "0 0 160 200", path: "M14 12 L146 16 L150 80 L142 124 L138 168 L128 192 L40 192 L18 168 L10 120 L8 70 Z" },
  LA: { viewBox: "0 0 200 160", path: "M12 12 L96 14 L96 88 L138 90 L188 94 L196 130 L172 152 L120 148 L80 132 L40 138 L14 128 Z" },
  WI: { viewBox: "0 0 160 200", path: "M14 32 L60 20 L92 28 L120 18 L146 28 L150 92 L138 132 L120 168 L96 192 L60 188 L34 170 L20 140 L10 100 L8 60 Z" },
  IL: { viewBox: "0 0 160 200", path: "M30 12 L120 14 L134 50 L142 96 L150 140 L138 176 L120 192 L60 192 L36 180 L20 158 L14 130 L18 88 L24 50 Z" },
  IN: { viewBox: "0 0 140 200", path: "M22 12 L120 16 L128 70 L130 124 L120 168 L100 192 L48 192 L28 176 L18 140 L14 92 L18 50 Z" },
  MI: { viewBox: "0 0 200 200", path: "M40 12 L80 6 L96 26 L120 36 L150 32 L172 18 L188 32 L186 70 L168 110 L138 144 L116 168 L96 188 L70 192 L48 178 L36 148 L28 110 L22 70 Z M110 96 L150 92 L170 76 L182 60 L172 50 L150 62 L130 72 L114 82 Z" },
  OH: { viewBox: "0 0 160 200", path: "M16 28 L80 12 L130 14 L150 30 L150 124 L138 168 L116 188 L70 192 L40 184 L20 168 L10 140 L12 96 Z" },
  KY: { viewBox: "0 0 200 140", path: "M10 60 L36 36 L80 22 L130 18 L172 30 L188 50 L196 90 L184 116 L162 124 L120 122 L84 116 L52 122 L26 116 L12 96 Z" },
  TN: { viewBox: "0 0 200 100", path: "M8 24 L188 16 L196 56 L184 84 L120 86 L72 86 L30 80 L10 60 Z" },
  AL: { viewBox: "0 0 140 200", path: "M16 12 L120 14 L130 60 L128 124 L118 168 L102 192 L46 192 L26 168 L18 130 L14 80 Z" },
  MS: { viewBox: "0 0 140 200", path: "M22 12 L122 14 L128 70 L126 130 L116 168 L100 192 L50 192 L30 168 L20 132 L16 80 Z" },
  GA: { viewBox: "0 0 160 200", path: "M16 16 L140 20 L150 60 L150 110 L140 152 L122 184 L98 192 L62 188 L38 170 L20 144 L10 108 L8 68 Z" },
  SC: { viewBox: "0 0 200 140", path: "M10 22 L130 18 L188 38 L196 80 L172 116 L130 124 L78 116 L40 100 L14 80 Z" },
  NC: { viewBox: "0 0 200 100", path: "M8 30 L120 20 L188 26 L196 50 L184 76 L150 84 L100 80 L52 82 L20 76 L10 56 Z" },
  VA: { viewBox: "0 0 200 120", path: "M14 36 L60 20 L120 18 L188 24 L196 60 L184 92 L150 104 L96 100 L60 104 L30 96 L10 76 Z" },
  WV: { viewBox: "0 0 160 200", path: "M40 16 L120 12 L140 36 L150 80 L146 124 L130 168 L106 192 L70 188 L40 168 L20 140 L10 100 L14 60 Z" },
  PA: { viewBox: "0 0 200 120", path: "M14 16 L188 18 L196 50 L184 92 L150 108 L96 108 L48 104 L18 92 L10 60 Z" },
  MD: { viewBox: "0 0 200 100", path: "M14 36 L60 22 L96 16 L130 18 L188 26 L196 56 L180 78 L160 80 L130 70 L100 76 L72 80 L42 76 L18 64 Z" },
  DC: { viewBox: "0 0 100 100", path: "M30 30 L70 30 L70 70 L30 70 Z" },
  DE: { viewBox: "0 0 100 200", path: "M30 20 L70 24 L78 60 L74 110 L66 156 L50 188 L34 178 L22 152 L18 110 L20 60 Z" },
  NJ: { viewBox: "0 0 120 200", path: "M30 12 L80 16 L96 40 L100 90 L94 140 L80 184 L60 192 L40 180 L26 156 L20 110 L24 60 Z" },
  CT: { viewBox: "0 0 200 100", path: "M14 28 L188 22 L196 70 L172 88 L120 86 L72 84 L24 78 Z" },
  RI: { viewBox: "0 0 100 140", path: "M30 16 L70 20 L80 50 L78 90 L62 124 L40 124 L24 96 L20 56 Z" },
  MA: { viewBox: "0 0 200 100", path: "M14 28 L60 22 L120 20 L188 24 L196 56 L180 84 L150 88 L100 80 L52 82 L24 76 Z" },
  VT: { viewBox: "0 0 120 200", path: "M30 12 L92 16 L100 60 L92 124 L80 184 L52 192 L34 170 L22 130 L20 70 Z" },
  NH: { viewBox: "0 0 120 200", path: "M40 12 L94 24 L100 80 L92 140 L74 188 L48 192 L32 168 L22 132 L20 80 L26 36 Z" },
  ME: { viewBox: "0 0 140 200", path: "M14 28 L60 20 L96 12 L130 18 L138 60 L130 110 L116 156 L92 192 L60 192 L34 178 L20 150 L10 110 L8 70 Z" },
  PR: { viewBox: "0 0 200 100", path: "M12 36 L80 24 L150 28 L188 38 L194 64 L160 78 L96 80 L40 74 L10 60 Z" },
};

function StateSilhouette({ code }: { code: string }) {
  const sil = STATE_SILHOUETTES[code];
  const filterId = `state-glow-${code}`;
  if (sil) {
    return (
      <svg
        viewBox={sil.viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <defs>
          <filter
            id={filterId}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`fill-${code}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity="0.35" />
            <stop
              offset="100%"
              stopColor={colors.accent_2}
              stopOpacity="0.05"
            />
          </linearGradient>
        </defs>
        {/* Halo silhouette (blurred + stacked) */}
        <path
          d={sil.path}
          fill={colors.accent}
          opacity="0.18"
          filter={`url(#${filterId})`}
        />
        {/* Inner gradient body */}
        <path
          d={sil.path}
          fill={`url(#fill-${code})`}
          stroke={colors.accent}
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* Inner accent stroke for definition */}
        <path
          d={sil.path}
          fill="none"
          stroke={colors.glow}
          strokeWidth="0.4"
          strokeOpacity="0.7"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // Fallback — a stamped sodium-glow cartouche.
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <defs>
        <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect
        x="10"
        y="10"
        width="80"
        height="80"
        rx="8"
        fill={colors.accent}
        opacity="0.18"
        filter={`url(#${filterId})`}
      />
      <rect
        x="14"
        y="14"
        width="72"
        height="72"
        rx="6"
        fill={colors.surface}
        stroke={colors.accent}
        strokeWidth="0.8"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function StatePage({
  params,
  searchParams,
}: {
  params: Promise<{ s: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { s } = await params;
  const sp = await searchParams;
  const stateCode = s.toUpperCase();
  const fullName = STATE_NAMES[stateCode] ?? stateCode;

  if (!/^[A-Z]{2}$/.test(stateCode)) {
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
          Bad state — “{s}”
        </h1>
        <p style={{ color: colors.text_dim, marginTop: "1rem" }}>
          State path must be a two-letter US state or territory code.
        </p>
      </main>
    );
  }

  const yearRaw = firstParam(sp.year);
  const yearParam = isYear(yearRaw) ? parseInt(yearRaw, 10) : undefined;

  // Build URLs.
  const summaryUrl = yearParam
    ? `/api/state/${stateCode}/summary?year=${yearParam}`
    : `/api/state/${stateCode}/summary`;
  const entriesQuery = new URLSearchParams();
  entriesQuery.set("limit", "200");
  if (yearParam) entriesQuery.set("year", String(yearParam));
  const entriesUrl = `/api/state/${stateCode}/entries?${entriesQuery.toString()}`;

  const [summary, entries, years] = await Promise.all([
    apiGet<StateSummary>(summaryUrl).catch(() => null as StateSummary | null),
    apiGet<StateEntry[]>(entriesUrl).catch(() => [] as StateEntry[]),
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
            {stateCode}
          </h1>
          <p style={{ color: colors.text_dim, marginTop: "1rem" }}>
            Couldn’t load the summary for {fullName}.
          </p>
        </div>
      </main>
    );
  }

  const topCityMax = summary.top_cities[0]?.count ?? 0;

  function yearHref(targetYear: number | null): string {
    if (targetYear === null) return `/state/${stateCode}`;
    return `/state/${stateCode}?year=${targetYear}`;
  }

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

      {/* --- HEADER --------------------------------------------------- */}
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
            <Link
              href="/"
              style={{ color: colors.text_dim, textDecoration: "none" }}
            >
              ham-callbook
            </Link>
            <span aria-hidden>·</span>
            <span>callbook state</span>
            <span aria-hidden>·</span>
            <span>{motifs.morseDividers.tight}</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, auto) minmax(0, 1fr)",
              alignItems: "center",
              gap: "clamp(1.5rem, 4vw, 3rem)",
            }}
          >
            {/* One-memorable-thing: a stylized state silhouette with a
                sodium-vapor halo. The 2-letter code is stamped over it
                in massive Fraunces so glyph + cartograph read as one. */}
            <div
              style={{
                position: "relative",
                width: "clamp(9rem, 18vw, 16rem)",
                aspectRatio: "1",
                flexShrink: 0,
              }}
            >
              <StateSilhouette code={stateCode} />
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: fontStacks.display,
                  fontSize: "clamp(3rem, 9vw, 7rem)",
                  fontWeight: 600,
                  fontVariationSettings: '"opsz" 144',
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  color: colors.text,
                  textShadow: motifs.glow.textShadow,
                  mixBlendMode: "screen",
                  pointerEvents: "none",
                }}
              >
                {stateCode}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.65rem",
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  color: colors.accent,
                }}
              >
                State · {stateCode}
              </span>
              <h1
                style={{
                  margin: 0,
                  fontFamily: fontStacks.display,
                  fontVariationSettings: '"opsz" 144, "wght" 500',
                  fontSize: "clamp(2.75rem, 7vw, 5.5rem)",
                  lineHeight: 0.92,
                  letterSpacing: "-0.025em",
                  color: colors.text,
                  fontStyle: "italic",
                }}
              >
                {fullName}
              </h1>
              {yearParam ? (
                <span
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.75rem",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: colors.text_dim,
                  }}
                >
                  scoped to{" "}
                  <span style={{ color: colors.accent }}>{yearParam}</span>
                </span>
              ) : null}
            </div>
          </div>

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
              value={summary.total_entries.toLocaleString()}
            />
            <StatCell
              label="Distinct callsigns"
              value={summary.distinct_callsigns.toLocaleString()}
            />
            <StatCell
              label="Peak year"
              value={summary.peak_year ? String(summary.peak_year) : "—"}
              sub={
                summary.peak_year_count
                  ? `${summary.peak_year_count.toLocaleString()} entries`
                  : undefined
              }
            />
            <StatCell
              label="Top cities"
              value={summary.top_cities.length.toString().padStart(2, "0")}
            />
          </div>
        </div>
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="cities" />
      </div>

      {/* --- TOP CITIES TILE ROW ------------------------------------- */}
      <section
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionHeader
          title="Top cities"
          hint={`${summary.top_cities.length} shown`}
        />
        {summary.top_cities.length === 0 ? (
          <div style={emptyStyle}>No city-level data for {stateCode}.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(13rem, 1fr))",
              gap: "0.75rem",
            }}
          >
            {summary.top_cities.map((c, i) => {
              const ratio = topCityMax > 0 ? c.count / topCityMax : 0;
              const alpha = 0.05 + ratio * 0.4;
              return (
                <div
                  key={c.city}
                  style={{
                    position: "relative",
                    padding: "1rem 1.125rem 1.25rem",
                    border: `1px solid ${colors.border}`,
                    background: colors.surface,
                    borderLeft: `3px solid ${
                      i === 0 ? colors.glow : colors.accent
                    }`,
                    borderRadius: "0.25rem",
                    overflow: "hidden",
                  }}
                >
                  {/* Tint band */}
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: `linear-gradient(90deg, rgba(255,163,11,${alpha.toFixed(
                        3,
                      )}) 0%, transparent 70%)`,
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.375rem",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.65rem",
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color: colors.text_dim,
                      }}
                    >
                      #{String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      style={{
                        fontFamily: fontStacks.display,
                        fontVariationSettings: '"opsz" 28',
                        fontSize: "1.15rem",
                        lineHeight: 1.15,
                        color: colors.text,
                      }}
                    >
                      {cleanOCRCity(c.city) || c.city}
                    </span>
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.8rem",
                        letterSpacing: "0.05em",
                        color: colors.accent,
                      }}
                    >
                      {c.count.toLocaleString()}{" "}
                      <span
                        style={{
                          color: colors.text_dim,
                          fontSize: "0.65rem",
                          letterSpacing: "0.2em",
                          textTransform: "uppercase",
                        }}
                      >
                        entries
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="year selector" />
      </div>

      {/* --- YEAR SELECTOR ------------------------------------------- */}
      <section
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionHeader
          title="Filter by year"
          hint={
            yearParam
              ? `active: ${yearParam}`
              : `${years.length} years on file`
          }
        />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.375rem",
            marginBottom: "0.5rem",
          }}
        >
          <YearChip
            href={yearHref(null)}
            label="ALL YEARS"
            active={!yearParam}
          />
          {years
            .slice()
            .sort((a, b) => a.year - b.year)
            .map((y) => (
              <YearChip
                key={y.year}
                href={yearHref(yearParam === y.year ? null : y.year)}
                label={String(y.year)}
                active={yearParam === y.year}
              />
            ))}
        </div>
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="entries" />
      </div>

      {/* --- DATA TABLE ---------------------------------------------- */}
      <section
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 6rem",
        }}
      >
        <SectionHeader
          title="Entries"
          hint={
            entries.length === 0
              ? "no rows"
              : `${entries.length.toLocaleString()} loaded`
          }
        />
        {entries.length === 0 ? (
          <div style={emptyStyle}>
            No entries matched the current filters for {stateCode}.
          </div>
        ) : (
          <EntriesTable entries={entries} />
        )}
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
}: {
  label: string;
  value: string;
  sub?: string;
}) {
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
          color: colors.accent,
          textShadow: motifs.glow.textShadow,
        }}
      >
        {value}
      </span>
      {sub ? (
        <span style={{ fontSize: "0.7rem", color: colors.text_dim }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
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

function YearChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "0.4rem 0.65rem",
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.1em",
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
    </Link>
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
// Page metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ s: string }>;
}) {
  const { s } = await params;
  const code = s.toUpperCase();
  const name = STATE_NAMES[code] ?? code;
  return {
    title: `${name} (${code})`,
    description: `Every callbook entry in ${name} from the US Ham Callbook Archive.`,
  };
}
