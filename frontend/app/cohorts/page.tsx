"use client";

/**
 * /cohorts — Cohort Observatory (Feature #11)
 *
 * Pick a cohort (first-licensed year, entry license class, optional state)
 * and see:
 *   1. Kaplan-Meier retention curve — what fraction of this class still
 *      appears 5/10/25/50 years later, right-censored at the 1997 print
 *      horizon and extended to today via ULS active status.
 *   2. Class-ladder flow — Sankey-style table showing Novice→General→
 *      Advanced→Extra upgrade counts and median years per rung.
 *   3. Compare mode — overlay two cohorts on the same chart.
 *   4. CSV export of the km_curve.
 *
 * Honest caveat banner surfaces data-quality warnings from the artifact
 * (sparse-1950s gap, archive gaps, etc.).
 *
 * Design: Sodium Vapor palette (midnight #0a0e1a, amber #ffa30b, bone
 * #f5ecd9, Fraunces + JetBrains Mono). Recharts for curves. No Inter,
 * no purple, no hover:scale-105. All tokens from lib/design.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colors, fontStacks } from "../../lib/design";

export const dynamic = "force-dynamic";

// --------------------------------------------------------------------------- //
// Constants + types                                                            //
// --------------------------------------------------------------------------- //

const API =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "")) ||
  "/api";

const CLASS_NAMES: Record<string, string> = {
  N: "Novice",
  G: "General",
  A: "Advanced",
  E: "Extra",
};

const COMPARE_COLORS = [colors.accent, colors.success] as const;
const CI_COLORS = ["rgba(255,163,11,0.15)", "rgba(93,211,168,0.15)"] as const;

interface KmPoint {
  t: number;
  obs_year: number;
  S: number;
  ci_lo: number;
  ci_hi: number;
  at_risk: number;
  events: number;
  censored: number;
}

interface KmSummary {
  retention_5yr?: { S: number; ci_lo: number; ci_hi: number; obs_year: number } | null;
  retention_10yr?: { S: number; ci_lo: number; ci_hi: number; obs_year: number } | null;
  retention_25yr?: { S: number; ci_lo: number; ci_hi: number; obs_year: number } | null;
  retention_50yr?: { S: number; ci_lo: number; ci_hi: number; obs_year: number } | null;
}

interface LadderRung {
  from_class: string;
  to_class: string;
  from_name: string;
  to_name: string;
  count: number;
  median_years: number;
}

interface Cohort {
  cohort_key: string;
  first_year: number;
  entry_class: string;
  entry_class_name: string;
  state: string;
  cohort_size: number;
  uls_still_active: number;
  km_curve: KmPoint[];
  km_summary: KmSummary;
  class_ladder: LadderRung[];
  caveats: string[];
  print_horizon: number;
  today_year: number;
}

interface AvailableMeta {
  years: number[];
  classes: string[];
  print_horizon: number;
}

// --------------------------------------------------------------------------- //
// Helpers                                                                     //
// --------------------------------------------------------------------------- //

const S = {
  bg: colors.bg,
  surface: colors.surface,
  border: colors.border,
  text: colors.text,
  dim: colors.text_dim,
  accent: colors.accent,
  accent2: colors.accent_2,
  glow: colors.glow,
  success: colors.success,
  danger: colors.danger,
  mono: fontStacks.mono,
  display: fontStacks.display,
  body: fontStacks.body,
} as const;

function pct(v: number | undefined | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function buildKey(year: string, cls: string): string {
  return `${year}|${cls}|ALL`;
}

function kmToCsv(cohort: Cohort): string {
  const header = "t,obs_year,S,ci_lo,ci_hi,at_risk,events,censored";
  const rows = cohort.km_curve.map(
    (p) =>
      `${p.t},${p.obs_year},${p.S.toFixed(4)},${p.ci_lo.toFixed(4)},${p.ci_hi.toFixed(4)},${p.at_risk},${p.events},${p.censored}`
  );
  return [header, ...rows].join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------- //
// Sub-components                                                              //
// --------------------------------------------------------------------------- //

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: S.surface,
        border: `1px solid ${S.border}`,
        borderRadius: 4,
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "1rem",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontFamily: S.display,
            color: S.accent,
            fontSize: "1.1rem",
            fontWeight: 600,
            letterSpacing: "0.02em",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Caveat({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div
      style={{
        background: "rgba(255,163,11,0.07)",
        border: `1px solid ${S.accent2}`,
        borderRadius: 4,
        padding: "0.75rem 1rem",
        marginBottom: "1.25rem",
        fontFamily: S.mono,
        fontSize: "0.75rem",
        color: S.dim,
        lineHeight: 1.6,
      }}
    >
      <span style={{ color: S.accent, fontWeight: 700 }}>DATA NOTES: </span>
      {messages.join(" · ")}
    </div>
  );
}

function SummaryTable({ summary, cohortSize, ulsActive }: {
  summary: KmSummary;
  cohortSize: number;
  ulsActive: number;
}) {
  const rows = [
    { label: "+5 yr", data: summary.retention_5yr },
    { label: "+10 yr", data: summary.retention_10yr },
    { label: "+25 yr", data: summary.retention_25yr },
    { label: "+50 yr", data: summary.retention_50yr },
  ];
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: S.mono,
        fontSize: "0.8rem",
        color: S.text,
      }}
    >
      <thead>
        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
          <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", color: S.dim }}>Horizon</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.dim }}>Retention</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.dim }}>95% CI</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.dim }}>Obs year</th>
        </tr>
      </thead>
      <tbody>
        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
          <td style={{ padding: "0.3rem 0.5rem", color: S.dim }}>cohort n</td>
          <td colSpan={3} style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>
            <span style={{ color: S.accent }}>{cohortSize.toLocaleString()}</span>
            {ulsActive > 0 && (
              <span style={{ color: S.success, marginLeft: "0.75rem" }}>
                {ulsActive.toLocaleString()} ULS active today
              </span>
            )}
          </td>
        </tr>
        {rows.map(({ label, data }) => (
          <tr key={label} style={{ borderBottom: `1px solid ${S.border}` }}>
            <td style={{ padding: "0.3rem 0.5rem", color: S.dim }}>{label}</td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.accent, fontWeight: 600 }}>
              {pct(data?.S)}
            </td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.dim }}>
              {data ? `[${pct(data.ci_lo)} – ${pct(data.ci_hi)}]` : "—"}
            </td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>
              {data?.obs_year ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClassLadder({ rungs, cohortClass }: { rungs: LadderRung[]; cohortClass: string }) {
  if (!rungs.length) {
    return <p style={{ color: S.dim, fontFamily: S.mono, fontSize: "0.8rem" }}>No upgrade data available.</p>;
  }
  // Filter to rungs starting from cohort class or higher
  const classOrder = ["N", "G", "A", "E"];
  const startIdx = classOrder.indexOf(cohortClass);
  const relevant = rungs.filter(
    (r) => classOrder.indexOf(r.from_class) >= (startIdx >= 0 ? startIdx : 0)
  );
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: S.mono,
        fontSize: "0.8rem",
        color: S.text,
      }}
    >
      <thead>
        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
          <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", color: S.dim }}>From</th>
          <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", color: S.dim }}>To</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.dim }}>Upgraded</th>
          <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.dim }}>Median yrs</th>
        </tr>
      </thead>
      <tbody>
        {relevant.map((r, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${S.border}` }}>
            <td style={{ padding: "0.3rem 0.5rem", color: S.dim }}>{r.from_name}</td>
            <td style={{ padding: "0.3rem 0.5rem", color: S.accent }}>{r.to_name}</td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>
              {r.count.toLocaleString()}
            </td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: S.success }}>
              {r.median_years}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ChartPoint {
  obs_year: number;
  S?: number;
  ci_lo?: number;
  ci_hi?: number;
  S_b?: number;
  ci_lo_b?: number;
  ci_hi_b?: number;
}

function buildChartData(a: Cohort, b?: Cohort): ChartPoint[] {
  const yearMap = new Map<number, ChartPoint>();
  for (const p of a.km_curve) {
    yearMap.set(p.obs_year, {
      obs_year: p.obs_year,
      S: p.S,
      ci_lo: p.ci_lo,
      ci_hi: p.ci_hi,
    });
  }
  if (b) {
    for (const p of b.km_curve) {
      const existing = yearMap.get(p.obs_year) ?? { obs_year: p.obs_year };
      yearMap.set(p.obs_year, {
        ...existing,
        S_b: p.S,
        ci_lo_b: p.ci_lo,
        ci_hi_b: p.ci_hi,
      });
    }
  }
  return Array.from(yearMap.values()).sort((x, y) => x.obs_year - y.obs_year);
}

// Custom tooltip
function KmTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: S.surface,
        border: `1px solid ${S.border}`,
        borderRadius: 4,
        padding: "0.6rem 0.8rem",
        fontFamily: S.mono,
        fontSize: "0.75rem",
        color: S.text,
      }}
    >
      <div style={{ color: S.dim, marginBottom: 4 }}>{label}</div>
      {payload
        .filter((p) => p.name.startsWith("S"))
        .map((p) => (
          <div key={p.name} style={{ color: p.color }}>
            {p.name}: {(p.value * 100).toFixed(1)}%
          </div>
        ))}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Main component                                                              //
// --------------------------------------------------------------------------- //

export default function CohortsPage() {
  const [available, setAvailable] = useState<AvailableMeta | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedClass, setSelectedClass] = useState<string>("N");
  const [cohortA, setCohortA] = useState<Cohort | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareYear, setCompareYear] = useState<string>("");
  const [compareClass, setCompareClass] = useState<string>("N");
  const [cohortB, setCohortB] = useState<Cohort | null>(null);
  const [loadingB, setLoadingB] = useState(false);

  // Fetch available years/classes
  useEffect(() => {
    fetch(`${API}/cohorts/available`)
      .then((r) => r.json())
      .then((d: AvailableMeta) => {
        setAvailable(d);
        if (d.years.length > 0) {
          // Default to ~1980 if available, else the middle year
          const defaultYear =
            d.years.find((y) => y === 1980) ?? d.years[Math.floor(d.years.length / 2)] ?? d.years[0];
          setSelectedYear(String(defaultYear ?? ""));
          setCompareYear(String(d.years.find((y) => y === 1970) ?? d.years[0] ?? ""));
        }
        if (d.classes.length > 0) {
          setSelectedClass(d.classes.includes("N") ? "N" : (d.classes[0] ?? ""));
          setCompareClass(d.classes.includes("N") ? "N" : (d.classes[0] ?? ""));
        }
      })
      .catch(() => {});
  }, []);

  const fetchCohort = useCallback(
    async (year: string, cls: string, isCompare: boolean) => {
      if (!year || !cls) return;
      const key = buildKey(year, cls);
      const setter = isCompare ? setCohortB : setCohortA;
      const loadSetter = isCompare ? setLoadingB : setLoadingA;
      const errSetter = isCompare ? (() => {}) : setErrorA;

      loadSetter(true);
      errSetter(null);
      try {
        const res = await fetch(`${API}/cohorts/${encodeURIComponent(key)}`);
        if (!res.ok) {
          const detail = await res.json().catch(() => ({ detail: "Not found" }));
          errSetter((detail as { detail?: string }).detail ?? "Cohort not found");
          setter(null);
        } else {
          setter((await res.json()) as Cohort);
        }
      } catch {
        errSetter("Network error loading cohort.");
        setter(null);
      } finally {
        loadSetter(false);
      }
    },
    []
  );

  // Fetch primary cohort when year/class change
  useEffect(() => {
    if (selectedYear && selectedClass) {
      fetchCohort(selectedYear, selectedClass, false);
    }
  }, [selectedYear, selectedClass, fetchCohort]);

  // Fetch compare cohort
  useEffect(() => {
    if (compareMode && compareYear && compareClass) {
      fetchCohort(compareYear, compareClass, true);
    } else if (!compareMode) {
      setCohortB(null);
    }
  }, [compareMode, compareYear, compareClass, fetchCohort]);

  const chartData = useMemo(() => {
    if (!cohortA) return [];
    return buildChartData(cohortA, compareMode && cohortB ? cohortB : undefined);
  }, [cohortA, cohortB, compareMode]);

  const printHorizon = cohortA?.print_horizon ?? available?.print_horizon ?? 1997;

  const labelA = cohortA
    ? `${cohortA.first_year} ${cohortA.entry_class_name}`
    : selectedYear
    ? `${selectedYear} ${CLASS_NAMES[selectedClass] ?? selectedClass}`
    : "—";

  const labelB = cohortB
    ? `${cohortB.first_year} ${cohortB.entry_class_name}`
    : compareYear
    ? `${compareYear} ${CLASS_NAMES[compareClass] ?? compareClass}`
    : "—";

  const allCaveats = [
    ...(cohortA?.caveats ?? []),
    ...(compareMode ? (cohortB?.caveats ?? []) : []),
    `Data right-censored at ${printHorizon} print horizon; extended via ULS active status.`,
    "Confidence intervals via Greenwood's formula. Sparse pre-1960 cohorts have wide CIs.",
  ];
  const uniqueCaveats = Array.from(new Set(allCaveats));

  return (
    <div
      style={{
        background: S.bg,
        minHeight: "100dvh",
        color: S.text,
        fontFamily: S.body,
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
        {/* Hero */}
        <div style={{ marginBottom: "2rem" }}>
          <h1
            style={{
              fontFamily: S.display,
              fontSize: "2rem",
              fontWeight: 700,
              color: S.accent,
              textShadow:
                "0 0 12px rgba(255,209,102,0.45), 0 0 2px rgba(255,163,11,0.7)",
              marginBottom: "0.5rem",
            }}
          >
            Cohort Observatory
          </h1>
          <p style={{ color: S.dim, fontSize: "0.9rem", maxWidth: 640 }}>
            Kaplan-Meier survival curves for licensed amateur-radio cohorts,
            1963–1997. Pick a first-licensed year and entry license class to see
            what fraction of operators remained in the archive 5, 10, 25, and 50
            years later.
          </p>
        </div>

        {/* Picker */}
        <Panel title="Select Cohort">
          {!available && (
            <p style={{ color: S.dim, fontFamily: S.mono, fontSize: "0.85rem" }}>
              Loading available cohorts…
            </p>
          )}
          {available && (
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label
                  style={{ display: "block", color: S.dim, fontSize: "0.75rem", marginBottom: "0.3rem", fontFamily: S.mono }}
                >
                  First-licensed year
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  style={{
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 3,
                    color: S.text,
                    fontFamily: S.mono,
                    fontSize: "0.9rem",
                    padding: "0.35rem 0.6rem",
                  }}
                >
                  {available.years.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  style={{ display: "block", color: S.dim, fontSize: "0.75rem", marginBottom: "0.3rem", fontFamily: S.mono }}
                >
                  Entry class
                </label>
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  style={{
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 3,
                    color: S.text,
                    fontFamily: S.mono,
                    fontSize: "0.9rem",
                    padding: "0.35rem 0.6rem",
                  }}
                >
                  {available.classes.map((c) => (
                    <option key={c} value={c}>
                      {CLASS_NAMES[c] ?? c} ({c})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  style={{ display: "block", color: S.dim, fontSize: "0.75rem", marginBottom: "0.3rem", fontFamily: S.mono }}
                >
                  &nbsp;
                </label>
                <button
                  onClick={() => setCompareMode((m) => !m)}
                  style={{
                    background: compareMode ? S.accent : "transparent",
                    border: `1px solid ${S.accent}`,
                    borderRadius: 3,
                    color: compareMode ? S.bg : S.accent,
                    fontFamily: S.mono,
                    fontSize: "0.85rem",
                    padding: "0.35rem 0.8rem",
                    cursor: "pointer",
                  }}
                >
                  {compareMode ? "Compare ON" : "Compare"}
                </button>
              </div>
            </div>
          )}

          {/* Compare row */}
          {compareMode && available && (
            <div
              style={{
                display: "flex",
                gap: "1rem",
                flexWrap: "wrap",
                alignItems: "flex-end",
                marginTop: "1rem",
                paddingTop: "1rem",
                borderTop: `1px solid ${S.border}`,
              }}
            >
              <span style={{ color: S.success, fontFamily: S.mono, fontSize: "0.75rem", alignSelf: "center" }}>
                vs.
              </span>
              <div>
                <label
                  style={{ display: "block", color: S.dim, fontSize: "0.75rem", marginBottom: "0.3rem", fontFamily: S.mono }}
                >
                  Compare year
                </label>
                <select
                  value={compareYear}
                  onChange={(e) => setCompareYear(e.target.value)}
                  style={{
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 3,
                    color: S.text,
                    fontFamily: S.mono,
                    fontSize: "0.9rem",
                    padding: "0.35rem 0.6rem",
                  }}
                >
                  {available.years.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  style={{ display: "block", color: S.dim, fontSize: "0.75rem", marginBottom: "0.3rem", fontFamily: S.mono }}
                >
                  Compare class
                </label>
                <select
                  value={compareClass}
                  onChange={(e) => setCompareClass(e.target.value)}
                  style={{
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 3,
                    color: S.text,
                    fontFamily: S.mono,
                    fontSize: "0.9rem",
                    padding: "0.35rem 0.6rem",
                  }}
                >
                  {available.classes.map((c) => (
                    <option key={c} value={c}>
                      {CLASS_NAMES[c] ?? c} ({c})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </Panel>

        {/* Error */}
        {errorA && (
          <div
            style={{
              background: "rgba(255,85,85,0.1)",
              border: `1px solid ${S.danger}`,
              borderRadius: 4,
              padding: "0.75rem 1rem",
              color: S.danger,
              fontFamily: S.mono,
              fontSize: "0.85rem",
              marginBottom: "1.5rem",
            }}
          >
            {errorA}
          </div>
        )}

        {/* Loading */}
        {loadingA && (
          <p style={{ color: S.dim, fontFamily: S.mono, fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Loading cohort…
          </p>
        )}

        {/* Caveats */}
        {cohortA && <Caveat messages={uniqueCaveats} />}

        {/* Retention Curve */}
        {cohortA && (
          <Panel
            title="Kaplan-Meier Retention Curve"
            action={
              <button
                onClick={() => {
                  const csv = kmToCsv(cohortA);
                  downloadCsv(
                    csv,
                    `cohort_${cohortA.cohort_key.replace(/\|/g, "_")}_km.csv`
                  );
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${S.border}`,
                  borderRadius: 3,
                  color: S.dim,
                  fontFamily: S.mono,
                  fontSize: "0.75rem",
                  padding: "0.25rem 0.6rem",
                  cursor: "pointer",
                }}
              >
                Export CSV
              </button>
            }
          >
            <div style={{ marginBottom: "0.75rem", fontFamily: S.mono, fontSize: "0.8rem", color: S.dim }}>
              <span style={{ color: COMPARE_COLORS[0] }}>■</span> {labelA}
              {compareMode && cohortB && (
                <>
                  {" "}
                  <span style={{ color: COMPARE_COLORS[1], marginLeft: "1rem" }}>■</span> {labelB}
                </>
              )}
              {(loadingA || loadingB) && (
                <span style={{ marginLeft: "1rem", color: S.accent }}>loading…</span>
              )}
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={S.border} strokeDasharray="3 3" />
                <XAxis
                  dataKey="obs_year"
                  tick={{ fill: S.dim, fontFamily: S.mono, fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fill: S.dim, fontFamily: S.mono, fontSize: 11 }}
                  tickLine={false}
                  domain={[0, 1]}
                />
                <Tooltip content={<KmTooltip />} />
                <Legend
                  wrapperStyle={{ fontFamily: S.mono, fontSize: "0.75rem", color: S.dim }}
                />
                {/* Print horizon */}
                <ReferenceLine
                  x={printHorizon}
                  stroke={S.dim}
                  strokeDasharray="4 4"
                  label={{
                    value: `${printHorizon} print horizon`,
                    position: "top",
                    fill: S.dim,
                    fontFamily: S.mono,
                    fontSize: 10,
                  }}
                />
                {/* Cohort A CI band */}
                <Area
                  type="stepAfter"
                  dataKey="ci_hi"
                  stroke="none"
                  fill={CI_COLORS[0]}
                  legendType="none"
                  name="ci_hi"
                  isAnimationActive={false}
                />
                <Area
                  type="stepAfter"
                  dataKey="ci_lo"
                  stroke="none"
                  fill={S.bg}
                  legendType="none"
                  name="ci_lo"
                  isAnimationActive={false}
                />
                {/* Cohort A curve */}
                <Area
                  type="stepAfter"
                  dataKey="S"
                  stroke={COMPARE_COLORS[0]}
                  strokeWidth={2}
                  fill="none"
                  dot={false}
                  name={`S (${labelA})`}
                  isAnimationActive={false}
                />
                {/* Cohort B (compare) */}
                {compareMode && cohortB && (
                  <>
                    <Area
                      type="stepAfter"
                      dataKey="ci_hi_b"
                      stroke="none"
                      fill={CI_COLORS[1]}
                      legendType="none"
                      name="ci_hi_b"
                      isAnimationActive={false}
                    />
                    <Area
                      type="stepAfter"
                      dataKey="ci_lo_b"
                      stroke="none"
                      fill={S.bg}
                      legendType="none"
                      name="ci_lo_b"
                      isAnimationActive={false}
                    />
                    <Area
                      type="stepAfter"
                      dataKey="S_b"
                      stroke={COMPARE_COLORS[1]}
                      strokeWidth={2}
                      fill="none"
                      dot={false}
                      name={`S (${labelB})`}
                      isAnimationActive={false}
                    />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {/* Summary table */}
        {cohortA && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: compareMode && cohortB ? "1fr 1fr" : "1fr",
              gap: "1.5rem",
              marginBottom: "1.5rem",
            }}
          >
            <Panel title={`Retention Milestones — ${labelA}`}>
              <SummaryTable
                summary={cohortA.km_summary}
                cohortSize={cohortA.cohort_size}
                ulsActive={cohortA.uls_still_active}
              />
            </Panel>
            {compareMode && cohortB && (
              <Panel title={`Retention Milestones — ${labelB}`}>
                <SummaryTable
                  summary={cohortB.km_summary}
                  cohortSize={cohortB.cohort_size}
                  ulsActive={cohortB.uls_still_active}
                />
              </Panel>
            )}
          </div>
        )}

        {/* Class ladder */}
        {cohortA && cohortA.class_ladder.length > 0 && (
          <Panel title="License Class Upgrade Flow">
            <p style={{ color: S.dim, fontSize: "0.78rem", fontFamily: S.mono, marginBottom: "0.75rem" }}>
              Observed upgrades in the archive for the selected cohort class.
              Median years represents time between first appearance in each class.
            </p>
            <ClassLadder rungs={cohortA.class_ladder} cohortClass={cohortA.entry_class} />
          </Panel>
        )}

        {/* Methodology note */}
        <div
          style={{
            background: "rgba(255,163,11,0.04)",
            border: `1px solid ${S.border}`,
            borderRadius: 4,
            padding: "1rem 1.25rem",
            fontFamily: S.mono,
            fontSize: "0.72rem",
            color: S.dim,
            lineHeight: 1.7,
          }}
        >
          <strong style={{ color: S.accent }}>Methodology.</strong>{" "}
          Cohort membership is defined by first appearance in the callbook archive at a given entry
          license class. Kaplan-Meier survival estimates treat absence from a later edition as a
          &ldquo;dropout event&rdquo; (not a death) and right-censor at the {printHorizon} print
          horizon. ULS active-license status extends observation to the present for calls still
          in the FCC database. Confidence intervals use Greenwood&rsquo;s variance formula.
          Pre-1963 cohorts are omitted (n &lt; 50 in the archive). Archive gaps (e.g. missing
          editions) cause artificially accelerated apparent dropout in the affected window.
        </div>
      </div>
    </div>
  );
}
