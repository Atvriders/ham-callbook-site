"use client";

/**
 * ClubAlphaStrip — the A–Z navigation strip rendered at the top of the
 * ``/clubs`` index. Acts as both a quick index (each letter links to an
 * anchor on the page, or to ``/clubs/by-letter/{letter}``) and a visual
 * "phosphor-amber typeset" header for the section.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - 26 monospaced letters in JetBrains Mono, sodium-amber, evenly
 *     distributed across the available width. Inactive letters (no
 *     clubs starting with that letter) are dimmed and non-interactive.
 *   - The currently selected letter is rendered with the glow text-shadow
 *     and an underline-block beneath it, mimicking a vintage tape-printed
 *     index card.
 *   - Counts (when ``counts`` is provided) appear as superscript-style
 *     mono digits above each letter — small, dim, but readable. Letters
 *     without any clubs use no superscript and a dimmed colour.
 *   - The strip itself sits inside a thin bordered band with a morse-code
 *     decoration on each side, replacing the conventional <hr>.
 */

import { useMemo } from "react";
import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClubAlphaStripProps {
  /**
   * Per-letter club counts. Keys are uppercase A–Z. Missing letters are
   * treated as 0. When omitted entirely, every letter is rendered
   * active (used during the initial empty-state of /clubs while the
   * counts payload is still loading).
   */
  counts?: Partial<Record<string, number>>;
  /** Currently highlighted letter ('A'–'Z'), or null for none. */
  active?: string | null;
  /**
   * Build the href for a given letter. Defaults to an in-page anchor
   * ``#letter-A``; the /clubs page can override this to route to the
   * ``/clubs/by-letter/{letter}`` route when paginating server-side.
   */
  hrefFor?: (letter: string) => string;
  /** Callback when a letter is clicked (in addition to navigation). */
  onLetterClick?: (letter: string) => void;
  /** Optional className passthrough. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function defaultHref(letter: string): string {
  return `#letter-${letter}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClubAlphaStrip({
  counts,
  active = null,
  hrefFor = defaultHref,
  onLetterClick,
  className,
}: ClubAlphaStripProps) {
  // Pre-compute (letter, count, active?) tuples once per render.
  const items = useMemo(() => {
    return LETTERS.map((L) => {
      const c = counts?.[L] ?? (counts ? 0 : null);
      const hasClubs = c === null ? true : c > 0;
      return { letter: L, count: c, hasClubs };
    });
  }, [counts]);

  return (
    <nav
      className={className}
      aria-label="Browse clubs by first letter"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        fontFamily: fontStacks.body,
      }}
    >
      {/* Left morse decoration */}
      <span
        aria-hidden
        style={{
          fontFamily: fontStacks.mono,
          color: colors.text_dim,
          fontSize: 10,
          letterSpacing: "0.18em",
          opacity: 0.5,
          flex: "0 0 auto",
          whiteSpace: "nowrap",
        }}
      >
        {motifs.morseDividers.tight}
      </span>

      {/* Letter grid */}
      <ol
        style={{
          flex: "1 1 auto",
          display: "grid",
          gridTemplateColumns: "repeat(26, minmax(0, 1fr))",
          gap: 0,
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {items.map(({ letter, count, hasClubs }) => {
          const isActive = active === letter;
          return (
            <li
              key={letter}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                minWidth: 0,
              }}
            >
              {/* superscript count row — always present so the baseline
                  of each letter aligns across the strip. */}
              <span
                aria-hidden
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: 8.5,
                  letterSpacing: "0.04em",
                  color: colors.text_dim,
                  opacity: hasClubs && count !== null && count > 0 ? 0.75 : 0,
                  lineHeight: 1,
                  height: 9,
                }}
              >
                {count !== null && count > 0 ? count : "·"}
              </span>

              {hasClubs ? (
                <a
                  href={hrefFor(letter)}
                  onClick={() => onLetterClick?.(letter)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={
                    count !== null
                      ? `Clubs starting with ${letter} (${count})`
                      : `Clubs starting with ${letter}`
                  }
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: 16,
                    fontWeight: 500,
                    color: isActive ? colors.glow : colors.accent,
                    textDecoration: "none",
                    lineHeight: 1,
                    padding: "2px 0 4px",
                    borderBottom: isActive
                      ? `2px solid ${colors.accent}`
                      : "2px solid transparent",
                    textShadow: isActive ? motifs.glow.textShadow : "none",
                    transition:
                      "color 140ms ease, border-color 140ms ease, text-shadow 220ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = colors.glow;
                      e.currentTarget.style.textShadow =
                        motifs.glow.textShadow;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = colors.accent;
                      e.currentTarget.style.textShadow = "none";
                    }
                  }}
                >
                  {letter}
                </a>
              ) : (
                <span
                  aria-disabled
                  title={`No clubs starting with ${letter}`}
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: 16,
                    fontWeight: 500,
                    color: colors.text_dim,
                    opacity: 0.35,
                    lineHeight: 1,
                    padding: "2px 0 4px",
                    borderBottom: "2px solid transparent",
                    cursor: "default",
                  }}
                >
                  {letter}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Right morse decoration */}
      <span
        aria-hidden
        style={{
          fontFamily: fontStacks.mono,
          color: colors.text_dim,
          fontSize: 10,
          letterSpacing: "0.18em",
          opacity: 0.5,
          flex: "0 0 auto",
          whiteSpace: "nowrap",
        }}
      >
        {motifs.morseDividers.tight}
      </span>
    </nav>
  );
}
