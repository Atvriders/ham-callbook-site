"use client";

/**
 * /random — "Spin the dial" page.
 *
 * Hits /api/random/notable and renders the chosen callsign as a big editorial
 * card with the reason it was deemed notable. A "Spin again" button refreshes
 * the page via the router, pulling a fresh row from the notable pool.
 *
 * Client component so we can:
 *   * Call router.refresh() in response to a button click.
 *   * Animate a brief amber pulse between spins so the UX reads as "tuning"
 *     rather than "page reloaded".
 *
 * The actual fetch happens in a useEffect; we deliberately don't SSR the
 * random pick so a visitor can't refresh and see the same row again. The
 * tradeoff (no SSR'd initial state) is acceptable here because /random is a
 * leaf page accessed by intent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useAnimationControls } from "motion/react";

import CallsignCard from "../../components/CallsignCard";
import { colors, fontStacks, motifs } from "../../lib/design";
import { cleanOCRName, cleanOCRCity, cleanOCRState, classLabelForCode } from "../../lib/ocrClean";

// ---------------------------------------------------------------------------
// Wire types — mirror NotableEntry in app/routes/random.py.
// ---------------------------------------------------------------------------

interface NotableEntry {
  year: number;
  edition: string;
  callsign: string;
  license_class: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  raw_ocr: string | null;
  flag: string | null;
  source: string;
  reason: "multi_edition" | "multi_holder" | "vanity" | string;
  reason_detail: string;
  edition_count: number;
  distinct_holder_count: number;
}

// ---------------------------------------------------------------------------
// Decorative motifs (client-side variants)
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

function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "2.5rem 0",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
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
// Reason badge — small accented chip with the "story" tag.
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<string, string> = {
  multi_edition: "Long-lived call",
  multi_holder: "Reissued call",
  vanity: "Vanity-style call",
};

function ReasonBadge({ reason }: { reason: string }) {
  const label = REASON_LABEL[reason] ?? "Notable";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.4rem 0.75rem",
        background: "transparent",
        border: `1px solid ${colors.accent}`,
        borderRadius: "999px",
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: colors.accent,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: colors.glow,
          boxShadow: `0 0 8px ${colors.glow}`,
        }}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DiceGlyph — six dot-faces of a die, drawn as SVG so we can swap the
// active face when the dice rolls. Faces 1-6 use canonical pip layouts.
// ---------------------------------------------------------------------------

function DicePips({ face }: { face: 1 | 2 | 3 | 4 | 5 | 6 }) {
  // Pip positions on a 3x3 grid (col, row), each in [0..2].
  const POSITIONS: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
  };
  return (
    <svg
      viewBox="0 0 60 60"
      width={40}
      height={40}
      aria-hidden
      style={{ display: "block" }}
    >
      <rect
        x="4"
        y="4"
        width="52"
        height="52"
        rx="9"
        fill={colors.bg}
        stroke={colors.bg}
        strokeWidth="1"
      />
      {(POSITIONS[face] ?? []).map(([cx, cy] = [1, 1], i) => (
        <circle
          key={i}
          cx={14 + cx * 16}
          cy={14 + cy * 16}
          r={4}
          fill={colors.glow}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RandomPage() {
  const [entry, setEntry] = useState<NotableEntry | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [spinKey, setSpinKey] = useState<number>(0);
  // Dice motif state: faces cycle while tumbling, settling on a random
  // final face once the spin resolves.
  const [diceFace, setDiceFace] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const diceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const diceControls = useAnimationControls();

  const tumbleDice = useCallback(async () => {
    // Cycle faces every 90ms while the request is in flight.
    if (diceTimer.current) clearInterval(diceTimer.current);
    diceTimer.current = setInterval(() => {
      setDiceFace((((Math.floor(Math.random() * 6)) + 1) as 1 | 2 | 3 | 4 | 5 | 6));
    }, 90);
    // Tumble the die — full 3D-ish rotation with spring settle.
    await diceControls.start({
      rotate: [0, 90, 180, 270, 360, 540, 720],
      scale: [1, 1.15, 0.92, 1.08, 0.96, 1.02, 1],
      transition: { duration: 0.95, ease: "easeInOut" },
    });
  }, [diceControls]);

  const settleDice = useCallback(() => {
    if (diceTimer.current) {
      clearInterval(diceTimer.current);
      diceTimer.current = null;
    }
    setDiceFace((((Math.floor(Math.random() * 6)) + 1) as 1 | 2 | 3 | 4 | 5 | 6));
  }, []);

  const spin = useCallback(() => {
    setLoading(true);
    setError(null);
    tumbleDice();
    fetch("/api/random/notable", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: NotableEntry) => {
        setEntry(data);
        setLoading(false);
        setSpinKey((k) => k + 1);
        settleDice();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Spin failed");
        setLoading(false);
        settleDice();
      });
  }, [tumbleDice, settleDice]);

  useEffect(() => {
    spin();
    return () => {
      if (diceTimer.current) clearInterval(diceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
      }}
    >
      <style>{`
        @keyframes spin-flash {
          0%   { opacity: 0;   transform: translateY(8px); filter: blur(4px); }
          60%  { opacity: 1;   transform: translateY(0);   filter: blur(0); }
          100% { opacity: 1;   transform: translateY(0);   filter: blur(0); }
        }
        @keyframes dial-pulse {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 1; }
        }
      `}</style>

      <Grain />

      {/* --- HEADER -------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 2rem",
          maxWidth: "min(70rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          <div
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            Vol III · Random Discovery
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: fontStacks.display,
              fontSize: "clamp(3.5rem, 9vw, 7.5rem)",
              fontVariationSettings: '"opsz" 144, "wght" 500',
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            Spin the{" "}
            <span style={{ color: colors.accent, fontStyle: "italic" }}>
              dial
            </span>
            .
          </h1>
          <p
            style={{
              maxWidth: "40rem",
              margin: 0,
              fontFamily: fontStacks.body,
              fontSize: "1.1rem",
              lineHeight: 1.55,
              color: colors.text_dim,
            }}
          >
            Drop the needle on a random callsign from the corpus — restricted
            to entries that have a story attached: long-lived issuance,
            multiple holders, or a vanity-style cadence.
          </p>
        </div>
      </section>

      <div
        style={{
          maxWidth: "min(70rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label={loading ? "tuning" : "tuned"} />
      </div>

      {/* --- CARD ---------------------------------------------------- */}
      <section
        style={{
          maxWidth: "min(70rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 3rem",
        }}
      >
        {error ? (
          <div
            style={{
              padding: "3rem 1.5rem",
              border: `1px dashed ${colors.danger}`,
              borderRadius: "0.25rem",
              textAlign: "center",
              fontFamily: fontStacks.mono,
              color: colors.danger,
              letterSpacing: "0.1em",
            }}
          >
            Spin failed: {error}
          </div>
        ) : loading && !entry ? (
          <div
            style={{
              padding: "5rem 1.5rem",
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              borderRadius: "0.25rem",
              textAlign: "center",
              fontFamily: fontStacks.mono,
              color: colors.accent,
              fontSize: "0.9rem",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              animation: "dial-pulse 1.2s ease-in-out infinite",
            }}
          >
            tuning…
          </div>
        ) : entry ? (
          <div
            key={spinKey}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2rem",
              animation: "spin-flash 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
            }}
          >
            {/* Reason banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <ReasonBadge reason={entry.reason} />
              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  fontFamily: fontStacks.mono,
                  fontSize: "0.7rem",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: colors.text_dim,
                }}
              >
                <span>
                  <span style={{ color: colors.accent }}>
                    {entry.edition_count}
                  </span>{" "}
                  editions
                </span>
                <span aria-hidden>·</span>
                <span>
                  <span style={{ color: colors.accent }}>
                    {entry.distinct_holder_count}
                  </span>{" "}
                  holder{entry.distinct_holder_count === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Editorial detail — a much bigger render than the inline
                CallsignCard, but we still keep the CallsignCard below for
                the deep-link grid pattern. */}
            <article
              style={{
                position: "relative",
                padding: "3rem 2rem 3rem",
                border: `1px solid ${colors.border}`,
                borderTop: `3px solid ${colors.accent}`,
                background: colors.surface,
                borderRadius: "0.25rem",
                overflow: "hidden",
              }}
            >
              <Scanlines />
              <div
                style={{
                  position: "relative",
                  zIndex: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                }}
              >
                <Link
                  href={`/callsign/${encodeURIComponent(entry.callsign)}`}
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "clamp(3.5rem, 12vw, 9rem)",
                    fontWeight: 600,
                    color: colors.accent,
                    letterSpacing: "0.06em",
                    textShadow: motifs.glow.textShadow,
                    lineHeight: 1,
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  {entry.callsign}
                </Link>
                <div
                  style={{
                    fontFamily: fontStacks.display,
                    fontVariationSettings: '"opsz" 72',
                    fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                    lineHeight: 1.1,
                    color: colors.text,
                    fontStyle: entry.name ? "normal" : "italic",
                  }}
                >
                  {entry.name ? cleanOCRName(entry.name) || "name unrecovered" : "name unrecovered"}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "1.5rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.85rem",
                    color: colors.text_dim,
                    letterSpacing: "0.08em",
                  }}
                >
                  {cleanOCRCity(entry.city) || null ? <span>{cleanOCRCity(entry.city)}</span> : null}
                  {cleanOCRState(entry.city, entry.state) || null ? (
                    <Link
                      href={`/state/${cleanOCRState(entry.city, entry.state)}`}
                      style={{
                        color: colors.accent,
                        textDecoration: "none",
                      }}
                    >
                      {cleanOCRState(entry.city, entry.state)}
                    </Link>
                  ) : null}
                  <span>
                    <span style={{ color: colors.text }}>{entry.year}</span> ·{" "}
                    {entry.edition}
                  </span>
                  {entry.license_class ? (
                    <span>
                      class{" "}
                      <span style={{ color: colors.glow }}>
                        {classLabelForCode(entry.license_class, entry.year)}
                      </span>
                    </span>
                  ) : null}
                </div>
                <p
                  style={{
                    margin: 0,
                    marginTop: "0.5rem",
                    fontFamily: fontStacks.body,
                    fontSize: "1.05rem",
                    lineHeight: 1.55,
                    color: colors.text_dim,
                    fontStyle: "italic",
                    maxWidth: "44rem",
                  }}
                >
                  &ldquo;{entry.reason_detail}&rdquo;
                </p>
              </div>
            </article>

            {/* Also surface the compact CallsignCard so users can preview the
                same payload in the form it will appear in elsewhere on the
                site (search results, related rails). */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: "1rem",
              }}
            >
              <CallsignCard
                entry={{
                  year: entry.year,
                  edition: entry.edition,
                  callsign: entry.callsign,
                  license_class: entry.license_class,
                  name: entry.name,
                  address: entry.address,
                  city: entry.city,
                  state: entry.state,
                  zip: entry.zip,
                  raw_ocr: entry.raw_ocr,
                  flag: entry.flag,
                  source: entry.source,
                }}
              />
            </div>

            {/* Spin again — the dice IS the button. One-memorable-thing:
                clicking it tumbles a real die (face randomises while
                in-flight, settles on a random face when the response
                lands), and the result becomes the new spin. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.75rem",
                marginTop: "2rem",
              }}
            >
              <button
                type="button"
                onClick={spin}
                disabled={loading}
                aria-label="Roll the die — spin for a new notable callsign"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.875rem",
                  padding: "0.85rem 1rem 0.85rem 0.85rem",
                  background: colors.accent,
                  color: colors.bg,
                  border: "none",
                  borderRadius: "0.4rem",
                  fontFamily: fontStacks.mono,
                  fontSize: "0.85rem",
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading ? 0.85 : 1,
                  boxShadow: `0 0 22px -4px ${colors.glow}, 0 0 4px ${colors.accent_2}`,
                  transition: "opacity 150ms ease",
                }}
              >
                <motion.span
                  animate={diceControls}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 44,
                    height: 44,
                    borderRadius: "0.4rem",
                    background: colors.bg,
                    border: `1px solid ${colors.glow}`,
                    boxShadow: `inset 0 0 6px rgba(255,209,102,0.35)`,
                  }}
                >
                  <DicePips face={diceFace} />
                </motion.span>
                <span>{loading ? "rolling…" : "Roll again"}</span>
              </button>
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.62rem",
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  color: colors.text_dim,
                }}
              >
                last face ·{" "}
                <span style={{ color: colors.accent }}>
                  {diceFace}
                </span>{" "}
                · 1d6
              </span>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
