/**
 * /changes/wwii — WWII Silent Stations Cohort
 *
 * Server component. Shows the three-way cohort split for callsigns
 * present in 1941_Spring vs 1946_Fall: silent (presumed wartime loss),
 * returned, and postwar new.
 *
 * Sodium Vapor aesthetic — all tokens from lib/design.ts.
 */

import Link from "next/link";
import { colors, fontStacks } from "../../../lib/design";

export const dynamic = "force-dynamic";

const API_BASE =
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_BASE ?? "http://backend:8000") + "/api"
    : "/api";

interface WwiiCohort {
  pre_war_edition: string;
  post_war_edition: string;
  total_pre_war: number;
  total_post_war: number;
  silent_count: number;
  returned_count: number;
  postwar_new_count: number;
  note: string;
}

async function fetchWwii(): Promise<WwiiCohort | null> {
  try {
    const res = await fetch(`${API_BASE}/diff/wwii`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as WwiiCohort;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "WWII Silent Stations — Ham Callbook Archive",
  description:
    "Which amateur radio operators disappeared from the callbooks during WWII (1941–1946)? Cohort analysis of silent, returned, and postwar-new licensees.",
};

export default async function WwiiPage() {
  const cohort = await fetchWwii();

  const containerStyle: React.CSSProperties = {
    background: colors.bg,
    color: colors.text,
    fontFamily: fontStacks.body,
    minHeight: "100dvh",
    padding: "2rem 1.5rem 4rem",
    maxWidth: "900px",
    margin: "0 auto",
  };

  const headingStyle: React.CSSProperties = {
    fontFamily: fontStacks.display,
    fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
    fontWeight: 900,
    color: colors.accent,
    letterSpacing: "-0.02em",
    marginBottom: "0.4rem",
    textShadow: "0 0 20px rgba(255,163,11,0.3)",
  };

  const cardStyle = (accent: string): React.CSSProperties => ({
    background: colors.surface,
    border: `2px solid ${accent}`,
    borderRadius: "8px",
    padding: "1.5rem",
    flex: "1 1 200px",
    minWidth: "180px",
  });

  const statLabel: React.CSSProperties = {
    color: colors.text_dim,
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: "0.4rem",
  };

  const statVal = (c: string): React.CSSProperties => ({
    fontFamily: fontStacks.mono,
    fontSize: "2.4rem",
    fontWeight: 700,
    color: c,
    lineHeight: 1,
  });

  const statDesc: React.CSSProperties = {
    color: colors.text_dim,
    fontSize: "0.8rem",
    marginTop: "0.5rem",
    lineHeight: 1.5,
  };

  if (!cohort) {
    return (
      <main style={containerStyle}>
        <h1 style={headingStyle}>WWII Silent Stations</h1>
        <p style={{ color: colors.text_dim }}>
          Data unavailable — run{" "}
          <code
            style={{ fontFamily: fontStacks.mono, background: colors.surface, padding: "0.1em 0.3em" }}
          >
            build_edition_diff.py
          </code>{" "}
          to generate the artifact.
        </p>
        <Link href="/changes" style={{ color: colors.accent }}>
          ← Back to Edition Diffs
        </Link>
      </main>
    );
  }

  const silentPct =
    cohort.total_pre_war > 0
      ? ((cohort.silent_count / cohort.total_pre_war) * 100).toFixed(1)
      : "0.0";
  const returnedPct =
    cohort.total_pre_war > 0
      ? ((cohort.returned_count / cohort.total_pre_war) * 100).toFixed(1)
      : "0.0";

  return (
    <main style={containerStyle}>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link href="/changes" style={{ color: colors.text_dim, fontSize: "0.85rem" }}>
          ← Edition Diff Explorer
        </Link>
      </div>

      <h1 style={headingStyle}>WWII Silent Stations</h1>
      <p
        style={{
          color: colors.text_dim,
          maxWidth: "600px",
          lineHeight: 1.7,
          marginBottom: "2.5rem",
        }}
      >
        Comparing <strong style={{ color: colors.text }}>{cohort.pre_war_edition}</strong> (
        {cohort.total_pre_war.toLocaleString()} callsigns) against{" "}
        <strong style={{ color: colors.text }}>{cohort.post_war_edition}</strong> (
        {cohort.total_post_war.toLocaleString()} callsigns). The five-year gap spans the entirety
        of U.S. involvement in World War II, during which most civilian amateur radio
        transmissions were prohibited (October 1941 – September 1945).
      </p>

      {/* Three cohort cards */}
      <div
        style={{
          display: "flex",
          gap: "1.25rem",
          flexWrap: "wrap" as const,
          marginBottom: "2.5rem",
        }}
      >
        <div style={cardStyle(colors.danger)}>
          <div style={statLabel}>Silent — did not return</div>
          <div style={statVal(colors.danger)}>
            {cohort.silent_count.toLocaleString()}
          </div>
          <div style={statDesc}>
            {silentPct}% of 1941 licensees absent from the 1946 callbook. Silent Key, wartime
            death, or simply let licenses lapse.
          </div>
        </div>

        <div style={cardStyle(colors.success)}>
          <div style={statLabel}>Returned</div>
          <div style={statVal(colors.success)}>
            {cohort.returned_count.toLocaleString()}
          </div>
          <div style={statDesc}>
            {returnedPct}% of 1941 licensees re-appeared in the 1946 edition. Ham radio survived
            the war.
          </div>
        </div>

        <div style={cardStyle(colors.accent)}>
          <div style={statLabel}>Postwar new</div>
          <div style={statVal(colors.accent)}>
            {cohort.postwar_new_count.toLocaleString()}
          </div>
          <div style={statDesc}>
            New licensees with no pre-war record — veterans, returning GIs, civilian newcomers
            drawn in by wartime radio experience.
          </div>
        </div>
      </div>

      {/* Net change */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: "6px",
          padding: "1.25rem 1.5rem",
          marginBottom: "2.5rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "1rem",
        }}
      >
        {(
          [
            ["Pre-war size", cohort.total_pre_war.toLocaleString(), colors.text],
            ["Post-war size", cohort.total_post_war.toLocaleString(), colors.text],
            [
              "Net change",
              `${cohort.total_post_war - cohort.total_pre_war >= 0 ? "+" : ""}${(cohort.total_post_war - cohort.total_pre_war).toLocaleString()}`,
              cohort.total_post_war >= cohort.total_pre_war ? colors.success : colors.danger,
            ],
          ] as [string, string, string][]
        ).map(([label, value, clr]) => (
          <div key={label}>
            <div style={statLabel}>{label}</div>
            <div style={{ fontFamily: fontStacks.mono, fontSize: "1.4rem", color: clr }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Methodology note */}
      <div
        style={{
          borderLeft: `4px solid ${colors.accent}`,
          paddingLeft: "1rem",
          color: colors.text_dim,
          fontSize: "0.85rem",
          lineHeight: 1.65,
          marginBottom: "2rem",
        }}
      >
        <strong style={{ color: colors.text }}>Methodology:</strong> Callsign matching is
        exact (uppercase normalised). &ldquo;Silent&rdquo; means the callsign in 1941_Spring
        does not appear in 1946_Fall; it does not distinguish between SK (silent key),
        expired licence, callsign reissued under different conditions, or OCR error.
        &ldquo;Returned&rdquo; requires the identical callsign string in both editions.
        Dataset accuracy ~97.1% (OCR-anchored) — cite original scan for primary-source
        genealogical proof.
      </div>

      <p style={{ color: colors.text_dim, fontSize: "0.75rem", fontFamily: fontStacks.mono }}>
        Dataset v2026.06 · {cohort.pre_war_edition} ↔ {cohort.post_war_edition}
      </p>

      {/* Morse divider */}
      <div
        style={{
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          marginTop: "2rem",
          letterSpacing: "0.2em",
        }}
      >
        · — · · · — · · · — — ·
      </div>
    </main>
  );
}
