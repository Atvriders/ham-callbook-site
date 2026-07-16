/**
 * <GrowthLine/> — entries-per-year line chart for the /stats page.
 *
 * Client component. Tries to dynamically import Recharts; if the
 * package isn't installed we render a hand-rolled SVG sparkline instead.
 * Either way the chart adheres to the Sodium Vapor palette (amber line
 * on midnight bg, JetBrains Mono axis labels, no purple, no scale-105).
 *
 * The fallback SVG is intentionally axis-light — just the line plus
 * year ticks at the wartime trough and the peak — so it still reads as
 * "the historical arc" rather than a generic loading placeholder.
 */

"use client";

import { useEffect, useState } from "react";
import { colors, fontStacks } from "../../lib/design";

interface YearPoint {
  year: number;
  count: number;
}

export function GrowthLine({ points }: { points: YearPoint[] }) {
  // Recharts is loaded lazily so it never enters the server bundle.
  // `Recharts === null` while we wait; `false` when the import failed
  // (package missing) and we should permanently use the fallback.
  const [Recharts, setRecharts] = useState<
    null | false | typeof import("recharts")
  >(null);

  useEffect(() => {
    let cancelled = false;
    import("recharts")
      .then((mod) => {
        if (!cancelled) setRecharts(mod);
      })
      .catch(() => {
        if (!cancelled) setRecharts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (points.length === 0) {
    return (
      <div
        style={{
          padding: "3rem 1rem",
          textAlign: "center",
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.85rem",
          border: `1px dashed ${colors.border}`,
          borderRadius: "0.25rem",
        }}
      >
        No per-year data available.
      </div>
    );
  }

  // Always render the SVG fallback first (SSR-safe). Recharts hydrates
  // over it once loaded — there's a brief flicker, but no layout shift
  // because both share the same outer 18rem-tall card.
  if (Recharts) {
    const {
      ResponsiveContainer,
      LineChart,
      Line,
      XAxis,
      YAxis,
      CartesianGrid,
      Tooltip,
    } = Recharts;
    return (
      <div
        style={{
          width: "100%",
          height: "20rem",
          padding: "1rem",
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          borderRadius: "0.25rem",
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
          >
            <CartesianGrid stroke={colors.border} strokeDasharray="2 4" />
            <XAxis
              dataKey="year"
              stroke={colors.text_dim}
              tick={{
                fill: colors.text_dim,
                fontFamily: fontStacks.mono,
                fontSize: 11,
              }}
            />
            <YAxis
              stroke={colors.text_dim}
              tick={{
                fill: colors.text_dim,
                fontFamily: fontStacks.mono,
                fontSize: 11,
              }}
              // Explicit auto domain: the y-scale tracks dataMax, so the
              // corrected 1999/2003 CD-ROM editions (~727K/731K vs the
              // ~300K print-era peak) stretch the axis instead of
              // clipping. Recharts picks nice ticks from this range.
              domain={[0, "auto"]}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={{
                background: colors.bg,
                border: `1px solid ${colors.accent}`,
                fontFamily: fontStacks.mono,
                fontSize: "0.8rem",
                color: colors.text,
              }}
              labelStyle={{ color: colors.accent }}
              cursor={{ stroke: colors.accent, strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={colors.accent}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: colors.glow }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return <FallbackSparkline points={points} />;
}

/**
 * Round a positive value up to a "nice" axis ceiling: half a step of its
 * decade (e.g. 731,000 → 750,000; 63,000 → 65,000; 284 → 300). Keeps the
 * fallback chart's y-domain tidy no matter how spiky the data gets.
 */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = pow / 2;
  return Math.ceil(v / step) * step;
}

/**
 * Hand-rolled SVG sparkline with year-tick marginalia. Used when
 * Recharts isn't available so the page still has a real chart.
 */
function FallbackSparkline({ points }: { points: YearPoint[] }) {
  const width = 1000;
  const height = 280;
  const padL = 48;
  const padR = 24;
  const padT = 16;
  const padB = 32;

  const xs = points.map((p) => p.year);
  const ys = points.map((p) => p.count);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  // Round the y-domain up to a "nice" ceiling (half a decade step) so the
  // 1999/2003 CD-ROM spike (~731K) reads against a 750k axis instead of a
  // raw 731k one, and the line never kisses the top padding edge.
  const yTop = niceCeil(yMax);

  const x = (year: number) =>
    padL + ((year - xMin) / (xMax - xMin || 1)) * (width - padL - padR);
  const y = (count: number) =>
    height - padB - (count / (yTop || 1)) * (height - padT - padB);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year).toFixed(1)} ${y(p.count).toFixed(1)}`)
    .join(" ");

  // Year ticks every 10 years across the displayed range.
  const tickStart = Math.ceil(xMin / 10) * 10;
  const xTicks: number[] = [];
  for (let t = tickStart; t <= xMax; t += 10) xTicks.push(t);

  return (
    <div
      style={{
        width: "100%",
        padding: "1rem",
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        borderRadius: "0.25rem",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="20rem"
        role="img"
        aria-label="Entries per year, line chart"
      >
        {/* y-axis baseline */}
        <line
          x1={padL}
          y1={height - padB}
          x2={width - padR}
          y2={height - padB}
          stroke={colors.border}
          strokeWidth={1}
        />
        {/* the line itself */}
        <path
          d={path}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* x-axis decade ticks */}
        {xTicks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              y1={height - padB}
              x2={x(t)}
              y2={height - padB + 4}
              stroke={colors.text_dim}
            />
            <text
              x={x(t)}
              y={height - padB + 18}
              textAnchor="middle"
              fontSize={11}
              fontFamily={fontStacks.mono}
              fill={colors.text_dim}
            >
              {t}
            </text>
          </g>
        ))}
        {/* y-axis label */}
        <text
          x={padL - 8}
          y={padT + 10}
          textAnchor="end"
          fontSize={11}
          fontFamily={fontStacks.mono}
          fill={colors.text_dim}
        >
          {yTop >= 1000 ? `${Math.round(yTop / 1000)}k` : String(yTop)}
        </text>
      </svg>
    </div>
  );
}
