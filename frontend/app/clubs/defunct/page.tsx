/**
 * /clubs/defunct — Silent Keys: Defunct Club Finder.
 *
 * Server component. Fetches the precomputed defunct-clubs artifact via
 * /api/clubs/defunct, with optional state + era facet filters.
 *
 * "Silent Key" is the ham-radio obituary term for a deceased operator.
 * Here it names clubs that were active in the printed callbook era and
 * then vanished permanently — their callsigns all dead in the FCC ULS.
 * Nobody else can compute "a 1940s club that went silent forever" without
 * 1909-1997 corpus + modern-FCC fusion.
 *
 * Memorable thing: a colossal Fraunces italic "SK" (Silent Key morse
 * abbreviation) behind the headline at very low opacity, identical in
 * treatment to the heroGlyph on /clubs but tonally funereal.
 *
 * Layout (top → bottom):
 *   1. Eyebrow: ·—· SK ·—·, mono, amber.
 *   2. Asymmetric hero: headline left, marginalia right.
 *   3. Era filter chips (4 eras + ALL).
 *   4. State filter dropdown.
 *   5. MorseDivider.
 *   6. Dense table (Name · Era · Years · Span · Calls · ST).
 *   7. Graceful empty state.
 *
 * Aesthetic guardrails:
 *   - NO Inter, NO purple, NO hover:scale-105.
 *   - Hex values only from lib/design.ts.
 *   - Inline styles only (no Tailwind classes for layout).
 *   - Strict TS: all array index access uses ?? guards.
 */

import { clubsDefunct, clubsDefunctMeta } from "../../../lib/club_api";
import { colors, fontStacks, motifs } from "../../../lib/design";
import { cleanOCRCity, cleanOCRState } from "../../../lib/ocrClean";
import type {
  DefunctClubSummary,
  DefunctFacets,
  EraClass,
} from "../../../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find((v) => !!v && v.length > 0);
  return value && value.length > 0 ? value : undefined;
}

function yearSpan(first: number | null, last: number | null): string {
  const f = first ?? "—";
  const l = last ?? "—";
  if (f === l) return String(f);
  return `${f}–${l}`;
}

const ERA_LABELS: Record<EraClass, string> = {
  pre_war: "Pre-War",
  mid_century: "Mid-Century",
  incentive_licensing: "Incentive Era",
  post_boom: "Post-Boom",
};

const ERA_VALUES: EraClass[] = [
  "pre_war",
  "mid_century",
  "incentive_licensing",
  "post_boom",
];

function eraLabel(era: EraClass): string {
  return ERA_LABELS[era] ?? era;
}

/**
 * Build a callsign-fate summary line for a row.
 * Pulls from the summary (which has callsign_count) to produce:
 * "3 calls — all silent" or similar.
 */
function fateSummary(club: DefunctClubSummary): string {
  const n = club.callsign_count;
  return `${n} call${n === 1 ? "" : "s"} — all silent`;
}

function eraHref(
  era: EraClass | "all",
  state: string | undefined,
): string {
  const params = new URLSearchParams();
  if (era !== "all") params.set("era", era);
  if (state) params.set("state", state);
  const s = params.toString();
  return `/clubs/defunct${s ? `?${s}` : ""}`;
}

function stateHref(
  state: string | undefined,
  era: EraClass | "all",
): string {
  const params = new URLSearchParams();
  if (era !== "all") params.set("era", era);
  if (state) params.set("state", state);
  const s = params.toString();
  return `/clubs/defunct${s ? `?${s}` : ""}`;
}

// ---------------------------------------------------------------------------
// Sub-components (server-safe, no "use client")
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

