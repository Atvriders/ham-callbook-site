"use client";

/**
 * DataTable — dense, hairline-bordered tabular grid for callbook records.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Reads like a stat sheet from a 1956 ARRL handbook. Single-pixel
 *     hairline rules (1px solid #2a3349) between rows and columns, no
 *     zebra striping, no rounded corners, no shadcn-style padding bloat.
 *   - Callsign and state columns automatically pick up the JetBrains
 *     Mono stack so the typographic colour matches the rest of the site;
 *     other columns use Geist Sans.
 *   - Rows are optionally clickable. When ``onRowClick`` is supplied, the
 *     row exposes ``role="button"``, ``tabIndex=0``, keyboard activation,
 *     and a sodium-amber hover wash.
 *   - Empty datasets defer to the caller — pass an ``<EmptyState/>`` as
 *     ``emptyFallback`` rather than building one inline.
 *
 * Used by /search results, /callsign/{cs} appearance lists, club roster
 * tables on /club/{slug}, and the corpus-stats marginalia panels.
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single column definition. ``key`` indexes into the row record; ``label``
 * is the printed header. ``mono`` forces the JetBrains Mono stack on the
 * cell (defaults true for keys that look like callsigns / state codes).
 * ``render`` lets the caller fully customise the cell body — handy for
 * snippet HTML, license-class pips, or year ranges.
 */
export interface DataTableColumn<Row> {
  key: keyof Row & string;
  label: string;
  /** Force monospace cell rendering. Auto-true for "callsign"/"state". */
  mono?: boolean;
  /** Tailwind-style width hint, e.g. "120px" or "minmax(0,1fr)". */
  width?: string;
  /** Right-align the cell content. Defaults left. */
  align?: "left" | "right" | "center";
  /** Custom cell renderer; receives the full row plus the raw cell value. */
  render?: (row: Row, value: Row[keyof Row]) => ReactNode;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Optional row click handler — also enables keyboard activation. */
  onRowClick?: (row: Row, index: number) => void;
  /** Stable per-row key extractor. Defaults to index when omitted. */
  rowKey?: (row: Row, index: number) => string | number;
  /** Rendered when ``rows`` is empty. Typically an ``<EmptyState/>``. */
  emptyFallback?: ReactNode;
  /** Optional caption rendered above the table (used by screen readers). */
  caption?: string;
  /**
   * Minimum rendered width of the grid. When the viewport is narrower than
   * this (i.e. phones), the outer wrapper scrolls horizontally instead of
   * crushing the columns. Defaults to ~6rem per column.
   */
  minWidth?: number | string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Auto-pick the mono stack for callsign-shaped columns. */
function shouldDefaultMono(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "callsign" ||
    k === "state" ||
    k === "zip" ||
    k === "year" ||
    k === "edition"
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  onRowClick,
  rowKey,
  emptyFallback,
  caption,
  minWidth,
  className,
}: DataTableProps<Row>) {
  const gridTemplate = useMemo(
    () =>
      columns
        .map((c) => c.width ?? "minmax(0, 1fr)")
        .join(" "),
    [columns],
  );

  if (rows.length === 0 && emptyFallback !== undefined) {
    return <div className={className}>{emptyFallback}</div>;
  }

  const headerStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: gridTemplate,
    borderTop: `1px solid ${colors.border}`,
    borderBottom: `1px solid ${colors.border}`,
    fontFamily: fontStacks.mono,
    fontSize: 10.5,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: colors.accent,
    background: "rgba(255,163,11,0.03)",
  };

  return (
    // Horizontal-scroll containment: on narrow viewports (320–375px phones)
    // the wrapper scrolls sideways instead of crushing the grid columns.
    // When the content fits (desktop), the wrapper is inert.
    <div className={className} style={{ overflowX: "auto" }}>
      <div
        role="table"
        aria-label={caption}
        style={{
          fontFamily: fontStacks.body,
          color: colors.text,
          fontSize: 13,
          minWidth: minWidth ?? `${Math.max(columns.length * 6, 20)}rem`,
        }}
      >
        {caption && (
          <span style={{ position: "absolute", left: -9999, top: -9999 }}>
            {caption}
          </span>
        )}

        {/* header row */}
        <div role="row" style={headerStyle}>
          {columns.map((col) => (
            <span
              key={col.key}
              role="columnheader"
              style={{
                padding: "8px 12px",
                textAlign: col.align ?? "left",
                borderRight: `1px solid ${colors.border}`,
              }}
            >
              {col.label}
            </span>
          ))}
        </div>

        {/* body rows */}
        {rows.map((row, idx) => {
          const key = rowKey ? rowKey(row, idx) : idx;
          const clickable = Boolean(onRowClick);
          return (
            <div
              role="row"
              key={key}
              tabIndex={clickable ? 0 : undefined}
              aria-rowindex={idx + 2}
              onClick={clickable ? () => onRowClick?.(row, idx) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick?.(row, idx);
                      }
                    }
                  : undefined
              }
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                borderBottom: `1px solid ${colors.border}`,
                cursor: clickable ? "pointer" : "default",
                transition: "background 120ms ease-out",
              }}
              onMouseEnter={(e) => {
                if (clickable)
                  (e.currentTarget as HTMLDivElement).style.background =
                    "rgba(255,163,11,0.05)";
              }}
              onMouseLeave={(e) => {
                if (clickable)
                  (e.currentTarget as HTMLDivElement).style.background =
                    "transparent";
              }}
            >
              {columns.map((col) => {
                const value = row[col.key] as Row[keyof Row];
                const mono = col.mono ?? shouldDefaultMono(col.key);
                const display =
                  col.render !== undefined
                    ? col.render(row, value)
                    : value === null || value === undefined
                      ? "—"
                      : String(value);
                return (
                  <span
                    key={col.key}
                    role="cell"
                    style={{
                      padding: "7px 12px",
                      textAlign: col.align ?? "left",
                      borderRight: `1px solid ${colors.border}`,
                      fontFamily: mono ? fontStacks.mono : fontStacks.body,
                      fontSize: mono ? 12.5 : 13,
                      letterSpacing: mono ? "0.04em" : undefined,
                      color:
                        value === null || value === undefined
                          ? colors.text_dim
                          : colors.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {display}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
