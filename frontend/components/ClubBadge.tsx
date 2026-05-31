"use client";

/**
 * ClubBadge — compact "this callsign belongs to a club" marker rendered
 * next to a callsign hero on the callsign detail page.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Looks like a small ID-card / placard the operator pinned next to
 *     their callsign: thin amber border, faint amber wash, mono-spaced
 *     "CLUB STATION" eyebrow, then the club's display name in Fraunces
 *     and the year window in JetBrains Mono.
 *   - Renders as an <a> when ``href`` is provided (typical: links to
 *     ``/club/{slug}``), otherwise as a plain span so it can be reused
 *     in non-linking contexts (e.g. the club detail hero itself).
 *   - The ``ClubTypePip`` is rendered inside when a ``club_type`` is
 *     present, giving the badge an at-a-glance category glyph.
 *
 * Built from the ``CallsignClubInfo`` payload that
 * ``GET /api/callsign/{cs}/club`` returns. The integration notes in
 * ``_club_integration_notes.txt`` call this badge out as the hero
 * companion for callsign pages where ``is_club`` is true.
 */

import { colors, fontStacks, motifs } from "@/lib/design";
import ClubTypePip from "./ClubTypePip";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClubBadgeProps {
  /** Human-readable club name, e.g. "REDWOOD EMPIRE ARC". */
  displayName: string;
  /** Optional ``[first_year, last_year]`` window for the badge subtitle. */
  years?: number[];
  /** Raw backend ``club_type`` (or null). Drives the inline pip. */
  clubType?: string | null;
  /** When provided, the badge renders as an <a> to this URL. */
  href?: string;
  /** Compact variant — drops the year subtitle, halves the padding. */
  compact?: boolean;
  /** Optional className passthrough. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format ``years`` array following the backend convention: 0, 1, or 2 entries. */
function formatYearWindow(years: number[] | undefined): string | null {
  if (!years || years.length === 0) return null;
  if (years.length === 1) return `since ${years[0]}`;
  const [first, last] = years;
  if (first === last) return `${first}`;
  return `${first} — ${last}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClubBadge({
  displayName,
  years,
  clubType,
  href,
  compact = false,
  className,
}: ClubBadgeProps) {
  const window = formatYearWindow(years);

  const padY = compact ? 6 : 10;
  const padX = compact ? 10 : 14;

  const content = (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: compact ? 2 : 4,
        padding: `${padY}px ${padX}px`,
        border: `1px solid ${colors.accent_2}`,
        borderRadius: 2,
        background:
          "linear-gradient(180deg, rgba(255,163,11,0.10) 0%, rgba(255,163,11,0.04) 100%)",
        color: colors.text,
        fontFamily: fontStacks.body,
        textDecoration: "none",
        position: "relative",
        // Sodium-vapor halo on the badge border.
        boxShadow: `0 0 12px rgba(255,163,11,0.10), inset 0 0 0 1px rgba(255,209,102,0.06)`,
      }}
    >
      {/* eyebrow row: "CLUB STATION" + type pip */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: fontStacks.mono,
          fontSize: 9.5,
          letterSpacing: "0.22em",
          color: colors.accent,
          textTransform: "uppercase",
          textShadow: motifs.glow.textShadow,
        }}
      >
        <span>Club Station</span>
        {clubType !== undefined && (
          <ClubTypePip type={clubType ?? null} size={11} iconOnly />
        )}
      </span>

      {/* the club name itself — display serif, slightly tighter optical sizing
          than the page-hero, so it sits visually under the callsign. */}
      <span
        style={{
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 36, "SOFT" 50',
          fontWeight: 500,
          fontSize: compact ? 15 : 18,
          letterSpacing: "-0.005em",
          lineHeight: 1.15,
          color: colors.text,
        }}
      >
        {displayName}
      </span>

      {!compact && window && (
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 11,
            letterSpacing: "0.12em",
            color: colors.text_dim,
          }}
        >
          {window}
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <a
        href={href}
        className={className}
        style={{ display: "inline-block", textDecoration: "none" }}
        aria-label={`View club: ${displayName}`}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={className} style={{ display: "inline-block" }}>
      {content}
    </span>
  );
}
