"use client";

/**
 * USMap — a 50-state choropleth tinted in amber by a per-state count.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - This is NOT a geographically-accurate map. It's an editorial
 *     state-grid (the "Periodic Table of the United States" layout, with
 *     AK and HI tucked into the lower-left, DC pinned next to MD). The
 *     grid feels printed — like a stat plate from a midcentury almanac.
 *   - Each cell is a square tile labeled with the 2-letter abbreviation
 *     in JetBrains Mono. Fill opacity ramps from 0.05 (zero) to 1.00
 *     (max) of the sodium amber accent — so the eye reads the entire map
 *     as a single phosphor glow with hotter and cooler regions.
 *   - Hover surfaces a tooltip in the corner of the map showing the
 *     state name + count, instead of floating tooltips that would clip
 *     against the panel edges.
 *
 * Pure presentational, no fetching. The page passes ``counts``, a
 * record of ``{ STATE_ABBR: number }``. States missing from the record
 * render as the dimmest tile.
 */

import { useMemo, useState } from "react";
import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// State grid — periodic-table layout (row, col) for each US state + DC.
// Cols 1..12, rows 1..8. Hand-tuned so neighbors are roughly correct.
// ---------------------------------------------------------------------------

interface GridCell {
  abbr: string;
  name: string;
  row: number;
  col: number;
}

const STATE_GRID: GridCell[] = [
  // row 1
  { abbr: "AK", name: "Alaska", row: 1, col: 1 },
  { abbr: "ME", name: "Maine", row: 1, col: 12 },
  // row 2
  { abbr: "VT", name: "Vermont", row: 2, col: 11 },
  { abbr: "NH", name: "New Hampshire", row: 2, col: 12 },
  // row 3
  { abbr: "WA", name: "Washington", row: 3, col: 2 },
  { abbr: "ID", name: "Idaho", row: 3, col: 3 },
  { abbr: "MT", name: "Montana", row: 3, col: 4 },
  { abbr: "ND", name: "North Dakota", row: 3, col: 5 },
  { abbr: "MN", name: "Minnesota", row: 3, col: 6 },
  { abbr: "IL", name: "Illinois", row: 3, col: 7 },
  { abbr: "WI", name: "Wisconsin", row: 3, col: 8 },
  { abbr: "MI", name: "Michigan", row: 3, col: 9 },
  { abbr: "NY", name: "New York", row: 3, col: 10 },
  { abbr: "MA", name: "Massachusetts", row: 3, col: 11 },
  // row 4
  { abbr: "OR", name: "Oregon", row: 4, col: 2 },
  { abbr: "NV", name: "Nevada", row: 4, col: 3 },
  { abbr: "WY", name: "Wyoming", row: 4, col: 4 },
  { abbr: "SD", name: "South Dakota", row: 4, col: 5 },
  { abbr: "IA", name: "Iowa", row: 4, col: 6 },
  { abbr: "IN", name: "Indiana", row: 4, col: 7 },
  { abbr: "OH", name: "Ohio", row: 4, col: 8 },
  { abbr: "PA", name: "Pennsylvania", row: 4, col: 9 },
  { abbr: "NJ", name: "New Jersey", row: 4, col: 10 },
  { abbr: "CT", name: "Connecticut", row: 4, col: 11 },
  { abbr: "RI", name: "Rhode Island", row: 4, col: 12 },
  // row 5
  { abbr: "CA", name: "California", row: 5, col: 2 },
  { abbr: "UT", name: "Utah", row: 5, col: 3 },
  { abbr: "CO", name: "Colorado", row: 5, col: 4 },
  { abbr: "NE", name: "Nebraska", row: 5, col: 5 },
  { abbr: "MO", name: "Missouri", row: 5, col: 6 },
  { abbr: "KY", name: "Kentucky", row: 5, col: 7 },
  { abbr: "WV", name: "West Virginia", row: 5, col: 8 },
  { abbr: "VA", name: "Virginia", row: 5, col: 9 },
  { abbr: "MD", name: "Maryland", row: 5, col: 10 },
  { abbr: "DC", name: "District of Columbia", row: 5, col: 11 },
  { abbr: "DE", name: "Delaware", row: 5, col: 12 },
  // row 6
  { abbr: "AZ", name: "Arizona", row: 6, col: 3 },
  { abbr: "NM", name: "New Mexico", row: 6, col: 4 },
  { abbr: "KS", name: "Kansas", row: 6, col: 5 },
  { abbr: "AR", name: "Arkansas", row: 6, col: 6 },
  { abbr: "TN", name: "Tennessee", row: 6, col: 7 },
  { abbr: "NC", name: "North Carolina", row: 6, col: 8 },
  { abbr: "SC", name: "South Carolina", row: 6, col: 9 },
  // row 7
  { abbr: "HI", name: "Hawaii", row: 7, col: 1 },
  { abbr: "OK", name: "Oklahoma", row: 7, col: 5 },
  { abbr: "LA", name: "Louisiana", row: 7, col: 6 },
  { abbr: "MS", name: "Mississippi", row: 7, col: 7 },
  { abbr: "AL", name: "Alabama", row: 7, col: 8 },
  { abbr: "GA", name: "Georgia", row: 7, col: 9 },
  // row 8
  { abbr: "TX", name: "Texas", row: 8, col: 5 },
  { abbr: "FL", name: "Florida", row: 8, col: 9 },
];

