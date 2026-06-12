/**
 * MedalPip — small inline rank indicator.
 * Ranks 1/2/3 get amber/silver/bronze styling; rest show rank number in dim.
 */

import { colors, fontStacks } from "../../lib/design";

interface MedalPipProps {
  rank: number;
}

export function MedalPip({ rank }: MedalPipProps) {
  const label = rank === 1 ? "①" : rank === 2 ? "②" : rank === 3 ? "③" : String(rank);
  const color =
    rank === 1
      ? colors.accent
      : rank === 2
        ? "#c0c0c0"
        : rank === 3
          ? "#cd7f32"
          : colors.text_dim;
  const glow =
    rank === 1
      ? "0 0 8px rgba(255,163,11,0.55)"
      : "none";

  return (
    <span
      style={{
        fontFamily: fontStacks.mono,
        fontSize: "0.75rem",
        color,
        textShadow: glow,
        minWidth: "2rem",
        display: "inline-block",
        fontVariantNumeric: "tabular-nums",
      }}
      aria-label={`Rank ${rank}`}
    >
      {label}
    </span>
  );
}
