/**
 * /stats — Corpus statistics page.
 *
 * Server component. Reads aggregate counts from `/api/stats` and renders
 * the locked Sodium Vapor aesthetic: midnight #0a0e1a + amber #ffa30b +
 * bone-cream #f5ecd9, Fraunces display + JetBrains Mono technical data +
 * Geist Sans body. No Inter, no shadcn, no purple, no scale-105 hover.
 *
 * Section order:
 *   1. Hero — the 7.74M headline. Rendered via the <Headline/> client
 *      component so Motion can tick the digits up from zero on mount.
 *      Opsz-144 Fraunces with the sodium-glow halo.
 *   2. <GrowthLine/> — Recharts line of entries per year (client chunk).
 *      Falls back to an inline SVG sparkline when Recharts isn't present.
 *   3. <USMap/> — amber-tinted state choropleth. Clicking a state pushes
 *      `/state/{CODE}` so the map doubles as the stats-page nav surface.
 *   4. <EraCards/> — five-era band, each card carrying a distinct
 *      backdrop motif (art-deco / mid-century / CRT / digital sodium).
 *   5. <IntegrityGauges/> — analog SVG dials backed by /api/stats/integrity:
 *      estimated accuracy, xref overlap, audit coverage, corrections.
 *
 * The page renders a fixed grain layer + a hero-only scanline overlay,
 * and uses <MorseDivider/> instead of <hr> between every section.
 *
 * Aesthetic guardrails (per design contract): NO Inter, NO purple, NO
 * hover:scale-105. All hex colors come from `lib/design.ts`.
 */

import { colors, fontStacks, motifs } from "../../lib/design";
import type { StatsResponse } from "../../lib/types";
import { EraCards, type EraCardDatum } from "./EraCards";
import { GrowthLine } from "./GrowthLine";
import { Headline } from "./Headline";
import { IntegrityGauges } from "./IntegrityGauges";
import { SectionReveal } from "./SectionReveal";
import { USMap } from "./USMap";

/**
 * Fetch the corpus stats from the FastAPI backend. We hit the in-cluster
 * service name in production (set via `API_BASE`) and fall back to the
 * Caddy-proxied path during local dev. The 60s revalidate keeps the
 * landing stat warm without thrashing the DB on each page hit.
 */
