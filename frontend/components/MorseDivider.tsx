"use client";

/**
 * MorseDivider — decorative horizontal rule rendered as a run of
 * dot/dash glyphs in JetBrains Mono.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Replaces ``<hr>`` site-wide. The locked spec calls out
 *     "Morse-code dashes used as decorative dividers" — see
 *     ``motifs.morseDividers.pattern`` in lib/design.ts for the canonical
 *     character sequence.
 *   - Two variants: ``inline`` (a short ``·—·`` run for in-line use, e.g.
 *     between callsign and license class on a hero card) and ``block``
 *     (a full-width row of the longer pattern, used between page
 *     sections).
 *   - Rendered with ``role="separator"`` so assistive tech treats it as
 *     a divider rather than reading aloud the glyph row.
 *
 * The pattern is intentionally not meaningful Morse — it's a visual
 * texture, not an Easter-egg message.
 */

import type { CSSProperties } from "react";
import { colors, fontStacks, motifs } from "@/lib/design";

export interface MorseDividerProps {
  /** "block" (default) is a full-width section break; "inline" is a short run. */
  variant?: "block" | "inline";
  /** Override the canonical pattern from design tokens. */
  pattern?: string;
  /** Custom aria-label; defaults to a generic "section divider". */
  label?: string;
  /** Optional className passthrough. */
  className?: string;
  /** Optional style passthrough — merged after the component defaults. */
  style?: CSSProperties;
}

export default function MorseDivider({
  variant = "block",
  pattern,
  label = "section divider",
  className,
  style,
}: MorseDividerProps) {
  const glyphs =
    pattern ??
    (variant === "inline"
      ? motifs.morseDividers.tight
      : motifs.morseDividers.pattern);

  const baseStyle: CSSProperties =
    variant === "block"
      ? {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          margin: "32px 0",
          fontFamily: fontStacks.mono,
          fontSize: 11,
          letterSpacing: "0.45em",
          color: colors.text_dim,
          textTransform: "uppercase",
          userSelect: "none",
        }
      : {
          display: "inline-block",
          margin: "0 10px",
          fontFamily: fontStacks.mono,
          fontSize: 10,
          letterSpacing: "0.35em",
          color: colors.text_dim,
          userSelect: "none",
          verticalAlign: "middle",
        };

  // For the block variant we frame the dot-dash run with thin amber rules
  // so it reads like a chapter break in a printed handbook.
  if (variant === "block") {
    return (
      <div
        role="separator"
        aria-label={label}
        className={className}
        style={{ ...baseStyle, ...style }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: 1,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${colors.border} 40%, ${colors.border} 60%, transparent)`,
          }}
        />
        <span
          aria-hidden="true"
          style={{ color: colors.accent_2, letterSpacing: "0.45em" }}
        >
          {glyphs}
        </span>
        <span
          aria-hidden="true"
          style={{
            flex: 1,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${colors.border} 40%, ${colors.border} 60%, transparent)`,
          }}
        />
      </div>
    );
  }

  return (
    <span
      role="separator"
      aria-label={label}
      aria-hidden="true"
      className={className}
      style={{ ...baseStyle, ...style }}
    >
      {glyphs}
    </span>
  );
}
