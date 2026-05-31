"use client";

/**
 * Hero — the landing page's editorial showpiece.
 *
 * This component packs the locked design motifs into a single reusable
 * section that can be re-skinned for inner pages (Search, Browse, About,
 * etc.) without duplicating the texture stack.
 *
 *   * Massive Fraunces wordmark with variable optical-sizing cranked to
 *     opsz=144 so the letters get all the drama Fraunces was designed
 *     for. Middle word in italic + amber, two-tone WONK axis pushed to
 *     1 so the accent word has a little extra personality.
 *   * CRT scanline overlay (motif `scanlines`) — repeating linear
 *     gradient, blended over the background. Hero only.
 *   * Grain/noise overlay (motif `grain`) — inline SVG fractal
 *     turbulence, very low opacity, mix-blend-mode: overlay.
 *   * Morse-code kicker above the title in JetBrains Mono.
 *   * Staggered Motion entrance — kicker → title → lede → SearchBar
 *     → stat ticker, each delayed by ~150ms to give the page a
 *     "tuning in" reveal feel.
 *   * **Memorable thing**: an oscilloscope-style sparkline strip
 *     beneath the title — pure mono glyphs, no chart library. It
 *     reads as a real-time S-meter on the corpus.
 *
 * Sub-components (Scanlines, Grain, SMeter) are local to this file
 * because they're only used here — every other surface on the site is
 * a clean information layer where these textures would be distracting.
 *
 * Exported as default <Hero/>. Pass `showStats={false}` if you want a
 * minimal inner-page reuse (Search results, About page, etc.).
 */

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

import SearchBar from "./SearchBar";
import { colors, fontStacks, motifs } from "../lib/design";

// ---------------------------------------------------------------------------
// CRT scanlines overlay — repeating linear gradient @ motif spacing.
// ---------------------------------------------------------------------------

function Scanlines() {
  const { opacity, spacingPx } = motifs.scanlines;
  const halfPx = spacingPx / 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          rgba(0, 0, 0, ${opacity}) 0px,
          rgba(0, 0, 0, ${opacity}) ${halfPx}px,
          transparent ${halfPx}px,
          transparent ${spacingPx}px
        )`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Grain overlay — inline SVG fractal-noise turbulence filter.
// ---------------------------------------------------------------------------

function Grain() {
  const { opacity, baseFrequency } = motifs.grain;
  const filterId = useId().replace(/:/g, "");
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ opacity, mixBlendMode: "overlay" }}
    >
      <svg
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <filter id={`grain-${filterId}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={baseFrequency}
            numOctaves={2}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter={`url(#grain-${filterId})`}
          opacity="1"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SMeter — oscilloscope sparkline strip rendered with mono glyphs.
//
// Pure unicode block characters from motifs.oscilloscope.chars. No chart
// library, no SVG. The pattern is deterministic per-render so SSR is
// stable — we seed off a small fixed sequence.
// ---------------------------------------------------------------------------

function SMeter() {
  const reduced = useReducedMotion();
  const chars = motifs.oscilloscope.chars;

  // A 96-glyph waveform with a couple of carrier peaks. Deterministic so
  // SSR + hydration agree. Built by sampling two sine harmonics + a
  // light pseudo-random offset; baked at module import time below.
  const wave = useMemo(() => buildWave(96, chars), [chars]);

  return (
    <div
      aria-hidden
      className="mt-8 select-none overflow-hidden"
      style={{ minHeight: "1.5rem" }}
    >
      <motion.div
        initial={reduced ? false : { opacity: 0, x: -24 }}
        animate={reduced ? undefined : { opacity: 1, x: 0 }}
        transition={{ duration: 0.9, delay: 0.7, ease: "easeOut" }}
        className="flex items-end gap-3 whitespace-nowrap"
        style={{ fontFamily: fontStacks.mono }}
      >
        <span
          className="text-[10px] uppercase tracking-[0.32em]"
          style={{ color: colors.accent_2 }}
        >
          S-meter
        </span>
        <span
          className="block"
          style={{
            color: colors.accent,
            letterSpacing: "0.08em",
            fontSize: "0.9rem",
            lineHeight: 1,
            textShadow: motifs.glow.textShadow,
          }}
        >
          {wave}
        </span>
        <span
          className="text-[10px] uppercase tracking-[0.32em]"
          style={{ color: colors.accent_2 }}
        >
          7.85M·ENTRIES
        </span>
      </motion.div>
    </div>
  );
}

