"use client";

/**
 * HoldersTimeline — a 1909→1997 horizontal timeline showing which
 * distinct operator held a given callsign in each year window.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - The 20th-century callbook corpus runs from 1909 (the earliest
 *     edition we have) through 1997. We render one continuous baseline
 *     across that span, with stacked horizontal bands — one band per
 *     distinct holder — anchored at their first and last appearance.
 *   - Bands look like strips of phosphor on an oscilloscope screen:
 *     thin amber fill, faint glow, JetBrains-Mono label tucked inside.
 *     Year ticks every 10 years sit beneath the baseline like ruler
 *     graticules. The whole thing reads like an editorial timeline plate
 *     from a print atlas, not a generic stacked bar chart.
 *   - When two holders' year windows overlap, the bands stack vertically
 *     so the operator names never collide. Sparse holders (e.g. a single
 *     1936 appearance) render as a 1-year dot rather than a thin sliver.
 *
 * Consumed from ``GET /api/callsign/{cs}/holders`` (see HoldersHistoryResult).
 * Pure presentational — no fetching here; the page passes ``holders`` in.
 */

import { colors, fontStacks, motifs } from "@/lib/design";
import type { HolderCluster } from "@/lib/types";
import { cleanOCRName, cleanOCRCity, cleanOCRState } from "@/lib/ocrClean";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Inclusive year range of the callbook corpus. */
const YEAR_MIN = 1909;
const YEAR_MAX = 1997;
const YEAR_SPAN = YEAR_MAX - YEAR_MIN; // 88 years

