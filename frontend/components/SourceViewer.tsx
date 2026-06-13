"use client";

/**
 * SourceViewer — expandable 'See the source' panel for a callsign record.
 *
 * Shows:
 *   - The raw OCR line as stored in the database (verbatim, as OCR'd).
 *   - The edition name and its PDF filename if known.
 *   - A best-effort rendered page image (estimated by callsign match across
 *     per-page OCR text files; NOT an exact location).
 *
 * Honest copy: the component explicitly labels what is exact vs. estimated.
 * The page image loads lazily on expand to avoid blocking the page render.
 *
 * Aesthetic: Sodium Vapor (midnight bg, amber accent, JetBrains Mono).
 * All colour tokens imported from lib/design.ts — no hard-coded hex.
 */

import { useState, useEffect, useCallback } from "react";
import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// API response shape — mirrors ProvenanceDetail in backend/app/routes/provenance.py
// ---------------------------------------------------------------------------

export interface ProvenanceDetail {
  callsign: string;
  year: number;
  edition: string | null;
  raw_ocr_line: string | null;
  has_ocr_pages: boolean;
  estimated_page: number | null;
  page_image_url: string | null;
  page_note: string;
  pdf_name: string | null;
  edition_label: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SourceViewerProps {
  callsign: string;
  year: number;
  edition: string;
  /** Optional: pre-fetched provenance data. If omitted, fetched on expand. */
  initialData?: ProvenanceDetail | null;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "")) ||
  "/api";

async function fetchProvenance(
  callsign: string,
  year: number,
  edition: string,
): Promise<ProvenanceDetail> {
  const url = `${API_BASE}/provenance/${encodeURIComponent(callsign)}/${year}/${encodeURIComponent(edition)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Provenance fetch failed: ${res.status}`);
  }
  return (await res.json()) as ProvenanceDetail;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OcrLine({ text }: { text: string }) {
  return (
    <div
      style={{
        fontFamily: fontStacks.mono,
        fontSize: 12,
        color: colors.text,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 3,
        padding: "8px 12px",
        lineHeight: 1.5,
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {text}
    </div>
  );
}

function PageImage({
  url,
  label,
  page,
}: {
  url: string;
  label: string;
  page: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: 10,
          color: colors.text_dim,
          letterSpacing: "0.08em",
          marginBottom: 6,
          textTransform: "uppercase",
        }}
      >
        Estimated page {page} of {label}
      </div>
      {error ? (
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 11,
            color: colors.text_dim,
            padding: "8px 0",
          }}
        >
          Page image unavailable.
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {!loaded && (
            <div
              style={{
                height: 80,
                display: "flex",
                alignItems: "center",
                fontFamily: fontStacks.mono,
                fontSize: 11,
                color: colors.text_dim,
                letterSpacing: "0.08em",
              }}
            >
              Rendering page…
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Estimated page ${page} of ${label}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            style={{
              display: loaded ? "block" : "none",
              maxWidth: "100%",
              border: `1px solid ${colors.border}`,
              borderRadius: 2,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: ProvenanceDetail }
  | { kind: "error"; message: string };

export default function SourceViewer({
  callsign,
  year,
  edition,
  initialData,
}: SourceViewerProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(
    initialData ? { kind: "ok", data: initialData } : { kind: "idle" },
  );

  const load = useCallback(async () => {
    if (state.kind !== "idle") return;
    setState({ kind: "loading" });
    try {
      const data = await fetchProvenance(callsign, year, edition);
      setState({ kind: "ok", data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [callsign, year, edition, state.kind]);

  // Trigger fetch when panel opens for the first time.
  useEffect(() => {
    if (open && state.kind === "idle") {
      void load();
    }
  }, [open, load, state.kind]);

  const data = state.kind === "ok" ? state.data : null;

  return (
    <div
      style={{
        borderTop: `1px dashed ${colors.border}`,
        paddingTop: 8,
        marginTop: 8,
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          all: "unset",
          cursor: "pointer",
          fontFamily: fontStacks.mono,
          fontSize: 11,
          color: open ? colors.accent : colors.text_dim,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 6,
          userSelect: "none",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            transition: "transform 0.15s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            fontSize: 9,
          }}
        >
          ▶
        </span>
        See the source
      </button>

      {/* Panel body */}
      {open && (
        <div style={{ marginTop: 10 }}>
          {state.kind === "loading" && (
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: 11,
                color: colors.text_dim,
                letterSpacing: "0.08em",
              }}
            >
              Loading provenance…
            </div>
          )}

          {state.kind === "error" && (
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: 11,
                color: colors.danger,
              }}
            >
              Could not load provenance data.
            </div>
          )}

          {data && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Edition label */}
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: 11,
                  color: colors.text_dim,
                  letterSpacing: "0.08em",
                }}
              >
                <span style={{ color: colors.text_dim, textTransform: "uppercase" }}>
                  Source edition:{" "}
                </span>
                <span style={{ color: colors.text }}>{data.edition_label}</span>
                {data.pdf_name && (
                  <span style={{ color: colors.text_dim }}> ({data.pdf_name}.pdf)</span>
                )}
              </div>

              {/* Raw OCR line */}
              {data.raw_ocr_line ? (
                <div>
                  <div
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: 10,
                      color: colors.text_dim,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Source line, as OCR&apos;d
                  </div>
                  <OcrLine text={data.raw_ocr_line} />
                </div>
              ) : (
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: 11,
                    color: colors.text_dim,
                  }}
                >
                  Raw OCR line not available for this record.
                </div>
              )}

              {/* Page image or "no page data" note */}
              {data.page_image_url && data.estimated_page !== null ? (
                <PageImage
                  url={data.page_image_url}
                  label={data.edition_label}
                  page={data.estimated_page}
                />
              ) : data.has_ocr_pages ? (
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: 11,
                    color: colors.text_dim,
                  }}
                >
                  Callsign not found in per-page OCR text; page render unavailable.
                </div>
              ) : (
                <div
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: 11,
                    color: colors.text_dim,
                  }}
                >
                  Per-page OCR not available for this edition; page render unavailable.
                </div>
              )}

              {/* Honest scope note */}
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: 10,
                  color: colors.text_dim,
                  letterSpacing: "0.06em",
                  lineHeight: 1.5,
                  borderTop: `1px dashed ${colors.border}`,
                  paddingTop: 6,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ color: colors.accent_2, marginRight: 4 }}
                >
                  ◆
                </span>
                {data.page_note}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
