"use client";

/**
 * / — Home / marquee for the USA Ham Callbook Atlas.
 *
 * Client component because it polls /api/random on an 8s interval for the
 * live teletype, runs the TWR transmit/receive cycle, drives the drifting
 * oscilloscope, and uses motion/react for staggered character-by-character
 * reveal of the ticker. All visuals come from the locked "Sodium Vapor"
 * design tokens — never hard-coded — so the look stays consistent.
 *
 * Sections (top → bottom):
 *   1. HERO  — gigantic Fraunces (opsz 144) "HAM CALLBOOK" with ambient
 *      amber-glow pulse, oscilloscope sine wave drifting horizontally,
 *      CRT scanlines + grain, JetBrains Mono "radio-tube label" sub-line
 *      with clipped corners, TWR indicator pulsing on TX/RX cycle.
 *   2. MORSE MARQUEE — slowly scrolling morse strip under the hero.
 *   3. SEARCH — big centred SearchBar that posts to /search?q=...
 *   4. TELETYPE — random callsigns from /api/random revealed
 *      character-by-character with Motion stagger.
 *   5. STATS STRIP — divided-line "7.74M | 99 EDITIONS | 1909→1997" with
 *      compressed-opsz Fraunces numerals.
 *   6. EXPLORE TILES — asymmetric heights (tall/short/mid), each with a
 *      unique motif: year stacked-bar, US silhouette, swirling glyph.
 *   7. SPARKLINE — license growth, SSR-safe SVG.
 *   8. MORSE DIVIDERS between sections.
 *
 * Guardrails: NO Inter, NO purple gradients, NO hover:scale-105, NO shadcn.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { colors, fontStacks, motifs } from "../lib/design";

// ---------------------------------------------------------------------------
// Static dataset surfaced in the chrome. Headline figures from the spec.
// ---------------------------------------------------------------------------

const STAT_LICENSEES = "7.74M";
const STAT_EDITIONS = "99";
const YEAR_FIRST = 1909;
const YEAR_LAST = 1997;

const SEED_CALLSIGNS: string[] = [
  "W1AW", "K2ORS", "W6AM", "K3LR", "W9XR", "WA2EJT", "N6TR", "K1ZZ",
  "W4AN", "K7RA", "WB5VZL", "N0AX", "W3LPL", "K5RC", "VE3KP", "W7RM",
];

// ---------------------------------------------------------------------------
// Sparkline data — yearly licensee count, hand-curated from stats_per_year.
// ---------------------------------------------------------------------------

type GrowthPoint = { year: number; count: number };

const LICENSE_GROWTH: GrowthPoint[] = [
  { year: 1909, count: 0.001 },
  { year: 1920, count: 0.006 },
  { year: 1930, count: 0.022 },
  { year: 1940, count: 0.054 },
  { year: 1950, count: 0.087 },
  { year: 1960, count: 0.230 },
  { year: 1970, count: 0.265 },
  { year: 1980, count: 0.410 },
  { year: 1985, count: 0.430 },
  { year: 1990, count: 0.495 },
  { year: 1993, count: 0.640 },
  { year: 1995, count: 0.680 },
  { year: 1997, count: 0.679 },
];

// ---------------------------------------------------------------------------
// Decorative layers — Scanlines + Grain + MorseDivider.
// ---------------------------------------------------------------------------

function Scanlines() {
  const { opacity, spacingPx } = motifs.scanlines;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          rgba(255, 209, 102, 0.6) 0px,
          rgba(255, 209, 102, 0.6) 1px,
          transparent 1px,
          transparent ${spacingPx}px
        )`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

function Grain() {
  const { opacity, baseFrequency } = motifs.grain;
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
       <filter id='n'>
         <feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='2' stitchTiles='stitch'/>
         <feColorMatrix values='0 0 0 0 1  0 0 0 0 0.64  0 0 0 0 0.04  0 0 0 0.6 0'/>
       </filter>
       <rect width='100%' height='100%' filter='url(#n)'/>
     </svg>`,
  );
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        zIndex: 1,
      }}
    />
  );
}

function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "4rem 0",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.75rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
      {label ? <span style={{ flexShrink: 0 }}>{label}</span> : null}
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MorseMarquee — full-width scrolling morse strip under the hero. Slow
// horizontal drift (60s), thin amber rule top + bottom. Reads as a
// punched paper tape feeding through the chassis.
// ---------------------------------------------------------------------------

function MorseMarquee() {
  const tape = `${motifs.morseDividers.pattern}    `.repeat(40);
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        overflow: "hidden",
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        background:
          "linear-gradient(90deg, rgba(255,163,11,0.02), rgba(255,163,11,0.06), rgba(255,163,11,0.02))",
        padding: "0.65rem 0",
      }}
    >
      <div
        style={{
          whiteSpace: "nowrap",
          fontFamily: fontStacks.mono,
          fontSize: "0.78rem",
          letterSpacing: "0.45em",
          color: colors.accent_2,
          animation: "morse-tape 80s linear infinite",
          willChange: "transform",
        }}
      >
        {tape}
        {tape}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TWR (transmit-receive) indicator — sits in the hero corner. Alternates
// between RX (amber) and TX (red), pulsing on a slow 5s carrier cycle.
// Built from a tiny state machine — no React rerender per frame, just CSS
// keyframes synchronised via a single `mode` toggle.
// ---------------------------------------------------------------------------

function TwrIndicator() {
  const [mode, setMode] = useState<"RX" | "TX">("RX");

  useEffect(() => {
    // 5s receive, 1.6s transmit — feels like real CW QSO cadence.
    let active = true;
    function cycle() {
      if (!active) return;
      setMode("TX");
      window.setTimeout(() => {
        if (!active) return;
        setMode("RX");
      }, 1600);
    }
    const id = window.setInterval(cycle, 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const isTx = mode === "TX";
  const lampColor = isTx ? colors.danger : colors.accent;
  const lampGlow = isTx ? "rgba(255,85,85,0.55)" : "rgba(255,209,102,0.55)";
  const pulseMs = isTx ? 600 : motifs.twrIndicator.pulseMs;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Service ${mode === "TX" ? "transmitting" : "receiving"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.4rem 0.8rem 0.4rem 0.6rem",
        border: `1px solid ${colors.border}`,
        borderRadius: "2px",
        background: "rgba(10, 14, 26, 0.7)",
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: colors.text_dim,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: motifs.twrIndicator.sizePx,
          height: motifs.twrIndicator.sizePx,
          borderRadius: "50%",
          background: lampColor,
          boxShadow: `0 0 12px ${lampGlow}, 0 0 2px ${lampColor}`,
          animation: `twr-pulse ${pulseMs}ms ease-in-out infinite alternate`,
          transition: "background 200ms ease, box-shadow 200ms ease",
        }}
      />
      <span
        style={{
          color: isTx ? colors.danger : colors.accent,
          fontWeight: 600,
          minWidth: "1.4em",
          textShadow: isTx ? "none" : motifs.glow.textShadow,
          transition: "color 200ms ease",
        }}
      >
        {mode}
      </span>
      <span style={{ color: colors.text_dim }}>· Live</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Oscilloscope — SVG sine wave drifting horizontally inside the hero. Pure
// SVG path animated via stroke-dashoffset + a parent translate. Stays SSR
// safe and runs entirely on the compositor.
// ---------------------------------------------------------------------------

function OscilloscopeWave() {
  // Build a long sine path so the horizontal drift never repeats visibly.
  const width = 2400;
  const height = 220;
  const segments = 240;
  const amplitude = 60;
  const wavelength = 120;

  let d = `M 0 ${height / 2}`;
  for (let i = 1; i <= segments; i++) {
    const x = (i / segments) * width;
    const y = height / 2 + Math.sin((x / wavelength) * Math.PI * 2) * amplitude;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        overflow: "hidden",
        opacity: 0.55,
        maskImage:
          "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
      }}
    >
      <svg
        viewBox={`0 0 ${width / 2} ${height}`}
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "200%",
          height: "100%",
          animation: "scope-drift 26s linear infinite",
          willChange: "transform",
        }}
      >
        <defs>
          <linearGradient id="scope-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colors.accent_2} stopOpacity="0.4" />
            <stop offset="50%" stopColor={colors.glow} stopOpacity="0.9" />
            <stop offset="100%" stopColor={colors.accent_2} stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <path
          d={d}
          fill="none"
          stroke="url(#scope-stroke)"
          strokeWidth={1.4}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${colors.accent})` }}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchBar — bone-cream input on near-black, amber underline.
// ---------------------------------------------------------------------------

function SearchBar() {
  const [value, setValue] = useState("");
  return (
    <form
      action="/search"
      method="GET"
      role="search"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: "0.75rem",
        width: "100%",
        maxWidth: "44rem",
        margin: 0,
      }}
    >
      <label htmlFor="home-search" style={{ position: "absolute", left: -9999 }}>
        Search callsigns, names, or places
      </label>
      <input
        id="home-search"
        name="q"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="W1AW · Hiram Percy Maxim · Connecticut"
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1,
          padding: "1.1rem 1.25rem",
          background: colors.surface,
          color: colors.text,
          border: `1px solid ${colors.border}`,
          borderBottom: `2px solid ${colors.accent}`,
          borderRadius: "0.25rem",
          fontFamily: fontStacks.mono,
          fontSize: "1.05rem",
          letterSpacing: "0.04em",
          outline: "none",
          caretColor: colors.accent,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderBottomColor = colors.glow;
          e.currentTarget.style.boxShadow = `0 4px 24px -8px ${colors.accent}`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = colors.accent;
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      <button
        type="submit"
        style={{
          padding: "0 1.6rem",
          background: colors.accent,
          color: colors.bg,
          border: "none",
          borderRadius: "0.25rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.8rem",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: `0 0 14px -4px ${colors.glow}`,
        }}
      >
        Tune in
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// LiveTicker — polls /api/random every 8s. Each callsign is revealed
// character-by-character (teletype style) using Motion's stagger. When a
// new batch arrives we re-key the wrapper so the reveal replays.
// ---------------------------------------------------------------------------

type RandomResponse = unknown;

function parseRandom(payload: RandomResponse): string[] {
  if (Array.isArray(payload)) {
    return payload.filter((x): x is string => typeof x === "string");
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.callsigns)) {
      return obj.callsigns.filter((x): x is string => typeof x === "string");
    }
    if (Array.isArray(obj.results)) {
      return obj.results
        .map((row) =>
          row && typeof row === "object" && "callsign" in row
            ? String((row as { callsign: unknown }).callsign)
            : "",
        )
        .filter((s) => s.length > 0);
    }
  }
  return [];
}

function TeletypeCallsign({ callsign, delay }: { callsign: string; delay: number }) {
  const chars = useMemo(() => callsign.split(""), [callsign]);
  return (
    <a
      href={`/callsign/${encodeURIComponent(callsign)}`}
      style={{
        display: "inline-flex",
        fontFamily: fontStacks.mono,
        fontSize: "1.05rem",
        letterSpacing: "0.14em",
        color: colors.text,
        textDecoration: "none",
        padding: "0 0.25rem",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = colors.glow;
        e.currentTarget.style.textShadow = motifs.glow.textShadow;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.text;
        e.currentTarget.style.textShadow = "none";
      }}
    >
      {chars.map((c, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.08,
            delay: delay + i * 0.035,
            ease: "linear",
          }}
        >
          {c}
        </motion.span>
      ))}
    </a>
  );
}

function LiveTicker() {
  const [calls, setCalls] = useState<string[]>(SEED_CALLSIGNS);
  const [batch, setBatch] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/random?n=16", { cache: "no-store" });
        if (!res.ok) return;
        const json: RandomResponse = await res.json();
        const next = parseRandom(json);
        if (!cancelled && next.length > 0) {
          setCalls(next);
          setBatch((b) => b + 1);
        }
      } catch {
        /* keep previous strip */
      }
    }

    const kickoff = window.setTimeout(refresh, 400);
    const interval = window.setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div
      aria-label="Teletype — random callsigns from the archive"
      style={{
        position: "relative",
        overflow: "hidden",
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        background: "rgba(19, 26, 45, 0.65)",
        padding: "1rem 1.5rem",
      }}
    >
      {/* Teletype caption */}
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.62rem",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: colors.text_dim,
          marginBottom: "0.6rem",
        }}
      >
        <span style={{ color: colors.accent }}>▮</span> Teletype · /api/random ·
        refreshes every 8s
      </div>
      <div
        key={batch}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem 1.4rem",
          whiteSpace: "nowrap",
        }}
      >
        {calls.map((cs, i) => (
          <TeletypeCallsign
            key={`${batch}-${cs}-${i}`}
            callsign={cs}
            delay={i * 0.18}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats strip — divided-line format with massive compressed Fraunces
// numerals (opsz 12) + tiny mono labels. Each segment separated by a
// vertical amber hairline rather than a centre-dot.
// ---------------------------------------------------------------------------

function StatsSegment({
  number,
  label,
}: {
  number: React.ReactNode;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        padding: "0 1.6rem",
        minWidth: "12rem",
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 12, "wght" 600',
          fontWeight: 600,
          fontSize: "clamp(2.4rem, 6vw, 4.2rem)",
          lineHeight: 0.9,
          color: colors.text,
          letterSpacing: "-0.02em",
        }}
      >
        {number}
      </span>
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.68rem",
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function StatsStrip() {
  const rule: React.CSSProperties = {
    width: 1,
    alignSelf: "stretch",
    background: `linear-gradient(to bottom, transparent, ${colors.accent_2}, transparent)`,
  };
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
        flexWrap: "wrap",
        gap: "1.5rem 0",
        padding: "1.5rem 0",
      }}
    >
      <StatsSegment
        number={
          <span style={{ color: colors.accent, textShadow: motifs.glow.textShadow }}>
            {STAT_LICENSEES}
          </span>
        }
        label="Licensees"
      />
      <div aria-hidden style={rule} />
      <StatsSegment number={STAT_EDITIONS} label="Editions" />
      <div aria-hidden style={rule} />
      <StatsSegment
        number={
          <>
            {YEAR_FIRST}
            <span style={{ color: colors.accent_2, padding: "0 0.2em" }}>→</span>
            {YEAR_LAST}
          </>
        }
        label="Span"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explore tiles — three asymmetric tiles (tall / short / mid), each with a
// unique inline-SVG motif: stacked year bars / US silhouette / swirl.
// ---------------------------------------------------------------------------

type ExploreMotif = "year-bars" | "us-silhouette" | "swirl";

type ExploreTile = {
  href: string;
  eyebrow: string;
  title: string;
  caption: string;
  height: number; // rem
  motif: ExploreMotif;
};

const EXPLORE_TILES: ExploreTile[] = [
  {
    href: "/years",
    eyebrow: "Vol I",
    title: "Browse by Year",
    caption:
      "99 editions, 1909 to 1997. Watch a hobby's century of growth, edition by edition.",
    height: 22,
    motif: "year-bars",
  },
  {
    href: "/states",
    eyebrow: "Vol II",
    title: "Browse by State",
    caption:
      "Every US state, territory, and possession. Maps weighted by activity.",
    height: 15,
    motif: "us-silhouette",
  },
  {
    href: "/random",
    eyebrow: "Vol IV",
    title: "Random Discovery",
    caption:
      "Drop the needle. One licensee from the corpus, picked at random.",
    height: 18,
    motif: "swirl",
  },
];

function YearBarsMotif() {
  // Tiny stacked-bar of growth — derived from LICENSE_GROWTH so it's real.
  const w = 220;
  const h = 70;
  const max = Math.max(...LICENSE_GROWTH.map((p) => p.count));
  const bw = (w - (LICENSE_GROWTH.length - 1) * 3) / LICENSE_GROWTH.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden>
      {LICENSE_GROWTH.map((p, i) => {
        const barH = (p.count / max) * (h - 12);
        const x = i * (bw + 3);
        return (
          <g key={p.year}>
            <rect
              x={x}
              y={h - barH}
              width={bw}
              height={barH}
              fill={i === LICENSE_GROWTH.length - 1 ? colors.glow : colors.accent_2}
              opacity={0.85}
            />
          </g>
        );
      })}
      <line
        x1={0}
        y1={h - 0.5}
        x2={w}
        y2={h - 0.5}
        stroke={colors.border}
        strokeWidth={1}
      />
    </svg>
  );
}

function UsSilhouetteMotif() {
  // Hand-tuned simplified continental-US silhouette path. Pure decoration —
  // accurate enough to read as "USA" at glance size, no atlas projection.
  const d =
    "M14,38 L26,30 L40,28 L52,22 L64,18 L78,16 L92,14 L108,12 L124,12 L138,14 L154,12 L168,10 L182,8 L196,8 L210,10 L222,16 L218,24 L214,32 L210,40 L204,48 L196,52 L188,54 L184,60 L176,62 L168,62 L160,58 L152,60 L148,66 L142,68 L134,68 L128,72 L122,74 L116,74 L110,68 L102,66 L94,68 L86,66 L78,60 L70,58 L62,56 L54,54 L48,50 L42,48 L34,46 L26,44 L18,42 Z";
  return (
    <svg viewBox="0 0 240 90" width="100%" height={90} aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={colors.accent}
        strokeWidth={1.2}
        strokeLinejoin="round"
        opacity={0.85}
        style={{ filter: `drop-shadow(0 0 4px ${colors.accent_2})` }}
      />
      <path d={d} fill={colors.accent} opacity={0.08} />
      {/* a couple of station dots */}
      {[
        [40, 32], [78, 24], [124, 22], [168, 22], [200, 28],
        [60, 44], [110, 46], [150, 42], [190, 44],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6} fill={colors.glow} />
      ))}
    </svg>
  );
}

