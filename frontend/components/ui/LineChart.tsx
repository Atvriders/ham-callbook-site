"use client";

/**
 * LineChart — full-size line chart wrapper around Recharts, styled with
 * the Sodium Vapor palette and the site's typographic stack.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Amber line on a midnight surface; faint dim-blue grid; sodium-amber
 *     dot on hover. The chart should feel like a CRT scope readout, not a
 *     SaaS dashboard.
 *   - Ticks rendered in Geist Sans (body) at small sizes; axis labels and
 *     the chart title in Fraunces with optical-sizing dialed up for drama.
 *   - One series at a time — multi-line charts are not part of the design
 *     contract for this surface. Use a stacked layout of charts instead.
 *   - Tooltip is a small mono-spaced placard echoing the SparklineChart's
 *     hover popover, so sparkline → expanded-chart feels continuous.
 */

import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LineChartDatum {
  /** X value — typically a year integer or a string period label. */
  x: number | string;
  /** Y value. */
  y: number;
}

export interface LineChartProps {
  /** Series, oldest → newest. */
  data: LineChartDatum[];
  /** Optional chart title, rendered in Fraunces above the plot area. */
  title?: string;
  /** Optional eyebrow label above the title (mono, dim). */
  eyebrow?: string;
  /** Y-axis label, rendered rotated on the left. */
  yLabel?: string;
  /** X-axis label, rendered centred below the axis. */
  xLabel?: string;
  /** Pixel height for the chart body (excluding title). Defaults to 240. */
  height?: number;
  /** Stroke color override. Defaults to sodium amber. */
  stroke?: string;
  /** Optional className passthrough on the outer wrapper. */
  className?: string;
  /** Optional accessibility label. */
  ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipPayloadEntry {
  payload?: LineChartDatum;
  value?: number;
}

function LineTooltip({
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
        padding: "6px 10px",
        fontFamily: fontStacks.mono,
        fontSize: 11,
        letterSpacing: "0.12em",
        color: colors.text,
        boxShadow: "0 0 12px rgba(255,163,11,0.10)",
      }}
    >
      <div style={{ color: colors.text_dim, marginBottom: 2 }}>
        {String(datum.x)}
      </div>
      <div style={{ color: colors.accent }}>
        {datum.y.toLocaleString("en-US")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TICK_STYLE = {
  fill: colors.text_dim,
  fontSize: 10,
  fontFamily: fontStacks.body,
  letterSpacing: "0.02em",
};

const AXIS_LABEL_STYLE = {
  fill: colors.text_dim,
  fontSize: 10,
  fontFamily: fontStacks.mono,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
};

export default function LineChart({
  data,
  title,
  eyebrow,
  yLabel,
  xLabel,
  height = 240,
  stroke,
  className,
  ariaLabel,
}: LineChartProps) {
  const lineColor = stroke ?? colors.accent;

  return (
    <div
      className={className}
      aria-label={ariaLabel ?? title ?? "line chart"}
      style={{ width: "100%" }}
    >
      {(eyebrow || title) && (
        <div style={{ marginBottom: 10 }}>
          {eyebrow && (
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: 10,
                letterSpacing: "0.24em",
                color: colors.text_dim,
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              {eyebrow}
            </div>
          )}
          {title && (
            <h3
              style={{
                margin: 0,
                fontFamily: fontStacks.display,
                fontVariationSettings: '"opsz" 72, "SOFT" 30',
                fontWeight: 500,
                fontSize: 22,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
                color: colors.text,
              }}
            >
              {title}
            </h3>
          )}
        </div>
      )}

      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart
            data={data}
            margin={{
              top: 8,
              right: 16,
              bottom: xLabel ? 28 : 12,
              left: yLabel ? 28 : 8,
            }}
          >
            <CartesianGrid
              stroke={colors.border}
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="x"
              stroke={colors.border}
              tick={TICK_STYLE}
              tickLine={{ stroke: colors.border }}
              axisLine={{ stroke: colors.border }}
              label={
                xLabel
                  ? {
                      value: xLabel,
                      position: "insideBottom",
                      offset: -16,
                      style: AXIS_LABEL_STYLE,
                    }
                  : undefined
              }
            />
            <YAxis
              stroke={colors.border}
              tick={TICK_STYLE}
              tickLine={{ stroke: colors.border }}
              axisLine={{ stroke: colors.border }}
              width={48}
              label={
                yLabel
                  ? {
                      value: yLabel,
                      angle: -90,
                      position: "insideLeft",
                      offset: 12,
                      style: AXIS_LABEL_STYLE,
                    }
                  : undefined
              }
            />
            <RechartsTooltip
              cursor={{ stroke: colors.accent_2, strokeWidth: 1 }}
              content={<LineTooltip />}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke={lineColor}
              strokeWidth={1.75}
              dot={false}
              activeDot={{
                r: 3.5,
                fill: colors.glow,
                stroke: lineColor,
                strokeWidth: 1,
                style: {
                  filter: "drop-shadow(0 0 6px rgba(255,209,102,0.7))",
                },
              }}
              isAnimationActive={false}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>

      {/* decorative motif tag for debugging tooling */}
      <span aria-hidden="true" hidden data-motif={motifs.oscilloscope.label} />
    </div>
  );
}
