/**
 * <EraCards/> — per-era cards for /stats with a *distinct motif per era*.
 *
 * Client component so we can do staggered Motion entrance reveals as the
 * section scrolls into view (Framer/Motion `whileInView`). The motifs
 * lean into the period each era evokes:
 *
 *   pre-1928   art-deco — chevron/sunburst SVG, thin gold rules
 *   1928-62    mid-century mono — geometric grid, beige + amber, single rule
 *   1963-97    CRT — scanlines + green-amber phosphor flicker
 *   2003+      digital sodium — pixel grid, glow accents
 *
 * Each card still inherits the Sodium Vapor palette (we don't suddenly
 * switch to green or pink) — the period flavour comes from the
 * background pattern and the typographic weighting, not new colors.
 *
 * Aesthetic guardrails: no purple, no Inter, no hover:scale-105, no
 * generic shadcn shadows. All hex from `lib/design.ts`.
 */

"use client";

import { motion } from "motion/react";
import { colors, fontStacks, motifs } from "../../lib/design";

// ---------------------------------------------------------------------------
// Era definition. The five eras are imported as data from page.tsx via props
// so the bucketing stays a single source of truth.
// ---------------------------------------------------------------------------

export interface EraCardDatum {
  key: string;
  label: string;
  span: [number, number];
  caption: string;
  count: number;
}

type MotifKey = "deco" | "midcentury" | "crt" | "digital";

/**
 * Era key → motif key. The four motifs reflect the four broad design
 * regimes the printed callbooks themselves moved through.
 */
function pickMotif(era: EraCardDatum): MotifKey {
  const end = era.span[1];
  if (end <= 1928) return "deco";
  if (end <= 1962) return "midcentury";
  if (end <= 1997) return "crt";
  return "digital";
}

function compactBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Background motifs — each returns a positioned <svg> sized to cover the card
// ---------------------------------------------------------------------------

function DecoBackdrop() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 220"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.18,
        pointerEvents: "none",
      }}
    >
      {/* Sunburst rays from bottom-center */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = -90 + (i - 5.5) * 8;
        const rad = (angle * Math.PI) / 180;
        const x2 = 100 + Math.cos(rad) * 260;
        const y2 = 220 + Math.sin(rad) * 260;
        return (
          <line
            key={i}
            x1={100}
            y1={220}
            x2={x2}
            y2={y2}
            stroke={colors.accent}
            strokeWidth={0.5}
          />
        );
      })}
      {/* Stacked chevrons */}
      {[0, 14, 28].map((y) => (
        <polyline
          key={y}
          points={`20,${30 + y} 100,${10 + y} 180,${30 + y}`}
          fill="none"
          stroke={colors.accent_2}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

function MidCenturyBackdrop() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 220"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.16,
        pointerEvents: "none",
      }}
    >
      <defs>
        <pattern
          id="midGrid"
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <path d="M20 0 L0 0 0 20" fill="none" stroke={colors.text_dim} strokeWidth={0.4} />
        </pattern>
      </defs>
      <rect width="200" height="220" fill="url(#midGrid)" />
      {/* Single bold horizontal rule */}
      <line
        x1={0}
        y1={120}
        x2={200}
        y2={120}
        stroke={colors.accent}
        strokeWidth={1.5}
      />
      {/* Three geometric dots, modernist style */}
      <circle cx={32} cy={180} r={5} fill={colors.accent} />
      <circle cx={56} cy={180} r={5} fill="none" stroke={colors.accent} strokeWidth={1} />
      <circle cx={80} cy={180} r={5} fill="none" stroke={colors.accent} strokeWidth={1} />
    </svg>
  );
}

function CrtBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: 0.22,
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          rgba(255, 209, 102, 0.55) 0px,
          rgba(255, 209, 102, 0.55) 1px,
          transparent 1px,
          transparent 3px
        ),
        radial-gradient(ellipse at center, rgba(255,163,11,0.18) 0%, transparent 70%)`,
        mixBlendMode: "screen",
      }}
    />
  );
}

function DigitalBackdrop() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 220"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.18,
        pointerEvents: "none",
      }}
    >
      <defs>
        <pattern
          id="digitalDots"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
        >
          <circle cx={1} cy={1} r={0.8} fill={colors.accent} />
        </pattern>
      </defs>
      <rect width="200" height="220" fill="url(#digitalDots)" />
      {/* Glowy bracket in the bottom-right */}
      <path
        d="M170 200 L195 200 L195 175"
        fill="none"
        stroke={colors.glow}
        strokeWidth={1.5}
        style={{ filter: "drop-shadow(0 0 4px rgba(255,209,102,0.8))" }}
      />
    </svg>
  );
}

const BACKDROPS: Record<MotifKey, () => React.ReactElement> = {
  deco: DecoBackdrop,
  midcentury: MidCenturyBackdrop,
  crt: CrtBackdrop,
  digital: DigitalBackdrop,
};

const MOTIF_TAG: Record<MotifKey, string> = {
  deco: "art-deco",
  midcentury: "mid-century",
  crt: "crt phosphor",
  digital: "digital sodium",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EraCards({ eras }: { eras: EraCardDatum[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
        gap: "1rem",
      }}
    >
      {eras.map((era, i) => {
        const motif = pickMotif(era);
        const Backdrop = BACKDROPS[motif];
        return (
          <motion.article
            key={era.key}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              duration: 0.55,
              delay: 0.08 * i,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              position: "relative",
              padding: "1.5rem 1.5rem 1.625rem",
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              borderRadius: "0.25rem",
              overflow: "hidden",
              minHeight: "13rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <Backdrop />
            <div style={{ position: "relative", zIndex: 1 }}>
              <header
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.65rem",
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: colors.accent,
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.5rem",
                }}
              >
                <span>
                  {era.span[0]} – {era.span[1]}
                </span>
                <span style={{ color: colors.text_dim }}>{MOTIF_TAG[motif]}</span>
              </header>
              <div
                style={{
                  fontFamily: fontStacks.display,
                  fontSize: "1.75rem",
                  fontVariationSettings: '"opsz" 48, "SOFT" 30',
                  fontWeight: 500,
                  lineHeight: 1.05,
                  letterSpacing: "-0.01em",
                  marginBottom: "0.5rem",
                }}
              >
                {era.label}
              </div>
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "1.75rem",
                  color: colors.glow,
                  textShadow: motifs.glow.textShadow,
                  fontVariantNumeric: "tabular-nums",
                  marginBottom: "0.4rem",
                }}
              >
                {compactBig(era.count)}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: colors.text_dim,
                  lineHeight: 1.45,
                }}
              >
                {era.caption}
              </p>
            </div>
          </motion.article>
        );
      })}
    </div>
  );
}
