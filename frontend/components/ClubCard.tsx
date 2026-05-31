"use client";

/**
 * ClubCard — a single tile in the /clubs index, the "Notable Clubs" rail,
 * the per-letter listings, and the related-clubs sidebar.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - A vertically stacked card: a mono-spaced eyebrow (the dominant
 *     city/state if known), the club's display name in Fraunces, then
 *     a tabular data row of stats (callsigns / appearances / year span)
 *     rendered in JetBrains Mono so the columns line up across cards.
 *   - The card is a Link to ``/club/{slug}``. Hover increases the amber
 *     border intensity and lifts the box-shadow halo — we explicitly do
 *     NOT use ``hover:scale-105`` per the locked aesthetic notes.
 *   - A ``ClubTypePip`` sits flush-right in the header row when the
 *     backend has a confident classification.
 *   - The stats row uses small em-dash separators ("—") rather than
 *     bullets so the card reads as printed-callbook marginalia.
 *
 * The component is presentational: it takes a ``ClubSummary`` payload
 * verbatim. Data fetching belongs to the route-level server component.
 */

import { colors, fontStacks, motifs } from "@/lib/design";
import { cleanOCRCity } from "@/lib/ocrClean";
import type { ClubSummary } from "@/lib/types";
import ClubTypePip from "./ClubTypePip";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClubCardProps {
  club: ClubSummary;
  /**
   * Visual density. ``'default'`` is the /clubs grid; ``'compact'`` is
   * the related-clubs sidebar on the detail page and the "Notable Clubs"
   * rail on the landing tile.
   */
  variant?: "default" | "compact";
  /** Optional className passthrough. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLocation(c: ClubSummary): string | null {
  const city = cleanOCRCity(c.dominant_city);
  const state = c.dominant_state ?? "";
  if (city && state) return `${city}, ${state}`;
  if (state) return state;
  if (city) return city;
  return null;
}

function formatYearSpan(c: ClubSummary): string | null {
  if (c.first_year == null && c.last_year == null) return null;
  if (c.first_year != null && c.last_year != null) {
    if (c.first_year === c.last_year) return `${c.first_year}`;
    return `${c.first_year} — ${c.last_year}`;
  }
  return `${c.first_year ?? c.last_year}`;
}

/**
 * Pretty-print large counts with a thin-space thousands separator.
 * Avoids the locale-sensitive ``toLocaleString`` so SSR output matches
 * the client render verbatim.
 */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const s = String(n);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += " ";
    out += s[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClubCard({
  club,
  variant = "default",
  className,
}: ClubCardProps) {
  const compact = variant === "compact";
  const href = `/club/${club.slug}`;
  const location = formatLocation(club);
  const span = formatYearSpan(club);

  return (
    <a
      href={href}
      className={className}
      aria-label={`View club: ${club.display_name}`}
      style={{
        // Layout
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 10,
        padding: compact ? "12px 14px" : "18px 18px 16px",
        // Card chrome
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        // Type defaults
        fontFamily: fontStacks.body,
        color: colors.text,
        textDecoration: "none",
        // Hover affordance: amber border + halo. CSS variable trick keeps
        // us out of Tailwind-utility land and avoids `hover:scale-*`.
        position: "relative",
        transition:
          "border-color 180ms ease, box-shadow 220ms ease, background-color 180ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.accent_2;
        e.currentTarget.style.boxShadow =
          "0 0 0 1px rgba(255,163,11,0.18), 0 0 24px rgba(255,163,11,0.10)";
        e.currentTarget.style.backgroundColor = "rgba(255,163,11,0.03)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.backgroundColor = colors.surface;
      }}
    >
      {/* ───── Header row: location eyebrow + type pip ───── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minHeight: 14,
        }}
      >
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 10,
            letterSpacing: "0.20em",
            color: colors.text_dim,
            textTransform: "uppercase",
            // truncate if a long city/state pushes against the pip
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {location ?? "Location — unknown"}
        </span>
        {club.club_type !== undefined && (
          <ClubTypePip type={club.club_type} size={11} iconOnly={compact} />
        )}
      </div>

      {/* ───── Club display name ───── */}
      <h3
        style={{
          margin: 0,
          fontFamily: fontStacks.display,
          // Fraunces opsz: bigger optical size for the grid tile, smaller
          // for the compact rail/sidebar variant.
          fontVariationSettings: compact
            ? '"opsz" 36, "SOFT" 50'
            : '"opsz" 72, "SOFT" 50',
          fontWeight: 500,
          fontSize: compact ? 16 : 22,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          color: colors.text,
          // Subtle amber halo on hover via the parent's color change.
          textShadow: "none",
        }}
      >
        {club.display_name}
      </h3>

      {/* ───── Stats row: callsigns / appearances / years ───── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: 8,
          fontFamily: fontStacks.mono,
          fontSize: compact ? 11 : 12,
          letterSpacing: "0.04em",
          color: colors.text_dim,
        }}
      >
        <Stat
          value={formatCount(club.callsign_count)}
          unit={club.callsign_count === 1 ? "callsign" : "callsigns"}
        />
        <Sep />
        <Stat
          value={formatCount(club.appearance_count)}
          unit={
            club.appearance_count === 1 ? "appearance" : "appearances"
          }
        />
        {span && (
          <>
            <Sep />
            <span style={{ color: colors.accent }}>{span}</span>
          </>
        )}
      </div>

      {/* ───── Compact decorative morse rune (default variant only) ───── */}
      {!compact && (
        <div
          aria-hidden
          style={{
            marginTop: 2,
            fontFamily: fontStacks.mono,
            fontSize: 9,
            letterSpacing: "0.32em",
            color: colors.text_dim,
            opacity: 0.4,
          }}
        >
          {motifs.morseDividers.tight}
        </div>
      )}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Internal bits
// ---------------------------------------------------------------------------

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <span>
      <span style={{ color: colors.text }}>{value}</span>
      <span style={{ marginLeft: 4, opacity: 0.75 }}>{unit}</span>
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden style={{ opacity: 0.5 }}>
      —
    </span>
  );
}
