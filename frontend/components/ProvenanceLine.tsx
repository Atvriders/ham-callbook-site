"use client";

/**
 * ProvenanceLine — small footer line that names the source edition and
 * the OCR confidence behind a row or card.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Renders something like:
 *
 *     Callbook · Spring 1947 ed.        [ OCR ~97.1% ]
 *
 * The left half is a quiet mono-spaced provenance string; the right
 * half is a compact accuracy chip with a small leading glyph. The chip
 * colour-codes the confidence band (green/amber/dim) so the eye can
 * spot suspect rows quickly when many ProvenanceLines stack.
 *
 * The line is intentionally small (10-11px) and dim — it lives under a
 * card, not in the eyeline. The chip is the only thing that pops.
 */

import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProvenanceLineProps {
  /**
   * Upstream source label, e.g. "Callbook", "FCC ULS", "Corrected".
   * Defaults to "Callbook" when omitted.
   */
  source?: string;
  /** Edition string, e.g. "Spring 1947", "Fall 1963 ed.". */
  edition?: string | null;
  /** Year as a numeric fallback when ``edition`` is missing. */
  year?: number | null;
  /**
   * OCR confidence percentage (0-100). Drives the accuracy chip's label
   * and colour band. ``null`` hides the chip entirely (e.g. for FCC ULS
   * rows that didn't go through OCR).
   */
  ocrPercent?: number | null;
  /** Optional className passthrough. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChipBand {
  border: string;
  background: string;
  color: string;
  glyph: string;
}

function bandForPercent(p: number): ChipBand {
  if (p >= 95) {
    return {
      border: colors.success,
      background: "rgba(93, 211, 168, 0.08)",
      color: colors.success,
      glyph: "●",
    };
  }
  if (p >= 85) {
    return {
      border: colors.accent_2,
      background: "rgba(255, 163, 11, 0.07)",
      color: colors.accent,
      glyph: "◐",
    };
  }
  return {
    border: colors.border,
    background: "transparent",
    color: colors.text_dim,
    glyph: "○",
  };
}

function formatProvenance(
  source: string,
  edition: string | null | undefined,
  year: number | null | undefined,
): string {
  const parts: string[] = [source];
  if (edition) {
    parts.push(`${edition} ed.`);
  } else if (typeof year === "number") {
    parts.push(`${year} ed.`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProvenanceLine({
  source = "Callbook",
  edition = null,
  year = null,
  ocrPercent = null,
  className,
}: ProvenanceLineProps) {
  const provenance = formatProvenance(source, edition, year);

  let chip: React.ReactNode = null;
  if (typeof ocrPercent === "number" && Number.isFinite(ocrPercent)) {
    const clamped = Math.max(0, Math.min(100, ocrPercent));
    const band = bandForPercent(clamped);
    const label = `OCR ~${clamped.toFixed(1)}%`;
    chip = (
      <span
        title={`OCR confidence ${clamped.toFixed(1)}%`}
        aria-label={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "2px 6px",
          border: `1px solid ${band.border}`,
          borderRadius: 2,
          background: band.background,
          color: band.color,
          fontFamily: fontStacks.mono,
          fontSize: 10,
          letterSpacing: "0.12em",
          lineHeight: 1,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 9 }}>
          {band.glyph}
        </span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <div
      className={className}
      data-provenance-source={source}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingTop: 6,
        borderTop: `1px dashed ${colors.border}`,
        fontFamily: fontStacks.mono,
        fontSize: 10.5,
        letterSpacing: "0.10em",
        color: colors.text_dim,
        lineHeight: 1.2,
      }}
    >
      <span
        style={{
          textTransform: "uppercase",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {provenance}
      </span>
      {chip}
    </div>
  );
}
