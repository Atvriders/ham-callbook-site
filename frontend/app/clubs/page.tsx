/**
 * /clubs — Radio Clubs index. (Sodium Vapor, editorial.)
 *
 * Server component. Fetches club data inline against the FastAPI service
 * (proxied by Caddy at /api).
 *
 * The page is built around ONE memorable thing: a colossal Fraunces
 * variable-axis display of the currently active letter (or an ampersand
 * for "ALL"), set behind the A–Z strip so the alphabet itself becomes
 * the hero. The selected letter visibly inflates inside the strip while
 * the colossal glyph behind it echoes the choice in editorial scale.
 *
 * Sections (top to bottom):
 *   1. Eyebrow with corpus stamp + morse rune.
 *   2. Two-column hero — "RADIO CLUBS" wordmark + lede prose, asymmetric.
 *   3. The alphabet glyph wall: a single oversized Fraunces letter as
 *      the background, the ClubAlphaStrip layered above it. The active
 *      letter in the strip inflates and glows.
 *   4. Notable rail — proper <ClubCard variant="compact"/> with the
 *      hand-drawn ClubTypePip glyphs.
 *   5. Morse divider.
 *   6. Search input (mono).
 *   7. Dense club table with right-rail marginalia (view label, count,
 *      timestamp, license-class key style).
 *
 * Aesthetic guardrails:
 *   - NO Inter, NO purple, NO hover:scale-105.
 *   - Hex values only from lib/design.ts.
 *   - CRT scanlines on the hero / glyph wall only.
 *   - Staggered entrance animations via CSS keyframes (server-safe).
 */

import { clubsByLetter, clubsNotable, clubsSearch } from "../../lib/club_api";
import { colors, fontStacks, motifs } from "../../lib/design";
import { cleanOCRCity, cleanOCRState } from "../../lib/ocrClean";
import type { ClubSummary } from "../../lib/types";
import ClubCard from "../../components/ClubCard";
import ClubTypePip from "../../components/ClubTypePip";

/** A-Z letters for the alphabet strip. */
const ALPHABET: string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

/**
 * Next.js 15 passes `searchParams` as a Promise in async server components.
 * We treat both shapes defensively (string | string[] | undefined) and
 * collapse to the first non-empty single string.
 */
type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find((v) => v && v.length > 0);
  return value && value.length > 0 ? value : undefined;
}

/**
 * Build the canonical URL for a letter chip — preserves any active query
 * so that "filter by letter then search" composes correctly.
 */
function letterHref(letter: string, q: string | undefined): string {
  const params = new URLSearchParams();
  params.set("letter", letter);
  if (q) params.set("q", q);
  return `/clubs?${params.toString()}`;
}

/**
 * Format a club's year span. Returns an em-dash for unknown bounds so the
 * column is always the same visual width in the dense table.
 */
function yearSpan(first: number | null, last: number | null): string {
  const f = first ?? "—";
  const l = last ?? "—";
  if (f === l) return String(f);
  return `${f}–${l}`;
}

/**
 * Decorative CRT scanlines layer. Pointer-events-none, absolutely
 * positioned within its container. Hero / glyph-wall only.
 */
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

/** Global SVG grain layer — once at the page root. */
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

/**
 * Morse-code divider — replaces <hr> throughout the site.
 */
function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "3rem 0",
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

/**
 * Bucket counts of clubs returned for the active view by leading letter.
 * Used to inflate the A–Z strip with per-letter activity dots.
 */
