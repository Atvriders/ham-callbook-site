/**
 * <SectionReveal/> — thin client-side wrapper that fades + lifts a
 * section into view via Motion's `whileInView`. Used by the /stats page
 * to stagger the growth chart, USMap, era cards, and integrity dials
 * as the visitor scrolls down the page.
 *
 * Kept generic so we can reuse it for any future stats sub-section
 * without re-implementing the IntersectionObserver dance.
 */

"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

export function SectionReveal({
  children,
  delay = 0,
  y = 20,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        duration: 0.65,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
