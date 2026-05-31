"use client";

/**
 * GrainBackground — SVG fractal-noise overlay for paper-warmth.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Implements the locked ``motifs.grain`` motif: a fixed-position,
 *     pointer-events-none layer with very low-opacity SVG turbulence
 *     noise. Adds the perceptual warmth of a printed page without
 *     loading a raster texture asset.
 *   - The noise is generated inline via ``<feTurbulence>`` so there are
 *     zero network roundtrips, no PNG payload, and the colour blends
 *     cleanly with the sodium-vapor palette.
 *   - Defaults to ``position: fixed`` so it persists through scroll —
 *     pass ``position="absolute"`` to scope it to a single section
 *     (e.g. a hero card).
 */

import type { CSSProperties } from "react";
import { motifs } from "@/lib/design";

export interface GrainBackgroundProps {
  /** 0-1 opacity, defaults to ``motifs.grain.opacity`` (0.06). */
  opacity?: number;
  /** SVG turbulence ``baseFrequency``. Higher = finer grain. */
  baseFrequency?: number;
  /** ``fixed`` (default) or ``absolute``. */
  position?: "fixed" | "absolute";
  /** z-index. Defaults 0 so it sits above the page bg but below content. */
  zIndex?: number;
  /** Optional className passthrough. */
  className?: string;
  style?: CSSProperties;
}

export default function GrainBackground({
  opacity = motifs.grain.opacity,
  baseFrequency = motifs.grain.baseFrequency,
  position = "fixed",
  zIndex = 0,
  className,
  style,
}: GrainBackgroundProps) {
  // Inline SVG with feTurbulence — encoded as data URL so React can use it
  // as a CSS background and skip a separate render tree.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
    <filter id='n'>
      <feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='2' stitchTiles='stitch'/>
      <feColorMatrix type='saturate' values='0'/>
    </filter>
    <rect width='100%' height='100%' filter='url(%23n)' opacity='1'/>
  </svg>`;

  const encoded = encodeURIComponent(svg).replace(/'/g, "%27");

  const merged: CSSProperties = {
    position,
    inset: 0,
    pointerEvents: "none",
    zIndex,
    opacity,
    backgroundImage: `url("data:image/svg+xml;utf8,${encoded}")`,
    backgroundSize: "200px 200px",
    backgroundRepeat: "repeat",
    mixBlendMode: "soft-light",
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