function SwirlMotif() {
  // Logarithmic-spiral path — 4 turns, sampled. Pure SVG, no library.
  const cx = 90;
  const cy = 60;
  const turns = 4;
  const samples = 240;
  const a = 1.6;
  const b = 0.22;
  let d = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * turns * Math.PI * 2;
    const r = a * Math.exp(b * t);
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return (
    <svg viewBox="0 0 180 120" width="100%" height={120} aria-hidden>
      <g
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: "swirl-rotate 36s linear infinite",
        }}
      >
        <path
          d={d}
          fill="none"
          stroke={colors.glow}
          strokeWidth={1}
          opacity={0.85}
          style={{ filter: `drop-shadow(0 0 6px ${colors.accent})` }}
        />
      </g>
      <circle cx={cx} cy={cy} r={2} fill={colors.accent} />
    </svg>
  );
}

function MotifFor({ motif }: { motif: ExploreMotif }) {
  if (motif === "year-bars") return <YearBarsMotif />;
  if (motif === "us-silhouette") return <UsSilhouetteMotif />;
  return <SwirlMotif />;
}

function ExploreTileCard({ tile, index }: { tile: ExploreTile; index: number }) {
  return (
    <a
      href={tile.href}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1.75rem 1.5rem",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderTop: `3px solid ${colors.accent}`,
        borderRadius: "2px",
        color: colors.text,
        textDecoration: "none",
        height: `${tile.height}rem`,
        position: "relative",
        overflow: "hidden",
        animation: `tile-rise 700ms ${300 + index * 120}ms cubic-bezier(0.2, 0.7, 0.2, 1) both`,
        transition: "border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.accent;
        e.currentTarget.style.boxShadow = `0 18px 48px -24px ${colors.accent}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.borderTopColor = colors.accent;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        <span>{tile.eyebrow}</span>
        <span aria-hidden style={{ color: colors.accent_2 }}>
          {String(index + 1).padStart(2, "0")}/{EXPLORE_TILES.length.toString().padStart(2, "0")}
        </span>
      </div>
      <div
        style={{
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 84, "wght" 500',
          fontSize: "2.1rem",
          lineHeight: 1.0,
          color: colors.text,
        }}
      >
        {tile.title}
      </div>
      <p
        style={{
          fontFamily: fontStacks.body,
          fontSize: "0.92rem",
          lineHeight: 1.5,
          color: colors.text_dim,
          margin: 0,
        }}
      >
        {tile.caption}
      </p>
      <div style={{ marginTop: "auto", marginBottom: "0.4rem" }}>
        <MotifFor motif={tile.motif} />
      </div>
      <span
        aria-hidden
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.68rem",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: colors.accent,
        }}
      >
        Enter →
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — license growth.
// ---------------------------------------------------------------------------

function GrowthSparkline() {
  const width = 800;
  const height = 160;
  const padX = 24;
  const padY = 18;

  const years = LICENSE_GROWTH.map((p) => p.year);
  const counts = LICENSE_GROWTH.map((p) => p.count);
  const yMin = 0;
  const yMax = Math.max(...counts) * 1.05;
  const xMin = Math.min(...years);
  const xMax = Math.max(...years);

  function px(year: number): number {
    return padX + ((year - xMin) / (xMax - xMin)) * (width - padX * 2);
  }
  function py(count: number): number {
    return (
      height - padY - ((count - yMin) / (yMax - yMin)) * (height - padY * 2)
    );
  }

  const points = LICENSE_GROWTH.map((p) => `${px(p.year)},${py(p.count)}`).join(
    " ",
  );
  const fillPoints = `${padX},${height - padY} ${points} ${width - padX},${height - padY}`;
  const ticks = [1909, 1920, 1940, 1960, 1980, 1997];

  return (
    <figure
      style={{
        margin: 0,
        padding: "2rem 1.5rem",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: "2px",
      }}
    >
      <figcaption
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "1rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        <span>License growth · 1909 → 1997</span>
        <span style={{ color: colors.accent }}>millions of licensees</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Sparkline of US amateur radio license growth from 1909 to 1997"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <defs>
          <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity="0.5" />
            <stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#growth-fill)" />
        <polyline
          points={points}
          fill="none"
          stroke={colors.glow}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${colors.accent})` }}
        />
        {LICENSE_GROWTH.map((p) => (
          <circle
            key={p.year}
            cx={px(p.year)}
            cy={py(p.count)}
            r={2.5}
            fill={colors.bg}
            stroke={colors.accent}
            strokeWidth={1.5}
          />
        ))}
        {ticks.map((year) => (
          <text
            key={year}
            x={px(year)}
            y={height - 2}
            textAnchor="middle"
            fontFamily={fontStacks.mono}
            fontSize="9"
            fill={colors.text_dim}
            letterSpacing="0.12em"
          >
            {year}
          </text>
        ))}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Sub-headline — the JetBrains Mono "radio-tube label". A clipped-corner