/** SVG viewbox dimensions (responsive via preserveAspectRatio). */
const VB_WIDTH = 1000;
const ROW_HEIGHT = 28;
const TOP_PADDING = 24;
const BOTTOM_PADDING = 44; // room for year ticks below the bands

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HoldersTimelineProps {
  /** Distinct holder clusters for one callsign, ordered first-year ascending. */
  holders: HolderCluster[];
  /** Optional className passthrough. */
  className?: string;
  /** Render label inside band only when band exceeds this px width. */
  minLabelWidth?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a year onto an x-coordinate in the SVG viewbox. */
function yearToX(year: number): number {
  const clamped = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
  return ((clamped - YEAR_MIN) / YEAR_SPAN) * VB_WIDTH;
}

/**
 * Greedy row assignment — pack each holder onto the lowest row whose
 * occupied span doesn't overlap with this holder's [firstYear, lastYear].
 * Returns rows[i] = row index for holders[i].
 */
function packRows(holders: HolderCluster[]): number[] {
  const rowsEnd: number[] = []; // rowsEnd[r] = last occupied year on row r
  const assigned: number[] = [];
  for (const h of holders) {
    const first = h.years[0] ?? YEAR_MIN;
    const last = h.years[h.years.length - 1] ?? first;
    let placed = -1;
    for (let r = 0; r < rowsEnd.length; r++) {
      // +1 year breathing room so adjacent bands don't kiss
      const end = rowsEnd[r] ?? YEAR_MIN;
      if (end + 1 < first) {
        placed = r;
        rowsEnd[r] = last;
        break;
      }
    }
    if (placed === -1) {
      rowsEnd.push(last);
      placed = rowsEnd.length - 1;
    }
    assigned.push(placed);
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HoldersTimeline({
  holders,
  className,
  minLabelWidth = 90,
}: HoldersTimelineProps) {
  // Empty / unknown state — a single dim baseline with the morse divider.
  if (!holders || holders.length === 0) {
    return (
      <div
        className={className}
        style={{
          fontFamily: fontStacks.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          color: colors.text_dim,
          padding: "20px 4px",
          textAlign: "center",
        }}
      >
        {motifs.morseDividers.pattern}
        <div style={{ marginTop: 8, textTransform: "uppercase" }}>
          no holder history on file
        </div>
      </div>
    );
  }

  // Sort by first year so packing is deterministic.
  const sorted = [...holders].sort((a, b) => {
    const af = a.years[0] ?? YEAR_MAX;
    const bf = b.years[0] ?? YEAR_MAX;
    return af - bf;
  });
  const rows = packRows(sorted);
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  const vbHeight = TOP_PADDING + rowCount * ROW_HEIGHT + BOTTOM_PADDING;

  // Decade ticks: 1910, 1920, ..., 1990.
  const decadeTicks: number[] = [];
  for (let y = 1910; y <= 1990; y += 10) decadeTicks.push(y);

  return (
    <figure
      className={className}
      style={{
        margin: 0,
        padding: "12px 0",
        // soft amber rule at the top, like a printed timeline plate
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
      }}
      aria-label="Holders timeline, 1909 through 1997"
    >
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${vbHeight}`}
        preserveAspectRatio="none"
        width="100%"
        height={vbHeight}
        role="img"
        style={{ display: "block", overflow: "visible" }}
      >
        {/* baseline */}
        <line
          x1={0}
          x2={VB_WIDTH}
          y1={TOP_PADDING + rowCount * ROW_HEIGHT + 8}
          y2={TOP_PADDING + rowCount * ROW_HEIGHT + 8}
          stroke={colors.border}
          strokeWidth={1}
        />

        {/* decade tick marks + labels */}
        {decadeTicks.map((y) => {
          const tickX = yearToX(y);
          const tickY = TOP_PADDING + rowCount * ROW_HEIGHT + 8;
          return (
            <g key={y}>
              <line
                x1={tickX}
                x2={tickX}
                y1={tickY}
                y2={tickY + 5}
                stroke={colors.border}
                strokeWidth={1}
              />
              <text
                x={tickX}
                y={tickY + 20}
                textAnchor="middle"
                fontFamily={fontStacks.mono}
                fontSize={10}
                letterSpacing="0.08em"
                fill={colors.text_dim}
              >
                {y}
              </text>
            </g>
          );
        })}

        {/* endpoint anchors: 1909 + 1997 marked in amber */}
        {[YEAR_MIN, YEAR_MAX].map((y) => {
          const x = yearToX(y);
          const baseY = TOP_PADDING + rowCount * ROW_HEIGHT + 8;
          return (
            <text
              key={`anchor-${y}`}
              x={x}
              y={baseY + 36}
              textAnchor={y === YEAR_MIN ? "start" : "end"}
              fontFamily={fontStacks.mono}
              fontSize={9}
              letterSpacing="0.22em"
              fill={colors.accent_2}
              style={{ textTransform: "uppercase" }}
            >
              {y === YEAR_MIN ? "corpus start" : "corpus end"}
            </text>
          );
        })}

        {/* holder bands */}
        {sorted.map((h, i) => {
          const row = rows[i] ?? 0;
          const yTop = TOP_PADDING + row * ROW_HEIGHT;
          const yMid = yTop + ROW_HEIGHT / 2;
          const first = h.years[0] ?? YEAR_MIN;
          const last = h.years[h.years.length - 1] ?? first;
          const x1 = yearToX(first);
          const x2 = yearToX(last);
          const bandW = Math.max(6, x2 - x1);
          const singleYear = first === last;
          const fillId = `band-fill-${i}`;

          // Sparse-year dots — show each year of appearance as a deeper-amber tick.
          const dots = h.years.map((yr, idx) => (
            <circle
              key={`d-${i}-${idx}`}
              cx={yearToX(yr)}
              cy={yMid}
              r={2.5}
              fill={colors.glow}
              opacity={0.85}
            />
          ));

          const labelParts: string[] = [];
          if (h.name) labelParts.push(cleanOCRName(h.name).toUpperCase());
          const cleanCity = cleanOCRCity(h.city);
          const cleanState = cleanOCRState(h.city, h.state);
          const place = [cleanCity, cleanState].filter(Boolean).join(", ");
          if (place) labelParts.push(place);
          const label = labelParts.join("   ·   ");
          const yearLabel = singleYear ? `${first}` : `${first}–${last}`;

          return (
            <g key={`band-${i}`}>
              <defs>
                <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255,163,11,0.32)" />
                  <stop offset="100%" stopColor="rgba(255,163,11,0.10)" />
                </linearGradient>
              </defs>

              {/* the band itself */}
              {singleYear ? (
                <circle
                  cx={x1}
                  cy={yMid}
                  r={6}
                  fill={colors.accent}
                  opacity={0.85}
                  style={{
                    filter: "drop-shadow(0 0 6px rgba(255,209,102,0.55))",
                  }}
                />
              ) : (
                <rect
                  x={x1}
                  y={yTop + 6}
                  width={bandW}
                  height={ROW_HEIGHT - 12}
                  fill={`url(#${fillId})`}
                  stroke={colors.accent_2}
                  strokeWidth={1}
                  rx={1}
                  style={{
                    filter: "drop-shadow(0 0 4px rgba(255,163,11,0.20))",
                  }}
                />
              )}

              {dots}

              {/* in-band label if there's room, otherwise label rides above */}
              {bandW >= minLabelWidth ? (
                <text
                  x={x1 + 8}
                  y={yMid + 3}
                  fontFamily={fontStacks.mono}
                  fontSize={11}
                  letterSpacing="0.06em"
                  fill={colors.text}
                >
                  {label}
                  <tspan
                    dx={10}
                    fill={colors.text_dim}
                    fontSize={10}
                    letterSpacing="0.12em"
                  >
                    {yearLabel}
                  </tspan>
                </text>
              ) : (
                <text
                  x={x1 + (singleYear ? 10 : bandW + 6)}
                  y={yMid + 3}
                  fontFamily={fontStacks.mono}
                  fontSize={10.5}
                  letterSpacing="0.06em"
                  fill={colors.text}
                >
                  {label}
                  <tspan dx={8} fill={colors.text_dim} fontSize={9.5}>
                    {yearLabel}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <figcaption
        style={{
          marginTop: 10,
          paddingTop: 8,
          fontFamily: fontStacks.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          color: colors.text_dim,
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        Holders timeline — {sorted.length} distinct{" "}
        {sorted.length === 1 ? "operator" : "operators"} across {YEAR_MIN}–
        {YEAR_MAX}
      </figcaption>
    </figure>
  );
}
