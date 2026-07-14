"use client";

/**
 * QslWizard — interactive QSL Dating Wizard.
 *
 * Client component. Accepts a callsign and optional clue fields (city,
 * state, name, address), posts them to /api/qsl/date, and renders the
 * resulting date-window result with a timeline visualisation.
 *
 * Aesthetic: Sodium Vapor. Amber accent borders, JetBrains Mono for data,
 * Fraunces for the headline, no external chart libs.
 */

import { useState, useCallback } from "react";
import { colors, fontStacks } from "../lib/design";

// ---------------------------------------------------------------------------
// Types mirroring backend QslDateResult
// ---------------------------------------------------------------------------

interface QslEditionRow {
  year: number;
  edition: string;
  name: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

interface QslDateResult {
  callsign: string;
  first_year: number | null;
  last_year: number | null;
  window_years: number | null;
  matching_editions: QslEditionRow[];
  all_editions: QslEditionRow[];
  confidence: "high" | "medium" | "low" | "none";
  interpretation: string;
  clues_used: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_COLORS: Record<string, string> = {
  high: colors.success,
  medium: colors.accent,
  low: colors.accent_2,
  none: colors.text_dim,
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High confidence (≤5 yr window)",
  medium: "Medium confidence (6–20 yr window)",
  low: "Low confidence (>20 yr window)",
  none: "No matching editions",
};

/** Build a simple ASCII-bar timeline over the callbook year range. */
function TimelineBar({
  allEditions,
  matchEditions,
}: {
  allEditions: QslEditionRow[];
  matchEditions: QslEditionRow[];
}) {
  if (allEditions.length === 0) return null;

  const allYears = allEditions.map((e) => e.year);
  const matchYears = new Set(matchEditions.map((e) => e.year));
  const minYear = allYears[0] ?? 1927;
  const maxYear = allYears[allYears.length - 1] ?? 1993;
  const span = Math.max(maxYear - minYear, 1);

  // Group all years into decade buckets for the bar display
  const decadeStart = Math.floor(minYear / 10) * 10;
  const decadeEnd = Math.ceil(maxYear / 10) * 10;
  const decades: number[] = [];
  for (let d = decadeStart; d <= decadeEnd; d += 10) {
    decades.push(d);
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          color: colors.text_dim,
          marginBottom: "0.25rem",
        }}
      >
        CALLBOOK TIMELINE
      </div>
      {/* Year axis */}
      <div
        style={{
          position: "relative",
          height: "2rem",
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        {/* All editions — dim ticks */}
        {allEditions.map((e, i) => {
          const pct = ((e.year - minYear) / span) * 100;
          return (
            <div
              key={`all-${i}`}
              title={`${e.year} ${e.edition}`}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: 0,
                width: "3px",
                height: "100%",
                background: colors.border,
              }}
            />
          );
        })}
        {/* Matching editions — amber ticks */}
        {matchEditions.map((e, i) => {
          const pct = ((e.year - minYear) / span) * 100;
          return (
            <div
              key={`match-${i}`}
              title={`${e.year} ${e.edition} — MATCH`}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: 0,
                width: "4px",
                height: "100%",
                background: colors.accent,
              }}
            />
          );
        })}
      </div>
      {/* Decade labels */}
      <div style={{ position: "relative", height: "1rem" }}>
        {decades.map((d) => {
          const pct = ((d - minYear) / span) * 100;
          if (pct < 0 || pct > 102) return null;
          return (
            <span
              key={d}
              style={{
                position: "absolute",
                left: `${Math.min(pct, 95)}%`,
                fontSize: "0.6rem",
                fontFamily: fontStacks.mono,
                color: colors.text_dim,
                userSelect: "none",
              }}
            >
              {d}
            </span>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          color: colors.text_dim,
          marginTop: "0.125rem",
        }}
      >
        <span style={{ color: colors.border }}>▐</span> all appearances{" "}
        <span style={{ color: colors.accent }}>▐</span> matching clues
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function QslWizard() {
  const [callsign, setCallsign] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QslDateResult | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const cs = callsign.trim().toUpperCase();
      if (!cs) return;
      setLoading(true);
      setError(null);
      setResult(null);

      const params = new URLSearchParams({ callsign: cs });
      if (city.trim()) params.set("city", city.trim());
      if (state.trim()) params.set("state", state.trim().toUpperCase().slice(0, 2));
      if (name.trim()) params.set("name", name.trim());
      if (address.trim()) params.set("address", address.trim());

      try {
        const res = await fetch(`/api/qsl/date?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          const detail = typeof body["detail"] === "string" ? body["detail"] : `HTTP ${res.status}`;
          throw new Error(detail);
        }
        const data = (await res.json()) as QslDateResult;
        setResult(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [callsign, city, state, name, address],
  );

  const confidenceColor = result
    ? (CONFIDENCE_COLORS[result.confidence] ?? colors.text_dim)
    : colors.text_dim;

  return (
    <div style={{ maxWidth: "52rem", margin: "0 auto" }}>
      {/* ------------------------------------------------------------------ */}
      {/* Form                                                                */}
      {/* ------------------------------------------------------------------ */}
      <form onSubmit={handleSubmit}>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: "4px",
            padding: "1.5rem",
          }}
        >
          <div
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.12em",
              color: colors.accent,
              textTransform: "uppercase",
              marginBottom: "1rem",
            }}
          >
            Enter QSL Clues
          </div>

          {/* Callsign — required */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={labelStyle}>
              Callsign <span style={{ color: colors.accent }}>*</span>
            </label>
            <input
              required
              type="text"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value.toUpperCase())}
              placeholder="e.g. W9QQQ"
              maxLength={10}
              style={inputStyle}
            />
          </div>

          {/* Optional clues row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            <div>
              <label style={labelStyle}>City (partial OK)</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Sparta"
                maxLength={80}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>State (2-letter)</label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="e.g. WI"
                maxLength={2}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Name / Operator (partial OK)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lambert"
                maxLength={80}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Address (partial OK)</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 525 Central"
                maxLength={120}
                style={inputStyle}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !callsign.trim()}
            style={{
              background: loading ? colors.border : colors.accent,
              color: colors.bg,
              fontFamily: fontStacks.mono,
              fontWeight: 700,
              fontSize: "0.875rem",
              letterSpacing: "0.06em",
              border: "none",
              borderRadius: "3px",
              padding: "0.6rem 1.6rem",
              cursor: loading || !callsign.trim() ? "not-allowed" : "pointer",
              opacity: loading || !callsign.trim() ? 0.6 : 1,
            }}
          >
            {loading ? "QUERYING…" : "DATE THIS QSL"}
          </button>
        </div>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Error                                                               */}
      {/* ------------------------------------------------------------------ */}
      {error && (
        <div
          style={{
            marginTop: "1rem",
            background: colors.surface,
            border: `1px solid ${colors.danger}`,
            borderRadius: "4px",
            padding: "1rem",
            color: colors.danger,
            fontFamily: fontStacks.mono,
            fontSize: "0.875rem",
          }}
        >
          Error: {error}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Result                                                              */}
      {/* ------------------------------------------------------------------ */}
      {result && (
        <div
          style={{
            marginTop: "1.5rem",
            background: colors.surface,
            borderLeft: `4px solid ${confidenceColor}`,
            borderTop: `1px solid ${colors.border}`,
            borderRight: `1px solid ${colors.border}`,
            borderBottom: `1px solid ${colors.border}`,
            borderRadius: "0 4px 4px 0",
            padding: "1.5rem",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "1rem",
              flexWrap: "wrap",
              marginBottom: "1rem",
            }}
          >
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "1.5rem",
                color: colors.accent,
                letterSpacing: "0.08em",
              }}
            >
              {result.callsign}
            </span>
            <a
              href={`https://www.qrz.com/db/${result.callsign}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                color: colors.accent,
                letterSpacing: "0.1em",
                textDecoration: "none",
              }}
            >
              QRZ
              <span aria-hidden style={{ marginLeft: "0.35em" }}>
                ↗
              </span>
            </a>
            {result.first_year !== null && result.last_year !== null && (
              <span
                style={{
                  fontFamily: fontStacks.display,
                  fontSize: "1.25rem",
                  color: colors.text,
                }}
              >
                {result.first_year === result.last_year
                  ? `${result.first_year}`
                  : `${result.first_year} – ${result.last_year}`}
              </span>
            )}
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                color: confidenceColor,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {CONFIDENCE_LABELS[result.confidence] ?? result.confidence}
            </span>
          </div>

          {/* Interpretation */}
          <p
            style={{
              fontFamily: fontStacks.body,
              fontSize: "0.95rem",
              color: colors.text,
              margin: "0 0 1rem 0",
              lineHeight: 1.55,
            }}
          >
            {result.interpretation}
          </p>

          {/* Clues applied */}
          {result.clues_used.length > 0 && (
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                color: colors.text_dim,
                marginBottom: "1rem",
              }}
            >
              Clues applied:{" "}
              {result.clues_used.map((c, i) => (
                <span
                  key={c}
                  style={{ color: colors.accent }}
                >
                  {c}
                  {i < result.clues_used.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}

          {/* Timeline bar */}
          <TimelineBar
            allEditions={result.all_editions}
            matchEditions={result.matching_editions}
          />

          {/* Matching editions table */}
          {result.matching_editions.length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.7rem",
                  color: colors.text_dim,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "0.5rem",
                }}
              >
                Matching Editions ({result.matching_editions.length})
              </div>
              <div
                style={{
                  overflowX: "auto",
                  border: `1px solid ${colors.border}`,
                  borderRadius: "3px",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.78rem",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: colors.bg,
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      {["Year", "Edition", "Name", "City", "St", "Address"].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              padding: "0.4rem 0.6rem",
                              textAlign: "left",
                              color: colors.text_dim,
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.matching_editions.map((e, i) => (
                      <tr
                        key={`${e.year}-${e.edition}-${i}`}
                        style={{
                          background:
                            i % 2 === 0 ? colors.surface : colors.bg,
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        <td style={tdStyle}>{e.year}</td>
                        <td style={tdStyle}>{e.edition}</td>
                        <td style={{ ...tdStyle, color: colors.text }}>
                          {e.name ?? "—"}
                        </td>
                        <td style={tdStyle}>{e.city ?? "—"}</td>
                        <td style={tdStyle}>{e.state ?? "—"}</td>
                        <td
                          style={{
                            ...tdStyle,
                            color: colors.text_dim,
                            maxWidth: "14rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {e.address ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared style objects (avoid re-allocation per render)
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: fontStacks.mono,
  fontSize: "0.68rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: colors.text_dim,
  marginBottom: "0.3rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: "3px",
  color: colors.text,
  fontFamily: fontStacks.mono,
  fontSize: "0.875rem",
  padding: "0.45rem 0.65rem",
  outline: "none",
  boxSizing: "border-box",
};

const tdStyle: React.CSSProperties = {
  padding: "0.35rem 0.6rem",
  color: colors.text_dim,
  whiteSpace: "nowrap",
};