function bucketByLetter(clubs: ClubSummary[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of clubs) {
    const ch = (c.display_name?.[0] ?? "").toUpperCase();
    if (ch >= "A" && ch <= "Z") {
      out[ch] = (out[ch] ?? 0) + 1;
    }
  }
  return out;
}

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const letterRaw = firstParam(sp.letter);
  const letter =
    letterRaw && /^[A-Za-z]$/.test(letterRaw)
      ? letterRaw.toUpperCase()
      : undefined;

  const [notable, results] = await Promise.all([
    clubsNotable().catch(() => [] as ClubSummary[]),
    (letter
      ? clubsByLetter(letter)
      : clubsSearch(q, 50)
    ).catch(() => [] as ClubSummary[]),
  ]);

  let viewLabel: string;
  if (letter) viewLabel = `Letter ${letter}`;
  else if (q) viewLabel = `Search "${q}"`;
  else viewLabel = "Most active";

  // The colossal background glyph: the active letter, or an ampersand for
  // the all-view (the ampersand is Fraunces's most expressive glyph at
  // high opsz — a signature of the typeface, used here as a wordless
  // "everything" sigil).
  const heroGlyph = letter ?? "&";

  const letterBuckets = bucketByLetter(results);

  // Restrict notable rail to top 8 per spec.
  const notableTop = notable.slice(0, 8);

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100dvh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
      }}
    >
      <Grain />

      {/* Server-rendered keyframes — no client component needed for the
          staggered entrance animations. Tied to a per-section delay
          variable so each block reveals in turn. */}
      <style>{`
        @keyframes sv-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sv-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes sv-wipe {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        @keyframes sv-glow-pulse {
          0%,100% { text-shadow: 0 0 16px rgba(255,209,102,0.35), 0 0 2px rgba(255,163,11,0.6); }
          50%     { text-shadow: 0 0 28px rgba(255,209,102,0.55), 0 0 4px rgba(255,163,11,0.9); }
        }
        .sv-rise   { animation: sv-rise 700ms cubic-bezier(.2,.7,.2,1) both; }
        .sv-fade   { animation: sv-fade 800ms ease-out both; }
        .sv-wipe   { animation: sv-wipe 900ms cubic-bezier(.2,.7,.2,1) both; transform-origin: left center; }
        .sv-pulse  { animation: sv-glow-pulse 3.2s ease-in-out infinite; }
        .sv-d-0   { animation-delay: 0ms; }
        .sv-d-1   { animation-delay: 80ms; }
        .sv-d-2   { animation-delay: 160ms; }
        .sv-d-3   { animation-delay: 260ms; }
        .sv-d-4   { animation-delay: 380ms; }
        .sv-d-5   { animation-delay: 520ms; }
        .sv-d-6   { animation-delay: 680ms; }
        .sv-letter-active { font-variation-settings: "opsz" 144, "wght" 600; }
      `}</style>

      {/* --- ASYMMETRIC HERO ---------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />
        <div
          className="sv-rise sv-d-0"
          style={{
            position: "relative",
            zIndex: 2,
            display: "grid",
            gridTemplateColumns: "minmax(0, 7fr) minmax(0, 4fr)",
            gap: "2.5rem",
            alignItems: "end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div
              className="sv-fade sv-d-0"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              {motifs.morseDividers.tight} &nbsp; vol. iv · clubs ·
              {" "}index
            </div>
            <h1
              className="sv-rise sv-d-1"
              style={{
                fontFamily: fontStacks.display,
                fontSize: "clamp(4rem, 13vw, 11rem)",
                fontWeight: 600,
                fontVariationSettings: '"opsz" 144, "SOFT" 100',
                lineHeight: 0.86,
                letterSpacing: "-0.035em",
                margin: 0,
                color: colors.text,
                textShadow: motifs.glow.textShadow,
              }}
            >
              Radio
              <br />
              <span
                style={{
                  fontStyle: "italic",
                  fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 400',
                  color: colors.glow,
                }}
              >
                Clubs.
              </span>
            </h1>
          </div>

          <aside
            className="sv-rise sv-d-3"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              paddingBottom: "0.75rem",
              borderLeft: `1px solid ${colors.border}`,
              paddingLeft: "1.5rem",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: fontStacks.body,
                fontSize: "1rem",
                lineHeight: 1.55,
                color: colors.text_dim,
                maxWidth: "32ch",
              }}
            >
              Every amateur-radio club, university station, league and
              repeater association detected across the twentieth-century
              printed callbook corpus. Browse the alphabet, search by name,
              or jump to a notable station below.
            </p>
            <div
              style={{
                display: "flex",
                gap: "1.25rem",
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              <span>
                <span style={{ color: colors.accent }}>
                  {notable.length.toString().padStart(3, "0")}
                </span>{" "}
                notable
              </span>
              <span aria-hidden style={{ opacity: 0.5 }}>·</span>
              <span>
                <span style={{ color: colors.accent }}>26</span> letters
              </span>
              <span aria-hidden style={{ opacity: 0.5 }}>·</span>
              <span>
                <span style={{ color: colors.accent }}>1909–1997</span>
              </span>
            </div>
          </aside>
        </div>
      </section>

      {/* --- ALPHABET GLYPH WALL ----------------------------------------- */}
      {/* The MEMORABLE THING: a half-page Fraunces glyph behind the A–Z. */}
      <section
        style={{
          position: "relative",
          padding: "1.25rem 2rem 1.75rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />

        {/* The colossal background glyph. Absolutely positioned, low
            opacity, so the strip above it reads as a legible "marker"
            on the cover of a printed catalogue. */}
        <div
          aria-hidden
          className="sv-fade sv-d-2"
          style={{
            position: "absolute",
            right: "-2vw",
            top: "-3rem",
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <span
            key={heroGlyph}
            className="sv-pulse"
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(16rem, 38vw, 38rem)",
              fontVariationSettings:
                '"opsz" 144, "SOFT" 100, "wght" 300',
              fontStyle: heroGlyph === "&" ? "italic" : "normal",
              color: colors.accent,
              opacity: 0.085,
              lineHeight: 0.78,
              letterSpacing: "-0.06em",
              userSelect: "none",
            }}
          >
            {heroGlyph}
          </span>
        </div>

        {/* The interactive A–Z strip overlaid on the glyph. We keep our
            own bespoke strip here (rather than ClubAlphaStrip) so the
            selected letter can inflate dramatically via the Fraunces
            opsz axis — the "memorable detail". */}
        <nav
          aria-label="Browse clubs alphabetically"
          className="sv-rise sv-d-3"
          style={{
            position: "relative",
            zIndex: 2,
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "end",
            gap: "1.25rem",
            paddingBottom: "1rem",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <a
            href={q ? `/clubs?q=${encodeURIComponent(q)}` : "/clubs"}
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: letter ? colors.text_dim : colors.accent,
              textDecoration: "none",
              padding: "0.4rem 0",
              borderBottom: `2px solid ${
                letter ? "transparent" : colors.accent
              }`,
              alignSelf: "end",
            }}
          >
            ALL
          </a>

          <ol
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(26, minmax(0, 1fr))",
              alignItems: "end",
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
          >
            {ALPHABET.map((L) => {
              const active = L === letter;
              const has = (letterBuckets[L] ?? 0) > 0;
              return (
                <li
                  key={L}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.2rem",
                    minWidth: 0,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: 8,
                      letterSpacing: "0.04em",
                      color: colors.text_dim,
                      opacity: has ? 0.7 : 0,
                      lineHeight: 1,
                      height: 8,
                    }}
                  >
                    {has ? letterBuckets[L] : "·"}
                  </span>
                  <a
                    href={letterHref(L, q)}
                    aria-current={active ? "page" : undefined}
                    style={{
                      fontFamily: fontStacks.display,
                      // Active letter inflates — this is the choreography
                      // the user feels on every click.
                      fontSize: active
                        ? "clamp(2.4rem, 4.2vw, 3.6rem)"
                        : "clamp(0.95rem, 1.1vw, 1.2rem)",
                      fontVariationSettings: active
                        ? '"opsz" 144, "wght" 600, "SOFT" 30'
                        : '"opsz" 14, "wght" 500',
                      lineHeight: 0.9,
                      color: active ? colors.glow : colors.text_dim,
                      textDecoration: "none",
                      letterSpacing: active ? "-0.03em" : "0.04em",
                      textShadow: active
                        ? motifs.glow.textShadow
                        : "none",
                      padding: active ? "0 0 0.1rem" : "0.2rem 0 0.3rem",
                      transition:
                        "color 180ms ease, font-size 320ms cubic-bezier(.2,.7,.2,1), letter-spacing 320ms ease",
                      textAlign: "center",
                      display: "block",
                    }}
                  >
                    {L}
                  </a>
                  <span
                    aria-hidden
                    style={{
                      height: 2,
                      width: active ? "70%" : 0,
                      background: colors.accent,
                      transition: "width 320ms cubic-bezier(.2,.7,.2,1)",
                    }}
                  />
                </li>
              );
            })}
          </ol>

          <span
            aria-hidden
            style={{
              fontFamily: fontStacks.mono,
              fontSize: 10,
              letterSpacing: "0.3em",
              color: colors.text_dim,
              opacity: 0.6,
              whiteSpace: "nowrap",
              alignSelf: "end",
              paddingBottom: "0.4rem",
            }}
          >
            {motifs.morseDividers.tight}
          </span>
        </nav>
      </section>

      {/* --- NOTABLE RAIL ------------------------------------------------- */}
      <section
        className="sv-rise sv-d-4"
        style={{
          padding: "2.5rem 2rem 0",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "baseline",
            gap: "1rem",
            marginBottom: "1.25rem",
          }}
        >
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(1.6rem, 2.6vw, 2.4rem)",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 60, "SOFT" 50',
              margin: 0,
              color: colors.text,
              letterSpacing: "-0.015em",
            }}
          >
            Notable stations
            <span
              style={{
                marginLeft: "0.6rem",
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 60, "wght" 400',
                color: colors.text_dim,
                fontSize: "0.7em",
              }}
            >
              the top {notableTop.length}.
            </span>
          </h2>
          <span
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            sorted by appearances
          </span>
        </div>
        {notableTop.length === 0 ? (
          <div
            style={{
              color: colors.text_dim,
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
            }}
          >
            No notable clubs available.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(100%, 18rem), 1fr))",
              gap: "0.75rem",
            }}
          >
            {notableTop.map((club, i) => (
              <div
                key={club.slug}
                className={`sv-rise sv-d-${Math.min(6, i)}`}
              >
                <ClubCard club={club} variant="compact" />
              </div>
            ))}
          </div>
        )}
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="browse" />
      </div>

      {/* --- SEARCH ------------------------------------------------------ */}
      <section
        style={{
          padding: "0 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <form
          method="GET"
          action="/clubs"
          role="search"
          className="sv-rise sv-d-2"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: "0.5rem",
          }}
        >
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="search clubs — e.g. REDWOOD EMPIRE, MIT, ARRL …"
            aria-label="Search clubs"
            autoCapitalize="characters"
            autoCorrect="off"
            style={{
              padding: "1rem 1.25rem",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${colors.accent}`,
              color: colors.text,
              fontFamily: fontStacks.mono,
              fontSize: "1rem",
              letterSpacing: "0.04em",
              outline: "none",
              borderRadius: "0.125rem",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "1rem 1.75rem",
              background: colors.accent,
              border: `1px solid ${colors.accent}`,
              color: colors.bg,
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              fontWeight: 600,
              cursor: "pointer",
              borderRadius: "0.125rem",
            }}
          >
            Transmit
          </button>
        </form>
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label={viewLabel} />
      </div>

      {/* --- DENSE TABLE -------------------------------------------------- */}
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          className="sv-rise sv-d-1"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "baseline",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(1.6rem, 2.6vw, 2.4rem)",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 60, "SOFT" 50',
              margin: 0,
              letterSpacing: "-0.015em",
            }}
          >
            {viewLabel}
          </h2>
          <span
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            <span style={{ color: colors.accent }}>
              {results.length.toString().padStart(3, "0")}
            </span>{" "}
            result{results.length === 1 ? "" : "s"}
          </span>
        </div>

        {results.length === 0 ? (
          <div
            style={{
              padding: "3rem 1rem",
              textAlign: "center",
              color: colors.text_dim,
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              letterSpacing: "0.1em",
              border: `1px dashed ${colors.border}`,
              borderRadius: "0.125rem",
            }}
          >
            No clubs matched. {motifs.morseDividers.tight}
          </div>
        ) : (
          <div
            role="table"
            aria-label="Clubs results"
            className="sv-rise sv-d-2"
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1fr) auto minmax(4rem, auto) minmax(7rem, auto) minmax(3rem, auto)",
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            {/* Header row */}
            <div role="row" style={{ display: "contents" }}>
              {[
                "Name",
                "Type",
                "Calls",
                "Years",
                "ST",
              ].map((label, i) => (
                <div
                  key={label}
                  role="columnheader"
                  style={{
                    padding: "0.65rem 0.75rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.6rem",
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: colors.text_dim,
                    borderBottom: `1px solid ${colors.border}`,
                    textAlign: i >= 2 ? "right" : "left",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            {results.map((club, rowIdx) => (
              <a
                key={club.slug}
                role="row"
                href={`/club/${encodeURIComponent(club.slug)}`}
                style={{
                  display: "contents",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <div
                  role="cell"
                  style={{
                    padding: "0.85rem 0.75rem",
                    fontFamily: fontStacks.display,
                    fontSize: "1.05rem",
                    fontVariationSettings: '"opsz" 24, "SOFT" 50',
                    color: colors.text,
                    borderBottom: `1px solid ${colors.border}`,
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.75rem",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: "0.65rem",
                      color: colors.border,
                      width: "2.5rem",
                      flexShrink: 0,
                      letterSpacing: "0.1em",
                    }}
                  >
                    {(rowIdx + 1).toString().padStart(3, "0")}
                  </span>
                  <span>{club.display_name}</span>
                  {cleanOCRCity(club.dominant_city) ? (
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.7rem",
                        letterSpacing: "0.08em",
                        color: colors.text_dim,
                        fontStyle: "italic",
                      }}
                    >
                      / {cleanOCRCity(club.dominant_city)}
                    </span>
                  ) : null}
                </div>
                <div
                  role="cell"
                  style={{
                    padding: "0.85rem 0.75rem",
                    borderBottom: `1px solid ${colors.border}`,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {club.club_type ? (
                    <ClubTypePip type={club.club_type} size={11} iconOnly />
                  ) : (
                    <span
                      style={{
                        color: colors.border,
                        fontFamily: fontStacks.mono,
                        fontSize: "0.7rem",
                      }}
                    >
                      —
                    </span>
                  )}
                </div>
                <div
                  role="cell"
                  style={{
                    padding: "0.85rem 0.75rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.9rem",
                    color: colors.accent,
                    textAlign: "right",
                    borderBottom: `1px solid ${colors.border}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {club.callsign_count.toString().padStart(3, "0")}
                </div>
                <div
                  role="cell"
                  style={{
                    padding: "0.85rem 0.75rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.85rem",
                    color: colors.text,
                    textAlign: "right",
                    borderBottom: `1px solid ${colors.border}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {yearSpan(club.first_year, club.last_year)}
                </div>
                <div
                  role="cell"
                  style={{
                    padding: "0.85rem 0.75rem",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.85rem",
                    color: colors.text_dim,
                    textAlign: "right",
                    borderBottom: `1px solid ${colors.border}`,
                    letterSpacing: "0.08em",
                  }}
                >
                  {cleanOCRState(null, club.dominant_state) || "—"}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* --- DEFUNCT / SILENT CLUBS entry-point -------------------------------- */}
      <section
        style={{
          padding: "0 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto 4rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            marginTop: "3rem",
            borderTop: `1px solid ${colors.border}`,
            borderBottom: `1px solid ${colors.border}`,
            padding: "2rem 0",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: "2rem",
            alignItems: "center",
          }}
        >
          {/* "SK" memorial glyph */}
          <div
            aria-hidden
            style={{
              fontFamily: fontStacks.display,
              fontVariationSettings: '"opsz" 72, "SOFT" 0, "WONK" 1',
              fontSize: "clamp(3rem, 7vw, 5rem)",
              fontWeight: 700,
              fontStyle: "italic",
              color: colors.accent,
              opacity: 0.25,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              userSelect: "none",
            }}
          >
            SK
          </div>

          {/* Lede */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.6rem",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              ·—· SK ·—·
            </span>
            <span
              style={{
                fontFamily: fontStacks.display,
                fontVariationSettings: '"opsz" 48, "SOFT" 30',
                fontSize: "clamp(1rem, 2.5vw, 1.4rem)",
                fontWeight: 600,
                color: colors.text,
                letterSpacing: "-0.01em",
              }}
            >
              Defunct &amp; Silent Clubs
            </span>
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.78rem",
                color: colors.text_dim,
                maxWidth: "52ch",
                lineHeight: 1.5,
              }}
            >
              Clubs that appeared in the printed callbooks and never returned —
              cross-referenced against current FCC ULS to confirm every call is dead.
              1,611 clubs whose last transmission was decades ago.
            </span>
          </div>

          {/* CTA */}
          <a
            href="/clubs/defunct"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.65rem 1.25rem",
              border: `1px solid ${colors.accent}`,
              color: colors.accent,
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "background 150ms ease, color 150ms ease",
            }}
            onMouseEnter={undefined}
          >
            View Silent Clubs →
          </a>
        </div>
      </section>
    </main>
  );
}
