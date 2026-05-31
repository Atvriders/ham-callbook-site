"use client";

/**
 * LicenseClassPip — single-letter pip identifying the FCC amateur-radio
 * license class held in a given callbook entry.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - One uppercase mono-spaced letter inside a square outlined chip —
 *     reads like a punch-card stamp on the callbook row.
 *   - Each class gets a distinct opacity hint against the sodium-amber
 *     accent so the eye can scan a column of pips and pick out the high
 *     classes (Extra) from the low ones (Novice) without reading.
 *
 *       N = Novice      (faintest)
 *       T = Technician
 *       G = General     (mid)
 *       A = Advanced
 *       E = Extra       (full glow)
 *
 *   - Unknown / null inputs render a dim "?" pip rather than nothing, so
 *     table rows keep their alignment.
 *   - Tooltip carries the full class name for accessibility.
 */

import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Canonical classes + bucket
// ---------------------------------------------------------------------------

export type LicenseClass = "N" | "T" | "G" | "A" | "E" | "?";

const CLASS_LABEL: Record<LicenseClass, string> = {
  N: "Novice",
  T: "Technician",
  G: "General",
  A: "Advanced",
  E: "Amateur Extra",
  "?": "Unknown",
};

/**
 * Per-class opacity hint applied to the amber background + text. The
 * Novice end of the scale is faint; Extra glows fully. Picked by eye to
 * read distinctly in a stacked column of pips at default size.
 */
const CLASS_OPACITY: Record<LicenseClass, number> = {
  N: 0.28,
  T: 0.45,
  G: 0.62,
  A: 0.8,
  E: 1.0,
  "?": 0.18,
};

/**
 * Bucket a raw license_class string (or null) into one of the canonical
 * single-letter codes. Accepts the FCC short codes ("N", "T", "G", "A",
 * "E") as well as the spelled-out forms ("Novice", "Technician", ...)
 * and the older Conditional ("C") + Technician Plus ("T+") variants that
 * appear in early callbooks.
 */
export function bucketLicenseClass(
  raw: string | null | undefined,
): LicenseClass {
  if (!raw) return "?";
  const k = raw.toUpperCase().trim();
  if (!k) return "?";

  if (k.startsWith("E") || k.includes("EXTRA")) return "E";
  if (k.startsWith("A") || k.includes("ADV")) return "A";
  if (k.startsWith("G") || k.includes("GENERAL") || k === "C" || k.includes("COND")) {
    // Conditional class folds into General for display.
    return "G";
  }
  if (k.startsWith("T") || k.includes("TECH")) return "T";
  if (k.startsWith("N") || k.includes("NOV")) return "N";

  return "?";
}

/**
 * Era-aware license class label for display in the CLASS tile.
 * Uses the raw FCC short code plus the entry year (and club flag) to
 * return the correct human-readable class name, accounting for codes
 * whose meaning changed over time (B, C).
 *
 * Does NOT affect the pip visualization — that still uses bucketLicenseClass().
 */
export function classLabelForCode(
  code: string | null | undefined,
  year: number | null | undefined,
  isClub: boolean = false,
): string {
  if (isClub) return 'Club';
  if (!code) return '—';
  const c = code.trim().toUpperCase();
  if (c === 'E') return 'Extra';
  if (c === 'A') return 'Advanced';
  if (c === 'G') return 'General';
  if (c === 'T') return 'Technician';
  if (c === 'N') return 'Novice';
  if (c === 'P') return '—'; // parser artifact
  if (c === 'B') {
    if (year && year >= 1952) return 'Club';
    return 'General';
  }
  if (c === 'C') {
    if (year && year > 1967) return '—';
    return 'Conditional';
  }
  return '—';
}

// ---------------------------------------------------------------------------
// Props + component
// ---------------------------------------------------------------------------

export interface LicenseClassPipProps {
  /** Raw license_class string from the backend (or canonical code). */
  licenseClass: string | null | undefined;
  /** Pip size in px (square). Defaults to 18. */
  size?: number;
  /** Optional className passthrough. */
  className?: string;
}

export default function LicenseClassPip({
  licenseClass,
  size = 18,
  className,
}: LicenseClassPipProps) {
  const code = bucketLicenseClass(licenseClass);
  const label = CLASS_LABEL[code];
  const opacity = CLASS_OPACITY[code];

  // The text shows the canonical letter, except "?" which renders as a
  // dim em-dash so it doesn't look like a typo.
  const glyph = code === "?" ? "—" : code;

  return (
    <span
      className={className}
      title={label}
      aria-label={`License class: ${label}`}
      data-license-class={code}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        border: `1px solid ${code === "?" ? colors.border : colors.accent_2}`,
        borderRadius: 2,
        background:
          code === "?"
            ? "transparent"
            : `rgba(255, 163, 11, ${(opacity * 0.18).toFixed(3)})`,
        color: code === "?" ? colors.text_dim : colors.accent,
        opacity: code === "?" ? 1 : 0.55 + opacity * 0.45,
        fontFamily: fontStacks.mono,
        fontSize: Math.round(size * 0.62),
        fontWeight: 600,
        letterSpacing: 0,
        lineHeight: 1,
        textShadow: code === "E" ? motifs.glow.textShadow : undefined,
        verticalAlign: "middle",
      }}
    >
      {glyph}
    </span>
  );
}
