/**
 * /search — Smart full-text search across the ham-callbook corpus.
 *
 * Server component (Next.js 15 App Router). Reads the four query params
 * documented in the API contract:
 *
 *   * ``q``       — required free-text query (callsign, name, city, state).
 *   * ``year``    — optional 4-digit edition year filter.
 *   * ``state``   — optional 2-letter US state code filter.
 *   * ``edition`` — optional edition identifier (e.g. ``"1937-summer"``).
 *
 * Pagination is also URL-driven via ``page`` (1-indexed) and ``per`` so
 * that every state of this page is bookmarkable and shareable — the
 * vintage-archive vibe relies on stable URLs that look like dewey-decimal
 * call numbers. Internally we translate ``page`` → ``offset`` for the API.
 *
 * Aesthetic contract (LOCKED — see `lib/design.ts`):
 *
 *   * Sodium-vapor palette: midnight #0a0e1a + amber #ffa30b + bone #f5ecd9.
 *   * Display type: Fraunces (variable opsz — 144 on the hero, 28-36 on
 *     headings, 20 inside the dense data table for the name column).
 *   * Mono: JetBrains Mono for every callsign, year, state-code, count,
 *     and snippet — the data is the texture.
 *   * Body: Geist Sans (only for prose; never for tabular data).
 *   * Motifs: CRT scanlines on the hero, fractal-noise grain across the
 *     whole page, morse-code dividers between sections, amber glow on
 *     the headline + active facets. NO Inter, NO purple, NO scale-105.
 *
 * Memorable thing on THIS page: the "no signal" empty state — an SVG
 * oscilloscope flatline with a slowly-pulsing SOS morse pattern under it,
 * paired with a sodium-amber underline that sweeps left-to-right under
 * every result row on hover. Sidebar facets are stylised as a spectrum
 * readout where every count is a vertical bar in a tuned receiver.
 *
 * Server-component-safe interactivity: all motion (entrance staggers,
 * hover underline sweep, SOS pulse) is implemented in a scoped `<style>`
 * block at the top of the page — no client component required.
 *
 * Layout: an asymmetric 12-col grid per the design tokens — results table
 * fills cols 1-8, facets sidebar (year + state + edition) cols 9-12.
 */

import { colors, fontStacks, motifs } from "../../lib/design";
import type {
  SearchFacets,
  SearchHit,
  SearchResults,
} from "../../lib/types";
import { cleanOCRName, cleanOCRCity, cleanOCRState } from "../../lib/ocrClean";

// ---------------------------------------------------------------------------
// Tunables.
// ---------------------------------------------------------------------------

/**
 * Default page size for the results table. Chosen to fill ~one screen of
 * dense rows on a 1080p display without forcing the user to scroll past
 * the facets column.
 */
const DEFAULT_PER_PAGE = 25;

/** Hard cap mirroring the backend `limit` validator (1-200). */
const MAX_PER_PAGE = 100;

/** Hard cap on `page` so a hostile URL can't blow up the API. */
const MAX_PAGE = 400;

// ---------------------------------------------------------------------------
// Query-param plumbing.
// ---------------------------------------------------------------------------

/**
 * Next.js 15 server components receive `searchParams` as a Promise; the
 * values themselves can be `string | string[] | undefined` depending on
 * whether the same key was repeated in the URL.
 */
type SearchParams = Record<string, string | string[] | undefined>;

/** Collapse a possibly-repeated query param to its first non-empty value. */
function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find((v) => v && v.length > 0);
  return value && value.length > 0 ? value : undefined;
}

/**
 * Parse an integer query param, returning `undefined` when missing, NaN,
 * or out-of-range. Out-of-range silently clamps to the nearest bound so
 * the page never throws on a hand-crafted URL.
 */
