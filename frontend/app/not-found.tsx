/**
 * 404 — Signal Lost.
 *
 * Custom not-found page in the Sodium Vapor language. The hero is a giant
 * Morse "SOS" rendered as separate dot / dash glyphs, with each glyph
 * pulsing on its own offset so the page reads like an SOS being keyed out
 * over a fading carrier.
 *
 * No images, no client JS for the hero animation — pure inline keyframes.
 * The "Tune back to base" link returns to the home page; the search link
 * lets the visitor retry whatever query carried them here.
 */

import Link from "next/link";

import { colors, fontStacks, motifs } from "../lib/design";

// ---------------------------------------------------------------------------
// Background motifs — replicated locally so this file is self-contained.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Morse SOS pattern. Each glyph carries its own animation delay so the run
// "keys out" left-to-right rather than blinking in unison.
// ---------------------------------------------------------------------------

// "S O S" = ... --- ...
const SOS_GLYPHS: { char: "·" | "—"; delayMs: number; gap?: boolean }[] = [
  { char: "·", delayMs: 0 },
  { char: "·", delayMs: 140 },
  { char: "·", delayMs: 280, gap: true },
  { char: "—", delayMs: 420 },
  { char: "—", delayMs: 560 },
  { char: "—", delayMs: 700, gap: true },
  { char: "·", delayMs: 840 },
  { char: "·", delayMs: 980 },
  { char: "·", delayMs: 1120 },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotFound() {
  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4rem 2rem",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      <style>{`
        @keyframes sos-key {
          0%, 100% { opacity: 0.15; text-shadow: 0 0 2px rgba(255,163,11,0.3); }
          50%      { opacity: 1;    text-shadow: 0 0 24px ${colors.glow}, 0 0 6px ${colors.accent}; }
        }
        @keyframes carrier-fade {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.85; }
        }
        @keyframes ghost-jitter {
          0%, 100% {
            opacity: 0.06;
            transform: translate(0, 0) skewX(0deg);
            filter: blur(0px);
          }
          18% {
            opacity: 0.09;
            transform: translate(-2px, 1px) skewX(-0.4deg);
            filter: blur(0.5px);
          }
          34% {
            opacity: 0.04;
            transform: translate(1px, -1px) skewX(0.3deg);
            filter: blur(1.5px);
          }
          52% {
            opacity: 0.11;
            transform: translate(3px, 0) skewX(0deg);
            filter: blur(0px);
          }
          71% {
            opacity: 0.05;
            transform: translate(-1px, 2px) skewX(0.2deg);
            filter: blur(0.8px);
          }
          88% {
            opacity: 0.08;
            transform: translate(0, -1px) skewX(-0.1deg);
            filter: blur(0px);
          }
        }
      `}</style>

      <Grain />
      <Scanlines />

      {/* One-memorable-thing: the SOS morse pattern is the dominant visual,
          rendered at a colossal scale with a faded ghost callsign "K0NULL"
          behind it. The SOS keys out left-to-right; the ghost callsign
          glitches/jitters faintly in the background like a station fading
          out on the band. */}

      {/* Background ghost callsign — sits behind the SOS, faded and huge */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "clamp(8rem, 28vw, 26rem)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: colors.accent,
            opacity: 0.06,
            lineHeight: 0.9,
            whiteSpace: "nowrap",
            animation: "ghost-jitter 5.5s ease-in-out infinite",
            mixBlendMode: "screen",
          }}
        >
          K0/NULL
        </span>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          maxWidth: "60rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.5rem",
        }}
      >
        {/* Eyebrow — error code */}
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: colors.accent,
          }}
        >
          QRT · 404 · No carrier
        </div>

        {/* Morse SOS hero — DOMINANT. Rendered at hero scale; this is the
            page's signature. */}
        <div
          role="img"
          aria-label="Morse SOS — three dots, three dashes, three dots"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.45rem",
            fontFamily: fontStacks.mono,
            fontSize: "clamp(5rem, 18vw, 13rem)",
            fontWeight: 600,
            color: colors.accent,
            lineHeight: 1,
            margin: "1.5rem 0 0.5rem",
            filter: "drop-shadow(0 0 22px rgba(255, 209, 102, 0.25))",
          }}
        >
          {SOS_GLYPHS.map((g, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: g.gap ? "2.25rem" : 0,
                animation: `sos-key 1.6s ${g.delayMs}ms ease-in-out infinite`,
              }}
            >
              {g.char}
            </span>
          ))}
        </div>

        {/* SOS legend — under the giant pattern, naming it in mono */}
        <div
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            letterSpacing: "0.45em",
            textTransform: "uppercase",
            color: colors.text_dim,
            marginBottom: "0.5rem",
          }}
        >
          <span>
            <span style={{ color: colors.accent }}>S</span> · · ·
          </span>
          <span style={{ color: colors.accent_2 }}>—</span>
          <span>
            <span style={{ color: colors.accent }}>O</span> — — —
          </span>
          <span style={{ color: colors.accent_2 }}>—</span>
          <span>
            <span style={{ color: colors.accent }}>S</span> · · ·
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            margin: 0,
            fontFamily: fontStacks.display,
            fontSize: "clamp(3rem, 7vw, 5.5rem)",
            fontVariationSettings: '"opsz" 144, "wght" 500',
            lineHeight: 0.95,
            letterSpacing: "-0.02em",
            color: colors.text,
            textShadow: motifs.glow.textShadow,
          }}
        >
          Signal{" "}
          <span style={{ color: colors.accent, fontStyle: "italic" }}>
            lost
          </span>
          .
        </h1>

        {/* Strapline */}
        <p
          style={{
            margin: 0,
            fontFamily: fontStacks.body,
            fontSize: "1.05rem",
            lineHeight: 1.6,
            color: colors.text_dim,
          }}
        >
          We can&rsquo;t tune the page you asked for. It may have moved, or it
          was never on this frequency. Try the search, or drop back to the
          main carrier and start over.
        </p>

        {/* Carrier line — a long morse pattern fading at the bottom */}
        <div
          aria-hidden
          style={{
            margin: "0.5rem auto 0",
            maxWidth: "32rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            letterSpacing: "0.35em",
            color: colors.accent_2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            animation: "carrier-fade 3.4s ease-in-out infinite",
          }}
        >
          {motifs.morseDividers.pattern.repeat(4)}
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginTop: "0.75rem",
          }}
        >
          <Link
            href="/"
            style={{
              padding: "0.85rem 1.6rem",
              background: colors.accent,
              color: colors.bg,
              border: "none",
              borderRadius: "0.25rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: `0 0 14px -4px ${colors.glow}`,
            }}
          >
            Tune back to base
          </Link>
          <Link
            href="/search"
            style={{
              padding: "0.85rem 1.6rem",
              background: "transparent",
              color: colors.accent,
              border: `1px solid ${colors.accent}`,
              borderRadius: "0.25rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Retry search
          </Link>
        </div>

        {/* Bottom eyebrow */}
        <div
          style={{
            marginTop: "1.25rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: colors.text_dim,
          }}
        >
          73 · de ham-callbook · k
        </div>
      </div>
    </main>
  );
}

export const metadata = {
  title: "Signal lost — 404",
  description: "The page you asked for could not be tuned.",
};
