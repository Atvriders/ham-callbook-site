"use client";

/**
 * Pagination — page-number strip for search results & roster lists.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Mono-spaced page tokens (JetBrains Mono) in an inline row, with the
 *     active page wearing the sodium-amber halo from
 *     ``motifs.glow.textShadow``. No ``scale-105`` hovers — interaction
 *     is signalled by a colour shift and a faint underline only.
 *   - Compact "windowed" rendering: shows the first page, last page, and
 *     a 2-page window around current. Gaps fill with a low-contrast
 *     ellipsis glyph.
 *   - Prev / Next arrows render as Fraunces-italic chevrons (``‹`` ``›``)
 *     and disable cleanly at the edges via ``aria-disabled`` + reduced
 *     opacity.
 *   - Page changes are dispatched via ``onPageChange`` — the parent owns
 *     the URL search-param mutation.
 */

import { useMemo, type CSSProperties } from "react";
import { colors, fontStacks } from "@/lib/design";

export interface PaginationProps {
  /** 1-indexed current page. */
  page: number;
  /** Total number of pages. */
  totalPages: number;
  /** Fired with the requested 1-indexed page. */
  onPageChange: (page: number) => void;
  /** Number of sibling pages to show either side of current. Defaults 2. */
  siblings?: number;
  /** Hide entirely when totalPages <= 1. Defaults true. */
  hideOnSinglePage?: boolean;
  className?: string;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/** Build the windowed token sequence — numbers + ``"…"`` gap markers. */
function buildTokens(
  page: number,
  totalPages: number,
  siblings: number,
): Array<number | "…"> {
  if (totalPages <= 7 + siblings * 2) return range(1, totalPages);

  const leftBoundary = Math.max(2, page - siblings);
  const rightBoundary = Math.min(totalPages - 1, page + siblings);

  const tokens: Array<number | "…"> = [1];
  if (leftBoundary > 2) tokens.push("…");
  for (const p of range(leftBoundary, rightBoundary)) tokens.push(p);
  if (rightBoundary < totalPages - 1) tokens.push("…");
  tokens.push(totalPages);

  return tokens;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  siblings = 2,
  hideOnSinglePage = true,
  className,
  style,
}: PaginationProps) {
  const tokens = useMemo(
    () => buildTokens(page, totalPages, siblings),
    [page, totalPages, siblings],
  );

  if (hideOnSinglePage && totalPages <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav
      aria-label="Pagination"
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontFamily: fontStacks.mono,
        fontSize: 13,
        color: colors.text,
        ...style,
      }}
    >
      <ArrowButton
        direction="prev"
        disabled={prevDisabled}
        onClick={() => !prevDisabled && onPageChange(page - 1)}
      />

      {tokens.map((tok, idx) =>
        tok === "…" ? (
          <span
            key={`gap-${idx}`}
            aria-hidden="true"
            style={{
              padding: "4px 6px",
              color: colors.text_dim,
              letterSpacing: "0.1em",
            }}
          >
            …
          </span>
        ) : (
          <PageToken
            key={tok}
            page={tok}
            active={tok === page}
            onClick={() => onPageChange(tok)}
          />
        ),
      )}

      <ArrowButton
        direction="next"
        disabled={nextDisabled}
        onClick={() => !nextDisabled && onPageChange(page + 1)}
      />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function PageToken({
  page,
  active,
  onClick,
}: {
  page: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={`Go to page ${page}`}
      onClick={onClick}
      style={{
        minWidth: 30,
        padding: "5px 9px",
        background: "transparent",
        border: `1px solid ${active ? colors.accent : "transparent"}`,
        color: active ? colors.accent : colors.text,
        cursor: "pointer",
        fontFamily: fontStacks.mono,
        fontSize: 13,
        letterSpacing: "0.04em",
        borderRadius: 2,
        textShadow: active
          ? "0 0 10px rgba(255,209,102,0.45), 0 0 2px rgba(255,163,11,0.7)"
          : "none",
        transition: "color 120ms, border-color 120ms",
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.color = colors.text;
      }}
    >
      {page}
    </button>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const glyph = direction === "prev" ? "‹" : "›";
  const label = direction === "prev" ? "Previous page" : "Next page";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-disabled={disabled}
      style={{
        padding: "4px 10px",
        background: "transparent",
        border: "none",
        color: disabled ? colors.text_dim : colors.accent,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: fontStacks.display,
        fontStyle: "italic",
        fontSize: 18,
        opacity: disabled ? 0.4 : 1,
        transition: "color 120ms",
      }}
    >
      {glyph}
    </button>
  );
}