function intParam(
  raw: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Normalize a state code: trims, uppercases, validates against the
 * 2-letter shape. Anything else collapses to `undefined` so the API
 * doesn't 400 on garbage like `?state=California`.
 */
function normState(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Resolved API origin. Empty string means "same origin as the page",
 * which is the production deployment shape (Caddy proxies /api → FastAPI).
 * Mirrors the convention in `lib/club_api.ts` so behaviour is consistent.
 */
const API_BASE: string = (typeof window === "undefined" ? (process.env.INTERNAL_API_BASE ?? "http://backend:8000") : "").replace(
  /\/+$/,
  "",
);

/**
 * Fire the `/api/search` call. We catch network/HTTP errors here and
 * surface them as a typed null so the page can render a friendly empty
 * state instead of crashing the route on a transient backend hiccup.
 */
async function fetchSearch(params: {
  q: string;
  year?: number;
  state?: string;
  edition?: string;
  limit: number;
  offset: number;
}): Promise<SearchResults | null> {
  const usp = new URLSearchParams();
  usp.set("q", params.q);
  if (params.year !== undefined) usp.set("year", String(params.year));
  if (params.state !== undefined) usp.set("state", params.state);
  if (params.edition !== undefined) usp.set("edition", params.edition);
  usp.set("limit", String(params.limit));
  usp.set("offset", String(params.offset));

  const url = `${API_BASE}/api/search?${usp.toString()}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as SearchResults;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL builders for facet links + pagination.
// ---------------------------------------------------------------------------

/**
 * Build a `/search?...` href that preserves all current params and
 * overrides (or removes, when value is `undefined`) the named ones.
 *
 * We never emit `page=1` because that's the default and would clutter the
 * URL bar; clicking a facet always resets pagination to page 1.
 */
function buildHref(
  current: {
    q?: string;
    year?: number;
    state?: string;
    edition?: string;
    page?: number;
    per?: number;
  },
  override: Partial<{
    q: string | undefined;
    year: number | undefined;
    state: string | undefined;
    edition: string | undefined;
    page: number | undefined;
    per: number | undefined;
  }>,
): string {
  const merged = { ...current, ...override };
  const usp = new URLSearchParams();
  if (merged.q) usp.set("q", merged.q);
  if (merged.year !== undefined) usp.set("year", String(merged.year));
  if (merged.state) usp.set("state", merged.state);
  if (merged.edition) usp.set("edition", merged.edition);
  if (merged.page !== undefined && merged.page > 1)
    usp.set("page", String(merged.page));
  if (merged.per !== undefined && merged.per !== DEFAULT_PER_PAGE)
    usp.set("per", String(merged.per));
  const qs = usp.toString();
  return qs ? `/search?${qs}` : "/search";
}

// ---------------------------------------------------------------------------
// Scoped CSS — all motion, hover sweeps, and the SOS oscillator animation.
// Inlined here so the file remains a single self-contained server component.
// Class prefix `sv-` ("sodium vapor") avoids global namespace collisions.
// ---------------------------------------------------------------------------

const SCOPED_CSS = `
/* Staggered entrance — set --i: <index> on each child to delay its reveal. */
@keyframes sv-rise {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
    filter: blur(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}
.sv-rise {
  opacity: 0;
  animation: sv-rise 520ms cubic-bezier(0.2, 0.65, 0.2, 1) forwards;
  animation-delay: calc(var(--i, 0) * 22ms + 80ms);
}

/* Result row: left-to-right amber underline that animates on hover. */
.sv-row {
  position: relative;
}
.sv-row::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: ${colors.accent};
  box-shadow: 0 0 8px ${colors.glow}, 0 0 2px ${colors.accent};
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 360ms cubic-bezier(0.25, 0.7, 0.2, 1);
  pointer-events: none;
}
.sv-row:hover::after,
.sv-row:focus-visible::after {
  transform: scaleX(1);
}
.sv-row:hover .sv-row-callsign,
.sv-row:focus-visible .sv-row-callsign {
  text-shadow: 0 0 18px rgba(255, 209, 102, 0.85),
    0 0 4px rgba(255, 163, 11, 0.95);
}
.sv-row:hover .sv-row-cell,
.sv-row:focus-visible .sv-row-cell {
  background: rgba(255, 163, 11, 0.035);
}

/* Snippet highlight: subtle amber underline rather than a fill block. */
.sv-mark {
  color: ${colors.accent};
  background: transparent;
  border-bottom: 1px solid ${colors.accent};
  padding-bottom: 1px;
  box-shadow: inset 0 -2px 0 rgba(255, 163, 11, 0.12);
  text-shadow: 0 0 6px rgba(255, 209, 102, 0.35);
}

/* Spectrum-readout facet bar — vertical column, animates from baseline. */
@keyframes sv-spectrum-bar {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}
.sv-spectrum-bar {
  display: block;
  width: 100%;
  background: ${colors.accent};
  transform-origin: bottom;
  animation: sv-spectrum-bar 520ms cubic-bezier(0.2, 0.7, 0.25, 1) forwards;
  animation-delay: calc(var(--i, 0) * 12ms);
  transform: scaleY(0);
}
.sv-spectrum-link {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;
  height: 100%;
  padding: 0 1px;
  text-decoration: none;
  outline: none;
}
.sv-spectrum-link:hover .sv-spectrum-bar,
.sv-spectrum-link:focus-visible .sv-spectrum-bar {
  background: ${colors.glow};
  box-shadow: 0 0 6px ${colors.glow}, 0 0 1px ${colors.accent};
}
.sv-spectrum-link[data-active="true"] .sv-spectrum-bar {
  background: ${colors.glow};
  box-shadow: 0 0 10px ${colors.glow}, 0 0 2px ${colors.accent};
}
.sv-spectrum-link .sv-spectrum-label {
  position: absolute;
  bottom: -1.25rem;
  left: 50%;
  transform: translateX(-50%) rotate(-65deg);
  transform-origin: top left;
  font-family: ${fontStacks.mono};
  font-size: 0.55rem;
  letter-spacing: 0.08em;
  color: ${colors.text_dim};
  white-space: nowrap;
  pointer-events: none;
}
.sv-spectrum-link[data-active="true"] .sv-spectrum-label,
.sv-spectrum-link:hover .sv-spectrum-label {
  color: ${colors.accent};
  text-shadow: 0 0 4px rgba(255, 209, 102, 0.6);
}

/* Vertical state-list bar that fills left-to-right (oscilloscope feel). */
.sv-vbar {
  display: block;
  height: 0.2rem;
  background: linear-gradient(
    90deg,
    ${colors.accent} 0%,
    ${colors.accent_2} 100%
  );
  transform-origin: left;
  animation: sv-vbar-grow 600ms cubic-bezier(0.2, 0.7, 0.25, 1) forwards;
  animation-delay: calc(var(--i, 0) * 18ms);
  transform: scaleX(0);
  opacity: 0.7;
}
@keyframes sv-vbar-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.sv-facet-row {
  position: relative;
  display: grid;
  grid-template-columns: 2.4rem 1fr 2.6rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0.4rem;
  font-family: ${fontStacks.mono};
  font-size: 0.78rem;
  color: ${colors.text};
  text-decoration: none;
  border-left: 2px solid transparent;
  transition: background 160ms ease, color 160ms ease,
    border-color 160ms ease;
}
.sv-facet-row:hover {
  background: rgba(255, 163, 11, 0.05);
  color: ${colors.accent};
}
.sv-facet-row[data-active="true"] {
  background: rgba(255, 163, 11, 0.09);
  color: ${colors.accent};
  border-left-color: ${colors.accent};
  text-shadow: ${motifs.glow.textShadow};
}

/* SOS oscillator pulse for the empty state. */
@keyframes sv-sos-pulse {
  0%,
  100% {
    opacity: 0.18;
  }
  50% {
    opacity: 0.55;
  }
}
@keyframes sv-flat-drift {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-40px);
  }
}
.sv-sos {
  animation: sv-sos-pulse 2400ms ease-in-out infinite;
}
.sv-flat {
  animation: sv-flat-drift 6s linear infinite;
}

/* Respect reduced-motion: kill all animations cleanly. */
@media (prefers-reduced-motion: reduce) {
  .sv-rise,
  .sv-spectrum-bar,
  .sv-vbar,
  .sv-sos,
  .sv-flat {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .sv-row::after {
    transition: none !important;
  }
}
`;

// ---------------------------------------------------------------------------
// Snippet rendering — the FTS5 snippet() output ships with <mark> tags.
// We sanitize to a very narrow allow-list and re-emit with our amber style.
// ---------------------------------------------------------------------------

/**
 * Render an FTS5 `snippet()` string safely. The backend wraps matched
 * terms in `<mark>...</mark>`; everything else is plain text. We split
 * on `<mark>`/`</mark>` literally (the snippet output never contains raw
 * angle-brackets from the source — FTS5 escapes them as part of its
 * tokenization), then alternate plain spans with amber-underlined spans
 * (no background fill — per the design brief).
 *
 * This avoids `dangerouslySetInnerHTML` entirely; React handles all the
 * HTML-entity escaping on the plain segments for us.
 */
function Snippet({ html }: { html: string }) {
  const parts = html.split(/<\/?mark>/g);
  return (
    <span
      style={{
        fontFamily: fontStacks.mono,
        fontSize: "0.78rem",
        lineHeight: 1.5,
        color: colors.text_dim,
        letterSpacing: "0.01em",
      }}
    >
      {parts.map((segment, i) => {
        const isMatch = i % 2 === 1;
        if (!isMatch) {
          return <span key={i}>{segment}</span>;
        }
        return (
          <span key={i} className="sv-mark">
            {segment}
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Decorative motif components (scoped to this page — kept inline so the
// /search route stays a single self-contained file per the project rule).
// ---------------------------------------------------------------------------

/** CRT scanlines layer for the hero. Pointer-events-none. */
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

/** Page-wide grain overlay — fixed, low-opacity SVG fractal noise. */
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

/** Morse-code section divider with optional label. */
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
// Facets sidebar — re-imagined as a tuned-receiver spectrum readout.
// ---------------------------------------------------------------------------

/**
 * Vertical spectrum strip used for the "by year" facet. Each year is a
 * column whose height encodes its match count. Clicking applies/toggles
 * that year filter via URL params (so the page stays server-rendered).
 *
 * Sorted ASCENDING by year inside this widget — left-to-right time axis
 * matches how an operator would expect to read a spectrum waterfall.
 */
function YearSpectrum({
  years,
  current,
}: {
  years: { year: number; count: number }[];
  current: {
    q?: string;
    year?: number;
    state?: string;
    edition?: string;
  };
}) {
  if (years.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
        }}
      >
        no edition data
      </p>
    );
  }
  // Linear scaling — counts span small enough range here that log would
  // collapse the visible delta. Floor at 8% so a bar is always tappable.
  const max = years.reduce((m, y) => Math.max(m, y.count), 0);
  const sorted = [...years].sort((a, b) => a.year - b.year);

  return (
    <div>
      <div
        aria-hidden
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: fontStacks.mono,
          fontSize: "0.55rem",
          letterSpacing: "0.2em",
          color: colors.text_dim,
          textTransform: "uppercase",
          marginBottom: "0.4rem",
        }}
      >
        <span>spectrum</span>
        <span>peak {max.toLocaleString()}</span>
      </div>
      <div
        role="list"
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${sorted.length}, 1fr)`,
          gap: "1px",
          height: "5.5rem",
          padding: "0.25rem 0",
          background: `linear-gradient(180deg, transparent 0%, rgba(255,163,11,0.04) 100%)`,
          borderBottom: `1px solid ${colors.border}`,
          borderTop: `1px solid ${colors.border}`,
          marginBottom: "2rem",
        }}
      >
        {sorted.map((y, i) => {
          const active = current.year === y.year;
          const pct = max > 0 ? Math.max(8, (y.count / max) * 100) : 0;
          const label = `${y.year} · ${y.count.toLocaleString()} match${
            y.count === 1 ? "" : "es"
          }`;
          return (
            <a
              key={y.year}
              role="listitem"
              href={buildHref(current, {
                year: active ? undefined : y.year,
                page: 1,
              })}
              className="sv-spectrum-link"
              data-active={active ? "true" : "false"}
              title={label}
              aria-label={label}
              style={{ height: "100%" }}
            >
              <span
                className="sv-spectrum-bar"
                style={{
                  height: `${pct}%`,
                  ["--i" as string]: i,
                  opacity: active ? 1 : 0.55,
                }}
              />
              {/* Sparse labels: every ~5th column carries a year tick. */}
              {i % Math.max(1, Math.floor(sorted.length / 6)) === 0 ||
              active ? (
                <span className="sv-spectrum-label">{y.year}</span>
              ) : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function FacetSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: "2rem",
        paddingBottom: "1.5rem",
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <h3
        style={{
          margin: 0,
          marginBottom: "0.875rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: colors.accent,
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function FacetsSidebar({
  facets,
  current,
}: {
  facets: SearchFacets;
  current: {
    q?: string;
    year?: number;
    state?: string;
    edition?: string;
  };
}) {
  // Years: cap to top-30 (by count) for the spectrum so the strip stays
  // readable; the underlying API already returns a pre-truncated facet.
  const years = [...facets.years]
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const states = [...facets.states]
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const maxStateCount = states.reduce((m, s) => Math.max(m, s.count), 0);

  return (
    <aside
      aria-label="Refine search"
      style={{
        fontFamily: fontStacks.body,
        color: colors.text,
        position: "sticky",
        top: "1.5rem",
        alignSelf: "start",
      }}
    >
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.6rem",
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: colors.text_dim,
          marginBottom: "0.75rem",
        }}
      >
        {motifs.morseDividers.tight} &nbsp; refine
      </div>

      {(current.year !== undefined ||
        current.state ||
        current.edition) && (
        <FacetSection title="Active filters">
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
            }}
          >
            {current.year !== undefined && (
              <li>
                <a
                  href={buildHref(current, { year: undefined, page: 1 })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.25rem 0.5rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.72rem",
                    letterSpacing: "0.1em",
                    color: colors.bg,
                    background: colors.accent,
                    textDecoration: "none",
                    borderRadius: "0.15rem",
                  }}
                >
                  YEAR · {current.year}
                  <span aria-hidden style={{ fontWeight: 700 }}>
                    ×
                  </span>
                </a>
              </li>
            )}
            {current.state && (
              <li>
                <a
                  href={buildHref(current, { state: undefined, page: 1 })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.25rem 0.5rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.72rem",
                    letterSpacing: "0.1em",
                    color: colors.bg,
                    background: colors.accent,
                    textDecoration: "none",
                    borderRadius: "0.15rem",
                  }}
                >
                  STATE · {current.state}
                  <span aria-hidden style={{ fontWeight: 700 }}>
                    ×
                  </span>
                </a>
              </li>
            )}
            {current.edition && (
              <li>
                <a
                  href={buildHref(current, { edition: undefined, page: 1 })}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.25rem 0.5rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.72rem",
                    letterSpacing: "0.1em",
                    color: colors.bg,
                    background: colors.accent,
                    textDecoration: "none",
                    borderRadius: "0.15rem",
                  }}
                >
                  EDITION · {current.edition}
                  <span aria-hidden style={{ fontWeight: 700 }}>
                    ×
                  </span>
                </a>
              </li>
            )}
          </ul>
        </FacetSection>
      )}

      <FacetSection title="By year — spectrum">
        <YearSpectrum years={years} current={current} />
      </FacetSection>

      <FacetSection title="By state — readout">
        {states.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              color: colors.text_dim,
              fontFamily: fontStacks.mono,
            }}
          >
            no state data
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.1rem",
            }}
          >
            {states.map((s, i) => {
              const active = current.state === s.state;
              const pct =
                maxStateCount > 0
                  ? Math.max(4, Math.round((s.count / maxStateCount) * 100))
                  : 0;
              return (
                <li key={s.state}>
                  <a
                    href={buildHref(current, {
                      state: active ? undefined : s.state,
                      page: 1,
                    })}
                    className="sv-facet-row"
                    data-active={active ? "true" : "false"}
                  >
                    <span style={{ letterSpacing: "0.08em" }}>{s.state}</span>
                    <span
                      aria-hidden
                      style={{
                        display: "block",
                        width: "100%",
                        height: "0.2rem",
                        position: "relative",
                        background: `linear-gradient(90deg, ${colors.border} 0%, ${colors.border} 100%)`,
                        opacity: 0.5,
                      }}
                    >
                      <span
                        className="sv-vbar"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: `${pct}%`,
                          ["--i" as string]: i,
                          opacity: active ? 1 : 0.7,
                        }}
                      />
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: active ? colors.accent : colors.text_dim,
                        fontSize: "0.7rem",
                      }}
                    >
                      {s.count.toLocaleString()}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </FacetSection>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Empty state — distinctive, on-brand.
