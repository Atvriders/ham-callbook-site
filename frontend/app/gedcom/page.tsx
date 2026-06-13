"use client";
/**
 * /gedcom — GEDCOM Bridge (Feature #15)
 *
 * Upload a family-tree GEDCOM -> receive candidate ham-radio matches
 * from the archive phonetic index.
 *
 * Sodium Vapor palette: midnight bg, amber accent, bone text.
 * JetBrains Mono for callsign data, Fraunces for headings.
 */

export const dynamic = "force-dynamic";

import { useState, useRef } from "react";
import { colors, fontStacks } from "../../lib/design";

interface GedcomCandidate {
  indi_xref: string;
  tree_name: string;
  callsign: string;
  archive_name: string;
  first_year: number;
  last_year: number;
  state: string | null;
  confidence: "low" | "medium" | "high";
  note: string;
}

interface GedcomScanResult {
  scanned_individuals: number;
  candidates: GedcomCandidate[];
  disclaimer: string;
}

const CONF_COLOR: Record<string, string> = {
  high: "#5dd3a8",
  medium: "#ffa30b",
  low: "#a8b0c3",
};

const CONF_LABEL: Record<string, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

export default function GedcomPage() {
  const [result, setResult] = useState<GedcomScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleScan() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Select a .ged file first.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("File exceeds 5 MB limit.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/gedcom/scan", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as GedcomScanResult;
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        background: colors.bg,
        minHeight: "100vh",
        color: colors.text,
        fontFamily: fontStacks.body,
        padding: "2.5rem 1.5rem",
        maxWidth: "900px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            color: colors.text_dim,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginBottom: "0.4rem",
          }}
        >
          ·  —  ·  ·  —  ·  GEDCOM BRIDGE  ·  —  ·  ·  —  ·
        </div>
        <h1
          style={{
            fontFamily: fontStacks.display,
            fontSize: "2.2rem",
            color: colors.accent,
            margin: 0,
            fontVariationSettings: '"opsz" 72',
            textShadow: "0 0 12px rgba(255,209,102,0.35)",
          }}
        >
          GEDCOM Bridge
        </h1>
        <p
          style={{
            color: colors.text_dim,
            marginTop: "0.6rem",
            maxWidth: "640px",
            lineHeight: 1.6,
          }}
        >
          Upload a family-tree GEDCOM file to find potential ham-radio operator
          matches in the 1909–2003 archive. Matches are phonetic suggestions
          only — all require independent verification.
        </p>
      </div>

      {/* Upload panel */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: "6px",
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <label
          style={{
            display: "block",
            marginBottom: "0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            color: colors.text_dim,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Family Tree GEDCOM (.ged, max 5 MB)
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".ged,.GED,text/plain"
          style={{
            display: "block",
            marginBottom: "1rem",
            color: colors.text,
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            background: "transparent",
            border: `1px solid ${colors.border}`,
            borderRadius: "4px",
            padding: "0.4rem 0.6rem",
            width: "100%",
          }}
        />
        <button
          onClick={handleScan}
          disabled={loading}
          style={{
            background: loading ? colors.border : colors.accent,
            color: colors.bg,
            border: "none",
            borderRadius: "4px",
            padding: "0.6rem 1.4rem",
            fontFamily: fontStacks.mono,
            fontWeight: 700,
            fontSize: "0.85rem",
            letterSpacing: "0.08em",
            cursor: loading ? "not-allowed" : "pointer",
            textTransform: "uppercase",
          }}
        >
          {loading ? "Scanning…" : "Scan for Ham Ancestors"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: "rgba(255,85,85,0.1)",
            border: `1px solid ${colors.danger}`,
            borderRadius: "4px",
            padding: "0.75rem 1rem",
            color: colors.danger,
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            marginBottom: "1.5rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Summary */}
          <div
            style={{
              display: "flex",
              gap: "2rem",
              marginBottom: "1.5rem",
              flexWrap: "wrap",
            }}
          >
            {[
              { label: "Individuals Scanned", value: result.scanned_individuals },
              { label: "Candidate Matches", value: result.candidates.length },
            ].map(({ label, value }) => (
              <div key={label}>
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.65rem",
                    color: colors.text_dim,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "2rem",
                    color: colors.accent,
                    lineHeight: 1,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Disclaimer */}
          <div
            style={{
              background: "rgba(255,163,11,0.07)",
              border: `1px solid ${colors.accent}44`,
              borderRadius: "4px",
              padding: "0.75rem 1rem",
              color: colors.text_dim,
              fontSize: "0.82rem",
              marginBottom: "1.5rem",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: colors.accent }}>Note:</strong>{" "}
            {result.disclaimer}
          </div>

          {result.candidates.length === 0 ? (
            <p style={{ color: colors.text_dim }}>
              No candidate matches found. Try a tree with more individuals or
              different name spellings.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {result.candidates.map((c, i) => (
                <div
                  key={i}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderLeft: `3px solid ${CONF_COLOR[c.confidence] ?? colors.border}`,
                    borderRadius: "4px",
                    padding: "1rem 1.2rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "1rem",
                      flexWrap: "wrap",
                      marginBottom: "0.4rem",
                    }}
                  >
                    <div>
                      <a
                        href={`/callsign/${c.callsign}`}
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "1.15rem",
                          color: colors.accent,
                          textDecoration: "none",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                        }}
                      >
                        {c.callsign}
                      </a>
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "0.8rem",
                          color: colors.text_dim,
                          marginLeft: "0.75rem",
                        }}
                      >
                        {c.first_year}
                        {c.state ? ` · ${c.state}` : ""}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.65rem",
                        letterSpacing: "0.12em",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "3px",
                        background: `${CONF_COLOR[c.confidence] ?? colors.border}22`,
                        color: CONF_COLOR[c.confidence] ?? colors.text_dim,
                        border: `1px solid ${CONF_COLOR[c.confidence] ?? colors.border}44`,
                        flexShrink: 0,
                      }}
                    >
                      {CONF_LABEL[c.confidence] ?? c.confidence}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: colors.text_dim,
                      marginBottom: "0.3rem",
                    }}
                  >
                    Archive:{" "}
                    <span style={{ color: colors.text }}>{c.archive_name}</span>
                    {"  ·  "}Tree:{" "}
                    <span style={{ color: colors.text }}>{c.tree_name}</span>
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.72rem",
                        color: colors.text_dim,
                        marginLeft: "0.5rem",
                      }}
                    >
                      ({c.indi_xref})
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: colors.text_dim,
                      fontStyle: "italic",
                      lineHeight: 1.5,
                    }}
                  >
                    {c.note}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info section */}
      {!result && !loading && (
        <div
          style={{
            marginTop: "2rem",
            borderTop: `1px solid ${colors.border}`,
            paddingTop: "1.5rem",
          }}
        >
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "1.1rem",
              color: colors.text,
              marginBottom: "0.75rem",
            }}
          >
            How it works
          </h2>
          <ul
            style={{
              color: colors.text_dim,
              lineHeight: 1.8,
              paddingLeft: "1.2rem",
              fontSize: "0.9rem",
            }}
          >
            <li>
              Individual names are extracted from your GEDCOM INDI records and
              matched phonetically against the 412,000-key callbook index using
              Metaphone.
            </li>
            <li>
              State and birth-year hints narrow results to plausible era and
              geography matches.
            </li>
            <li>
              Your file is processed entirely in-memory and never stored on our
              servers.
            </li>
            <li>
              Callsign pages (click any match) show the full archive history and
              edition-by-edition address records.
            </li>
          </ul>
        </div>
      )}
    </main>
  );
}
