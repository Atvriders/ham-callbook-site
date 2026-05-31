"use client";

/**
 * Reveal — tiny client island that fades + slides a server-rendered
 * children tree up into place on mount. We use this to apply the
 * page's staggered entrance choreography without forcing entire
 * subtrees to become client components.
 *
 * Pass `delay` (seconds) to time a section against its siblings.
 */

import { motion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  delay?: number;
  /** Distance to translate from (px). Defaults to 14. */
  y?: number;
  /** Optional inline style to forward to the wrapper. */
  style?: CSSProperties;
}

export default function Reveal({
  children,
  delay = 0,
  y = 14,
  style,
}: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={style}
    >
      {children}
    </motion.div>
  );
}
