"use client";

/**
 * HeroCallsign — character-by-character reveal of the hero callsign with
 * amber phosphor halo behind each glyph and a CSS-masked floor reflection
 * beneath the row. The component is intentionally self-contained so the
 * surrounding page can remain a server component; only this island ships
 * the Motion runtime to the client.
 *
 * Design notes
 *   - Each character is its own <motion.span>, staggered ~55ms apart.
 *   - Per-character backdrop glow is a separately rendered absolutely-
 *     positioned blurred amber disc, so the glow fades up under the
 *     character without inflating the type's bounding box.
 *   - The floor reflection is a duplicate run of the same text with
 *     scaleY(-1) and a linear-gradient mask fading to transparent, so it
 *     reads like the callsign is sitting on a polished radio chassis.
 */

import { motion } from "framer-motion";

import { colors, fontStacks } from "../../../lib/design";

interface HeroCallsignProps {
  callsign: string;
}

const STAGGER_S = 0.055;
const ENTER_DURATION_S = 0.6;

export default function HeroCallsign({ callsign }: HeroCallsignProps) {
  const chars = callsign.split("");

  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        // Reserve room below for the reflection so the rest of the page
        // layout doesn't jump when the mask renders.
        paddingBottom: "clamp(2rem, 6vw, 5rem)",
        // Constrain so very long calls don't blow past the viewport.
        maxWidth: "100%",
      }}
    >
      {/* The visible row */}
      <h1
        style={{
          margin: 0,
          fontFamily: fontStacks.mono,
          fontWeight: 700,
          fontSize: "clamp(4rem, 14vw, 11rem)",
          lineHeight: 0.9,
          letterSpacing: "-0.02em",
          color: colors.glow,
          display: "flex",
          alignItems: "baseline",
          gap: "0.02em",
          position: "relative",
          zIndex: 2,
          textShadow:
            "0 0 24px rgba(255,209,102,0.55), 0 0 4px rgba(255,163,11,0.85), 0 0 1px rgba(255,255,255,0.6)",
        }}
        aria-label={callsign}
      >
        {chars.map((ch, i) => (
          <span
            key={`${ch}-${i}`}
            style={{
              position: "relative",
              display: "inline-block",
            }}
          >
            {/* Per-character halo — fades up *behind* the glyph */}
            <motion.span
              aria-hidden
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 0.85, scale: 1 }}
              transition={{
                delay: 0.25 + i * STAGGER_S,
                duration: 0.8,
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                inset: "-20% -10%",
                background:
                  "radial-gradient(circle at 50% 55%, rgba(255,209,102,0.7) 0%, rgba(255,163,11,0.35) 38%, rgba(255,163,11,0) 70%)",
                filter: "blur(14px)",
                pointerEvents: "none",
                zIndex: -1,
              }}
            />
            {/* The glyph itself */}
            <motion.span
              initial={{ opacity: 0, y: "0.25em" }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * STAGGER_S,
                duration: ENTER_DURATION_S,
                ease: [0.22, 1, 0.36, 1],
              }}
              style={{
                display: "inline-block",
              }}
            >
              {ch}
            </motion.span>
          </span>
        ))}
      </h1>

      {/* Floor reflection — same text, flipped, faded via mask. */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.32 }}
        transition={{ delay: 0.4 + chars.length * STAGGER_S, duration: 0.9 }}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "100%",
          marginTop: "-1.5rem",
          fontFamily: fontStacks.mono,
          fontWeight: 700,
          fontSize: "clamp(4rem, 14vw, 11rem)",
          lineHeight: 0.9,
          letterSpacing: "-0.02em",
          color: colors.glow,
          transform: "scaleY(-1)",
          transformOrigin: "top",
          filter: "blur(1.5px)",
          pointerEvents: "none",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 75%)",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 75%)",
          textShadow:
            "0 0 24px rgba(255,209,102,0.35), 0 0 4px rgba(255,163,11,0.55)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {callsign}
      </motion.div>
    </div>
  );
}
