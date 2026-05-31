/**
 * <USMap/> — per-state heat map for the /stats page.
 *
 * Client component. We don't pull in a heavy geo package by default —
 * just render a square tile per state laid out roughly like the
 * NPR-style cartogram (Pacific on the left, Atlantic on the right,
 * Alaska and Hawaii in their conventional inset positions). Each tile
 * is amber-tinted by its share of the corpus.
 *
 * This stays well inside the Sodium Vapor palette and avoids the
 * generic "dark-theme map with neon scatter" look that screams AI.
 */

"use client";

import { useRouter } from "next/navigation";
import { colors, fontStacks } from "../../lib/design";

interface StatePoint {
  state: string;
  count: number;
}

/**
 * Tile grid for the 50 US states + DC, using the de-facto NPR layout.
 * (row, col) is zero-indexed from the top-left. The exact positions
 * are widely used in newsroom dataviz; what matters here is that the
 * relative geographic intuition reads as "this looks like a US map"
 * even with chunky 4rem squares.
 */
const TILES: Record<string, [number, number]> = {
  AK: [0, 0],
  ME: [0, 10],
  VT: [1, 9],
  NH: [1, 10],
  WA: [2, 1],
  MT: [2, 2],
  ND: [2, 3],
  MN: [2, 4],
  WI: [2, 5],
  MI: [2, 6],
  NY: [2, 8],
  MA: [2, 10],
  ID: [3, 2],
  WY: [3, 3],
  SD: [3, 4],
  IA: [3, 5],
  IL: [3, 6],
  IN: [3, 7],
  OH: [3, 8],
  PA: [3, 9],
  NJ: [3, 10],
  CT: [3, 11],
  RI: [3, 12],
  OR: [4, 1],
  NV: [4, 2],
  UT: [4, 3],
  CO: [4, 4],
  NE: [4, 5],
  MO: [4, 6],
  KY: [4, 7],
  WV: [4, 8],
  VA: [4, 9],
  MD: [4, 10],
  DE: [4, 11],
  CA: [5, 1],
  AZ: [5, 3],
  NM: [5, 4],
  KS: [5, 5],
  AR: [5, 6],
  TN: [5, 7],
  NC: [5, 8],
  SC: [5, 9],
  DC: [5, 10],
  HI: [6, 0],
  OK: [6, 5],
  LA: [6, 6],
  MS: [6, 7],
  AL: [6, 8],
  GA: [6, 9],
  TX: [7, 5],
  FL: [7, 9],
};

export function USMap({ points }: { points: StatePoint[] }) {
  const router = useRouter();

  // Normalize the per-state counts into a 0..1 intensity. Top-5 states
  // dominate by an order of magnitude so we log-scale the intensity to
  // keep the small states visible on the same gradient.
  const byState = new Map(points.map((p) => [p.state, p.count]));
  const maxLog = Math.log1p(
    Math.max(1, ...Array.from(byState.values()).map((v) => v ?? 0)),
  );

  function intensity(stateCode: string): number {
    const c = byState.get(stateCode) ?? 0;
    if (!c || maxLog === 0) return 0;
    return Math.log1p(c) / maxLog;
  }

  // Top-5 list rendered as a sidebar so the user has hard numbers,
  // not just an amber gradient.
  const topStates = [...points]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(12rem, 16rem)",
        gap: "1.5rem",
        alignItems: "start",
      }}
    >
      <div
        style={{
          padding: "1rem",
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          borderRadius: "0.25rem",
          overflow: "auto",
        }}
      >
        <div
          role="img"
          aria-label="US state appearance heatmap"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(13, minmax(2.25rem, 1fr))",
            gridAutoRows: "minmax(2.25rem, auto)",
            gap: "0.25rem",
            minWidth: "32rem",
          }}
        >
          {Object.entries(TILES).map(([code, [r, c]]) => {
            const i = intensity(code);
            const count = byState.get(code) ?? 0;
            // Amber alpha climbs from 0.05 → 0.85 with intensity. The
            // border stays at full accent for occupied states so even
            // a zero-count tile still reads as part of the country.
            const bg = `rgba(255, 163, 11, ${(0.05 + i * 0.8).toFixed(3)})`;
            return (
              <button
                key={code}
                type="button"
                onClick={() => router.push(`/state/${code}`)}
                title={`${code}: ${count.toLocaleString()} — open /state/${code}`}
                aria-label={`${code}, ${count.toLocaleString()} appearances. Open state page.`}
                style={{
                  gridRow: r + 1,
                  gridColumn: c + 1,
                  background: bg,
                  border: `1px solid ${
                    i > 0 ? colors.accent_2 : colors.border
                  }`,
                  borderRadius: "2px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0.25rem",
                  minHeight: "2.25rem",
                  color: i > 0.6 ? colors.bg : colors.text,
                  fontFamily: fontStacks.mono,
                  fontSize: "0.7rem",
                  letterSpacing: "0.05em",
                  cursor: "pointer",
                  transition: "box-shadow 160ms ease, border-color 160ms ease",
                  outline: "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 0 0 1px rgba(255,163,11,0.9), 0 0 14px rgba(255,209,102,0.55)";
                  e.currentTarget.style.borderColor = colors.accent;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor =
                    i > 0 ? colors.accent_2 : colors.border;
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 0 0 2px rgba(255,209,102,0.85)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <span style={{ fontWeight: 700 }}>{code}</span>
              </button>
            );
          })}
        </div>
        <div
          style={{
            marginTop: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            color: colors.text_dim,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          <span>fewer</span>
          <div
            aria-hidden
            style={{
              flex: 1,
              height: "0.5rem",
              background: `linear-gradient(to right,
                rgba(255, 163, 11, 0.05),
                rgba(255, 163, 11, 0.85))`,
              borderRadius: "2px",
              border: `1px solid ${colors.border}`,
            }}
          />
          <span>more</span>
        </div>
      </div>

      <aside
        style={{
          padding: "1rem 1.125rem",
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          borderRadius: "0.25rem",
        }}
      >
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: colors.text_dim,
            marginBottom: "0.75rem",
          }}
        >
          Top 5 by appearances
        </div>
        {topStates.length === 0 ? (
          <div
            style={{
              color: colors.text_dim,
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
            }}
          >
            No state data.
          </div>
        ) : (
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {topStates.map((s, i) => (
              <li
                key={s.state}
                style={{
                  paddingBottom: "0.5rem",
                  borderBottom:
                    i === topStates.length - 1
                      ? "none"
                      : `1px solid ${colors.border}`,
                }}
              >
                <a
                  href={`/state/${s.state}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontFamily: fontStacks.display,
                      fontSize: "1.1rem",
                      fontVariationSettings: '"opsz" 24',
                      color: colors.text,
                    }}
                  >
                    {s.state}
                  </span>
                  <span
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: "0.95rem",
                      color: colors.accent,
                    }}
                  >
                    {s.count.toLocaleString()}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
