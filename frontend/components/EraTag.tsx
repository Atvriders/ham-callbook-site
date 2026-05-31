"use client";

/**
 * EraTag — small chip naming the regulatory era a year belongs to.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * The amateur-radio licensing landscape changed in identifiable jumps,
 * and the callbook editions in this corpus straddle four useful eras:
 *
 *     pre-1928   — pre-Radio Act / pre-three-letter-prefix era
 *     1928-1962  — modern call districts established; pre-Incentive
 *     1963-1997  — Incentive Licensing through the no-code restructuring
 *     2003       — post-2000 restructuring (Tech-No-Code, vanity calls)
 *
 * The chip lets the UI tell the reader "this 1947 row was issued under
 * the same rules as a 1955 row" without an essay.
 *
 * Design intent
 *   - Tiny mono eyebrow above a single-line year-range label, set in
 *     small caps with generous letter spacing — feels like a museum
 *     placard glued to the row.
 *   - Border colour shifts by era so the four periods are also
 *     colour-distinguishable in a dense table column (subtle: all four
 *     stay within the sodium-amber + dim-text family).
 *   - Accepts either a raw ``year`` or a pre-computed ``era`` value.
 */

import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// Canonical eras
// ---------------------------------------------------------------------------

export type Era = "pre-1928" | "1928-1962" | "1963-1997" | "2003";

interface EraSpec {
  label: string;
  /** Plain-language description used as the title tooltip. */
  description: string;
  /** Border / accent colour for the chip. */
  accent: string;
  /** Subtle wash behind the chip. */
  wash: string;
}

const ERA_SPEC: Record<Era, EraSpec> = {
  "pre-1928": {
    label: "PRE-1928",
    description: "Pre-Radio Act era — before three-letter call prefixes.",
    accent: colors.border,
    wash: "transparent",
  },
  "1928-1962": {
    label: "1928 — 1962",
    description: "Modern call districts; pre-Incentive Licensing.",
    accent: colors.accent_2,
    wash: "rgba(201, 126, 8, 0.06)",
  },
  "1963-1997": {
    label: "1963 — 1997",
    description:
      "Incentive Licensing era through the 1990s restructuring efforts.",
    accent: colors.accent,
    wash: "rgba(255, 163, 11, 0.06)",
  },
  "2003": {
    label: "2003",
    description:
      "Post-2000 restructuring (no-code Tech, vanity calls, modern ULS).",
    accent: colors.glow,
    wash: "rgba(255, 209, 102, 0.08)",
  },
};

/**
 * Map a year integer into the canonical era it belongs to. Years past
 * 1997 are bucketed into the "2003" era because that's the only post-
 * restructuring edition this corpus carries; mid-range odd years fall to
 * the nearest preceding era boundary.
 */
export function eraForYear(year: number): Era {
  if (year < 1928) return "pre-1928";
  if (year <= 1962) return "1928-1962";
  if (year <= 1997) return "1963-1997";
  return "2003";
}

// ---------------------------------------------------------------------------
// Props + component
// ---------------------------------------------------------------------------

export interface EraTagProps {
  /** Year integer to derive the era from (ignored if ``era`` is set). */
  year?: number;
  /** Pre-computed era. Overrides ``year`` when both are passed. */
  era?: Era;
  /** Compact variant — drops the eyebrow label. */
  compact?: boolean;
  /** Optional className passthrough. */
  className?: string;
}

export default function EraTag({
  year,
  era,
  compact = false,
  className,
}: EraTagProps) {
  const resolved: Era | null =
    era ?? (typeof year === "number" ? eraForYear(year) : null);

  if (!resolved) return null;
  const spec = ERA_SPEC[resolved];

  return (
    <span
      className={className}
      title={spec.description}
      aria-label={`Era: ${spec.label}`}
      data-era={resolved}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: compact ? 0 : 2,
        padding: compact ? "2px 6px" : "3px 8px",
        border: `1px solid ${spec.accent}`,
        borderRadius: 2,
        background: spec.wash,
        fontFamily: fontStacks.mono,
        color: colors.text_dim,
        lineHeight: 1.15,
      }}
    >
      {!compact && (
        <span
          style={{
            fontSize: 8.5,
            letterSpacing: "0.24em",
            color: colors.text_dim,
            textTransform: "uppercase",
          }}
        >
          Era
        </span>
      )}
      <span
        style={{
          fontSize: compact ? 9.5 : 10.5,
          letterSpacing: "0.16em",
          color: colors.text,
          textTransform: "uppercase",
        }}
      >
        {spec.label}
      </span>
    </span>
  );
}