function InlineMorse({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "3rem 0",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.75rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(4)}
      </span>
      {label ? <span style={{ flexShrink: 0 }}>{label}</span> : null}
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(4)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level US state list for the dropdown (used in facets)
// ---------------------------------------------------------------------------

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC","PR","GU","VI",
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DefunctClubsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const stateRaw = firstParam(sp.state);
  const eraRaw = firstParam(sp.era);

  const state =
    stateRaw && /^[A-Z]{2}$/.test(stateRaw.toUpperCase())
      ? stateRaw.toUpperCase()
      : undefined;
  const era =
    eraRaw && ERA_VALUES.includes(eraRaw as EraClass)
      ? (eraRaw as EraClass)
      : undefined;
  const activeEra: EraClass | "all" = era ?? "all";

  const [listResult, meta] = await Promise.all([
    clubsDefunct({ state, era, limit: 100 }).catch(
      () => ({ total: 0, clubs: [] as DefunctClubSummary[], facets: { by_state: {}, by_era: {} } as DefunctFacets }),
    ),
    clubsDefunctMeta().catch(() => ({
      total: 0,
      gap_years: 10,
      generated: "",
    })),
  ]);

  const { clubs, facets } = listResult;
  const total = meta.total > 0 ? meta.total : listResult.total;

  // Collect states that have clubs in the facet data
  const faceStateEntries = Object.entries(facets.by_state)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));

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
      <Grain />

      <style>{`
        @keyframes sv-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sv-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes sv-glow-pulse {
          0%,100% { text-shadow: 0 0 20px rgba(255,163,11,0.28), 0 0 2px rgba(255,163,11,0.5); }
          50%     { text-shadow: 0 0 36px rgba(255,163,11,0.42), 0 0 4px rgba(255,163,11,0.75); }
        }
        @keyframes sv-row-in {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .sv-rise   { animation: sv-rise 700ms cubic-bezier(.2,.7,.2,1) both; }
        .sv-fade   { animation: sv-fade 900ms ease-out both; }
        .sv-pulse  { animation: sv-glow-pulse 4s ease-in-out infinite; }
        .sv-d-0  { animation-delay: 0ms; }
        .sv-d-1  { animation-delay: 80ms; }
        .sv-d-2  { animation-delay: 160ms; }
        .sv-d-3  { animation-delay: 260ms; }
        .sv-d-4  { animation-delay: 380ms; }

        .sk-row {
          display: contents;
          text-decoration: none;
          color: inherit;
        }
        .sk-row:hover > div {
          background: rgba(255,163,11,0.035) !important;
          color: ${colors.glow} !important;
        }
        .sk-era-chip {
          cursor: pointer;
          transition: color 180ms ease, border-color 180ms ease, background 180ms ease;
        }
        .sk-era-chip:hover {
          border-color: ${colors.accent} !important;
          color: ${colors.accent} !important;
        }
      `}</style>

      {/* ─── HERO ─────────────────────────────────────────────────────────── */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />

        {/* Colossal "SK" behind the headline — the memorable thing. */}
        <div
          aria-hidden
          className="sv-fade sv-d-0"
          style={{
            position: "absolute",
            right: "-1vw",
            top: "-2rem",
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <span
            className="sv-pulse"
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(14rem, 34vw, 34rem)",
              fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 300',
              fontStyle: "italic",
              color: colors.accent,
              opacity: 0.065,
              lineHeight: 0.82,
              letterSpacing: "-0.06em",
              userSelect: "none",
            }}
          >
            SK
          </span>
        </div>

        <div
          className="sv-rise sv-d-0"
          style={{
            position: "relative",
            zIndex: 2,
            display: "grid",
            gridTemplateColumns: "minmax(0, 7fr) minmax(0, 4fr)",
            gap: "2.5rem",
            alignItems: "end",
          }}
        >
          {/* Left: eyebrow + headline */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div
              className="sv-fade sv-d-0"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                letterSpacing: "0.44em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              {motifs.morseDividers.tight} &nbsp; SK &nbsp;{" "}
              {motifs.morseDividers.tight}
            </div>
            <h1
              className="sv-rise sv-d-1"
              style={{
                fontFamily: fontStacks.display,
                fontSize: "clamp(3.6rem, 11vw, 9.5rem)",
                fontWeight: 600,
                fontVariationSettings: '"opsz" 144, "SOFT" 100',
                lineHeight: 0.88,
                letterSpacing: "-0.03em",
                margin: 0,
                color: colors.text,
                textShadow: motifs.glow.textShadow,
              }}
            >
              Silent
              <br />
              <span
                style={{
                  fontStyle: "italic",
                  fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 400',
                  color: colors.glow,
                }}
              >
                Keys.
              </span>
            </h1>
          </div>

          {/* Right: marginalia */}
          <aside
            className="sv-rise sv-d-3"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              paddingBottom: "0.75rem",
              borderLeft: `1px solid ${colors.border}`,
              paddingLeft: "1.5rem",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: fontStacks.body,
                fontSize: "0.95rem",
                lineHeight: 1.6,
                color: colors.text_dim,
                maxWidth: "34ch",
              }}
            >
              Clubs that appeared in the twentieth-century printed callbook
              and then vanished forever — their callsigns all dead or
              unclaimed in the modern FCC ULS. Nobody else can surface
              "a 1940s club that went silent" without 1909–1997 corpus
              fusion.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                fontFamily: fontStacks.mono,
                fontSize: "0.68rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              <span>
                <span style={{ color: colors.accent }}>
                  {total.toString().padStart(3, "0")}
                </span>{" "}
                defunct
              </span>
              <span aria-hidden style={{ opacity: 0.4 }}>·</span>
              <span>
                <span style={{ color: colors.accent }}>
                  {meta.gap_years > 0 ? meta.gap_years : 10}yr
                </span>{" "}
                silence gap
              </span>
              <span aria-hidden style={{ opacity: 0.4 }}>·</span>
              <span>
                <span style={{ color: colors.accent }}>1909–1997</span>
              </span>
            </div>
          </aside>
        </div>
      </section>

      {/* ─── FILTERS ──────────────────────────────────────────────────────── */}
      <section
        className="sv-rise sv-d-2"
        style={{
          padding: "1.5rem 2rem 0",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        {/* Era chips */}
        <nav aria-label="Filter by era" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {/* ALL chip */}
          <a
            href={eraHref("all", state)}
            className="sk-era-chip"
            aria-current={activeEra === "all" ? "page" : undefined}
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.68rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              textDecoration: "none",
              padding: "0.4rem 0.85rem",
              border: `1px solid ${
                activeEra === "all" ? colors.accent : colors.border
              }`,
              borderRadius: 2,
              color: activeEra === "all" ? colors.accent : colors.text_dim,
              background:
                activeEra === "all"
                  ? "rgba(255,163,11,0.07)"
                  : "transparent",
            }}
          >
            ALL
          </a>
          {ERA_VALUES.map((e) => (
            <a
              key={e}
              href={eraHref(e, state)}
              className="sk-era-chip"
              aria-current={activeEra === e ? "page" : undefined}
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.68rem",
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                textDecoration: "none",
                padding: "0.4rem 0.85rem",
                border: `1px solid ${
                  activeEra === e ? colors.accent : colors.border
                }`,
                borderRadius: 2,
                color: activeEra === e ? colors.accent : colors.text_dim,
                background:
                  activeEra === e
                    ? "rgba(255,163,11,0.07)"
                    : "transparent",
              }}
            >
              {eraLabel(e)}
            </a>
          ))}
        </nav>

        {/* State dropdown */}
        <form method="GET" action="/clubs/defunct" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {era && (
            <input type="hidden" name="era" value={era} />
          )}
          <label
            htmlFor="state-filter"
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            ST
          </label>
          <select
            id="state-filter"
            name="state"
            defaultValue={state ?? ""}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${colors.accent}`,
              color: state ? colors.text : colors.text_dim,
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              letterSpacing: "0.1em",
              padding: "0.35rem 0.6rem",
              borderRadius: "0.125rem",
              outline: "none",
              cursor: "pointer",
            }}
            onChange={undefined /* server-form, submit via button */}
          >
            <option value="">All states</option>
            {faceStateEntries.length > 0
              ? faceStateEntries.map(([st, count]) => (
                  <option key={st} value={st}>
                    {st} ({count})
                  </option>
                ))
              : US_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
          </select>
          <button
            type="submit"
            style={{
              padding: "0.35rem 0.85rem",
              background: "transparent",
              border: `1px solid ${colors.border}`,
              color: colors.text_dim,
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              cursor: "pointer",
              borderRadius: "0.125rem",
            }}
          >
            Filter
          </button>
          {state && (
            <a
              href={eraHref(activeEra, undefined)}
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.65rem",
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: colors.text_dim,
                textDecoration: "none",
                padding: "0.35rem 0.6rem",
                border: `1px solid ${colors.border}`,
                borderRadius: "0.125rem",
              }}
            >
              ✕ {state}
            </a>
          )}
        </form>
      </section>

      {/* ─── DIVIDER ──────────────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <InlineMorse
          label={
            state
              ? `${state} · ${activeEra === "all" ? "all eras" : eraLabel(activeEra)}`
              : activeEra === "all"
              ? "all defunct clubs"
              : eraLabel(activeEra)
          }
        />
      </div>

      {/* ─── TABLE / EMPTY STATE ──────────────────────────────────────────── */}
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        {/* Count + column header */}
        <div
          className="sv-rise sv-d-1"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "baseline",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(1.4rem, 2.2vw, 2rem)",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 60, "SOFT" 50',
              margin: 0,
              letterSpacing: "-0.012em",
            }}
          >
            {activeEra === "all"
              ? "All defunct clubs"
              : eraLabel(activeEra)}
            {state ? (
              <span
                style={{
                  marginLeft: "0.6rem",
                  fontStyle: "italic",
                  fontVariationSettings: '"opsz" 60, "wght" 400',
                  color: colors.text_dim,
                  fontSize: "0.7em",
                }}
              >
                · {state}
              </span>
            ) : null}
          </h2>
          <span
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.63rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            <span style={{ color: clubs.length > 0 ? colors.accent : colors.text_dim }}>
              {clubs.length.toString().padStart(3, "0")}
            </span>{" "}
            shown
          </span>
        </div>

        {clubs.length === 0 ? (
          /* ─── EMPTY STATE ─── */
          <div
            className="sv-rise sv-d-2"
            style={{
              padding: "4rem 1.5rem",
              textAlign: "center",
              border: `1px dashed ${colors.border}`,
              borderRadius: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
            }}
          >
            <span
              aria-hidden
              style={{
                fontFamily: fontStacks.display,
                fontSize: "4rem",
                fontVariationSettings: '"opsz" 72, "SOFT" 100, "wght" 300',
                fontStyle: "italic",
                color: colors.accent,
                opacity: 0.25,
                lineHeight: 1,
              }}
            >
              SK
            </span>
            <p
              style={{
                margin: 0,
                fontFamily: fontStacks.mono,
                fontSize: "0.8rem",
                letterSpacing: "0.12em",
                color: colors.text_dim,
              }}
            >
              No defunct clubs matched the current filters.
            </p>
            <a
              href="/clubs/defunct"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.68rem",
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                textDecoration: "none",
                padding: "0.45rem 1rem",
                border: `1px solid ${colors.border}`,
                borderRadius: 2,
                color: colors.text_dim,
              }}
            >
              Clear filters
            </a>
          </div>
        ) : (
          /* ─── DENSE TABLE ─── */
          <div
            role="table"
            aria-label="Defunct clubs"
            className="sv-rise sv-d-2"
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1fr) minmax(8rem, auto) minmax(8rem, auto) minmax(4rem, auto) minmax(3rem, auto) minmax(3rem, auto)",
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            {/* Header */}
            <div role="row" style={{ display: "contents" }}>
              {["Name", "Era", "Years", "Span", "Calls", "ST"].map(
                (label, i) => (
                  <div
                    key={label}
                    role="columnheader"
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.58rem",
                      letterSpacing: "0.28em",
                      textTransform: "uppercase",
                      color: colors.text_dim,
                      borderBottom: `1px solid ${colors.border}`,
                      textAlign: i >= 2 ? "right" : "left",
                    }}
                  >
                    {label}
                  </div>
                ),
              )}
            </div>

            {/* Data rows */}
            {clubs.map((club, rowIdx) => {
              const loc = cleanOCRCity(club.dominant_city);
              const st = cleanOCRState(null, club.dominant_state) ?? "—";
              return (
                <a
                  key={club.slug}
                  role="row"
                  href={`/club/${encodeURIComponent(club.slug)}`}
                  title={fateSummary(club)}
                  style={{
                    display: "contents",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  {/* Name cell */}
                  <div
                    role="cell"
                    style={{
                      padding: "0.8rem 0.75rem",
                      fontFamily: fontStacks.display,
                      fontSize: "1rem",
                      fontVariationSettings: '"opsz" 24, "SOFT" 50',
                      color: colors.text,
                      borderBottom: `1px solid ${colors.border}`,
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.6rem",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.62rem",
                        color: colors.border,
                        width: "2.25rem",
                        flexShrink: 0,
                        letterSpacing: "0.08em",
                      }}
                    >
                      {(rowIdx + 1).toString().padStart(3, "0")}
                    </span>
                    <span>{club.display_name}</span>
                    {loc ? (
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "0.65rem",
                          letterSpacing: "0.06em",
                          color: colors.text_dim,
                          fontStyle: "italic",
                        }}
                      >
                        / {loc}
                      </span>
                    ) : null}
                  </div>

                  {/* Era cell */}
                  <div
                    role="cell"
                    style={{
                      padding: "0.8rem 0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.65rem",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: colors.text_dim,
                      borderBottom: `1px solid ${colors.border}`,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        border: `1px solid ${colors.border}`,
                        borderRadius: 2,
                        fontSize: "0.6rem",
                        letterSpacing: "0.2em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {eraLabel(club.era_class)}
                    </span>
                  </div>

                  {/* Years cell */}
                  <div
                    role="cell"
                    style={{
                      padding: "0.8rem 0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.82rem",
                      color: colors.text,
                      textAlign: "right",
                      borderBottom: `1px solid ${colors.border}`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {yearSpan(club.first_year, club.last_year)}
                  </div>

                  {/* Span cell */}
                  <div
                    role="cell"
                    style={{
                      padding: "0.8rem 0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.82rem",
                      color: colors.text_dim,
                      textAlign: "right",
                      borderBottom: `1px solid ${colors.border}`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {club.span_years > 0 ? `${club.span_years}y` : "—"}
                  </div>

                  {/* Calls cell */}
                  <div
                    role="cell"
                    style={{
                      padding: "0.8rem 0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.82rem",
                      color: colors.accent,
                      textAlign: "right",
                      borderBottom: `1px solid ${colors.border}`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {club.callsign_count.toString().padStart(2, "0")}
                  </div>

                  {/* State cell */}
                  <div
                    role="cell"
                    style={{
                      padding: "0.8rem 0.75rem",
                      fontFamily: fontStacks.mono,
                      fontSize: "0.82rem",
                      color: colors.text_dim,
                      textAlign: "right",
                      borderBottom: `1px solid ${colors.border}`,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {st}
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {/* Load more hint when results are capped */}
        {clubs.length >= 100 && (
          <p
            style={{
              marginTop: "2rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.68rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: colors.text_dim,
              textAlign: "center",
            }}
          >
            Showing first 100 results. Use state or era filters to narrow.
          </p>
        )}
      </section>
    </main>
  );
}
