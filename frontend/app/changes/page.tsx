/**
 * /changes — Edition Diff Explorer
 *
 * Server component. Shows callsign churn between consecutive editions:
 * adds, drops, retained, address changes, class upgrades. Timeline chart
 * rendered by the client <DiffTimeline/> sub-component.
 *
 * Sodium Vapor aesthetic — all tokens from lib/design.ts.
 */

import Link from "next/link";
import { colors, fontStacks } from "../../lib/design";
import DiffTimeline from "./DiffTimeline";

export const dynamic = "force-dynamic";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8000/api";

interface TimelinePoint {
  year_a: number;
  year_b: number;
  edition_a: string;
  edition_b: string;
  total_a: number | null;
  total_b: number | null;
  adds: number | null;
  drops: number | null;
  retained: number | null;
  net: number | null;
  retention_pct: number | null;
  address_changes: number | null;
  class_upgrades: number | null;
}

interface DiffMeta {
  generated: string | null;
  dataset_version: string | null;
  pair_count: number | null;
}

async function fetchTimeline(): Promise<TimelinePoint[]> {
  try {
    const res = await fetch(`${API_BASE}/diff/timeline`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    return (await res.json()) as TimelinePoint[];
  } catch {
    return [];
  }
}

async function fetchMeta(): Promise<DiffMeta | null> {
  try {
    const res = await fetch(`${API_BASE}/diff/meta`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as DiffMeta;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Edition Diff Explorer — Ham Callbook Archive",
  description:
    "Visualise callsign churn between consecutive callbook editions: additions, drops, retention, address changes, and license upgrades 1909–1997.",
};

export default async function ChangesPage() {
  const [timeline, diffMeta] = await Promise.all([fetchTimeline(), fetchMeta()]);

  // Compute big-picture stats from timeline
  const totalPairs = timeline.length;
  const biggestGain = timeline.reduce<TimelinePoint | null>(
    (best, p) =>
      p.net !== null && (best === null || (best.net ?? -Infinity) < p.net) ? p : best,
    null,
  );
  const biggestDrop = timeline.reduce<TimelinePoint | null>(
    (worst, p) =>
      p.net !== null && (worst === null || (worst.net ?? Infinity) > p.net) ? p : worst,
    null,
  );

  const containerStyle: React.CSSProperties = {
    background: colors.bg,
    color: colors.text,
    fontFamily: fontStacks.body,
    minHeight: "100vh",
    padding: "2rem 1.5rem 4rem",
    maxWidth: "1100px",
    margin: "0 auto",
  };

  const headingStyle: React.CSSProperties = {
    fontFamily: fontStacks.display,
    fontSize: "clamp(2rem, 5vw, 3.2rem)",
    fontWeight: 900,
    color: colors.accent,
    letterSpacing: "-0.02em",
    marginBottom: "0.4rem",
    textShadow: "0 0 24px rgba(255,163,11,0.3)",
  };

  const subStyle: React.CSSProperties = {
    color: colors.text_dim,
    fontFamily: fontStacks.body,
    fontSize: "1rem",
    marginBottom: "2.5rem",
    maxWidth: "640px",
  };

  const cardRowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1rem",
    marginBottom: "2.5rem",
  };

  const cardStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: "6px",
    padding: "1.25rem",
  };

  const labelStyle: React.CSSProperties = {
    color: colors.text_dim,
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginBottom: "0.4rem",
  };

  const valStyle: React.CSSProperties = {
    fontFamily: fontStacks.mono,
    fontSize: "1.6rem",
    fontWeight: 700,
    color: colors.accent,
  };

  const tableWrap: React.CSSProperties = {
    overflowX: "auto",
    border: `1px solid ${colors.border}`,
    borderRadius: "6px",
    background: colors.surface,
  };

  const thStyle: React.CSSProperties = {
    fontFamily: fontStacks.mono,
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.text_dim,
    padding: "0.5rem 0.75rem",
    textAlign: "right" as const,
    borderBottom: `1px solid ${colors.border}`,
    whiteSpace: "nowrap" as const,
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: fontStacks.mono,
    fontSize: "0.85rem",
    padding: "0.45rem 0.75rem",
    textAlign: "right" as const,
    borderBottom: `1px solid ${colors.border}`,
    whiteSpace: "nowrap" as const,
  };

  const tdLeft: React.CSSProperties = { ...tdStyle, textAlign: "left" as const };
  const thLeft: React.CSSProperties = { ...thStyle, textAlign: "left" as const };

  return (
    <main style={containerStyle}>
      {/* Header */}
      <h1 style={headingStyle}>Edition Diff Explorer</h1>
      <p style={subStyle}>
        Callsign churn between consecutive callbook editions, 1909–1997. Each row is
        one edition transition: new licensees added, silent stations dropped, operators
        who moved, and license-class upgrades.{" "}
        <Link
          href="/changes/wwii"
          style={{ color: colors.accent, textDecoration: "underline" }}
        >
          WWII cohort analysis →
        </Link>
      </p>

      {/* Summary cards */}
      <div style={cardRowStyle}>
        <div style={cardStyle}>
          <div style={labelStyle}>Edition pairs</div>
          <div style={valStyle}>{totalPairs}</div>
        </div>
        {biggestGain && (
          <div style={cardStyle}>
            <div style={labelStyle}>Biggest single-year gain</div>
            <div style={valStyle}>
              +{(biggestGain.net ?? 0).toLocaleString()}
            </div>
            <div style={{ color: colors.text_dim, fontSize: "0.8rem", marginTop: "0.25rem" }}>
              {biggestGain.edition_a} → {biggestGain.edition_b}
            </div>
          </div>
        )}
        {biggestDrop && (
          <div style={cardStyle}>
            <div style={labelStyle}>Biggest single-year drop</div>
            <div style={{ ...valStyle, color: colors.danger }}>
              {(biggestDrop.net ?? 0).toLocaleString()}
            </div>
            <div style={{ color: colors.text_dim, fontSize: "0.8rem", marginTop: "0.25rem" }}>
              {biggestDrop.edition_a} → {biggestDrop.edition_b}
            </div>
          </div>
        )}
        {diffMeta && (
          <div style={cardStyle}>
            <div style={labelStyle}>Dataset</div>
            <div style={{ fontFamily: fontStacks.mono, fontSize: "1rem", color: colors.glow }}>
              {diffMeta.dataset_version ?? "v2026.06"}
            </div>
            <div style={{ color: colors.text_dim, fontSize: "0.75rem", marginTop: "0.25rem" }}>
              {diffMeta.generated ? diffMeta.generated.slice(0, 10) : ""}
            </div>
          </div>
        )}
      </div>

      {/* Timeline sparkline chart (client component) */}
      <DiffTimeline timeline={timeline} />

      {/* WWII callout */}
      <div
        style={{
          background: colors.surface,
          border: `2px solid ${colors.accent}`,
          borderRadius: "6px",
          padding: "1.25rem 1.5rem",
          marginBottom: "2rem",
          display: "flex",
          gap: "1.5rem",
          alignItems: "center",
          flexWrap: "wrap" as const,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: fontStacks.display,
              fontSize: "1.1rem",
              fontWeight: 700,
              color: colors.accent,
              marginBottom: "0.3rem",
            }}
          >
            WWII Silent Stations
          </div>
          <div style={{ color: colors.text_dim, fontSize: "0.9rem" }}>
            Who went silent 1941–1946? How many returned? How many were new postwar licensees?
          </div>
        </div>
        <Link
          href="/changes/wwii"
          style={{
            background: colors.accent,
            color: colors.bg,
            padding: "0.6rem 1.2rem",
            borderRadius: "4px",
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap" as const,
          }}
        >
          Explore WWII Cohort →
        </Link>
      </div>

      {/* Full table */}
      <h2
        style={{
          fontFamily: fontStacks.display,
          fontSize: "1.4rem",
          fontWeight: 700,
          color: colors.text,
          marginBottom: "1rem",
        }}
      >
        All Edition Pairs
      </h2>
      {timeline.length === 0 ? (
        <p style={{ color: colors.text_dim }}>No data available — run build_edition_diff.py first.</p>
      ) : (
        <div style={tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thLeft}>Transition</th>
                <th style={thStyle}>Size A</th>
                <th style={thStyle}>Size B</th>
                <th style={{ ...thStyle, color: colors.success }}>Adds</th>
                <th style={{ ...thStyle, color: colors.danger }}>Drops</th>
                <th style={thStyle}>Retained</th>
                <th style={thStyle}>Net</th>
                <th style={thStyle}>Ret. %</th>
                <th style={thStyle}>Addr Δ</th>
                <th style={thStyle}>Upgrades</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((p) => {
                const net = p.net ?? 0;
                const netColor =
                  net > 0 ? colors.success : net < 0 ? colors.danger : colors.text_dim;
                return (
                  <tr
                    key={`${p.year_a}-${p.year_b}`}
                    style={{ borderBottom: `1px solid ${colors.border}` }}
                  >
                    <td style={tdLeft}>
                      <Link
                        href={`/year/${p.year_b}`}
                        style={{
                          color: colors.accent,
                          textDecoration: "none",
                          fontFamily: fontStacks.mono,
                        }}
                      >
                        {p.edition_a}
                      </Link>
                      <span style={{ color: colors.text_dim }}> → </span>
                      <Link
                        href={`/year/${p.year_b}`}
                        style={{ color: colors.accent, textDecoration: "none" }}
                      >
                        {p.edition_b}
                      </Link>
                    </td>
                    <td style={tdStyle}>{(p.total_a ?? 0).toLocaleString()}</td>
                    <td style={tdStyle}>{(p.total_b ?? 0).toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: colors.success }}>
                      +{(p.adds ?? 0).toLocaleString()}
                    </td>
                    <td style={{ ...tdStyle, color: colors.danger }}>
                      −{(p.drops ?? 0).toLocaleString()}
                    </td>
                    <td style={tdStyle}>{(p.retained ?? 0).toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: netColor }}>
                      {net >= 0 ? "+" : ""}
                      {net.toLocaleString()}
                    </td>
                    <td style={{ ...tdStyle, color: (p.retention_pct ?? 0) >= 50 ? colors.success : colors.text_dim }}>
                      {(p.retention_pct ?? 0).toFixed(1)}%
                    </td>
                    <td style={tdStyle}>{(p.address_changes ?? 0).toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: colors.accent }}>
                      {(p.class_upgrades ?? 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Morse divider + footnote */}
      <div
        style={{
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          marginTop: "3rem",
          letterSpacing: "0.2em",
        }}
      >
        · — · · · — · · · — — ·
      </div>
      <p style={{ color: colors.text_dim, fontSize: "0.8rem", marginTop: "0.75rem" }}>
        Dataset {diffMeta?.dataset_version ?? "v2026.06"} · accuracy ~97.1% (OCR-anchored) ·
        Address-change count capped at 200 per pair in pre-computed artifact.
      </p>
    </main>
  );
}
