/**
 * /browse — Three-column index of every axis the corpus is sliced
 * along: by year, by state, by era.
 *
 * Server component. The page is intentionally deep + dense — it's the
 * "back of the book" reference, not a marketing page. We render three
 * tall columns of links separated by morse-code dividers (rotated 90°
 * on wide screens, restacked vertically on narrow screens).
 *
 * Aesthetic: locked Sodium Vapor palette, Fraunces display, JetBrains
 * Mono for the year/state codes, Geist Sans for prose. NO Inter, NO
 * purple, NO hover:scale-105.
 */

import { colors, fontStacks, motifs } from "../../lib/design";

/**
 * Year range we index. The 1920s and 1930s are sparse — many editions
 * exist for ARRL Headquarters callbook but not necessarily the FCC
 * roster — so we link every year regardless of whether it has rows.
 * The year-detail page can present its own empty-state if needed.
 */
const YEAR_START = 1909;
const YEAR_END = 1999;

/**
 * US states + DC. We keep DC, drop territories — the entries table is
 * conventionally US states only.
 */
const STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

/**
 * Era boundaries — must agree with /stats. We re-declare here rather
 * than import to keep the two pages independent (the stats page may
 * grow more eras in the future without dragging this page along).
 */
const ERAS: {
  slug: string;
  label: string;
  span: [number, number];
  blurb: string;
}[] = [
  {
    slug: "spark",
    label: "Spark Era",
    span: [1909, 1922],
    blurb:
      "Pre-broadcast amateurs, spark-gap rigs, the first US call letters.",
  },
  {
    slug: "pre-war",
    label: "Pre-WW2",
    span: [1923, 1940],
    blurb: "ARRL ascendant. CW dominates phone. Class A/B/C codified.",
  },
  {
    slug: "wartime",
    label: "Wartime Silence",
    span: [1941, 1945],
    blurb: "Civilian operation suspended. Rosters effectively frozen.",
  },
  {
    slug: "golden",
    label: "Golden Era",
    span: [1946, 1967],
    blurb:
      "Surplus rigs everywhere. Novice ticket. AM phone. Sunspot maxima.",
  },
  {
    slug: "incentive",
    label: "Incentive Licensing",
    span: [1968, 1982],
    blurb: "Advanced/Extra carved out. CW speed politics. Repeaters spread.",
  },
  {
    slug: "modern",
    label: "End-of-paper",
    span: [1983, 1999],
    blurb:
      "Packet radio, the BBS years, ULS online, the last printed callbooks.",
  },
];

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

/**
 * Vertical morse divider, rendered between the three columns on wide
 * screens. CSS hides it under the wide-screen breakpoint and the
 * horizontal MorseDivider above takes over on mobile.
 */
function VerticalMorse() {
  return (
    <div
      aria-hidden
      style={{
        writingMode: "vertical-rl",
        textOrientation: "mixed",
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.4em",
        color: colors.text_dim,
        padding: "1rem 0",
        opacity: 0.7,
      }}
    >
      {motifs.morseDividers.pattern.repeat(4)}
    </div>
  );
}

/**
 * Column heading — Fraunces, opsz tuned for ~3rem display.
 */
function ColumnHeading({
  kicker,
  title,
}: {
  kicker: string;
  title: string;
}) {
  return (
    <header style={{ marginBottom: "1.25rem" }}>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: colors.accent,
        }}
      >
        {kicker}
      </div>
      <h2
        style={{
          fontFamily: fontStacks.display,
          fontSize: "2.25rem",
          fontVariationSettings: '"opsz" 64',
          fontWeight: 500,
          margin: "0.25rem 0 0",
          lineHeight: 1,
          textShadow: motifs.glow.textShadow,
        }}
      >
        {title}
      </h2>
    </header>
  );
}