// ---------------------------------------------------------------------------

/**
 * "No signal" SVG — a flat oscilloscope trace with the SOS morse pattern
 * (· · · — — — · · ·) faintly pulsing beneath it. This is the page's
 * "one memorable thing" per the design brief. Purely decorative, marked
 * aria-hidden — the readable text below carries the same message.
 */
function NoSignalScope() {
  // SOS morse: dit/dah lengths in "units". 1 = dit, 3 = dah, 1 = intra-char gap,
  // 3 = inter-char gap. We render it as a row of rects on a baseline.
  const UNIT = 8;
  const GAP = 8;
  const symbols: Array<{ len: 1 | 3; isDah: boolean }> = [
    // S = · · ·
    { len: 1, isDah: false },
    { len: 1, isDah: false },
    { len: 1, isDah: false },
    // O = — — —
    { len: 3, isDah: true },
    { len: 3, isDah: true },
    { len: 3, isDah: true },
    // S = · · ·
    { len: 1, isDah: false },
    { len: 1, isDah: false },
    { len: 1, isDah: false },
  ];
  // Insert wider gaps between letter groups (positions 3 and 6).
  let x = 0;
  const rects = symbols.map((sym, i) => {
    const w = sym.len * UNIT;
    const rect = { x, w, isDah: sym.isDah };
    x += w + GAP;
    if (i === 2 || i === 5) x += GAP * 2; // inter-letter gap
    return rect;
  });
  const totalW = x;
  const VBW = 600;
  const VBH = 140;
  const morseY = VBH - 18;
  const morseStartX = (VBW - totalW) / 2;
  const flatY = 60;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${VBW} ${VBH}`}
      role="img"
      style={{
        width: "100%",
        maxWidth: "32rem",
        height: "auto",
        display: "block",
        margin: "0 auto 1.5rem",
        overflow: "visible",
      }}
    >
      {/* Subtle scope grid */}
      <defs>
        <pattern id="sv-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path
            d="M 20 0 L 0 0 0 20"
            fill="none"
            stroke={colors.border}
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </pattern>
        <linearGradient id="sv-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={colors.bg} stopOpacity="0" />
          <stop offset="100%" stopColor={colors.bg} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width={VBW} height={VBH} fill="url(#sv-grid)" />
      <rect width={VBW} height={VBH} fill="url(#sv-fade)" />

      {/* Center baseline reference */}
      <line
        x1="0"
        y1={flatY}
        x2={VBW}
        y2={flatY}
        stroke={colors.border}
        strokeWidth="1"
        strokeDasharray="2 4"
        opacity="0.55"
      />

      {/* Flat-line scope trace (drifting horizontally) */}
      <g className="sv-flat">
        <path
          d={`M -40 ${flatY} L ${VBW + 40} ${flatY}`}
          stroke={colors.accent}
          strokeWidth="1.5"
          fill="none"
          opacity="0.85"
          style={{
            filter: "drop-shadow(0 0 4px rgba(255, 209, 102, 0.7))",
          }}
        />
        {/* tiny noise spikes — a quiet receiver */}
        <path
          d={`M -40 ${flatY} L 60 ${flatY} L 64 ${flatY - 2} L 68 ${flatY + 1} L 72 ${flatY} L 220 ${flatY} L 224 ${flatY + 1} L 228 ${flatY - 1} L 232 ${flatY} L 420 ${flatY} L 424 ${flatY - 2} L 428 ${flatY} L ${VBW + 40} ${flatY}`}
          stroke={colors.accent}
          strokeWidth="1"
          fill="none"
          opacity="0.45"
        />
      </g>

      {/* "NO SIGNAL" mono label, just under the trace */}
      <text
        x={VBW / 2}
        y={flatY + 28}
        textAnchor="middle"
        fontFamily={fontStacks.mono}
        fontSize="10"
        letterSpacing="6"
        fill={colors.text_dim}
        opacity="0.85"
      >
        NO SIGNAL · CARRIER LOST
      </text>

      {/* SOS morse beneath — faint, pulsing */}
      <g className="sv-sos" transform={`translate(${morseStartX} 0)`}>
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={morseY - 3}
            width={r.w}
            height="6"
            rx="1"
            fill={colors.accent}
          />
        ))}
        <text
          x={totalW / 2}
          y={morseY + 18}
          textAnchor="middle"
          fontFamily={fontStacks.mono}
          fontSize="9"
          letterSpacing="8"
          fill={colors.accent}
          opacity="0.75"
        >
          S O S
        </text>
      </g>
    </svg>
  );
}

/**
 * "No results" empty state. Combines the silent-waveform SVG above with a
 * tasteful prose explanation and four sample queries the user can try.
 * Renders only when the user has typed a query and got zero rows back.
 */
function EmptyResults({ q }: { q: string }) {
  const suggestions = ["W1AW", "Hiram Maxim", "Newington", "K6"];
  return (
    <div
      className="sv-rise"
      style={{
        ["--i" as string]: 0,
        position: "relative",
        padding: "3rem 2rem 3rem",
        textAlign: "center",
        border: `1px dashed ${colors.border}`,
        borderRadius: "0.25rem",
        background:
          "linear-gradient(180deg, rgba(255,163,11,0.02) 0%, transparent 100%)",
        overflow: "hidden",
      }}
    >
      <NoSignalScope />
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: colors.accent,
          marginBottom: "0.75rem",
        }}
      >
        {motifs.morseDividers.tight} &nbsp; no copy &nbsp;{" "}
        {motifs.morseDividers.tight}
      </div>
      <div
        style={{
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 96',
          fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
          fontWeight: 600,
          color: colors.text,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          textShadow: motifs.glow.textShadow,
        }}
      >
        QRT
      </div>
      <p
        style={{
          maxWidth: "32rem",
          margin: "1rem auto 0.25rem",
          fontFamily: fontStacks.body,
          fontSize: "0.95rem",
          color: colors.text_dim,
          lineHeight: 1.55,
        }}
      >
        No callbook line matched{" "}
        <em style={{ color: colors.text }}>&ldquo;{q}&rdquo;</em>. The corpus
        indexes ~7.74M lines across the 20th-century callbooks — try a partial
        callsign, a surname, or a city.
      </p>
      <div
        style={{
          marginTop: "1.5rem",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.5rem",
        }}
      >
        {suggestions.map((s) => (
          <a
            key={s}
            href={`/search?q=${encodeURIComponent(s)}`}
            style={{
              padding: "0.5rem 0.875rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              border: `1px solid ${colors.accent_2}`,
              color: colors.accent,
              textDecoration: "none",
              borderRadius: "0.15rem",
              background: "rgba(255, 163, 11, 0.05)",
            }}
          >
            {s}
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Empty state for "/search with no query yet" — invites the user to type
 * without making the page feel broken. Visually distinct from EmptyResults
 * so the user always knows whether they searched and got nothing vs.
 * landed on a blank prompt.
 */
function EmptyPrompt() {
  return (
    <div
      className="sv-rise"
      style={{
        ["--i" as string]: 0,
        padding: "4rem 2rem",
        textAlign: "center",
        border: `1px solid ${colors.border}`,
        borderRadius: "0.25rem",
        background: colors.surface,
      }}
    >
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: colors.accent,
          marginBottom: "0.75rem",
        }}
      >
        cq cq cq &nbsp; {motifs.morseDividers.tight}
      </div>
      <div
        style={{
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 96',
          fontSize: "clamp(2rem, 5vw, 3.5rem)",
          fontWeight: 600,
          color: colors.text,
          lineHeight: 1,
        }}
      >
        Begin transmission.
      </div>
      <p
        style={{
          maxWidth: "30rem",
          margin: "1rem auto 0",
          fontFamily: fontStacks.body,
          fontSize: "0.95rem",
          color: colors.text_dim,
          lineHeight: 1.55,
        }}
      >
        Search by callsign (e.g.{" "}
        <span style={{ fontFamily: fontStacks.mono, color: colors.text }}>
          W1AW
        </span>
        ), operator name, or city. Filter the results with the year spectrum
        and state readout on the right.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results table — hairline grid, callsign+name left, state+zip pushed right.
// ---------------------------------------------------------------------------

/**
 * Build the canonical destination URL for one hit. We deep-link to the
 * callsign detail page; the year/edition are encoded as hash so the
 * callsign page can scroll to the matching row.
 */
function hitHref(hit: SearchHit): string {
  const cs = encodeURIComponent(hit.callsign);
  return `/callsign/${cs}#${encodeURIComponent(`${hit.year}-${hit.edition}`)}`;
}

