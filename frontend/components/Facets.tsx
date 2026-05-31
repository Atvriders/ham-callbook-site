"use client";

/**
 * Facets — left-rail search facet panel with vertical bar mini-charts.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Companion to ``/search``: takes the ``SearchFacets`` payload
 *     (per-year + per-state counts) and renders two stacked groups —
 *     a year histogram (vertical amber bars by edition year) and a
 *     state list (clickable mono chips).
 *   - Each facet value is a chip toggle: clicking emits ``onSelect`` so
 *     the parent can patch the URL search-params. The active chip wears
 *     an amber-filled border + faint glow; inactive chips are
 *     border-only.
 *   - The year histogram is a deliberately low-fidelity ASCII-adjacent
 *     bar chart: thin amber rectangles whose height encodes count.
 *     Hover surfaces the year + count in a tooltip-style label.
 *   - No chart library — pure flex layout. Keeps the bundle small and
 *     matches the "no shadcn aesthetic" rule.
 */

import { useMemo, type CSSProperties } from "react";
import { colors, fontStacks } from "@/lib/design";
import type { SearchFacets } from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FacetsProps {
  facets: SearchFacets;
  /** Currently-active year filter, if any. */
  activeYear?: number | null;
  /** Currently-active state code (two-letter), if any. */
  activeState?: string | null;
  /** Fired when the user toggles a year chip / bar. */
  onSelectYear?: (year: number | null) => void;
  /** Fired when the user toggles a state chip. */
  onSelectState?: (state: string | null) => void;
  /** Top-N state chips to render. Defaults 12. */
  maxStates?: number;
  className?: string;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Facets({
  facets,
  activeYear = null,
  activeState = null,
  onSelectYear,
  onSelectState,
  maxStates = 12,
  className,
  style,
}: FacetsProps) {
  const { years, states } = facets;

  // Normalise the year histogram. We bucket by the canonical year value
  // so missing editions render as gaps rather than implicit zero columns.
  const maxYearCount = useMemo(
    () => years.reduce((acc, y) => Math.max(acc, y.count), 0) || 1,
    [years],
  );

  const topStates = useMemo(
    () => states.slice().sort((a, b) => b.count - a.count).slice(0, maxStates),
    [states, maxStates],
  );

  return (
    <aside
      className={className}
      aria-label="Search facets"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "20px 18px",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        fontFamily: fontStacks.body,
        color: colors.text,
        ...style,
      }}
    >
      {/* ------------- Year histogram ------------- */}
      <section>
        <FacetHeader title="By year" hint={`${years.length} editions`} />
        <div
          role="group"
          aria-label="Year histogram"
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 2,
            height: 64,
            padding: "8px 0",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          {years.map((y) => {
            const ratio = y.count / maxYearCount;
            const isActive = activeYear === y.year;
            return (
              <button
                key={y.year}
                type="button"
                onClick={() =>
                  onSelectYear?.(isActive ? null : y.year)
                }
                title={`${y.year} — ${y.count.toLocaleString()} hit${y.count === 1 ? "" : "s"}`}
                aria-pressed={isActive}
                aria-label={`Filter year ${y.year}`}
                style={{
                  flex: "1 1 0",
                  minWidth: 2,
                  height: `${Math.max(ratio * 100, 3)}%`,
                  background: isActive ? colors.accent : colors.accent_2,
                  opacity: isActive ? 1 : 0.55,
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  transition: "opacity 100ms ease-out, background 100ms",
                  boxShadow: isActive
                    ? `0 0 8px ${colors.glow}`
                    : "none",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity =
                    isActive ? "1" : "0.55";
                }}
              />
            );
          })}
        </div>
        {/* tick labels: first + last + active */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontFamily: fontStacks.mono,
            fontSize: 10,
            letterSpacing: "0.08em",
            color: colors.text_dim,
          }}
        >
          <span>{years[0]?.year ?? "—"}</span>
          {activeYear !== null && (
            <span style={{ color: colors.accent }}>{activeYear}</span>
          )}
          <span>{years[years.length - 1]?.year ?? "—"}</span>
        </div>
      </section>

      {/* ------------- State chips ------------- */}
      <section>
        <FacetHeader title="By state" hint={`${states.length} total`} />
        <ul
          role="list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {topStates.map((s) => {
            const isActive = activeState === s.state;
            return (
              <li key={s.state}>
                <button
                  type="button"
                  onClick={() =>
                    onSelectState?.(isActive ? null : s.state)
                  }
                  aria-pressed={isActive}
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: 6,
                    padding: "4px 8px",
                    border: `1px solid ${
                      isActive ? colors.accent : colors.border
                    }`,
                    borderRadius: 2,
                    background: isActive
                      ? "rgba(255,163,11,0.10)"
                      : "transparent",
                    color: colors.text,
                    cursor: "pointer",
                    fontFamily: fontStacks.mono,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    boxShadow: isActive
                      ? `0 0 8px rgba(255,209,102,0.20)`
                      : "none",
                    transition: "background 120ms, border-color 120ms",
                  }}
                >
                  <span style={{ color: colors.accent }}>{s.state}</span>
                  <span style={{ color: colors.text_dim }}>
                    {s.count.toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Internal — facet header strip
// ---------------------------------------------------------------------------

function FacetHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 8,
        paddingBottom: 4,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontFamily: fontStacks.mono,
          fontSize: 10.5,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: colors.accent,
        }}
      >
        {title}
      </h3>
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: 10,
          letterSpacing: "0.10em",
          color: colors.text_dim,
        }}
      >
        {hint}
      </span>
    </header>
  );
}