const STATE_BY_ABBR: Record<string, GridCell> = Object.fromEntries(
  STATE_GRID.map((c) => [c.abbr, c])
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface USMapProps {
  /** ``{ "CA": 4218, "TX": 3771, ... }`` — counts per state abbreviation. */
  counts: Record<string, number>;
  /** Label rendered above the map, e.g. "Operators per state, 1936". */
  caption?: string;
  /** Format the number in the tooltip. Defaults to locale grouping. */
  formatCount?: (n: number) => string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function USMap({
  counts,
  caption,
  formatCount,
  className,
}: USMapProps) {
  const [hover, setHover] = useState<string | null>(null);

  const fmt = formatCount ?? ((n: number) => n.toLocaleString("en-US"));

  const { max, total, nonZero } = useMemo(() => {
    let max = 0;
    let total = 0;
    let nonZero = 0;
    for (const cell of STATE_GRID) {
      const v = counts[cell.abbr] ?? 0;
      if (v > max) max = v;
      total += v;
      if (v > 0) nonZero += 1;
    }
    return { max, total, nonZero };
  }, [counts]);

  /** Map a raw count onto an amber fill opacity, using a sqrt scale so
   *  the dim states still get a hint of phosphor. */
  function fillForCount(n: number): string {
    if (max <= 0 || n <= 0) return "rgba(255,163,11,0.05)";
    const t = Math.sqrt(n / max); // perceptual easing
    const alpha = 0.10 + t * 0.85; // 0.10..0.95
    return `rgba(255,163,11,${alpha.toFixed(3)})`;
  }

  const hovered = hover ? STATE_BY_ABBR[hover] : null;
  const hoveredCount = hovered ? counts[hovered.abbr] ?? 0 : 0;

  return (
    <figure
      className={className}
      style={{
        margin: 0,
        padding: "16px 18px",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        position: "relative",
      }}
      aria-label={caption ?? "US states choropleth"}
    >
      {caption && (
        <figcaption
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 10,
            letterSpacing: "0.28em",
            color: colors.accent,
            textTransform: "uppercase",
            marginBottom: 12,
            textShadow: motifs.glow.textShadow,
          }}
        >
          {caption}
        </figcaption>
      )}

      {/* the grid itself */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gridTemplateRows: "repeat(8, 1fr)",
          gap: 4,
          aspectRatio: "12 / 8",
        }}
        role="grid"
        aria-label="US states tile grid"
      >
        {STATE_GRID.map((cell) => {
          const n = counts[cell.abbr] ?? 0;
          const isHover = hover === cell.abbr;
          return (
            <button
              key={cell.abbr}
              type="button"
              role="gridcell"
              aria-label={`${cell.name}: ${fmt(n)}`}
              onMouseEnter={() => setHover(cell.abbr)}
              onMouseLeave={() => setHover((h) => (h === cell.abbr ? null : h))}
              onFocus={() => setHover(cell.abbr)}
              onBlur={() => setHover((h) => (h === cell.abbr ? null : h))}
              style={{
                gridColumnStart: cell.col,
                gridRowStart: cell.row,
                background: fillForCount(n),
                border: `1px solid ${
                  isHover ? colors.glow : colors.border
                }`,
                color: n > 0 ? colors.text : colors.text_dim,
                fontFamily: fontStacks.mono,
                fontSize: 11,
                letterSpacing: "0.08em",
                cursor: "pointer",
                padding: 0,
                outline: "none",
                transition: "border-color 120ms ease",
                boxShadow: isHover
                  ? `0 0 12px rgba(255,209,102,0.45) inset`
                  : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {cell.abbr}
            </button>
          );
        })}
      </div>

      {/* legend strip — quantitative ramp */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: fontStacks.mono,
            fontSize: 9.5,
            letterSpacing: "0.2em",
            color: colors.text_dim,
            textTransform: "uppercase",
          }}
        >
          <span>0</span>
          <span
            style={{
              display: "inline-block",
              width: 140,
              height: 8,
              background:
                "linear-gradient(90deg, rgba(255,163,11,0.05), rgba(255,163,11,0.95))",
              border: `1px solid ${colors.border}`,
            }}
          />
          <span>{fmt(max)}</span>
        </div>
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 9.5,
            letterSpacing: "0.2em",
            color: colors.text_dim,
            textTransform: "uppercase",
          }}
        >
          {fmt(total)} total · {nonZero}/50 states
        </div>
      </div>

      {/* hover readout — corner card, never a floating tooltip */}
      <div
        aria-live="polite"
        style={{
          position: "absolute",
          top: 14,
          right: 18,
          padding: "6px 10px",
          minWidth: 120,
          textAlign: "right",
          border: `1px solid ${
            hovered ? colors.accent_2 : "transparent"
          }`,
          background: hovered ? colors.bg : "transparent",
          fontFamily: fontStacks.body,
          fontSize: 12,
          color: colors.text,
          transition: "border-color 120ms ease, background 120ms ease",
          pointerEvents: "none",
        }}
      >
        {hovered ? (
          <>
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: 9.5,
                letterSpacing: "0.22em",
                color: colors.accent,
                textTransform: "uppercase",
              }}
            >
              {hovered.abbr}
            </div>
            <div style={{ marginTop: 2 }}>{hovered.name}</div>
            <div
              style={{
                marginTop: 2,
                fontFamily: fontStacks.mono,
                color: colors.text_dim,
                fontSize: 11,
              }}
            >
              {fmt(hoveredCount)}
            </div>
          </>
        ) : null}
      </div>
    </figure>
  );
}
