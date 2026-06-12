"use client";

/**
 * DiffTimeline — client component for edition diff sparkline.
 *
 * Renders an ASCII-style sparkline bar chart of net churn per pair using
 * the Sodium Vapor oscilloscope motif. No Recharts dependency.
 */

import { colors, fontStacks } from "../../lib/design";

interface TimelinePoint {
  year_a: number;
  year_b: number;
  edition_a: string;
  edition_b: string;
  total_a: number | null;
  total_b: number | null;
  adds: number | null;
  drops: number | null;
  retained: number | null;
  net: number | null;
  retention_pct: number | null;
  address_changes: number | null;
  class_upgrades: number | null;
}

const SPARKLINE_CHARS = "▁▂▃▄▅▆▇█";

function toSparkChar(value: number, max: number): string {
  if (max === 0) return SPARKLINE_CHARS[0] ?? "▁";
  const idx = Math.round(((value / max) * (SPARKLINE_CHARS.length - 1)));
  const clamped = Math.max(0, Math.min(SPARKLINE_CHARS.length - 1, idx));
  return SPARKLINE_CHARS[clamped] ?? "▁";
}

export default function DiffTimeline({ timeline }: { timeline: TimelinePoint[] }) {
  if (timeline.length === 0) return null;

  const maxAdds = Math.max(...timeline.map((p) => p.adds ?? 0));
  const maxDrops = Math.max(...timeline.map((p) => p.drops ?? 0));

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: "6px",
        padding: "1.25rem 1.5rem",
        marginBottom: "2rem",
        overflowX: "auto",
      }}
    >
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          color: colors.text_dim,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: "1rem",
        }}
      >
        Adds / Drops oscilloscope · {timeline.length} edition pairs
      </div>

      {/* Adds row */}
      <div style={{ marginBottom: "0.5rem" }}>
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            color: colors.success,
            marginRight: "0.5rem",
            display: "inline-block",
            width: "3rem",
          }}
        >
          adds
        </span>
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            color: colors.success,
            letterSpacing: "0.05em",
          }}
        >
          {timeline.map((p) => toSparkChar(p.adds ?? 0, maxAdds)).join("")}
        </span>
      </div>

      {/* Drops row */}
      <div>
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            color: colors.danger,
            marginRight: "0.5rem",
            display: "inline-block",
            width: "3rem",
          }}
        >
          drops
        </span>
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            color: colors.danger,
            letterSpacing: "0.05em",
          }}
        >
          {timeline.map((p) => toSparkChar(p.drops ?? 0, maxDrops)).join("")}
        </span>
      </div>

      {/* Year tick marks — show every 10 years approximately */}
      <div
        style={{
          marginTop: "0.5rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          color: colors.text_dim,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap" as const,
        }}
      >
        {timeline.map((p, i) => {
          const showTick = i === 0 || p.year_b % 10 === 0;
          return showTick ? (
            <span key={i} style={{ marginRight: "0.1em" }}>
              {p.year_b}
            </span>
          ) : (
            <span key={i} style={{ marginRight: "0.1em" }}>
              {" "}
            </span>
          );
        })}
      </div>
    </div>
  );
}
