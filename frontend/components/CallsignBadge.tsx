"use client";

/**
 * CallsignBadge — compact mono-spaced callsign chip with the sodium-vapor
 * amber halo. Used in search rows, club roster tables, related-callsign
 * marginalia, and anywhere a callsign is referenced inline.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - JetBrains Mono, generous tracking, uppercase callsign — reads like
 *     a callbook printout, not a button.
 *   - Optional amber underglow on hover when ``href`` is set; the badge
 *     becomes a quiet link target rather than a chunky button.
 *   - Three densities (``compact`` / default / ``hero``) so the same
 *     component covers footer chips and the search-result lead.
 *   - When ``muted`` is set the chip drops to ``text_dim`` — useful for
 *     historical / cancelled callsigns where the row should de-emphasise.
 */

import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CallsignBadgeSize = "compact" | "default" | "hero";

export interface CallsignBadgeProps {
  /** The callsign string. Rendered uppercase regardless of input case. */
  callsign: string;
  /** When provided, renders as an <a> to this URL (typically /c/{cs}). */
  href?: string;
  /** Visual density. */
  size?: CallsignBadgeSize;
  /** De-emphasise (cancelled / historical / non-clickable contexts). */
  muted?: boolean;
  /** Optional className passthrough. */
  className?: string;
  /** Optional title attribute for the tooltip. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Size table
// ---------------------------------------------------------------------------

interface SizeSpec {
  fontSize: number;
  padX: number;
  padY: number;
  letterSpacing: string;
}

const SIZE: Record<CallsignBadgeSize, SizeSpec> = {
  compact: { fontSize: 11, padX: 6, padY: 2, letterSpacing: "0.10em" },
  default: { fontSize: 13, padX: 8, padY: 3, letterSpacing: "0.12em" },
  hero: { fontSize: 16, padX: 12, padY: 5, letterSpacing: "0.14em" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CallsignBadge({
  callsign,
  href,
  size = "default",
  muted = false,
  className,
  title,
}: CallsignBadgeProps) {
  const spec = SIZE[size];
  const display = callsign.toUpperCase();

  const textColor = muted ? colors.text_dim : colors.accent;
  const borderColor = muted ? colors.border : colors.accent_2;

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: `${spec.padY}px ${spec.padX}px`,
    border: `1px solid ${borderColor}`,
    borderRadius: 2,
    background: muted
      ? "transparent"
      : "linear-gradient(180deg, rgba(255,163,11,0.08) 0%, rgba(255,163,11,0.02) 100%)",
    color: textColor,
    fontFamily: fontStacks.mono,
    fontSize: spec.fontSize,
    letterSpacing: spec.letterSpacing,
    fontWeight: 500,
    textDecoration: "none",
    textTransform: "uppercase",
    lineHeight: 1,
    textShadow: muted ? undefined : motifs.glow.textShadow,
    whiteSpace: "nowrap",
  };

  if (href) {
    return (
      <a
        href={href}
        className={className}
        title={title ?? display}
        aria-label={`Callsign ${display}`}
        style={baseStyle}
        data-callsign={display}
      >
        {display}
      </a>
    );
  }

  return (
    <span
      className={className}
      title={title ?? display}
      aria-label={`Callsign ${display}`}
      style={baseStyle}
      data-callsign={display}
    >
      {display}
    </span>
  );
}