/**
 * Build a deterministic waveform string using the oscilloscope motif
 * glyph set. Two sine harmonics + a fixed pseudo-noise offset, then
 * quantised onto the glyph palette.
 */
function buildWave(len: number, chars: string): string {
  const n = chars.length - 1;
  let s = "";
  for (let i = 0; i < len; i++) {
    // Two sine harmonics — gives a non-trivial waveform that still
    // looks like a single coherent signal.
    const a = Math.sin(i * 0.42) * 0.5 + 0.5;
    const b = Math.sin(i * 0.13 + 1.3) * 0.25 + 0.25;
    // Fixed pseudo-noise (no Math.random — SSR must be stable).
    const noise = ((i * 9301 + 49297) % 233280) / 233280;
    const v = Math.min(1, Math.max(0, a * 0.65 + b * 0.25 + noise * 0.18));
    const idx = Math.min(n, Math.max(0, Math.round(v * n)));
    s += chars[idx];
  }
  return s;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

interface HeroProps {
  /**
   * Optional override for the corpus tagline shown above the title.
   * Defaults to a morse-flavoured editorial pitch.
   */
  kicker?: string;
  /**
   * Title words. The middle word renders in italic sodium amber.
   * Defaults to ["USA", "HAM", "CALLBOOKS"]; pass your own three-up
   * if you need it for an inner-page reuse.
   */
  titleWords?: [string, string, string];
  /**
   * Lede paragraph. Defaults to a one-sentence corpus pitch.
   */
  lede?: string;
  /**
   * If false, omits the SearchBar + stat ticker. Useful for inner
   * pages that want the texture stack but bring their own controls.
   */
  showSearch?: boolean;
  /**
   * If false, omits the three-up stat ticker strip.
   */
  showStats?: boolean;
}

export default function Hero({
  kicker,
  titleWords = ["USA", "HAM", "CALLBOOKS"],
  lede,
  showSearch = true,
  showStats = true,
}: HeroProps) {
  const kickerText =
    kicker ??
    `${motifs.morseDividers.tight}  a century of US amateur radio, indexed`;
  const ledeText =
    lede ??
    "Search 20th-century United States callbooks by callsign, operator, or QTH. " +
      "Every line cross-referenced against the modern FCC ULS and graded for OCR confidence.";

  return (
    <section
      className="relative isolate overflow-hidden"
      style={{
        backgroundColor: colors.bg,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {/* Decorative texture layers — order matters: grain on top of
          scanlines so the noise breaks up the regularity of the lines. */}
      <Scanlines />
      <Grain />

      {/* Sodium-amber vignette in the upper-right, like a street lamp
          just out of frame. Pure CSS, GPU-accelerated. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-[36rem] w-[36rem] rounded-full"
        style={{
          background: `radial-gradient(circle at center, rgba(255, 163, 11, 0.22), rgba(255, 163, 11, 0) 60%)`,
          filter: "blur(8px)",
        }}
      />
      {/* A second, weaker vignette low-left — gives the section a
          diagonal sodium "draft" instead of a single hot spot. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full"
        style={{
          background: `radial-gradient(circle at center, rgba(255, 163, 11, 0.10), rgba(255, 163, 11, 0) 60%)`,
          filter: "blur(10px)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8 lg:pb-36 lg:pt-32">
        {/* Kicker — morse + tagline */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: "easeOut" }}
          className="mb-6 text-xs uppercase sm:text-sm"
          style={{
            fontFamily: fontStacks.mono,
            color: colors.accent,
            letterSpacing: "0.32em",
            opacity: 0.85,
          }}
        >
          {kickerText}
        </motion.p>

        {/* Massive title */}
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          className="leading-[0.95] tracking-tight"
          style={{
            fontFamily: fontStacks.display,
            color: colors.text,
            // Crank optical sizing to the top of Fraunces's variable axis
            // so the letterforms get their full editorial drama.
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 0',
            fontWeight: 600,
            fontSize: "clamp(3rem, 12vw, 9rem)",
            textShadow: motifs.glow.textShadow,
          }}
        >
          <span className="block">{titleWords[0]}</span>
          <span
            className="block italic"
            style={{
              color: colors.accent,
              fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
              textShadow: `0 0 28px rgba(255, 209, 102, 0.45), 0 0 4px rgba(255, 163, 11, 0.85)`,
            }}
          >
            {titleWords[1]}
          </span>
          <span
            className="block"
            style={{
              color: colors.text,
              opacity: 0.92,
            }}
          >
            {titleWords[2]}
          </span>
        </motion.h1>

        {/* S-meter sparkline — the memorable beat */}
        <SMeter />

        {/* Asymmetric body row — lede on the left rail, dataset stamp
            on the right marginalia. 12-col split matching the locked
            asymmetricGrid motif. */}
        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.32, ease: "easeOut" }}
            className="max-w-2xl text-base leading-relaxed sm:text-lg lg:col-span-8"
            style={{
              fontFamily: fontStacks.body,
              color: colors.text_dim,
            }}
          >
            {ledeText}
          </motion.p>

          {/* Marginalia stamp — a tiny dataset descriptor on the right
              rail, mono-set, like a library accession label. */}
          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
            className="lg:col-span-4 lg:pl-6"
            style={{
              borderLeft: `1px solid ${colors.border}`,
            }}
            aria-label="dataset stamp"
          >
            <div
              className="text-[10px] uppercase tracking-[0.3em]"
              style={{
                fontFamily: fontStacks.mono,
                color: colors.accent_2,
              }}
            >
              accession
            </div>
            <div
              className="mt-1"
              style={{
                fontFamily: fontStacks.mono,
                color: colors.text,
                fontSize: "0.95rem",
                letterSpacing: "0.06em",
              }}
            >
              USA<span style={{ color: colors.accent }}>·</span>HAM
              <span style={{ color: colors.accent }}>·</span>CALLBOOKS
            </div>
            <div
              className="mt-1 text-xs"
              style={{
                fontFamily: fontStacks.mono,
                color: colors.text_dim,
              }}
            >
              v1 &middot; SQLite/FTS5 &middot; ULS-anchored
            </div>
          </motion.aside>
        </div>

        {/* Big hero SearchBar */}
        {showSearch ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55, ease: "easeOut" }}
            className="mt-10 max-w-3xl"
          >
            <SearchBar />
          </motion.div>
        ) : null}

        {/* Stat ticker strip — three glanceable corpus numbers, kept
            as text so it works without JS. Real values are wired in via
            a server component swap on the landing page; defaults here
            look right in design review. */}
        {showStats ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.75 }}
            className="mt-16 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3"
          >
            {[
              { kpi: "1909–1999", label: "editions indexed" },
              { kpi: "~7.85M", label: "callbook lines" },
              { kpi: "ULS-anchored", label: "cross-referenced" },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.5,
                  delay: 0.85 + i * 0.08,
                  ease: "easeOut",
                }}
                className="border-l pl-4"
                style={{ borderColor: colors.border }}
              >
                <div
                  className="text-2xl"
                  style={{
                    fontFamily: fontStacks.mono,
                    color: colors.accent,
                    letterSpacing: "0.04em",
                    textShadow: motifs.glow.textShadow,
                  }}
                >
                  {s.kpi}
                </div>
                <div
                  className="mt-1 text-xs uppercase tracking-[0.22em]"
                  style={{
                    fontFamily: fontStacks.mono,
                    color: colors.text_dim,
                  }}
                >
                  {s.label}
                </div>
              </motion.div>
            ))}
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}
