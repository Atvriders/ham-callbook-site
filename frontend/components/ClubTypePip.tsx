"use client";

/**
 * ClubTypePip — a tiny inline glyph + label that tags a club by its
 * detected ``club_type`` classification.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - One "pip" per known club type: a small SVG glyph drawn in the
 *     sodium-amber accent on a transparent background, paired with a
 *     short mono-spaced label.
 *   - Each glyph is hand-drawn so the categories read as visually
 *     distinct at a glance — no shared icon-set / generic Lucide look.
 *   - Renders inline-flex so it sits naturally next to a club name in
 *     the header of <ClubCard/>, the hero of /club/[slug], or inline
 *     in search-result rows.
 *
 * Categorisation
 *   The backend emits ``club_type`` as a free-form lowercase string
 *   (``'arc'``, ``'radio club'``, ``'amateur radio association'``,
 *   ``'university'``, ``'dx club'``, ``'museum'``, ``'scouts'``, etc.).
 *   We bucket the raw string into one of the nine canonical kinds the
 *   design contract lists. Unknown strings fall through to ``'club'``.
 */

import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// Canonical kinds and bucket mapping
// ---------------------------------------------------------------------------

export type ClubKind =
  | "club"
  | "society"
  | "university"
  | "dx"
  | "repeater"
  | "scouts"
  | "museum"
  | "league"
  | "association";

/**
 * Map a raw backend ``club_type`` string into one of the canonical
 * kinds the pip set knows how to render. Lowercased, whitespace-trimmed.
 *
 * Order matters — we prefer the more specific match. e.g. "amateur radio
 * association" maps to ``'association'`` before falling back to
 * ``'club'`` via the generic "radio" branch.
 */
export function bucketClubType(raw: string | null | undefined): ClubKind {
  if (!raw) return "club";
  const k = raw.toLowerCase().trim();
  if (!k) return "club";

  if (k.includes("univer") || k.includes("college") || k.includes("school")) {
    return "university";
  }
  if (k.includes("dx")) return "dx";
  if (k.includes("repeater") || k.includes("relay")) return "repeater";
  if (k.includes("scout")) return "scouts";
  if (k.includes("museum") || k.includes("memorial")) return "museum";
  if (k.includes("league")) return "league";
  if (k.includes("associat")) return "association";
  if (k.includes("societ")) return "society";
  // 'arc', 'radio club', 'amateur radio club', plain 'club', etc.
  return "club";
}

const KIND_LABEL: Record<ClubKind, string> = {
  club: "CLUB",
  society: "SOCIETY",
  university: "UNIVERSITY",
  dx: "DX CLUB",
  repeater: "REPEATER",
  scouts: "SCOUTS",
  museum: "MUSEUM",
  league: "LEAGUE",
  association: "ASSOCIATION",
};

// ---------------------------------------------------------------------------
// Glyphs — each is a 16x16 SVG path picked so the categories look distinct
// without leaning on an external icon font.
// ---------------------------------------------------------------------------

function Glyph({ kind, size }: { kind: ClubKind; size: number }) {
  const stroke = colors.accent;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke,
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (kind) {
    case "club":
      // Three operators around a hub — a tiny "people circle".
      return (
        <svg {...common}>
          <circle cx="8" cy="5" r="1.6" />
          <circle cx="4" cy="11" r="1.6" />
          <circle cx="12" cy="11" r="1.6" />
          <path d="M8 6.6 L4 9.4 M8 6.6 L12 9.4 M5.6 11 L10.4 11" />
        </svg>
      );

    case "society":
      // Open book — society = published record.
      return (
        <svg {...common}>
          <path d="M2 4 L8 5 L14 4 L14 13 L8 14 L2 13 Z" />
          <path d="M8 5 L8 14" />
        </svg>
      );

    case "university":
      // Mortar-board cap with tassel.
      return (
        <svg {...common}>
          <path d="M1.5 6 L8 3 L14.5 6 L8 9 Z" />
          <path d="M4 7.2 L4 11 C4 12 6 12.6 8 12.6 C10 12.6 12 12 12 11 L12 7.2" />
          <path d="M14.5 6 L14.5 10" />
        </svg>
      );

    case "dx":
      // Globe with longitude lines + a faint equator — "distance".
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.6" />
          <ellipse cx="8" cy="8" rx="2.4" ry="5.6" />
          <path d="M2.4 8 L13.6 8" />
        </svg>
      );

    case "repeater":
      // Tower with two outward radio waves.
      return (
        <svg {...common}>
          <path d="M8 3 L8 13" />
          <path d="M5 13 L8 5 L11 13" />
          <path d="M3 9 Q2 7 3 5" />
          <path d="M13 9 Q14 7 13 5" />
        </svg>
      );

    case "scouts":
      // Fleur-de-lys silhouette.
      return (
        <svg {...common}>
          <path d="M8 2 L8 13" />
          <path d="M8 6 C5 7 4 9 5 11 C6 9 7 9 8 9 C9 9 10 9 11 11 C12 9 11 7 8 6" />
          <path d="M4.5 10 L11.5 10" />
        </svg>
      );

    case "museum":
      // Greek-temple front (pediment + columns).
      return (
        <svg {...common}>
          <path d="M2 6 L8 3 L14 6" />
          <path d="M3 6 L3 12 M6 6 L6 12 M10 6 L10 12 M13 6 L13 12" />
          <path d="M2 13 L14 13" />
        </svg>
      );

    case "league":
      // Pennant flag on a pole.
      return (
        <svg {...common}>
          <path d="M4 2 L4 14" />
          <path d="M4 3 L13 5 L4 8 Z" />
        </svg>
      );

    case "association":
      // Two interlocking rings.
      return (
        <svg {...common}>
          <circle cx="6" cy="8" r="3.4" />
          <circle cx="10" cy="8" r="3.4" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Props + component
// ---------------------------------------------------------------------------

export interface ClubTypePipProps {
  /**
   * Raw ``club_type`` string from the backend (or one of the canonical
   * ``ClubKind`` values directly). Null/undefined renders the generic
   * "club" pip rather than nothing — clubs always get a type tag.
   */
  type: string | null | undefined;
  /** Glyph size in px. Defaults to 14 for inline header use. */
  size?: number;
  /** Hide the text label; render only the glyph (still has aria-label). */
  iconOnly?: boolean;
  /** Optional className passthrough for layout adjustments. */
  className?: string;
}

export default function ClubTypePip({
  type,
  size = 14,
  iconOnly = false,
  className,
}: ClubTypePipProps) {
  const kind = bucketClubType(type);
  const label = KIND_LABEL[kind];

  return (
    <span
      className={className}
      title={label}
      aria-label={`Club type: ${label.toLowerCase()}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: iconOnly ? 0 : "2px 6px 2px 4px",
        border: iconOnly ? "none" : `1px solid ${colors.border}`,
        borderRadius: 2,
        background: iconOnly ? "transparent" : "rgba(255,163,11,0.05)",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: 10,
        letterSpacing: "0.16em",
        lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      <Glyph kind={kind} size={size} />
      {!iconOnly && <span>{label}</span>}
    </span>
  );
}
