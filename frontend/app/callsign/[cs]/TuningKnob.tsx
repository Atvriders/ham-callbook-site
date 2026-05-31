"use client";

/**
 * TuningKnob — decorative vacuum-tube-radio dial drawn as inline SVG and
 * gently rotated by Motion. Placed at the page edges to frame the hero
 * the way a tube-radio's bakelite face plate frames its display.
 *
 * Variants
 *   - "knob"   : a chunky dial with knurled rim + amber pointer.
 *   - "meter"  : a quarter-arc dB meter with a swinging needle.
 *
 * The knob silently slow-spins between -8° and +8°, the meter needle
 * sweeps from 15% to 85% deflection. Both motions are easeInOut + reverse
 * so they read as "alive but unhurried" — the tube radio is warm but
 * idle, not actively tuning.
 */

import { motion } from "framer-motion";

import { colors } from "../../../lib/design";

interface TuningKnobProps {
  variant?: "knob" | "meter";
  size?: number;
  /** ms per oscillation half-cycle */
  pulseMs?: number;
}

export default function TuningKnob({
  variant = "knob",
  size = 96,
  pulseMs = 5200,
}: TuningKnobProps) {
  if (variant === "meter") {
    return (
      <svg
        aria-hidden
        width={size}
        height={size * 0.62}
        viewBox="0 0 100 62"
        style={{ display: "block", opacity: 0.65 }}
      >
        {/* Bezel */}
        <rect
          x={1}
          y={1}
          width={98}
          height={60}
          rx={4}
          fill={colors.surface}
          stroke={colors.border}
        />
        {/* Arc */}
        <path
          d="M 12 54 A 38 38 0 0 1 88 54"
          stroke={colors.border}
          strokeWidth={1}
          fill="none"
        />
        {/* Tick marks */}
        {Array.from({ length: 11 }).map((_, i) => {
          const a = (i / 10) * Math.PI;
          const r1 = 36;
          const r2 = i % 5 === 0 ? 30 : 33;
          const cx = 50;
          const cy = 54;
          const x1 = cx - Math.cos(a) * r1;
          const y1 = cy - Math.sin(a) * r1;
          const x2 = cx - Math.cos(a) * r2;
          const y2 = cy - Math.sin(a) * r2;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={i % 5 === 0 ? colors.accent : colors.text_dim}
              strokeWidth={i % 5 === 0 ? 1 : 0.5}
              opacity={0.7}
            />
          );
        })}
        {/* Needle */}
        <motion.line
          x1={50}
          y1={54}
          x2={50}
          y2={20}
          stroke={colors.accent}
          strokeWidth={1.2}
          strokeLinecap="round"
          style={{ transformOrigin: "50px 54px", filter: "drop-shadow(0 0 2px rgba(255,163,11,0.7))" }}
          animate={{ rotate: [-58, 58] }}
          transition={{
            duration: pulseMs / 1000,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut",
          }}
        />
        {/* Hub */}
        <circle cx={50} cy={54} r={2.5} fill={colors.accent} />
        {/* Label */}
        <text
          x={50}
          y={12}
          textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={5}
          letterSpacing={1.2}
          fill={colors.text_dim}
        >
          S-METER
        </text>
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: "block", opacity: 0.7 }}
    >
      {/* Outer ring */}
      <circle
        cx={50}
        cy={50}
        r={46}
        fill="none"
        stroke={colors.border}
        strokeWidth={1}
      />
      {/* Knurled rim ticks */}
      {Array.from({ length: 36 }).map((_, i) => {
        const a = (i / 36) * Math.PI * 2;
        const r1 = 46;
        const r2 = 42;
        return (
          <line
            key={i}
            x1={50 + Math.cos(a) * r1}
            y1={50 + Math.sin(a) * r1}
            x2={50 + Math.cos(a) * r2}
            y2={50 + Math.sin(a) * r2}
            stroke={colors.text_dim}
            strokeWidth={0.6}
            opacity={0.55}
          />
        );
      })}
      {/* Inner cap */}
      <motion.g
        style={{ transformOrigin: "50px 50px" }}
        animate={{ rotate: [-8, 8] }}
        transition={{
          duration: pulseMs / 1000,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
        }}
      >
        <circle
          cx={50}
          cy={50}
          r={32}
          fill={colors.surface}
          stroke={colors.accent_2}
          strokeWidth={0.8}
        />
        {/* Pointer dot */}
        <circle
          cx={50}
          cy={26}
          r={3}
          fill={colors.accent}
          style={{ filter: "drop-shadow(0 0 3px rgba(255,209,102,0.8))" }}
        />
        {/* Grip line */}
        <line
          x1={50}
          y1={28}
          x2={50}
          y2={48}
          stroke={colors.accent}
          strokeWidth={1.2}
          opacity={0.55}
        />
      </motion.g>
      {/* Center hub */}
      <circle cx={50} cy={50} r={2} fill={colors.text_dim} />
    </svg>
  );
}
