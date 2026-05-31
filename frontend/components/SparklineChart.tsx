"use client";

/**
 * SparklineChart — tiny inline trendline, used in stat cards and table
 * cells (e.g. "operators per year, 1909-1997"). Recharts wrapper so the
 * site uses one charting library across sparklines and full line charts.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - A sparkline is a typographic-density object — it should feel like
 *     a word in a sentence, not a chart in a card. So: no axes, no grid,
 *     no tooltips, no labels. Just a 1.5px amber line on a transparent
 *     background, with a tiny glow dot anchoring the latest point.
 *   - Recharts' ``ResponsiveContainer`` lets the sparkline grow to its
 *     parent. The parent is expected to fix a height (default 24px) and
 *     either a width or rely on the flex/grid context for sizing.
 *   - When data is empty, renders a 1px dim baseline so the layout
 *     doesn't reflow when sparklines load asynchronously.
 */

import {
  Line,
  LineChart,
  ResponsiveContainer,
  YAxis,
  Tooltip as RechartsTooltip,
} from "recharts";
import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SparklineDatum {
  /** X-axis label, e.g. a year. */
  x: number | string;
  /** Y value. */
  y: number;
}

export interface SparklineChartProps {
  /** Series data, oldest → newest. */
  data: SparklineDatum[];
  /** Pixel height of the sparkline. Defaults to 24. */
  height?: number;
  /** Show a tiny dot on the last point. Defaults to true. */
  showLastPoint?: boolean;
  /** Stroke color override. Defaults to sodium amber. */
  stroke?: string;
  /** Optional tooltip rendering (off by default — sparklines are silent). */
  showTooltip?: boolean;
  /** Optional aria-label for screen readers. */
  ariaLabel?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Tooltip (only used when showTooltip is true)
// ---------------------------------------------------------------------------

interface TooltipPayloadEntry {
  payload?: SparklineDatum;
}

function SparkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.accent_2}`,
        padding: "4px 8px",
        fontFamily: fontStacks.mono,
        fontSize: 10,
        letterSpacing: "0.12em",
        color: colors.text,
      }}
    >
      <span style={{ color: colors.text_dim }}>{String(datum.x)}</span>
      <span style={{ marginLeft: 8, color: colors.accent }}>
        {datum.y.toLocaleString("en-US")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SparklineChart({
  data,
  height = 24,
  showLastPoint = true,
  stroke,
  showTooltip = false,
  ariaLabel,
  className,
}: SparklineChartProps) {
  const lineColor = stroke ?? colors.accent;

  if (!data || data.length === 0) {
    // Empty-state baseline — keeps row heights stable while data loads.
    return (
      <div
        className={className}
        aria-label={ariaLabel ?? "sparkline (no data)"}
        style={{
          height,
          width: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            height: 1,
            width: "100%",
            background: colors.border,
          }}
        />
      </div>
    );
  }

  const lastIndex = data.length - 1;

  return (
    <div
      className={className}
      aria-label={ariaLabel ?? "sparkline"}
      style={{ width: "100%", height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          {/* Padded YAxis (hidden) so the line doesn't kiss the top/bottom edges */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          {showTooltip && (
            <RechartsTooltip
              cursor={{ stroke: colors.accent_2, strokeWidth: 1 }}
              content={<SparkTooltip />}
            />
          )}
          <Line
            type="monotone"
            dataKey="y"
            stroke={lineColor}
            strokeWidth={1.5}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              if (!showLastPoint || props.index !== lastIndex) {
                // Recharts requires a real SVG element (or false). Hidden circle.
                return (
                  <circle
                    key={`d-${props.index}`}
                    cx={props.cx ?? 0}
                    cy={props.cy ?? 0}
                    r={0}
                    fill="transparent"
                  />
                );
              }
              return (
                <circle
                  key={`d-${props.index}`}
                  cx={props.cx ?? 0}
                  cy={props.cy ?? 0}
                  r={2.2}
                  fill={colors.glow}
                  stroke={lineColor}
                  strokeWidth={1}
                  style={{
                    filter: "drop-shadow(0 0 4px rgba(255,209,102,0.7))",
                  }}
                />
              );
            }}
            activeDot={{
              r: 3,
              fill: colors.glow,
              stroke: lineColor,
              strokeWidth: 1,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {/* Decorative motif tag — exposed via aria-hidden style, helps
          debugging tools confirm the sodium-vapor styling pass. */}
      <span aria-hidden="true" hidden data-motif={motifs.oscilloscope.label} />
    </div>
  );
}