function ResultsTable({ hits }: { hits: SearchHit[] }) {
  // Column order: callsign · name · snippet (match preview) · city ·
  // year · edition · state. State is the right-most column, intentionally
  // dim, so a glance left-to-right reads identity → context → location.
  const columns: Array<{
    label: string;
    align: "left" | "right";
  }> = [
    { label: "Callsign", align: "left" },
    { label: "Name", align: "left" },
    { label: "Match", align: "left" },
    { label: "City", align: "left" },
    { label: "Yr", align: "right" },
    { label: "Edition", align: "right" },
    { label: "ST", align: "right" },
  ];

  return (
    <div
      role="table"
      aria-label="Search results"
      style={{
        display: "grid",
        // callsign | name | match | city | year | edition | state
        gridTemplateColumns:
          "minmax(6rem, auto) minmax(0, 1.3fr) minmax(0, 2fr) minmax(0, 1fr) 3rem minmax(5rem, auto) 2.5rem",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      {/* Header row */}
      <div role="row" style={{ display: "contents" }}>
        {columns.map((col) => (
          <div
            key={col.label}
            role="columnheader"
            style={{
              padding: "0.5rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.6rem",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: colors.text_dim,
              borderBottom: `1px solid ${colors.border}`,
              textAlign: col.align,
              background: "rgba(255, 163, 11, 0.02)",
            }}
          >
            {col.label}
          </div>
        ))}
      </div>

      {hits.map((hit, idx) => (
        <a
          key={`${hit.callsign}-${hit.year}-${hit.edition}-${idx}`}
          role="row"
          href={hitHref(hit)}
          className="sv-row sv-rise"
          style={{
            display: "contents",
            color: "inherit",
            textDecoration: "none",
            ["--i" as string]: idx,
          }}
        >
          {/* Callsign — JetBrains Mono, amber, glow on hover */}
          <div
            role="cell"
            className="sv-row-cell sv-row-callsign"
            style={{
              padding: "0.7rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.95rem",
              letterSpacing: "0.04em",
              fontWeight: 600,
              color: colors.accent,
              borderBottom: `1px solid ${colors.border}`,
              textShadow: motifs.glow.textShadow,
              transition: "text-shadow 200ms ease",
            }}
          >
            {hit.callsign}
          </div>
          {/* Name — Fraunces with low opsz for tabular density */}
          <div
            role="cell"
            className="sv-row-cell"
            style={{
              padding: "0.7rem 0.75rem",
              fontFamily: fontStacks.display,
              fontVariationSettings: '"opsz" 20',
              fontSize: "0.98rem",
              fontWeight: 450,
              color: colors.text,
              borderBottom: `1px solid ${colors.border}`,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hit.name ? cleanOCRName(hit.name) || (
              <span
                style={{ color: colors.border, fontFamily: fontStacks.mono }}
              >
                —
              </span>
            ) : (
              <span
                style={{ color: colors.border, fontFamily: fontStacks.mono }}
              >
                —
              </span>
            )}
          </div>
          {/* Snippet (match preview) — amber-underlined matches */}
          <div
            role="cell"
            className="sv-row-cell"
            style={{
              padding: "0.7rem 0.75rem",
              borderBottom: `1px solid ${colors.border}`,
              overflow: "hidden",
            }}
          >
            <Snippet html={hit.snippet} />
          </div>
          {/* City — dim mono */}
          <div
            role="cell"
            className="sv-row-cell"
            style={{
              padding: "0.7rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.78rem",
              color: colors.text_dim,
              borderBottom: `1px solid ${colors.border}`,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {cleanOCRCity(hit.city, hit.state) || "—"}
          </div>
          {/* Year */}
          <div
            role="cell"
            className="sv-row-cell"
            style={{
              padding: "0.7rem 0.5rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.82rem",
              color: colors.text,
              textAlign: "right",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {hit.year}
          </div>
          {/* Edition */}
          <div
            role="cell"
            className="sv-row-cell"
            style={{
              padding: "0.7rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.72rem",
              color: colors.text_dim,
              textAlign: "right",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              borderBottom: `1px solid ${colors.border}`,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hit.edition}
          </div>
          {/* State (pushed right, dimmed per design brief) */}
          <div
            role="cell"
            className="sv-row-cell"
            style={{
              padding: "0.7rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.78rem",
              color: colors.text_dim,
              textAlign: "right",
              letterSpacing: "0.1em",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {cleanOCRState(hit.city, hit.state) || "—"}
          </div>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination strip.
// ---------------------------------------------------------------------------

function Pagination({
  current,
  page,
  per,
  total,
}: {
  current: {
    q?: string;
    year?: number;
    state?: string;
    edition?: string;
  };
  page: number;
  per: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.min(MAX_PAGE, Math.ceil(total / per)));
  if (totalPages <= 1) return null;

  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  const linkStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.5rem 0.9rem",
    fontFamily: fontStacks.mono,
    fontSize: "0.78rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: active ? colors.bg : colors.accent,
    background: active ? colors.accent : "transparent",
    border: `1px solid ${colors.accent_2}`,
    textDecoration: "none",
    borderRadius: "0.15rem",
  });

  const disabledStyle: React.CSSProperties = {
    ...linkStyle(false),
    color: colors.border,
    borderColor: colors.border,
    cursor: "not-allowed",
  };

  return (
    <nav
      aria-label="Results pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        marginTop: "2rem",
        paddingTop: "1.25rem",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        Page{" "}
        <span style={{ color: colors.accent }}>
          {page.toString().padStart(3, "0")}
        </span>{" "}
        of {totalPages.toString().padStart(3, "0")} · {total.toLocaleString()}{" "}
        rows
      </span>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {prev !== null ? (
          <a
            href={buildHref(current, { page: prev, per })}
            style={linkStyle(false)}
            rel="prev"
          >
            ← Prev
          </a>
        ) : (
          <span style={disabledStyle} aria-disabled>
            ← Prev
          </span>
        )}
        {next !== null ? (
          <a
            href={buildHref(current, { page: next, per })}
            style={linkStyle(false)}
            rel="next"
          >
            Next →
          </a>
        ) : (
          <span style={disabledStyle} aria-disabled>
            Next →
          </span>
        )}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const year = intParam(firstParam(sp.year), 1900, 2100);
  const state = normState(firstParam(sp.state));
  const edition = firstParam(sp.edition);
  const page = intParam(firstParam(sp.page), 1, MAX_PAGE) ?? 1;
  const per =
    intParam(firstParam(sp.per), 1, MAX_PER_PAGE) ?? DEFAULT_PER_PAGE;
  const offset = (page - 1) * per;

  const current = { q, year, state, edition };

  // Only call the API when we have a query — the backend rejects empty
  // strings with a 400, and the empty prompt state is more useful anyway.
  const results = q
    ? await fetchSearch({ q, year, state, edition, limit: per, offset })
    : null;

  const hits: SearchHit[] = results?.hits ?? [];
  const total = results?.total ?? 0;
  const facets: SearchFacets = results?.facets ?? { years: [], states: [] };

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100dvh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
      }}
    >
      {/* Scoped CSS for all animations + hover effects.
          Server-component-safe (no JS / no client boundary). */}
      <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />

      <Grain />

      {/* --- HERO -------------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "4rem 2rem 2.5rem",
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
            gap: "1rem",
          }}
        >
          <div
            className="sv-rise"
            style={{
              ["--i" as string]: 0,
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            {motifs.morseDividers.tight} &nbsp; ham-callbook · search
          </div>
          <h1
            className="sv-rise"
            style={{
              ["--i" as string]: 1,
              fontFamily: fontStacks.display,
              fontSize: "clamp(3.5rem, 10vw, 8rem)",
              fontWeight: 600,
              fontVariationSettings: '"opsz" 144',
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              margin: 0,
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            SEARCH
          </h1>

          {/* --- SEARCH FORM --------------------------------------------- */}
          <form
            method="GET"
            action="/search"
            role="search"
            className="sv-rise"
            style={{
              ["--i" as string]: 2,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 6rem 5rem auto",
              gap: "0.5rem",
              marginTop: "1.25rem",
              maxWidth: "60rem",
            }}
          >
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="callsign, name, city — try W1AW or HIRAM MAXIM"
              aria-label="Search query"
              autoCapitalize="characters"
              autoCorrect="off"
              autoFocus
              style={{
                padding: "0.95rem 1.1rem",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.text,
                fontFamily: fontStacks.mono,
                fontSize: "1rem",
                letterSpacing: "0.04em",
                outline: "none",
                borderRadius: "0.25rem",
              }}
            />
            <input
              type="text"
              name="year"
              defaultValue={year ?? ""}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              placeholder="YEAR"
              aria-label="Year filter"
              style={{
                padding: "0.95rem 0.75rem",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.text,
                fontFamily: fontStacks.mono,
                fontSize: "0.9rem",
                letterSpacing: "0.1em",
                textAlign: "center",
                outline: "none",
                borderRadius: "0.25rem",
              }}
            />
            <input
              type="text"
              name="state"
              defaultValue={state ?? ""}
              maxLength={2}
              placeholder="ST"
              aria-label="State filter"
              style={{
                padding: "0.95rem 0.75rem",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.text,
                fontFamily: fontStacks.mono,
                fontSize: "0.9rem",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                textAlign: "center",
                outline: "none",
                borderRadius: "0.25rem",
              }}
            />
            {edition !== undefined && (
              // Preserve an edition param across submissions; the user
              // clears it via the active-filter chip in the sidebar.
              <input type="hidden" name="edition" value={edition} />
            )}
            <button
              type="submit"
              style={{
                padding: "0.95rem 1.75rem",
                background: colors.accent,
                border: `1px solid ${colors.accent}`,
                color: colors.bg,
                fontFamily: fontStacks.mono,
                fontSize: "0.8rem",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                fontWeight: 700,
                cursor: "pointer",
                borderRadius: "0.25rem",
              }}
            >
              QSO
            </button>
          </form>
        </div>
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider
          label={
            q
              ? `${total.toLocaleString()} match${total === 1 ? "" : "es"}`
              : "awaiting query"
          }
        />
      </div>

      {/* --- BODY: results + facets ------------------------------------ */}
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
          display: "grid",
          // Asymmetric grid per design tokens: wide content + narrow rail.
          gridTemplateColumns: motifs.asymmetricGrid.gridTemplate,
          gap: "2.5rem",
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          {!q ? (
            <EmptyPrompt />
          ) : results === null ? (
            // Backend reachable failure — never crash the page.
            <div
              className="sv-rise"
              style={{
                ["--i" as string]: 0,
                padding: "2rem",
                border: `1px solid ${colors.danger}`,
                borderRadius: "0.25rem",
                color: colors.danger,
                fontFamily: fontStacks.mono,
                fontSize: "0.85rem",
                letterSpacing: "0.1em",
              }}
            >
              Search service unreachable. Retry in a moment.
            </div>
          ) : hits.length === 0 ? (
            <EmptyResults q={q} />
          ) : (
            <>
              <div
                className="sv-rise"
                style={{
                  ["--i" as string]: 0,
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: "0.75rem",
                }}
              >
                <h2
                  style={{
                    fontFamily: fontStacks.display,
                    fontVariationSettings: '"opsz" 36',
                    fontSize: "1.5rem",
                    fontWeight: 500,
                    margin: 0,
                  }}
                >
                  Results
                </h2>
                <span
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.7rem",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: colors.text_dim,
                  }}
                >
                  showing {(offset + 1).toLocaleString()}–
                  {(offset + hits.length).toLocaleString()} of{" "}
                  {total.toLocaleString()}
                </span>
              </div>
              <ResultsTable hits={hits} />
              <Pagination
                current={current}
                page={page}
                per={per}
                total={total}
              />
            </>
          )}
        </div>

        {/* Facets sidebar — only render when there's something to filter
            against. The asymmetric grid still reserves the column, which
            keeps the main column width stable between empty and populated
            states. */}
        <div style={{ minWidth: 0 }}>
          {q && results !== null && hits.length > 0 ? (
            <FacetsSidebar facets={facets} current={current} />
          ) : (
            <aside
              aria-label="Refine search"
              className="sv-rise"
              style={{
                ["--i" as string]: 4,
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                color: colors.text_dim,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                paddingTop: "0.5rem",
              }}
            >
              {motifs.morseDividers.tight} &nbsp; facets appear once you tune
              in a signal
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}