export default function BrowsePage() {
  // Pre-compute year decades for grouping. Each decade renders as a
  // sub-heading with a row of year links underneath.
  const decades: { decade: number; years: number[] }[] = [];
  for (let d = Math.floor(YEAR_START / 10) * 10; d <= YEAR_END; d += 10) {
    const years: number[] = [];
    for (let y = Math.max(d, YEAR_START); y <= Math.min(d + 9, YEAR_END); y += 1) {
      years.push(y);
    }
    decades.push({ decade: d, years });
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

      {/* --- HERO -------------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 2.5rem",
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
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            {motifs.morseDividers.tight} &nbsp; corpus · index
          </div>
          <h1
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(3.5rem, 11vw, 8.5rem)",
              fontWeight: 600,
              fontVariationSettings: '"opsz" 144',
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              margin: 0,
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            BROWSE
          </h1>
          <p
            style={{
              maxWidth: "44rem",
              margin: 0,
              fontFamily: fontStacks.body,
              fontSize: "1rem",
              lineHeight: 1.5,
              color: colors.text_dim,
            }}
          >
            Three ways into the callbook: by edition year, by US state,
            or by era. Pick the axis that matches the question you're
            holding.
          </p>
        </div>
      </section>

      {/* --- THREE COLUMNS, DELIBERATELY DISTINCT ------------------------ */}
      {/* One-memorable-thing: each column carries a different visual
          hierarchy — years = chronological calendar grid where decade is
          the spine; states = roster split into east/west blocks with the
          two-letter code stamped large; eras = vertical timeline with
          rich descriptive cards. Three lists, three rhythms. */}
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(0, 1.15fr) auto minmax(0, 0.95fr) auto minmax(0, 1.1fr)",
            gap: "0",
            alignItems: "start",
          }}
        >
          {/* --- COLUMN 1: BY YEAR (calendar grid, decade-as-spine) ------ */}
          <div style={{ padding: "0 1.5rem 0 0", minWidth: 0 }}>
            <ColumnHeading kicker="axis · 01" title="By year" />
            <p
              style={{
                margin: "0 0 1.5rem",
                fontFamily: fontStacks.body,
                fontSize: "0.85rem",
                lineHeight: 1.5,
                color: colors.text_dim,
                maxWidth: "26rem",
              }}
            >
              Every edition year, indexed by decade. The leftmost column is
              the decade marker; each row carries that decade's ten years
              keyed in JetBrains Mono.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              {decades.map(({ decade, years }) => (
                <div
                  key={decade}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "5.5rem minmax(0, 1fr)",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.875rem 0",
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: fontStacks.display,
                      fontVariationSettings: '"opsz" 60',
                      fontSize: "1.85rem",
                      lineHeight: 1,
                      color: colors.accent,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {String(decade).slice(-2)}'
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
                      gap: "0.25rem",
                    }}
                  >
                    {Array.from({ length: 10 }).map((_, i) => {
                      const y = decade + i;
                      const present = years.includes(y);
                      if (!present) {
                        return (
                          <span
                            key={i}
                            aria-hidden
                            style={{
                              display: "block",
                              padding: "0.35rem 0",
                              textAlign: "center",
                              fontFamily: fontStacks.mono,
                              fontSize: "0.65rem",
                              color: colors.border,
                              letterSpacing: "0.05em",
                            }}
                          >
                            ·
                          </span>
                        );
                      }
                      return (
                        <a
                          key={i}
                          href={`/year/${y}`}
                          title={`Browse ${y}`}
                          style={{
                            display: "block",
                            padding: "0.35rem 0",
                            textAlign: "center",
                            fontFamily: fontStacks.mono,
                            fontSize: "0.78rem",
                            color: colors.text,
                            textDecoration: "none",
                            background: colors.surface,
                            border: `1px solid ${colors.border}`,
                            borderRadius: "0.15rem",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {String(y).slice(-2)}
                        </a>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <VerticalMorse />

          {/* --- COLUMN 2: BY STATE (codes as stamps) ---------------------- */}
          <div style={{ padding: "0 1.5rem", minWidth: 0 }}>
            <ColumnHeading kicker="axis · 02" title="By state" />
            <p
              style={{
                margin: "0 0 1.5rem",
                fontFamily: fontStacks.body,
                fontSize: "0.85rem",
                lineHeight: 1.5,
                color: colors.text_dim,
              }}
            >
              Fifty US states + DC, sorted alphabetically. The two-letter
              code is the postage stamp, the full name the legend.
            </p>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 0,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              {STATES.map((s) => (
                <li
                  key={s.code}
                  style={{ borderBottom: `1px solid ${colors.border}` }}
                >
                  <a
                    href={`/state/${s.code}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2.75rem minmax(0, 1fr)",
                      alignItems: "center",
                      gap: "0.875rem",
                      padding: "0.625rem 0.25rem",
                      color: colors.text,
                      textDecoration: "none",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.95rem",
                        color: colors.accent,
                        letterSpacing: "0.1em",
                        textAlign: "center",
                        padding: "0.25rem 0",
                        border: `1px solid ${colors.accent_2}`,
                        borderRadius: "0.15rem",
                        background: "rgba(255, 163, 11, 0.05)",
                      }}
                    >
                      {s.code}
                    </span>
                    <span
                      style={{
                        fontFamily: fontStacks.display,
                        fontVariationSettings: '"opsz" 24',
                        fontSize: "1rem",
                        lineHeight: 1.1,
                      }}
                    >
                      {s.name}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <VerticalMorse />

          {/* --- COLUMN 3: BY ERA (vertical timeline) --------------------- */}
          <div style={{ padding: "0 0 0 1.5rem", minWidth: 0 }}>
            <ColumnHeading kicker="axis · 03" title="By era" />
            <p
              style={{
                margin: "0 0 1.5rem",
                fontFamily: fontStacks.body,
                fontSize: "0.85rem",
                lineHeight: 1.5,
                color: colors.text_dim,
              }}
            >
              Six eras span the corpus. A continuous left-rail timeline ties
              them together; each card carries its years and a one-line
              characterisation.
            </p>
            <ol
              style={{
                listStyle: "none",
                margin: 0,
                padding: "0 0 0 1.25rem",
                position: "relative",
              }}
            >
              {/* The timeline spine */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: "0.5rem",
                  bottom: "0.5rem",
                  width: 1,
                  background: `linear-gradient(to bottom, ${colors.accent_2} 0%, ${colors.accent} 50%, transparent 100%)`,
                }}
              />
              {ERAS.map((era, i) => (
                <li
                  key={era.slug}
                  style={{
                    position: "relative",
                    marginBottom: "1.125rem",
                  }}
                >
                  {/* Spine dot */}
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: "-1.55rem",
                      top: "1.25rem",
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: colors.accent,
                      boxShadow: `0 0 8px ${colors.glow}`,
                    }}
                  />
                  <a
                    href={`/era/${era.slug}`}
                    style={{
                      display: "block",
                      padding: "0.875rem 1rem 1rem",
                      border: `1px solid ${colors.border}`,
                      borderLeft: `3px solid ${colors.accent}`,
                      borderRadius: "0.25rem",
                      background: colors.surface,
                      textDecoration: "none",
                      color: colors.text,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: "1rem",
                        marginBottom: "0.375rem",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "0.6rem",
                          letterSpacing: "0.28em",
                          textTransform: "uppercase",
                          color: colors.glow,
                        }}
                      >
                        Era {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "0.78rem",
                          color: colors.accent,
                          letterSpacing: "0.08em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {era.span[0]}–{era.span[1]}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: fontStacks.display,
                        fontSize: "1.45rem",
                        fontVariationSettings: '"opsz" 36',
                        lineHeight: 1.1,
                        marginBottom: "0.5rem",
                      }}
                    >
                      {era.label}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.85rem",
                        color: colors.text_dim,
                        lineHeight: 1.45,
                      }}
                    >
                      {era.blurb}
                    </p>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <MorseDivider label="end of index" />

        <p
          style={{
            textAlign: "center",
            color: colors.text_dim,
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          {motifs.morseDividers.tight} &nbsp; or try{" "}
          <a
            href="/random"
            style={{
              color: colors.accent,
              textDecoration: "none",
              borderBottom: `1px solid ${colors.accent_2}`,
            }}
          >
            a random notable callsign
          </a>
        </p>
      </section>
    </main>
  );
}
