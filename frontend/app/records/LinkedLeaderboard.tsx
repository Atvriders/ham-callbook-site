/**
 * LinkedLeaderboard — the /records leaderboard table with per-row
 * deep-links to the shareable record card at /records/{category}/{rank}.
 *
 * Server component (no "use client" — it receives data as props). This is
 * the same layout as components/records/LeaderboardTable (which stays
 * untouched for other consumers) with two link targets per row:
 *
 *   - rank pip  → /records/{category}/{rank}   (shareable record card)
 *   - call/club → /callsign/{cs} or /clubs/{slug} (full archive record)
 *
 * The backend keeps each row's original rank when state/district facets
 * are applied, so `row.rank` is a stable permalink even from a filtered
 * view.
 *
 * Aesthetic guardrails: NO Inter, NO purple, NO hover:scale-105. All hex
 * values from lib/design.ts.
 */

import Link from "next/link";
import { colors, fontStacks } from "../../lib/design";
import { MedalPip } from "../../components/records/MedalPip";
import type { LeaderboardRow } from "../../components/records/LeaderboardTable";

interface LinkedLeaderboardProps {
  rows: LeaderboardRow[];
  linkType: "callsign" | "club";
  sortField: string;
  /** Category name used to build /records/{category}/{rank} permalinks. */
  category: string;
}

function fmtSpan(row: LeaderboardRow): string {
  if (row.first_year != null && row.last_year != null) {
    return `${row.first_year}–${row.last_year}`;
  }
  return "—";
}

function fmtMetric(row: LeaderboardRow, sortField: string): string {
  if (sortField === "span_years" && row.span_years != null) {
    return `${row.span_years} yr`;
  }
  if (sortField === "first_year" && row.first_year != null) {
    return `${row.first_year}`;
  }
  if (sortField === "distinct_holders" && row.distinct_holders != null) {
    return `${row.distinct_holders} holders`;
  }
  return "—";
}

function rowHref(row: LeaderboardRow, linkType: "callsign" | "club"): string {
  if (linkType === "club") {
    return `/clubs/${row.slug ?? ""}`;
  }
  return `/callsign/${row.callsign ?? ""}`;
}

function rowLabel(row: LeaderboardRow, linkType: "callsign" | "club"): string {
  if (linkType === "club") {
    return row.display_name ?? row.slug ?? "";
  }
  return row.callsign ?? "";
}

function rowSublabel(
  row: LeaderboardRow,
  linkType: "callsign" | "club",
): string | null {
  if (linkType === "callsign" && row.holder_name) {
    return row.holder_name;
  }
  return null;
}

export function LinkedLeaderboard({
  rows,
  linkType,
  sortField,
  category,
}: LinkedLeaderboardProps) {
  if (rows.length === 0) {
    return (
      <p
        style={{
          color: colors.text_dim,
          fontFamily: fontStacks.body,
          padding: "2rem 0",
        }}
      >
        No entries for this selection.
      </p>
    );
  }

  return (
    <div
      role="table"
      aria-label="Leaderboard"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        background: colors.border,
        border: `1px solid ${colors.border}`,
        borderRadius: "0.25rem",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: "3rem 1fr 7rem 5rem 4rem",
          gap: "0.75rem",
          padding: "0.5rem 1rem",
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {["#", linkType === "club" ? "Club" : "Call", "Years", "Span", "ST"].map(
          (h) => (
            <span
              key={h}
              role="columnheader"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.6rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              {h}
            </span>
          ),
        )}
      </div>

      {/* Rows */}
      {rows.map((row) => {
        const href = rowHref(row, linkType);
        const label = rowLabel(row, linkType);
        const sublabel = rowSublabel(row, linkType);
        const isTop3 = row.rank <= 3;
        const detailHref = `/records/${encodeURIComponent(category)}/${row.rank}`;

        return (
          <div
            key={`${row.rank}-${label}`}
            role="row"
            style={{
              display: "grid",
              gridTemplateColumns: "3rem 1fr 7rem 5rem 4rem",
              gap: "0.75rem",
              padding: "0.6rem 1rem",
              background: isTop3 ? `${colors.surface}ee` : colors.surface,
              borderLeft: isTop3
                ? `3px solid ${colors.accent}`
                : "3px solid transparent",
              alignItems: "center",
            }}
          >
            <div role="cell">
              {/* Rank pip doubles as the permalink to the shareable card. */}
              <Link
                href={detailHref}
                title={`Open shareable card for rank ${row.rank}`}
                aria-label={`Rank ${row.rank} — open shareable record card`}
                style={{
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  textDecorationColor: colors.border,
                  textUnderlineOffset: "3px",
                }}
              >
                <MedalPip rank={row.rank} />
              </Link>
            </div>

            <div role="cell" style={{ overflow: "hidden" }}>
              <Link
                href={href}
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.95rem",
                  color: colors.accent,
                  textDecoration: "none",
                  fontWeight: isTop3 ? 700 : 400,
                }}
              >
                {label}
              </Link>
              {sublabel ? (
                <div
                  style={{
                    fontFamily: fontStacks.body,
                    fontSize: "0.72rem",
                    color: colors.text_dim,
                    marginTop: "0.1rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sublabel}
                </div>
              ) : null}
            </div>

            <div
              role="cell"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.8rem",
                color: colors.text_dim,
              }}
            >
              {fmtSpan(row)}
            </div>

            <div
              role="cell"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.8rem",
                color: isTop3 ? colors.glow : colors.text,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <Link
                href={detailHref}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {fmtMetric(row, sortField)}
              </Link>
            </div>

            <div
              role="cell"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.75rem",
                color: colors.text_dim,
              }}
            >
              {row.state ?? ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
