"use client";

/**
 * TuningIndicator — small "TUNING" pip for the CRT activity panel. A
 * pulsing amber LED beside a fixed mono caption, paired with a thin
 * progress bar that sweeps as if the receiver is locking onto a signal.
 */

import { motion } from "framer-motion";

import { colors, fontStacks } from "../../../lib/design";

export default function TuningIndicator({ label = "TUNING" }: { label?: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.25rem 0.6rem",
        border: `1px solid rgba(93, 211, 168, 0.4)`,
        borderRadius: "0.125rem",
        background: "rgba(0, 25, 14, 0.45)",
        fontFamily: fontStacks.mono,
        fontSize: "0.625rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        color: "rgb(93, 211, 168)",
        textShadow: "0 0 6px rgba(93,211,168,0.7)",
      }}
    >
      <motion.span
        aria-hidden
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: "rgb(93, 211, 168)",
          boxShadow: "0 0 8px rgba(93,211,168,0.85)",
        }}
      />
      {label}
      <span
        aria-hidden
        style={{
          position: "relative",
          width: 36,
          height: 2,
          background: "rgba(93,211,168,0.18)",
          overflow: "hidden",
          borderRadius: 2,
        }}
      >
        <motion.span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "40%",
            background: "rgb(93, 211, 168)",
            boxShadow: "0 0 6px rgba(93,211,168,0.85)",
          }}
          animate={{ x: ["-100%", "240%"] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
    </div>
  );
}
