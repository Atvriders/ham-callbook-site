"use client";

/**
 * TwrIndicator — animated TWR (transmit/receive) status dot.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Implements ``motifs.twrIndicator``: a small accent-filled disc with
 *     a soft sodium-amber halo that breathes on a 1.2s heartbeat cycle.
 *     Reads as "live, listening on the air".
 *   - The heartbeat is *not* a simple sine breath — it uses a two-beat
 *     keyframe (lub-dub) so it feels organic next to the otherwise rigid
 *     editorial typography. The outer halo expands further than the
 *     inner pellet, giving a CRT-phosphor decay impression.
 *   - Driven by Motion (``motion/react``) — already in package.json.
 *   - Three states: ``live`` (default, pulsing amber), ``idle`` (dim
 *     accent_2, flat), and ``error`` (danger colour, flat, slightly
 *     larger to draw the eye).
 *   - Includes an off-screen text label so SR users hear
 *     "Search service: live".
 *   - Respects ``prefers-reduced-motion`` via ``useReducedMotion``.
 */

import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { colors, motifs } from "@/lib/design";

export interface TwrIndicatorProps {
  /** Lifecycle state of the search service. Defaults "live". */
  state?: "live" | "idle" | "error";
  /** Override the dot diameter in pixels. Defaults from design tokens. */
  size?: number;
  /** Accessible label for SR users. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export default function TwrIndicator({
  state = "live",
  size = motifs.twrIndicator.sizePx,
  label,
  className,
  style,
}: TwrIndicatorProps) {
  const reduced = useReducedMotion();

  const palette: Record<typeof state, string> = {
    live: colors.accent,
    idle: colors.accent_2,
    error: colors.danger,
  } as const;

  const dotColor = palette[state];
  const haloColor =
    state === "live" ? colors.glow : state === "error" ? colors.danger : dotColor;

  const srLabel =
    label ??
    (state === "live"
      ? "Search service: live"
      : state === "idle"
        ? "Search service: idle"
        : "Search service: error");

  // 1.2s heartbeat — two-beat (lub-dub) timing so it doesn't read as a
  // sine wave breath. Each keyframe array shares a length so Motion
  // interpolates cleanly across them.
  const animate =
    state === "live" && !reduced
      ? {
          opacity: [0.55, 1, 0.78, 1, 0.55] as number[],
          scale: [0.9, 1.18, 0.96, 1.12, 0.9] as number[],
        }
      : { opacity: 1, scale: 1 };

  // Halo expands further than the pellet & decays — phosphor afterglow.
  const haloAnimate =
    state === "live" && !reduced
      ? {
          opacity: [0.0, 0.55, 0.15, 0.4, 0.0] as number[],
          scale: [1, 2.4, 1.4, 2.2, 1] as number[],
        }
      : { opacity: 0, scale: 1 };

  const transition =
    state === "live" && !reduced
      ? {
          duration: 1.2, // 1.2s heartbeat per spec
          repeat: Infinity,
          ease: "easeInOut" as const,
          times: [0, 0.18, 0.4, 0.6, 1],
        }
      : { duration: 0 };

  return (
    <span
      role="status"
      aria-live="polite"
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size * 2.6,
        height: size * 2.6,
        ...style,
      }}
    >
      {/* Outer phosphor halo — decays + re-blooms on the dub-beat */}
      <motion.span
        aria-hidden="true"
        animate={haloAnimate}
        transition={transition}
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle at center, ${haloColor} 0%, ${haloColor}00 70%)`,
          filter: "blur(1px)",
        }}
      />
      {/* Inner pellet — the actual TWR dot */}
      <motion.span
        aria-hidden="true"
        animate={animate}
        transition={transition}
        style={{
          position: "relative",
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          background: dotColor,
          boxShadow:
            state === "live"
              ? `0 0 8px ${colors.glow}, 0 0 2px ${dotColor}`
              : state === "error"
                ? `0 0 6px ${colors.danger}`
                : "none",
        }}
      />
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {srLabel}
      </span>
    </span>
  );
}
