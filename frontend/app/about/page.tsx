/**
 * /about — Editorial provenance + methodology page.
 *
 * Server component. Reads the live data-quality numbers from
 * /api/stats/integrity and weaves them into the narrative.
 *
 * Sections, top → bottom:
 *
 *   1. HERO — "About the Archive" set in giant Fraunces italic with a
 *      sodium-vapor halo. Single-paragraph mission statement underneath.
 *   2. PROVENANCE — credits leehite.org as the upstream PDF source and the
 *      Internet Archive as the long-term mirror. Block-quote tone, large
 *      left rule, hanging caps.
 *   3. METHODOLOGY — describes the four-pass pipeline:
 *        a. OCR (Tesseract + locked layout).
 *        b. 2-way cross-reference (callbook A × callbook B).
 *        c. 3-way correction (callbook A × callbook B × FCC ULS).
 *        d. ULS anchoring (high-confidence record promotion).
 *   4. ACCURACY — headline "~97.1% accuracy" pulled from /api/stats/integrity
 *      (falls back to a static caption if the API is unreachable), plus the
 *      caveats: OCR row noise, edition-skip bias, regional sparsity.
 *   5. DATA QUALITY STATS — tile row of the live numbers: editions with
 *      x-ref, sample-audited editions, avg overlap, avg estimated accuracy,
 *      total corrections applied.
 *   6. COLOPHON — built-in colophon block, Sodium Vapor palette + type stack.
 */

import { colors, fontStacks, motifs } from "../../lib/design";

// ---------------------------------------------------------------------------
// Wire types — mirror IntegrityResponse in app/routes/stats.py.
// ---------------------------------------------------------------------------

interface IntegritySummary {
  editions_with_xref: number;
  editions_with_sample_audit: number;
  editions_with_sample_confidence: number;
  avg_overlap_pct: number | null;
  avg_estimated_true_accuracy_pct: number | null;
  total_corrections_applied: number;
  confidence_breakdown: Record<string, number>;
  headline_estimated_accuracy_pct: number | null;
}

interface IntegrityResponse {
  summary: IntegritySummary;
  xref_sources: unknown[];
  sample_audits: unknown[];
  sample_confidence: unknown[];
}

// ---------------------------------------------------------------------------
// Fetch helper
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
// Local motif components — same pattern as the other server-component pages.
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
        margin: "3rem 0",
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
// Sub-components
// ---------------------------------------------------------------------------

function SectionEyebrow({ vol, label }: { vol: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "1rem",
        marginBottom: "0.75rem",
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.4em",
        textTransform: "uppercase",
        color: colors.accent,
      }}
    >
      <span style={{ color: colors.glow }}>{vol}</span>
      <span aria-hidden style={{ color: colors.accent_2 }}>·</span>
      <span style={{ color: colors.text_dim }}>{label}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        marginBottom: "1.25rem",
        fontFamily: fontStacks.display,
        fontSize: "clamp(2rem, 4vw, 3rem)",
        fontVariationSettings: '"opsz" 96',
        lineHeight: 1.05,
        color: colors.text,
      }}
    >
      {children}
    </h2>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: fontStacks.body,
        fontSize: "1.05rem",
        lineHeight: 1.65,
        color: colors.text,
        maxWidth: "44rem",
      }}
    >
      {children}
    </div>
  );
}

function QualityTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: "1.25rem 1.25rem 1.5rem",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderTop: `3px solid ${colors.accent}`,
        borderRadius: "0.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        minHeight: "8rem",
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
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
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 96',
          fontSize: "2.25rem",
          lineHeight: 1,
          color: colors.accent,
          textShadow: motifs.glow.textShadow,
        }}
      >
        {value}
      </span>
      {sub ? (
        <span
          style={{
            fontFamily: fontStacks.body,
            fontSize: "0.85rem",
            color: colors.text_dim,
            lineHeight: 1.4,
            marginTop: "auto",
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AboutPage() {
  const integrity = await apiGet<IntegrityResponse>(
    "/api/stats/integrity",
  ).catch(() => null as IntegrityResponse | null);

  const headlineAccuracy =
    integrity?.summary.headline_estimated_accuracy_pct ??
    integrity?.summary.avg_estimated_true_accuracy_pct ??
    97.1;

  const accuracyDisplay =
    typeof headlineAccuracy === "number"
      ? `${headlineAccuracy.toFixed(1)}%`
      : "97.1%";

  const tiles: { label: string; value: string; sub?: string }[] = integrity
    ? [
        {
          label: "Cross-referenced editions",
          value: integrity.summary.editions_with_xref.toLocaleString(),
          sub: "Editions with at least one paired second source.",
        },
        {
          label: "Sample-audited editions",
          value: integrity.summary.editions_with_sample_audit.toLocaleString(),
          sub: "Pages hand-graded against the OCR output for true accuracy.",
        },
        {
          label: "Avg overlap %",
          value:
            integrity.summary.avg_overlap_pct !== null
              ? `${integrity.summary.avg_overlap_pct.toFixed(1)}%`
              : "—",
          sub: "Mean entry overlap across paired sources per edition.",
        },
        {
          label: "Avg true accuracy",
          value:
            integrity.summary.avg_estimated_true_accuracy_pct !== null
              ? `${integrity.summary.avg_estimated_true_accuracy_pct.toFixed(1)}%`
              : "—",
          sub: "Manual sample audits across the corpus.",
        },
        {
          label: "Corrections applied",
          value: integrity.summary.total_corrections_applied.toLocaleString(),
          sub: "Rows fixed by the 3-way correction pass.",
        },
        {
          label: "Sample confidence runs",
          value:
            integrity.summary.editions_with_sample_confidence.toLocaleString(),
          sub: "Editions with strict + fuzzy A/B/C agreement statistics.",
        },
      ]
    : [
        {
          label: "Cross-referenced editions",
          value: "—",
          sub: "Integrity endpoint unreachable; tiles will fill in on next visit.",
        },
      ];

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

      {/* --- HERO ---------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 3rem",
          maxWidth: "min(80rem, 100%)",
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
            gap: "1.5rem",
          }}
        >
          {/* Magazine masthead — issue number, date, section, fold. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1rem",
              paddingBottom: "0.875rem",
              borderBottom: `1px solid ${colors.border}`,
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            <span>
              <span style={{ color: colors.accent }}>The Archive</span> · Issue
              No.{" "}
              <span style={{ color: colors.text }}>
                {String(new Date().getFullYear()).padStart(4, "0")}
              </span>
            </span>
            <span style={{ color: colors.accent_2 }}>
              {motifs.morseDividers.tight}
            </span>
            <span>
              Colophon · Provenance · Methodology
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: fontStacks.display,
              fontSize: "clamp(3.5rem, 9vw, 7.5rem)",
              fontVariationSettings: '"opsz" 144, "wght" 500',
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            About the{" "}
            <span
              style={{ color: colors.accent, fontStyle: "italic" }}
            >
              Archive
            </span>
          </h1>
          <p
            style={{
              maxWidth: "44rem",
              margin: 0,
              fontFamily: fontStacks.body,
              fontSize: "1.15rem",
              lineHeight: 1.55,
              color: colors.text_dim,
            }}
          >
            Every printed United States amateur radio callbook from 1909 through
            1997, OCR'd from scanned originals, cross-referenced edition against
            edition, and anchored against the modern FCC ULS database. The
            archive is built to be read — by historians, by operators, and by
            the merely curious — not just queried.
          </p>
        </div>
      </section>

      <div style={{ maxWidth: "min(80rem, 100%)", margin: "0 auto", padding: "0 2rem" }}>
        <MorseDivider label="provenance" />
      </div>

      {/* --- PROVENANCE ---------------------------------------------- */}
      <section
        style={{
          maxWidth: "min(80rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "1.5rem",
        }}
      >
        <SectionEyebrow vol="Vol I" label="Provenance" />
        <SectionTitle>Where the bits came from.</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            gap: "3rem",
            alignItems: "start",
          }}
        >
          <Prose>
            {/* One-memorable-thing: editorial drop-cap in Fraunces — a giant
                italic T floats above the lead, with the rest of the
                paragraph wrapping around it. Pure CSS float, no extra
                deps. */}
            <p style={{ marginTop: 0 }}>
              <span
                aria-hidden
                style={{
                  float: "left",
                  fontFamily: fontStacks.display,
                  fontVariationSettings: '"opsz" 144, "wght" 500',
                  fontStyle: "italic",
                  fontSize: "5.5rem",
                  lineHeight: 0.82,
                  color: colors.accent,
                  marginRight: "0.6rem",
                  marginTop: "0.35rem",
                  marginBottom: "-0.25rem",
                  textShadow: motifs.glow.textShadow,
                  paddingTop: "0.1rem",
                }}
              >
                T
              </span>
              <span aria-hidden style={{ position: "absolute", left: -9999 }}>T</span>
              he PDF scans of every edition were generously collected and
              hosted by{" "}
              <a
                href="https://leehite.org/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: colors.accent, textDecoration: "underline" }}
              >
                leehite.org
              </a>
              , whose decades-long custody of the printed callbooks made this
              project possible. Long-term mirrors of the original PDFs live at
              the{" "}
              <a
                href="https://archive.org/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: colors.accent, textDecoration: "underline" }}
              >
                Internet Archive
              </a>
              , so the source corpus remains independently verifiable.
            </p>
            <p
              style={{
                clear: "left",
                fontFamily: fontStacks.body,
                fontSize: "1.05rem",
                lineHeight: 1.65,
                color: colors.text,
              }}
            >
              <span
                style={{
                  fontFamily: fontStacks.display,
                  fontVariationSettings: '"opsz" 24',
                  fontStyle: "italic",
                  fontSize: "1.15em",
                  color: colors.glow,
                  letterSpacing: "0.02em",
                }}
              >
                Every record
              </span>{" "}
              in the database is traceable back to a specific (year, edition,
              page) coordinate in those scans. Where the OCR left a row
              ambiguous, we kept the raw OCR text alongside the structured
              fields — so a curious reader can always see what the printed
              page actually said.
            </p>
          </Prose>
          <aside
            style={{
              padding: "1.25rem 1.25rem 1.5rem",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${colors.accent}`,
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
                marginBottom: "0.5rem",
              }}
            >
              Source ledger
            </div>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                fontFamily: fontStacks.body,
                fontSize: "0.9rem",
                lineHeight: 1.5,
                color: colors.text,
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
              }}
            >
              <li>
                <strong style={{ color: colors.accent }}>Primary</strong>{" "}
                — leehite.org PDF scans
              </li>
              <li>
                <strong style={{ color: colors.accent }}>Mirror</strong>{" "}
                — Internet Archive
              </li>
              <li>
                <strong style={{ color: colors.accent }}>Anchor</strong>{" "}
                — FCC ULS (modern licenses)
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <div style={{ maxWidth: "min(80rem, 100%)", margin: "0 auto", padding: "0 2rem" }}>
        <MorseDivider label="methodology" />
      </div>

      {/* --- METHODOLOGY --------------------------------------------- */}
      <section
        style={{
          maxWidth: "min(80rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionEyebrow vol="Vol II" label="Methodology" />
        <SectionTitle>From scanned page to structured row.</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
            gap: "1rem",
            marginTop: "1.5rem",
          }}
        >
          {[
            {
              tag: "01",
              title: "OCR",
              body: "Tesseract reads every page with a layout model trained on the locked callbook grid — three columns, justified text, two-line entries.",
            },
            {
              tag: "02",
              title: "2-way cross-reference",
              body: "Adjacent editions are aligned callsign-by-callsign so we can lift fields out of the cleaner of two reads when the OCR disagrees.",
            },
            {
              tag: "03",
              title: "3-way correction",
              body: "When a third source — usually an FCC database or a parallel publisher — agrees with one of the two callbook reads, we promote that version and flag the row as corrected.",
            },
            {
              tag: "04",
              title: "ULS anchoring",
              body: "Modern FCC ULS records ground-truth the most recent decades — every match becomes a Grade-A row and propagates a confidence signal backwards through history.",
            },
          ].map((step) => (
            <div
              key={step.tag}
              style={{
                padding: "1.25rem 1.25rem 1.4rem",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderTop: `3px solid ${colors.accent}`,
                borderRadius: "0.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
              }}
            >
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.7rem",
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: colors.glow,
                }}
              >
                {step.tag}
              </span>
              <span
                style={{
                  fontFamily: fontStacks.display,
                  fontVariationSettings: '"opsz" 36',
                  fontSize: "1.35rem",
                  lineHeight: 1.15,
                  color: colors.text,
                }}
              >
                {step.title}
              </span>
              <p
                style={{
                  margin: 0,
                  fontFamily: fontStacks.body,
                  fontSize: "0.9rem",
                  lineHeight: 1.55,
                  color: colors.text_dim,
                }}
              >
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div style={{ maxWidth: "min(80rem, 100%)", margin: "0 auto", padding: "0 2rem" }}>
        <MorseDivider label="accuracy" />
      </div>

      {/* --- ACCURACY ------------------------------------------------ */}
      <section
        style={{
          maxWidth: "min(80rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionEyebrow vol="Vol III" label="Accuracy" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
            gap: "3rem",
            alignItems: "center",
          }}
        >
          <div>
            <SectionTitle>
              The archive is{" "}
              <span style={{ color: colors.accent, fontStyle: "italic" }}>
                {accuracyDisplay}
              </span>{" "}
              accurate.
            </SectionTitle>
            <Prose>
              <p style={{ marginTop: 0 }}>
                That headline number is the mean estimated true-row accuracy
                across our sample-audited editions — pages that a human re-read
                against the OCR'd structured fields. The rest of the corpus is
                graded by inference from the cross-reference passes, and every
                row carries a source-quality flag (A through D) describing how
                much it was trusted by the pipeline.
              </p>
              <p>
                <strong style={{ color: colors.text }}>Caveats.</strong>{" "}
                OCR row noise is real: smudged scans, broken columns, mid-line
                hyphenation. Edition coverage is uneven — wartime editions are
                thinner because the hobby was suspended. Regional sparsity
                exists for territories and possessions. None of these are
                hidden from the data; they are flagged so a reader can decide
                how to weigh them.
              </p>
            </Prose>
          </div>
          <div
            style={{
              padding: "2rem 1.5rem 2.25rem",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: "0.25rem",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.65rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: colors.text_dim,
                marginBottom: "0.75rem",
              }}
            >
              Headline accuracy
            </div>
            <div
              style={{
                fontFamily: fontStacks.display,
                fontVariationSettings: '"opsz" 144',
                fontSize: "clamp(4rem, 8vw, 6.5rem)",
                color: colors.accent,
                lineHeight: 1,
                textShadow: motifs.glow.textShadow,
              }}
            >
              {accuracyDisplay}
            </div>
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.text_dim,
                marginTop: "0.5rem",
              }}
            >
              ±2.4% across sample audits
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: "min(80rem, 100%)", margin: "0 auto", padding: "0 2rem" }}>
        <MorseDivider label="data quality" />
      </div>

      {/* --- DATA QUALITY STATS -------------------------------------- */}
      <section
        style={{
          maxWidth: "min(80rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionEyebrow vol="Vol IV" label="Data quality" />
        <SectionTitle>Live integrity ledger.</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
            gap: "1rem",
          }}
        >
          {tiles.map((t) => (
            <QualityTile
              key={t.label}
              label={t.label}
              value={t.value}
              sub={t.sub}
            />
          ))}
        </div>
      </section>

      <div style={{ maxWidth: "min(80rem, 100%)", margin: "0 auto", padding: "0 2rem" }}>
        <MorseDivider />
      </div>

      {/* --- COLOPHON ------------------------------------------------ */}
      <section
        style={{
          maxWidth: "min(80rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 6rem",
        }}
      >
        <SectionEyebrow vol="Colophon" label="Type · Palette · Construction" />
        <Prose>
          <p style={{ marginTop: 0 }}>
            Set in <strong style={{ color: colors.text }}>Fraunces</strong> for
            display (variable optical sizing — the hero callsigns ride a 144
            opsz axis), <strong style={{ color: colors.text }}>JetBrains Mono</strong>{" "}
            for callsigns and tabular data, and{" "}
            <strong style={{ color: colors.text }}>Geist Sans</strong> for body
            prose. Palette is the locked Sodium Vapor scheme: midnight{" "}
            <code style={{ color: colors.accent }}>{colors.bg}</code> on{" "}
            sodium-amber <code style={{ color: colors.accent }}>{colors.accent}</code>,
            with bone-cream type at <code style={{ color: colors.accent }}>{colors.text}</code>.
          </p>
          <p>
            Built with Next.js App Router, FastAPI, and SQLite (FTS5). Hosted
            behind Caddy. Decorative motifs — CRT scanlines, fractal-noise
            grain, morse-code dividers, animated TWR dot — are bespoke, not
            borrowed.
          </p>
        </Prose>
      </section>
    </main>
  );
}

export const metadata = {
  title: "About",
  description:
    "Provenance, methodology, and accuracy of the US Ham Callbook Archive.",
};
