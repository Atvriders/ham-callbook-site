/**
 * LeaderboardTable — ranked table for a single leaderboard category.
 *
 * Server component (no "use client" — it receives data as props).
 * Each row links to /callsign/{cs} or /clubs/{slug} depending on link_type.
 */

import Link from "next/link";
import { colors, fontStacks } from "../../lib/design";
import { MedalPip } from "./MedalPip";

export interface LeaderboardRow {
  rank: number;
  callsign?: string;
  slug?: string;
  display_name?: string;
  holder_name?: string;
  first_year?: number;
  last_year?: number;
  span_years?: number;
  edition_count?: number;
  run_editions?: number;
  distinct_holders?: number;
  appearance_count?: number;
  state?: string;
  uls_status?: string;
  [key: string]: unknown;
}

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  linkType: "callsign" | "club";
  sortField: string;
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

function rowSublabel(row: LeaderboardRow, linkType: "callsign" | "club"): string | null {
  if (linkType === "callsign" && row.holder_name) {
    return row.holder_name;
  }
  return null;
}

export function LeaderboardTable({ rows, linkType, sortField }: LeaderboardTableProps) {
  if (rows.length === 0) {
    return (
      <p style={{ color: colors.text_dim, fontFamily: fontStacks.body, padding: "2rem 0" }}>
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
        {["#", linkType === "club" ? "Club" : "Call", "Years", "Span", "ST"].map((h) => (
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
        ))}
      </div>

      {/* Rows */}
      {rows.map((row) => {
        const href = rowHref(row, linkType);
        const label = rowLabel(row, linkType);
        const sublabel = rowSublabel(row, linkType);
        const isTop3 = row.rank <= 3;

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
              borderLeft: isTop3 ? `3px solid ${colors.accent}` : "3px solid transparent",
              alignItems: "center",
            }}
          >
            <div role="cell">
              <MedalPip rank={row.rank} />
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
              {fmtMetric(row, sortField)}
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
