"use client";
/**
 * /adif — ADIF Time Machine
 *
 * Upload an ADIF log; get back every QSO annotated with the period-correct
 * callsign holder, reissue flags, heritage awards, and a decade histogram.
 * Fully stateless: nothing is persisted server-side.
 *
 * Client component (needs file input + charting). Mark force-dynamic at
 * the module level so Next.js never tries to static-render it.
 */

export const dynamic = "force-dynamic";

import React, { useCallback, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import Link from "next/link";
import { colors, fontStacks } from "../../lib/design";

// ---------------------------------------------------------------------------
// Types (mirror backend AdifAnalysisResult)
// ---------------------------------------------------------------------------

interface AnnotatedQso {
  call: string;
  qso_date: string;
  band: string | null;
  mode: string | null;
  holder_at_time: string | null;
  first_year: number | null;
  is_reissue: boolean;
  is_heritage: boolean;
  resolved: boolean;
}

interface HeritageListing {
  callsign: string;
  first_year: number | null;
  qso_date: string;
  holder_at_time: string | null;
  current_holder: string | null;
}

interface DecadeBin {
  decade: string;
  count: number;
}

interface AdifResult {
  qso_count: number;
  resolved_count: number;
  unresolved_calls: string[];
  reissued_calls: string[];
  oldest_first_licensed: {
    callsign: string;
    year: number;
    name: string | null;
    state: string | null;
  } | null;
  decade_histogram: DecadeBin[];
  heritage_qso_count: number;
  heritage_calls: HeritageListing[];
  heritage_csv_lines: string[];
  annotated_qsos: AnnotatedQso[];
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const mono: React.CSSProperties = { fontFamily: fontStacks.mono };
const display: React.CSSProperties = { fontFamily: fontStacks.display };

const badge = (bg: string, fg: string = colors.bg): React.CSSProperties => ({
  display: "inline-block",
  padding: "1px 7px",
  borderRadius: 3,
  fontSize: 11,
  fontFamily: fontStacks.mono,
  fontWeight: 700,
  background: bg,
  color: fg,
  letterSpacing: "0.04em",
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "14px 20px",
        minWidth: 120,
        textAlign: "center",
      }}
    >
      <div
        style={{
          ...mono,
          fontSize: 28,
          fontWeight: 700,
          color: colors.accent,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: colors.text_dim, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function DecadeChart({ data }: { data: DecadeBin[] }) {
  if (!data.length) return null;
  return (
    <div style={{ marginTop: 32 }}>
      <h3
        style={{
          ...display,
          fontSize: 16,
          color: colors.accent,
          marginBottom: 12,
          fontWeight: 600,
        }}
      >
        QSOs by Decade
      </h3>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: "16px 8px 8px",
        }}
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} barCategoryGap="25%">
            <XAxis
              dataKey="decade"
              tick={{ fill: colors.text_dim, fontSize: 11, fontFamily: fontStacks.mono }}
              axisLine={{ stroke: colors.border }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: colors.text_dim, fontSize: 11, fontFamily: fontStacks.mono }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                fontFamily: fontStacks.mono,
                fontSize: 12,
                color: colors.text,
              }}
              cursor={{ fill: "rgba(255,163,11,0.08)" }}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={colors.accent} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HeritageTable({ calls }: { calls: HeritageListing[] }) {
  if (!calls.length) return null;
  const uniqueCalls = Array.from(
    new Map(calls.map((h) => [h.callsign, h])).values()
  );
  return (
    <div style={{ marginTop: 32 }}>
      <h3
        style={{
          ...display,
          fontSize: 16,
          color: colors.accent,
          marginBottom: 12,
          fontWeight: 600,
        }}
      >
        Heritage Calls Worked ({uniqueCalls.length} unique)
      </h3>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          overflow: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            ...mono,
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: `1px solid ${colors.border}`,
                color: colors.text_dim,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {["Callsign", "First Year", "QSO Date", "Holder at Time", "Current Holder"].map(
                (h) => (
                  <th
                    key={h}
                    style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500 }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {uniqueCalls.map((h, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: i % 2 === 0 ? "transparent" : "rgba(255,163,11,0.03)",
                }}
              >
                <td style={{ padding: "8px 12px" }}>
                  <Link
                    href={`/callsign/${h.callsign}`}
                    style={{ color: colors.accent, textDecoration: "none" }}
                  >
                    {h.callsign}
                  </Link>
                </td>
                <td style={{ padding: "8px 12px", color: colors.glow }}>
                  {h.first_year ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", color: colors.text_dim }}>
                  {h.qso_date}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {h.holder_at_time ?? <span style={{ color: colors.text_dim }}>unknown</span>}
                </td>
                <td style={{ padding: "8px 12px", color: colors.text_dim }}>
                  {h.current_holder ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QsoTable({ qsos }: { qsos: AnnotatedQso[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? qsos : qsos.slice(0, 200);
  return (
    <div style={{ marginTop: 32 }}>
      <h3
        style={{
          ...display,
          fontSize: 16,
          color: colors.accent,
          marginBottom: 12,
          fontWeight: 600,
        }}
      >
        Annotated QSOs ({qsos.length.toLocaleString()})
      </h3>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          overflow: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            ...mono,
            fontSize: 12,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: `1px solid ${colors.border}`,
                color: colors.text_dim,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {["Call", "Date", "Band", "Mode", "Holder at Time", "Flags"].map(
                (h) => (
                  <th
                    key={h}
                    style={{ padding: "7px 10px", textAlign: "left", fontWeight: 500 }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((q, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: i % 2 === 0 ? "transparent" : "rgba(255,163,11,0.03)",
                  opacity: q.resolved ? 1 : 0.55,
                }}
              >
                <td style={{ padding: "6px 10px" }}>
                  <Link
                    href={`/callsign/${q.call}`}
                    style={{ color: colors.accent, textDecoration: "none" }}
                  >
                    {q.call}
                  </Link>
                </td>
                <td style={{ padding: "6px 10px", color: colors.text_dim }}>
                  {q.qso_date}
                </td>
                <td style={{ padding: "6px 10px", color: colors.text_dim }}>
                  {q.band ?? "—"}
                </td>
                <td style={{ padding: "6px 10px", color: colors.text_dim }}>
                  {q.mode ?? "—"}
                </td>
                <td style={{ padding: "6px 10px" }}>
                  {q.holder_at_time ?? (
                    <span style={{ color: colors.text_dim }}>unresolved</span>
                  )}
                </td>
                <td style={{ padding: "6px 10px" }}>
                  {q.is_heritage && (
                    <span style={{ ...badge(colors.glow, colors.bg), marginRight: 4 }}>
                      HERITAGE
                    </span>
                  )}
                  {q.is_reissue && (
                    <span style={{ ...badge(colors.danger, "#fff"), marginRight: 4 }}>
                      REISSUE
                    </span>
                  )}
                  {!q.resolved && (
                    <span style={badge(colors.border, colors.text_dim)}>
                      UNRESOLVED
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && qsos.length > 200 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            marginTop: 10,
            background: "none",
            border: `1px solid ${colors.border}`,
            color: colors.text_dim,
            ...mono,
            fontSize: 12,
            padding: "5px 14px",
            cursor: "pointer",
            borderRadius: 4,
          }}
        >
          Show all {qsos.length.toLocaleString()} QSOs
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function AdifPage() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdifResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const API =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : "http://backend:8000";

  const processFile = useCallback(
    async (f: File) => {
      if (f.size > 5 * 1024 * 1024) {
        setError("File exceeds 5 MB limit.");
        return;
      }
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch(`${API}/api/adif/resolve`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(
            typeof detail.detail === "string" ? detail.detail : res.statusText
          );
        }
        const data = (await res.json()) as AdifResult;
        setResult(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [API]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0] ?? null;
      if (f) processFile(f);
    },
    [processFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] ?? null;
      if (f) processFile(f);
    },
    [processFile]
  );

  const downloadCsv = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.heritage_csv_lines.join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "heritage-calls.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <main
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: "40px 24px 80px",
        color: colors.text,
      }}
    >
      {/* Hero */}
      <h1
        style={{
          ...display,
          fontSize: 36,
          fontWeight: 700,
          color: colors.accent,
          marginBottom: 6,
        }}
      >
        ADIF Time Machine
      </h1>
      <p
        style={{
          color: colors.text_dim,
          fontSize: 15,
          marginBottom: 32,
          maxWidth: 620,
        }}
      >
        Upload your ADIF log. Every QSO callsign is resolved to its
        period-correct holder&nbsp;— the op who actually held that call on
        your QSO date, not today&#39;s licensee. Reissued calls are flagged.
        Heritage award: calls first issued 50+ years before the QSO.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? colors.accent : colors.border}`,
          borderRadius: 8,
          padding: "48px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging
            ? "rgba(255,163,11,0.06)"
            : colors.surface,
          transition: "all 0.15s",
          marginBottom: 24,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".adi,.adif,.txt"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        {loading ? (
          <span
            style={{
              ...mono,
              color: colors.accent,
              fontSize: 15,
            }}
          >
            Resolving QSOs...
          </span>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
            <div style={{ color: colors.text, fontSize: 15, marginBottom: 4 }}>
              Drop your <strong style={mono}>.adi</strong> /{" "}
              <strong style={mono}>.adif</strong> here
            </div>
            <div style={{ color: colors.text_dim, fontSize: 12 }}>
              or click to browse — max 5 MB, up to 50,000 QSOs
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: "rgba(255,85,85,0.1)",
            border: `1px solid ${colors.danger}`,
            borderRadius: 6,
            padding: "10px 16px",
            color: colors.danger,
            ...mono,
            fontSize: 13,
            marginBottom: 24,
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Stat cards */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <StatCard label="QSOs" value={result.qso_count.toLocaleString()} />
            <StatCard
              label="Resolved"
              value={result.resolved_count.toLocaleString()}
            />
            <StatCard
              label="Reissued Calls"
              value={result.reissued_calls.length}
            />
            <StatCard
              label="Heritage QSOs"
              value={result.heritage_qso_count}
            />
            {result.oldest_first_licensed && (
              <StatCard
                label={`Oldest op worked (${result.oldest_first_licensed.callsign})`}
                value={`${result.oldest_first_licensed.year}`}
              />
            )}
          </div>

          {/* Heritage CSV download */}
          {result.heritage_qso_count > 0 && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={downloadCsv}
                style={{
                  background: colors.accent,
                  color: colors.bg,
                  border: "none",
                  borderRadius: 4,
                  padding: "8px 18px",
                  ...mono,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.03em",
                }}
              >
                Download Heritage CSV ({result.heritage_qso_count} QSOs)
              </button>
            </div>
          )}

          <DecadeChart data={result.decade_histogram} />
          <HeritageTable calls={result.heritage_calls} />
          <QsoTable qsos={result.annotated_qsos} />

          {/* Unresolved list */}
          {result.unresolved_calls.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <h3
                style={{
                  ...display,
                  fontSize: 14,
                  color: colors.text_dim,
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                Unresolved calls ({result.unresolved_calls.length})
              </h3>
              <div
                style={{
                  ...mono,
                  fontSize: 12,
                  color: colors.text_dim,
                  lineHeight: 1.7,
                }}
              >
                {result.unresolved_calls.join(" · ")}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