// pill (CSS clip-path notch on every corner) holding mono caps text, sat
// in the eyebrow position above the search.
// ---------------------------------------------------------------------------

function TubeLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.55rem 1rem 0.55rem 0.8rem",
        background: "rgba(255, 163, 11, 0.08)",
        color: colors.glow,
        border: `1px solid ${colors.accent_2}`,
        fontFamily: fontStacks.mono,
        fontSize: "0.72rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        // Notched corners — reads as a tube/relay label etched into bakelite.
        clipPath:
          "polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: colors.accent,
          boxShadow: `0 0 8px ${colors.glow}`,
        }}
      />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------

export default function HomePage() {
  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        overflowX: "hidden",
      }}
    >
      {/* Bespoke keyframes — inlined so the home page is self-contained. */}
      <style>{`
        @keyframes twr-pulse {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(1.45); opacity: 1; }
        }
        @keyframes hero-rise {
          from { opacity: 0; transform: translateY(28px); letter-spacing: 0.18em; }
          to   { opacity: 1; transform: translateY(0);    letter-spacing: 0.02em; }
        }
        @keyframes fade-rise {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes tile-rise {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scope-drift {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes morse-tape {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes swirl-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes hero-halo {
          0%, 100% {
            text-shadow:
              0 0 10px rgba(255, 209, 102, 0.32),
              0 0 28px rgba(255, 163, 11, 0.18),
              0 0 2px rgba(255, 163, 11, 0.55);
          }
          50% {
            text-shadow:
              0 0 22px rgba(255, 209, 102, 0.55),
              0 0 56px rgba(255, 163, 11, 0.32),
              0 0 3px rgba(255, 163, 11, 0.7);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.001ms !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>

      <Grain />

      {/* ---------- HERO ---------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 1.5rem 4rem",
          overflow: "hidden",
          borderBottom: `1px solid ${colors.border}`,
          minHeight: "82vh",
          display: "flex",
          alignItems: "center",
        }}
      >
        <OscilloscopeWave />
        <Scanlines />

        <div
          style={{
            position: "relative",
            zIndex: 2,
            maxWidth: "82rem",
            margin: "0 auto",
            width: "100%",
            display: "grid",
            // Asymmetric: wide content column + narrow marginalia rail.
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: "2.25rem",
          }}
        >
          {/* Eyebrow row — edition stamp left, TWR right. */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: colors.text_dim,
              animation: "fade-rise 600ms 100ms both",
            }}
          >
            <span>Edition · MMXXVI · Vol. 99</span>
            <TwrIndicator />
          </div>

          {/* Tube label — sub-headline above the H1. */}
          <div style={{ animation: "fade-rise 700ms 250ms both" }}>
            <TubeLabel>Sodium Vapor · 80m–10m · 7,742,910 licensees indexed</TubeLabel>
          </div>

          {/* Massive Fraunces headline. opsz axis maxed (144) for drama. */}
          <h1
            style={{
              margin: 0,
              fontFamily: fontStacks.display,
              fontVariationSettings: '"opsz" 144, "wght" 500',
              fontWeight: 500,
              fontSize: "clamp(3.2rem, 12vw, 10rem)",
              lineHeight: 0.88,
              letterSpacing: "0.01em",
              color: colors.text,
              animation:
                "hero-rise 900ms 350ms cubic-bezier(0.2, 0.7, 0.2, 1) both, hero-halo 5200ms 1200ms ease-in-out infinite",
            }}
          >
            <span style={{ display: "block" }}>USA</span>
            <span
              style={{
                display: "block",
                color: colors.accent,
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 144, "wght" 400',
              }}
            >
              Ham Callbook
            </span>
            <span style={{ display: "block" }}>Atlas</span>
          </h1>

          {/* Strapline — the "what is this" in one line. */}
          <p
            style={{
              maxWidth: "44rem",
              margin: 0,
              fontFamily: fontStacks.body,
              fontSize: "1.1rem",
              lineHeight: 1.55,
              color: colors.text_dim,
              animation: "fade-rise 700ms 700ms both",
            }}
          >
            Every amateur radio licensee printed in the United States, from
            the first 1909 callbook to the last 1997 edition — searchable,
            cross-referenced, and rendered as an atlas of the airwaves.
          </p>

          {/* Search. */}
          <div style={{ animation: "fade-rise 700ms 850ms both" }}>
            <SearchBar />
          </div>
        </div>
      </section>

      {/* ---------- MORSE MARQUEE (under hero) ---------- */}
      <div style={{ animation: "fade-rise 700ms 950ms both" }}>
        <MorseMarquee />
      </div>

      {/* ---------- LIVE TICKER ---------- */}
      <div style={{ animation: "fade-rise 700ms 1050ms both" }}>
        <LiveTicker />
      </div>

      {/* ---------- STATS STRIP ---------- */}
      <section
        style={{
          padding: "3.5rem 1.5rem 2.5rem",
          animation: "fade-rise 700ms 1150ms both",
        }}
      >
        <StatsStrip />
      </section>

      <div style={{ maxWidth: "82rem", margin: "0 auto", padding: "0 1.5rem" }}>
        <MorseDivider label="Explore" />
      </div>

      {/* ---------- EXPLORE TILES — asymmetric heights ---------- */}
      <section
        style={{
          padding: "0 1.5rem 1rem",
          maxWidth: "82rem",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "grid",
            // Three columns; row alignment START so unequal heights stagger.
            gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))",
            alignItems: "start",
            gap: "1.5rem",
          }}
        >
          {EXPLORE_TILES.map((tile, i) => (
            <ExploreTileCard key={tile.href} tile={tile} index={i} />
          ))}
        </div>
      </section>

      <div style={{ maxWidth: "82rem", margin: "0 auto", padding: "0 1.5rem" }}>
        <MorseDivider label="Growth" />
      </div>

      {/* ---------- SPARKLINE ---------- */}
      <section
        style={{
          padding: "0 1.5rem 5rem",
          maxWidth: "82rem",
          margin: "0 auto",
          animation: "fade-rise 800ms 200ms both",
        }}
      >
        <GrowthSparkline />
      </section>

      <div style={{ maxWidth: "82rem", margin: "0 auto", padding: "0 1.5rem" }}>
        <MorseDivider />
      </div>

      {/* ---------- COLOPHON ---------- */}
      <footer
        style={{
          padding: "2rem 1.5rem 4rem",
          textAlign: "center",
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        Compiled from {STAT_EDITIONS} editions · {YEAR_FIRST}—{YEAR_LAST} ·
        Sodium Vapor / 73
      </footer>
    </main>
  );
}
