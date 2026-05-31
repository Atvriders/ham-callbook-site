"use client";

/**
 * ScanlineOverlay — faint horizontal CRT scanlines for hero sections.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Implements the locked ``motifs.scanlines`` motif: low-opacity
 *     horizontal rules at 3px spacing, blend-mode overlay so they tint
 *     amber on warm content and shadow on cool content.
 *   - HERO/LANDING ONLY. The motif description in lib/design.ts is
 *     explicit: "never inside data tables." Components like DataTable
 *     and Facets must not embed this overlay.
 *   - Pure CSS — a single ``repeating-linear-gradient`` plus
 *     ``mix-blend-mode: overlay``. No JavaScript, no animation, so it
 *     plays nicely with SSR and reduces motion concerns.
 *   - Default ``pointer-events: none`` so it never blocks clicks on the
 *     underlying hero copy.
 */

import type { CSSProperties } from "react";
import { motifs } from "@/lib/design";

export interface ScanlineOverlayProps {
  /** Override the design-token opacity (0-1). */
  opacity?: number;
  /** Override the inter-line spacing in pixels. */
  spacingPx?: number;
  /** Override the line colour. Defaults to a tuned amber-tinted black. */
  lineColor?: string;
  /** When ``absolute`` (default) the overlay fills its positioned parent.
   *  When ``fixed`` it covers the viewport — use sparingly. */
  position?: "absolute" | "fixed";
  /** Extra z-index. Defaults 1 so it sits above static hero art. */
  zIndex?: number;
  className?: string;
  style?: CSSProperties;
}

export default function ScanlineOverlay({
  opacity = motifs.scanlines.opacity,
  spacingPx = motifs.scanlines.spacingPx,
  lineColor = "rgba(10, 14, 26, 0.75)",
  position = "absolute",
  zIndex = 1,
  className,
  style,
}: ScanlineOverlayProps) {
  const merged: CSSProperties = {
    position,
    inset: 0,
    pointerEvents: "none",
    zIndex,
    opacity,
    mixBlendMode: "overlay",
    backgroundImage: `repeating-linear-gradient(
      to bottom,
      ${lineColor} 0px,
      ${lineColor} 1px,
      transparent 1px,
      transparent ${spacingPx}px
    )`,
    ...style,
  };

  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={className}
      style={merged}
    />
  );
}
