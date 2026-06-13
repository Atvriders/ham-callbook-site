"use client";

/**
 * /name-voyager — First-Name Voyager + YL Index (Feature #14)
 *
 * Baby-name-voyager-style explorer over operator first names in the
 * 1920-1997 callbook archive.
 *
 * Panels:
 *   1. Search bar + autocomplete — type a name, see its edition-year curve.
 *   2. Compare mode — up to 4 names overlaid on the same chart.
 *   3. Top names by era — decade strip showing the top 10 names per decade.
 *   4. YL Index — estimated women-operator share per state per decade,
 *      with honest confidence bands and methodology note.
 *
 * Uses Recharts for the bar/line charts. All design tokens from lib/design.ts.
 * No numpy/scipy — confidence intervals computed server-side in pure Python.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { colors, fontStacks } from "../../lib/design";

// --------------------------------------------------------------------------- //
// Constants + types                                                            //
// --------------------------------------------------------------------------- //

const API =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "")) ||
  "/api";

const COMPARE_COLORS = [
  colors.accent,
  colors.success,
  colors.glow,
  "#c084fc",
] as const;

interface VoyagerEntry {
  name: string;
  years: Record<string, number>;
  total: number;
  first_year: number | null;
  last_year: number | null;
  not_found?: boolean;
}

interface YlCell {
  share: number | null;
  ci_lo: number | null;
  ci_hi: number | null;
  n: number;
  unclassifiable_n: number;
  sparse: boolean;
}

interface TopNameEntry {
  name: string;
  count: number;
}

// --------------------------------------------------------------------------- //
// Helpers                                                                     //
// --------------------------------------------------------------------------- //

function yearMapToChartData(
  name: string,
  years: Record<string, number>
): { year: string; count: number }[] {
  return Object.entries(years)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([year, count]) => ({ year, count }));
}

function mergeCompareData(
  entries: VoyagerEntry[]
): { year: string; [name: string]: number | string }[] {
  const allYears = new Set<string>();
  for (const e of entries) {
    Object.keys(e.years).forEach((y) => allYears.add(y));
  }
  return Array.from(allYears)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((year) => {
      const row: { year: string; [k: string]: number | string } = { year };
      for (const e of entries) {
        row[e.name] = e.years[year] ?? 0;
      }
      return row;
    });
}

// --------------------------------------------------------------------------- //
// Sub-components                                                              //
// --------------------------------------------------------------------------- //

const S = {
  bg: colors.bg,
  surface: colors.surface,
  border: colors.border,
  text: colors.text,
  dim: colors.text_dim,
  accent: colors.accent,
  success: colors.success,
  mono: fontStacks.mono,
  display: fontStacks.display,
  body: fontStacks.body,
} as const;

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
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
      <h2
        style={{
          fontFamily: S.display,
          color: S.accent,
          fontSize: "1.1rem",
          fontWeight: 600,
          marginBottom: "1rem",
          letterSpacing: "0.02em",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: S.mono,
        fontSize: "0.75rem",
        padding: "0.2rem 0.6rem",
        borderRadius: 3,
        border: `1px solid ${active ? S.accent : S.border}`,
        background: active ? S.accent : "transparent",
        color: active ? S.bg : S.dim,
        cursor: "pointer",
        marginRight: "0.4rem",
        marginBottom: "0.4rem",
      }}
    >
      {label}
    </button>
  );
}

function MethodologyNote({ yl_degraded }: { yl_degraded: boolean }) {
  return (
    <div
      style={{
        background: S.bg,
        border: `1px solid ${S.border}`,
        borderRadius: 3,
        padding: "0.75rem 1rem",
        fontSize: "0.78rem",
        color: S.dim,
        fontFamily: S.body,
        lineHeight: 1.6,
        marginTop: "1rem",
      }}
    >
      {yl_degraded ? (
        <>
          <strong style={{ color: colors.danger }}>YL Index unavailable.</strong>{" "}
          The SSA baby-names data source could not be reached during artifact
          build. The name voyager is fully functional; only the YL (women
          operator) estimates are missing.
        </>
      ) : (
        <>
          <strong style={{ color: S.accent }}>Methodology:</strong> Women-operator
          share is estimated by matching each extracted first name against SSA
          public-domain baby-names data (p_female = female births / total births,
          1880-1980). Wilson-score 95% confidence intervals shown as error bars.
          Names that are initials-only, single-token, or unrecognised in SSA data
          are excluded from the denominator and tallied as &ldquo;unclassifiable.&rdquo;
          Treat estimates as lower bounds — many YL operators used initials and are
          excluded. First-name extraction accuracy also varies by OCR era; pre-1940
          counts are sparser.
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Main page                                                                   //
// --------------------------------------------------------------------------- //

export default function NameVoyagerPage() {
  // --- Tab state ---
  const [activeTab, setActiveTab] = useState<"voyager" | "top-era" | "yl">(
    "voyager"
  );

  // --- Voyager state ---
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<VoyagerEntry | null>(null);
  const [compareList, setCompareList] = useState<VoyagerEntry[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Top-by-era state ---
  const [topByEra, setTopByEra] = useState<Record<string, TopNameEntry[]>>({});
  const [selectedDecade, setSelectedDecade] = useState<string | null>(null);

  // --- YL index state ---
  const [ylData, setYlData] = useState<Record<
    string,
    Record<string, YlCell>
  > | null>(null);
  const [ylDegraded, setYlDegraded] = useState(false);
  const [ylState, setYlState] = useState<string>("CA");
  const [ylLoadState, setYlLoadState] = useState<"idle" | "loading" | "done">(
    "idle"
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Autocomplete ---
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/name-trends/search?q=${encodeURIComponent(query)}&limit=12`
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.names ?? []);
        }
      } catch {
        // ignore
      }
    }, 200);
  }, [query]);

  const fetchVoyager = useCallback(
    async (name: string) => {
      setLoading(true);
      setError(null);
      setSuggestions([]);
      try {
        const res = await fetch(
          `${API}/name-trends/voyager/${encodeURIComponent(name)}`
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(
            (j as { detail?: string }).detail ??
              `Name "${name}" not found in the archive.`
          );
          setSelected(null);
          setLoading(false);
          return;
        }
        const data: VoyagerEntry = await res.json();
        if (compareMode) {
          if (!compareList.find((e) => e.name === data.name)) {
            setCompareList((prev) =>
              [...prev, data].slice(-4)
            );
          }
        } else {
          setSelected(data);
        }
      } catch (e) {
        setError(String(e));
      }
      setLoading(false);
    },
    [compareMode, compareList]
  );

  const handleSearch = () => {
    if (query.trim()) fetchVoyager(query.trim());
  };

  // --- Top by era ---
  useEffect(() => {
    if (activeTab !== "top-era" || Object.keys(topByEra).length > 0) return;
    fetch(`${API}/name-trends/top-by-era`)
      .then((r) => r.json())
      .then((d) => {
        setTopByEra(d.top_names_by_era ?? {});
        const decades = Object.keys(d.top_names_by_era ?? {}).sort();
        if (decades.length > 0) setSelectedDecade(decades[decades.length - 2] ?? decades[0] ?? null);
      })
      .catch(() => {});
  }, [activeTab, topByEra]);

  // --- YL index ---
  useEffect(() => {
    if (activeTab !== "yl" || ylLoadState !== "idle") return;
    setYlLoadState("loading");
    fetch(`${API}/name-trends/yl-index`)
      .then((r) => r.json())
      .then((d) => {
        setYlDegraded(d.yl_degraded ?? true);
        setYlData(d.yl_index ?? null);
        setYlLoadState("done");
      })
      .catch(() => {
        setYlDegraded(true);
        setYlLoadState("done");
      });
  }, [activeTab, ylLoadState]);

  // --- Chart data ---
  const singleChartData = selected
    ? yearMapToChartData(selected.name, selected.years)
    : [];

  const compareChartData =
    compareList.length > 0 ? mergeCompareData(compareList) : [];

  const activeCompareEntries = compareMode ? compareList : selected ? [selected] : [];

  // --- YL chart for selected state ---
  const ylStateData: {
    decade: string;
    share: number;
    ci_lo: number;
    ci_hi: number;
    n: number;
  }[] = [];
  if (ylData && ylData[ylState]) {
    for (const [decade, cell] of Object.entries(ylData[ylState]).sort()) {
      if (!cell.sparse && cell.share !== null) {
        ylStateData.push({
          decade,
          share: Math.round(cell.share * 1000) / 10, // percent
          ci_lo: Math.round((cell.ci_lo ?? 0) * 1000) / 10,
          ci_hi: Math.round((cell.ci_hi ?? 0) * 1000) / 10,
          n: cell.n,
        });
      }
    }
  }

  const US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA",
    "HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME",
    "MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM",
    "NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX",
    "UT","VA","VT","WA","WI","WV","WY",
  ];

  // -------------------------------------------------------------------------- //
  // Render                                                                     //
  // -------------------------------------------------------------------------- //

  return (
    <main
      style={{
        background: S.bg,
        minHeight: "100vh",
        color: S.text,
        fontFamily: S.body,
        padding: "2rem 1.5rem",
        maxWidth: "900px",
        margin: "0 auto",
      }}
    >
      {/* Hero */}
      <header style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontFamily: S.display,
            fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
            color: S.accent,
            fontWeight: 700,
            textShadow: "0 0 12px rgba(255,209,102,0.4)",
            marginBottom: "0.4rem",
          }}
        >
          First-Name Voyager
        </h1>
        <p
          style={{
            color: S.dim,
            fontSize: "0.9rem",
            maxWidth: "60ch",
            lineHeight: 1.6,
          }}
        >
          Explore operator first names across 1920&ndash;1997 callbook editions.
          See how names like <em>Elmer</em> or <em>Mildred</em> rise and fall,
          compare multiple names, and view decade top-10 lists. The YL Index
          estimates women-operator share per state per decade via SSA birth-name
          gender data.
        </p>
      </header>

      {/* Tab rail */}
      <nav style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem" }}>
        {(["voyager", "top-era", "yl"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              fontFamily: S.mono,
              fontSize: "0.78rem",
              padding: "0.3rem 0.9rem",
              borderRadius: 3,
              border: `1px solid ${activeTab === tab ? S.accent : S.border}`,
              background: activeTab === tab ? S.accent : "transparent",
              color: activeTab === tab ? S.bg : S.dim,
              cursor: "pointer",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {tab === "voyager"
              ? "Name Voyager"
              : tab === "top-era"
              ? "Top by Era"
              : "YL Index"}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------------------- */}
      {/* TAB: VOYAGER                                                         */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "voyager" && (
        <>
          <Panel title="Search Operator First Names">
            {/* Mode toggle */}
            <div
              style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}
            >
              <Pill
                label="Single"
                active={!compareMode}
                onClick={() => {
                  setCompareMode(false);
                  setCompareList([]);
                }}
              />
              <Pill
                label="Compare (up to 4)"
                active={compareMode}
                onClick={() => {
                  setCompareMode(true);
                  setSelected(null);
                }}
              />
            </div>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="e.g. Elmer, Mildred, Patricia..."
                  style={{
                    flex: 1,
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 3,
                    color: S.text,
                    fontFamily: S.mono,
                    fontSize: "0.9rem",
                    padding: "0.45rem 0.75rem",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  style={{
                    background: S.accent,
                    color: S.bg,
                    border: "none",
                    borderRadius: 3,
                    fontFamily: S.mono,
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    padding: "0.45rem 1rem",
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  {loading ? "..." : "Go"}
                </button>
              </div>

              {/* Autocomplete dropdown */}
              {suggestions.length > 0 && (
                <ul
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: "5rem",
                    background: S.surface,
                    border: `1px solid ${S.border}`,
                    borderRadius: 3,
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    zIndex: 10,
                    maxHeight: "200px",
                    overflowY: "auto",
                  }}
                >
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        onClick={() => {
                          setQuery(s);
                          setSuggestions([]);
                          fetchVoyager(s);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: S.text,
                          fontFamily: S.mono,
                          fontSize: "0.85rem",
                          padding: "0.4rem 0.75rem",
                          cursor: "pointer",
                        }}
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p
                style={{
                  color: colors.danger,
                  fontSize: "0.85rem",
                  fontFamily: S.mono,
                  marginTop: "0.5rem",
                }}
              >
                {error}
              </p>
            )}

            {/* Compare chips */}
            {compareMode && compareList.length > 0 && (
              <div
                style={{ display: "flex", flexWrap: "wrap", marginTop: "0.5rem" }}
              >
                {compareList.map((e, i) => (
                  <span
                    key={e.name}
                    style={{
                      fontFamily: S.mono,
                      fontSize: "0.78rem",
                      padding: "0.2rem 0.5rem",
                      borderRadius: 3,
                      border: `1px solid ${COMPARE_COLORS[i] ?? S.border}`,
                      color: COMPARE_COLORS[i] ?? S.text,
                      marginRight: "0.4rem",
                      marginBottom: "0.4rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                    }}
                  >
                    {e.name}
                    <button
                      onClick={() =>
                        setCompareList((prev) =>
                          prev.filter((x) => x.name !== e.name)
                        )
                      }
                      style={{
                        background: "none",
                        border: "none",
                        color: S.dim,
                        cursor: "pointer",
                        padding: 0,
                        fontSize: "0.85rem",
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Panel>

          {/* Single mode chart */}
          {!compareMode && selected && (
            <Panel
              title={`${selected.name} — ${selected.total.toLocaleString()} appearances`}
            >
              <p
                style={{
                  color: S.dim,
                  fontSize: "0.78rem",
                  fontFamily: S.mono,
                  marginBottom: "0.75rem",
                }}
              >
                Editions {selected.first_year}–{selected.last_year} &nbsp;·&nbsp;{" "}
                {Object.keys(selected.years).length} editions with data
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={singleChartData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: S.dim, fontSize: 10, fontFamily: S.mono }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: S.dim, fontSize: 10, fontFamily: S.mono }}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: S.surface,
                      border: `1px solid ${S.border}`,
                      color: S.text,
                      fontFamily: S.mono,
                      fontSize: "0.8rem",
                    }}
                  />
                  <Bar dataKey="count" fill={S.accent} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}

          {/* Compare mode chart */}
          {compareMode && compareList.length > 0 && (
            <Panel title="Name Comparison">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={compareChartData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: S.dim, fontSize: 10, fontFamily: S.mono }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: S.dim, fontSize: 10, fontFamily: S.mono }}
                    width={45}
                  />
                  <Tooltip
                    contentStyle={{
                      background: S.surface,
                      border: `1px solid ${S.border}`,
                      color: S.text,
                      fontFamily: S.mono,
                      fontSize: "0.8rem",
                    }}
                  />
                  <Legend
                    wrapperStyle={{
                      fontFamily: S.mono,
                      fontSize: "0.78rem",
                      color: S.dim,
                    }}
                  />
                  {compareList.map((e, i) => (
                    <Line
                      key={e.name}
                      type="monotone"
                      dataKey={e.name}
                      stroke={COMPARE_COLORS[i] ?? S.dim}
                      dot={false}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          )}
        </>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB: TOP BY ERA                                                      */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "top-era" && (
        <Panel title="Top Operator Names by Decade">
          {Object.keys(topByEra).length === 0 ? (
            <p style={{ color: S.dim, fontFamily: S.mono, fontSize: "0.85rem" }}>
              Loading...
            </p>
          ) : (
            <>
              {/* Decade picker */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  marginBottom: "1rem",
                }}
              >
                {Object.keys(topByEra)
                  .sort()
                  .map((decade) => (
                    <Pill
                      key={decade}
                      label={decade}
                      active={selectedDecade === decade}
                      onClick={() => setSelectedDecade(decade)}
                    />
                  ))}
              </div>

              {/* Bar chart for selected decade */}
              {selectedDecade && topByEra[selectedDecade] && (
                <>
                  <p
                    style={{
                      color: S.dim,
                      fontSize: "0.78rem",
                      fontFamily: S.mono,
                      marginBottom: "0.5rem",
                    }}
                  >
                    Top 10 first names · {selectedDecade}
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={topByEra[selectedDecade]}
                      layout="vertical"
                      margin={{ top: 0, right: 16, bottom: 0, left: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
                      <XAxis
                        type="number"
                        tick={{
                          fill: S.dim,
                          fontSize: 10,
                          fontFamily: S.mono,
                        }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{
                          fill: S.text,
                          fontSize: 11,
                          fontFamily: S.mono,
                        }}
                        width={58}
                      />
                      <Tooltip
                        contentStyle={{
                          background: S.surface,
                          border: `1px solid ${S.border}`,
                          color: S.text,
                          fontFamily: S.mono,
                          fontSize: "0.8rem",
                        }}
                      />
                      <Bar
                        dataKey="count"
                        fill={S.accent}
                        radius={[0, 2, 2, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>

                  <p
                    style={{
                      color: S.dim,
                      fontSize: "0.72rem",
                      fontFamily: S.body,
                      marginTop: "0.5rem",
                      lineHeight: 1.5,
                    }}
                  >
                    Counts include all editions in the {selectedDecade} window.
                    Pre-1940 data is sparser; OCR artifacts may inflate some
                    tokens. Names with fewer than 10 total appearances across the
                    archive are excluded.
                  </p>
                </>
              )}
            </>
          )}
        </Panel>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB: YL INDEX                                                        */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "yl" && (
        <>
          <Panel title="YL Index — Estimated Women-Operator Share">
            {ylLoadState === "loading" && (
              <p
                style={{
                  color: S.dim,
                  fontFamily: S.mono,
                  fontSize: "0.85rem",
                }}
              >
                Loading YL index...
              </p>
            )}

            {ylLoadState === "done" && ylDegraded && (
              <p
                style={{
                  color: colors.danger,
                  fontFamily: S.mono,
                  fontSize: "0.85rem",
                }}
              >
                YL Index data is unavailable (SSA source unreachable at build
                time).
              </p>
            )}

            {ylLoadState === "done" && !ylDegraded && ylData && (
              <>
                {/* State selector */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    marginBottom: "1rem",
                  }}
                >
                  <label
                    style={{
                      color: S.dim,
                      fontFamily: S.mono,
                      fontSize: "0.82rem",
                    }}
                  >
                    State:
                  </label>
                  <select
                    value={ylState}
                    onChange={(e) => setYlState(e.target.value)}
                    style={{
                      background: S.bg,
                      border: `1px solid ${S.border}`,
                      borderRadius: 3,
                      color: S.text,
                      fontFamily: S.mono,
                      fontSize: "0.85rem",
                      padding: "0.3rem 0.6rem",
                    }}
                  >
                    {US_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                {/* YL chart */}
                {ylStateData.length > 0 ? (
                  <>
                    <p
                      style={{
                        color: S.dim,
                        fontSize: "0.78rem",
                        fontFamily: S.mono,
                        marginBottom: "0.5rem",
                      }}
                    >
                      Estimated women-operator % · {ylState} · with 95% CI
                    </p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={ylStateData}
                        margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
                        <XAxis
                          dataKey="decade"
                          tick={{
                            fill: S.dim,
                            fontSize: 10,
                            fontFamily: S.mono,
                          }}
                        />
                        <YAxis
                          tick={{
                            fill: S.dim,
                            fontSize: 10,
                            fontFamily: S.mono,
                          }}
                          width={38}
                          tickFormatter={(v: number) => `${v}%`}
                        />
                        <Tooltip
                          formatter={(val: number, name: string) => {
                            if (name === "share") return [`${val}%`, "Est. share"];
                            return [val, name];
                          }}
                          contentStyle={{
                            background: S.surface,
                            border: `1px solid ${S.border}`,
                            color: S.text,
                            fontFamily: S.mono,
                            fontSize: "0.8rem",
                          }}
                        />
                        <Bar
                          dataKey="share"
                          fill={S.success}
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>

                    {/* CI table */}
                    <table
                      style={{
                        width: "100%",
                        marginTop: "1rem",
                        borderCollapse: "collapse",
                        fontFamily: S.mono,
                        fontSize: "0.78rem",
                        color: S.dim,
                      }}
                    >
                      <thead>
                        <tr>
                          {["Decade", "Est. %", "95% CI", "n (classif.)", "Unclass."].map(
                            (h) => (
                              <th
                                key={h}
                                style={{
                                  textAlign: "left",
                                  paddingBottom: "0.3rem",
                                  borderBottom: `1px solid ${S.border}`,
                                  color: S.accent,
                                }}
                              >
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {ylStateData.map((row) => {
                          const raw =
                            ylData[ylState]?.[row.decade];
                          return (
                            <tr key={row.decade}>
                              <td style={{ paddingTop: "0.25rem", color: S.text }}>{row.decade}</td>
                              <td style={{ paddingTop: "0.25rem", color: S.success }}>
                                {row.share.toFixed(1)}%
                              </td>
                              <td style={{ paddingTop: "0.25rem" }}>
                                {row.ci_lo.toFixed(1)}–{row.ci_hi.toFixed(1)}%
                              </td>
                              <td style={{ paddingTop: "0.25rem" }}>
                                {row.n.toLocaleString()}
                              </td>
                              <td style={{ paddingTop: "0.25rem" }}>
                                {raw?.unclassifiable_n?.toLocaleString() ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p
                    style={{
                      color: S.dim,
                      fontFamily: S.mono,
                      fontSize: "0.85rem",
                    }}
                  >
                    No non-sparse data for {ylState}. Try a larger state (CA, TX,
                    NY, IL).
                  </p>
                )}
              </>
            )}
          </Panel>

          <MethodologyNote yl_degraded={ylDegraded} />
        </>
      )}
    </main>
  );
}