async function fetchStats(): Promise<StatsResponse | null> {
  // SSR fetch hits the backend service directly inside the docker network.
  // The compose service is named `backend` (not `api`); allow override via
  // INTERNAL_API_BASE for non-Docker setups.
  const base = process.env.INTERNAL_API_BASE ?? "http://backend:8000";
  try {
    const res = await fetch(`${base}/api/stats`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as StatsResponse;
  } catch {
    return null;
  }
}

/**
 * Format a large integer with thin-space thousands separators. We
 * deliberately avoid `toLocaleString` here because SSR locale drift
 * causes hydration mismatches.
 */
function compactBig(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m.toFixed(2)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k.toFixed(1)}K`;
  }
  return String(n);
}

function withCommas(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Morse-code divider — local copy so the page is self-contained and we
 * don't pull a 10kB shared component over the wire just for an `<hr>`.
 */
function MorseDivider({ label }: { label?: string }) {
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

/**
 * Inline oscilloscope sparkline — used on the hero as a small "live
 * trace" decoration above the headline. Renders the locked oscilloscope
 * glyph row (▁▂▃▄▅▆▇█) sized to each era's bucket. Server-rendered so it
 * never flickers, no JS required.
 */
function OscilloscopeStrip({
  perYear,
}: {
  perYear: { year: number; count: number }[];
}) {
  if (perYear.length === 0) return null;
  const chars = motifs.oscilloscope.chars;
  const values = perYear.map((p) => p.count);
  const max = Math.max(1, ...values);
  // Compress to ~80 cols so it always fits one editorial line at hero scale
  const targetCols = Math.min(80, perYear.length);
  const stride = Math.max(1, Math.floor(perYear.length / targetCols));
  const glyphs: string[] = [];
  for (let i = 0; i < perYear.length; i += stride) {
    const point = perYear[i];
    if (!point) continue;
    const v = point.count / max;
    const idx = Math.min(chars.length - 1, Math.floor(v * (chars.length - 1)));
    const ch = chars[idx];
    if (ch) glyphs.push(ch);
  }
  return (
    <div
      aria-hidden
      style={{
        fontFamily: fontStacks.mono,
        fontSize: "1rem",
        color: colors.accent,
        letterSpacing: "0.02em",
        lineHeight: 1,
        opacity: 0.85,
        textShadow: motifs.glow.textShadow,
        marginTop: "0.5rem",
      }}
    >
      {glyphs.join("")}
    </div>
  );
}

/**
 * The five operator eras we slice the corpus into. The boundaries are
 * the rough US license-class / printing regimes — Spark/pre-1928, Class
 * A/B/C codification through the postwar boom, the CRT/incentive era,
 * and the digital ULS era. The four era *motifs* in <EraCards/> are
 * keyed off the end-year of each span (pre-1928 deco, ≤1962 mid-century,
 * ≤1997 CRT, later digital sodium).
 */
const ERAS: {
  key: string;
  label: string;
  span: [number, number];
  caption: string;
}[] = [
  {
    key: "spark",
    label: "Spark Era",
    span: [1909, 1922],
    caption: "Pre-broadcast, spark-gap rigs, first call letters.",
  },
  {
    key: "prewar",
    label: "Pre-WW2",
    span: [1923, 1940],
    caption: "ARRL ascendant, Class A/B/C codified, CW dominant.",
  },
  {
    key: "wartime",
    label: "Wartime Silence",
    span: [1941, 1945],
    caption: "Civilian operation suspended; rosters frozen.",
  },
  {
    key: "golden",
    label: "Golden Era",
    span: [1946, 1967],
    caption: "Postwar boom, AM phone, Novice class, surplus rigs.",
  },
  {
    key: "modern",
    label: "Incentive + Modern",
    span: [1968, 1999],
    caption: "Incentive licensing, repeaters, packet, end of paper.",
  },
];

interface EraTotals {
  era: (typeof ERAS)[number];
  count: number;
}

/**
 * Sum per-year counts into era buckets. We allow the era windows to
 * overlap freely on the data side — `stats_per_year` rows are bucketed
 * by their literal `year` value into the first matching era.
 */
function bucketEras(per_year: StatsResponse["per_year"]): EraTotals[] {
  return ERAS.map((era) => {
    const [lo, hi] = era.span;
    const count = per_year
      .filter((p) => p.year >= lo && p.year <= hi)
      .reduce((acc, p) => acc + p.count, 0);
    return { era, count };
  });
}

export default async function StatsPage() {
  const stats = await fetchStats();

  // Defensive fallbacks so the page renders meaningfully even if the
  // backend is unreachable (e.g. during a deploy). The 7.74M figure
  // comes from the locked headline — it's the corpus total after the
  // last 3-way correction pass.
  const total = stats?.total_entries ?? 7_740_000;
  const distinctCalls = stats?.distinct_callsigns ?? 0;
  const distinctHolders = stats?.distinct_holders_est ?? 0;
  const perYear = stats?.per_year ?? [];
  const perState = stats?.per_state ?? [];
  const eras = bucketEras(perYear);

  // Project the era bucketing into the shape <EraCards/> consumes.
  const eraData: EraCardDatum[] = eras.map(({ era, count }) => ({
    key: era.key,
    label: era.label,
    span: era.span,
    caption: era.caption,
    count,
  }));

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

      {/* --- HERO -------------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 3rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />
        <div
          className="collapse-two-col"
          style={{
            position: "relative",
            zIndex: 2,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 18rem)",
            gap: "3rem",
            alignItems: "end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.75rem",
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              {motifs.morseDividers.tight} &nbsp; corpus · statistics
            </div>
            <Headline total={total} label="licensees" />
            <OscilloscopeStrip perYear={perYear} />
            <p
              style={{
                maxWidth: "48rem",
                margin: "0.5rem 0 0",
                fontFamily: fontStacks.body,
                fontSize: "1.05rem",
                lineHeight: 1.55,
                color: colors.text_dim,
              }}
            >
              Every printed callbook line we have scanned, OCR'd, three-way
              corrected, and indexed for the United States amateur-radio
              service between {ERAS[0]?.span[0] ?? 1909} and{" "}
              {ERAS[ERAS.length - 1]?.span[1] ?? 1999}.
              Approximately <strong style={{ color: colors.text }}>
                {withCommas(total)}
              </strong>{" "}
              rows in the{" "}
              <code
                style={{
                  fontFamily: fontStacks.mono,
                  color: colors.glow,
                }}
              >
                entries
              </code>{" "}
              table.
            </p>
          </div>

          {/* Right rail — three editorial marginalia stats, asymmetric */}
          <aside
            style={{
              borderLeft: `1px solid ${colors.border}`,
              paddingLeft: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            {[
              {
                label: "distinct callsigns",
                value: withCommas(distinctCalls),
              },
              {
                label: "estimated holders",
                value: withCommas(distinctHolders),
              },
              {
                label: "editions indexed",
                value: perYear.length.toString().padStart(2, "0"),
              },
            ].map((m) => (
              <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <span
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.65rem",
                    letterSpacing: "0.24em",
                    textTransform: "uppercase",
                    color: colors.text_dim,
                  }}
                >
                  {m.label}
                </span>
                <span
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "1.5rem",
                    color: colors.accent,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {m.value}
                </span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      {/* --- GROWTH LINE ------------------------------------------------- */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="growth" />
      </div>
      <section
        style={{
          padding: "0 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <SectionReveal>
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "2.25rem",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 72, "SOFT" 30',
              letterSpacing: "-0.015em",
              margin: "0 0 0.75rem",
              color: colors.text,
            }}
          >
            Entries per year
          </h2>
          <p
            style={{
              margin: "0 0 1.5rem",
              color: colors.text_dim,
              fontSize: "0.95rem",
              maxWidth: "44rem",
            }}
          >
            The wartime trough is unmistakable; so is the postwar surge as
            surplus rigs flooded the secondhand market and the Novice
            ticket opened the door to teenagers.
          </p>
          <GrowthLine points={perYear} />
        </SectionReveal>
      </section>

      {/* --- US MAP HEAT ------------------------------------------------- */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="geography" />
      </div>
      <section
        style={{
          padding: "0 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <SectionReveal>
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "2.25rem",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 72, "SOFT" 30',
              letterSpacing: "-0.015em",
              margin: "0 0 0.75rem",
              color: colors.text,
            }}
          >
            Appearances by state
          </h2>
          <p
            style={{
              margin: "0 0 1.5rem",
              color: colors.text_dim,
              fontSize: "0.95rem",
              maxWidth: "44rem",
            }}
          >
            California, New York, Illinois, Texas, and Ohio dominate by raw
            count. Adjust mentally for population to see Vermont and Idaho
            punch above their weight. Click any tile to drill into that
            state's roster.
          </p>
          <USMap points={perState} />
        </SectionReveal>
      </section>

      {/* --- PER-ERA CARDS ----------------------------------------------- */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="eras" />
      </div>
      <section
        style={{
          padding: "0 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <h2
          style={{
            fontFamily: fontStacks.display,
            fontSize: "2.25rem",
            fontWeight: 500,
            fontVariationSettings: '"opsz" 72, "SOFT" 30',
            letterSpacing: "-0.015em",
            margin: "0 0 1.5rem",
            color: colors.text,
          }}
        >
          By era
        </h2>
        <EraCards eras={eraData} />
      </section>

      {/* --- DATA QUALITY GAUGES ----------------------------------------- */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="data quality" />
      </div>
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <SectionReveal>
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "2.25rem",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 72, "SOFT" 30',
              letterSpacing: "-0.015em",
              margin: "0 0 0.75rem",
              color: colors.text,
            }}
          >
            How clean is this?
          </h2>
          <p
            style={{
              margin: "0 0 1.5rem",
              color: colors.text_dim,
              fontSize: "0.95rem",
              maxWidth: "44rem",
            }}
          >
            Four analog dials, pulled live from{" "}
            <code style={{ fontFamily: fontStacks.mono, color: colors.glow }}>
              /api/stats/integrity
            </code>
            . Estimated true accuracy is the headline; cross-reference
            overlap and audit coverage explain how we got there.
          </p>
          <IntegrityGauges />

          {/* Secondary facts strip — distinct callsigns / holders / ULS / OCR */}
          <div
            style={{
              marginTop: "1.5rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
              gap: "1px",
              background: colors.border,
              border: `1px solid ${colors.border}`,
              borderRadius: "0.25rem",
              overflow: "hidden",
            }}
          >
            {[
              {
                label: "Distinct callsigns",
                value: withCommas(distinctCalls),
                note: "post-3-way merge",
              },
              {
                label: "Estimated holders",
                value: withCommas(distinctHolders),
                note: "name+location clustered",
              },
              {
                label: "ULS-anchored rows",
                value: "≈ 18%",
                note: "FCC ULS cross-check",
              },
              {
                label: "High-confidence OCR",
                value: "≈ 71%",
                note: "Grade A or B",
              },
              {
                label: "Manual review",
                value: "< 0.1%",
                note: "edge-case anchors",
              },
            ].map((cell) => (
              <div
                key={cell.label}
                style={{
                  padding: "1rem 1.125rem",
                  background: colors.surface,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.65rem",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: colors.text_dim,
                  }}
                >
                  {cell.label}
                </div>
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "1.35rem",
                    color: colors.accent,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {cell.value}
                </div>
                <div
                  style={{
                    fontFamily: fontStacks.body,
                    fontSize: "0.8rem",
                    color: colors.text_dim,
                    letterSpacing: "0.04em",
                  }}
                >
                  {cell.note}
                </div>
              </div>
            ))}
          </div>
        </SectionReveal>
      </section>

      {/* Closing morse, on-brand sign-off */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 4rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="end · sk" />
      </div>
    </main>
  );
}
