/**
 * <Headline/> — the eleven-rem, opsz-144 corpus tally with a Motion
 * count-up. Client component so we can drive the tween from `useMotionValue`
 * + `animate`. The digits stay in JetBrains Mono-flavoured Fraunces glyphs
 * to keep the odometer feel without losing the variable-axis drama.
 *
 * Aesthetic guardrails: amber #ffa30b digits, sodium-glow halo, NO purple,
 * NO Inter, NO hover:scale-105. All hex colors come from `lib/design.ts`.
 *
 * The animation runs once on mount with a 1.6s ease-out curve so the
 * digits tick up from zero — long enough to read as "we counted these"
 * rather than instantaneous, short enough that scroll-by visitors still
 * see the final value.
 */

"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { colors, fontStacks, motifs } from "../../lib/design";

/**
 * Compact-format an integer to the "7.74M" / "740K" form used on the hero.
 * Mirrors the server-side helper in `page.tsx` so the SSR snapshot and the
 * post-hydration ticker render identical glyph shapes (no layout shift).
 */
function compactBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function Headline({ total, label }: { total: number; label: string }) {
  // Driven motion value — we tween it from 0 → total and project through
  // the compact formatter for display.
  const counter = useMotionValue(0);
  const display = useTransform(counter, (v) => compactBig(v));

  useEffect(() => {
    const controls = animate(counter, total, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [counter, total]);

  return (
    <motion.h1
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      style={{
        fontFamily: fontStacks.display,
        fontSize: "clamp(4rem, 14vw, 11rem)",
        fontWeight: 600,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        lineHeight: 0.88,
        letterSpacing: "-0.035em",
        margin: 0,
        color: colors.text,
        textShadow: motifs.glow.textShadow,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "0.25em",
      }}
    >
      <motion.span
        style={{
          color: colors.accent,
          // tabular numerics so the ticker doesn't jitter glyph widths
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum"',
          display: "inline-block",
          minWidth: "5.5ch",
        }}
      >
        {display}
      </motion.span>
      <span
        style={{
          fontSize: "0.42em",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontWeight: 400,
          textShadow: "none",
        }}
      >
        {label}
      </span>
    </motion.h1>
  );
}
