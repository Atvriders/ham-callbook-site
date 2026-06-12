/**
 * /data — Open Data Portal
 *
 * Server component. Fetches /api/data/manifest and renders a download
 * directory for all 86 per-edition CSVs (7.69M rows total).
 *
 * Sodium Vapor aesthetic: midnight + amber + bone, Fraunces + JetBrains Mono.
 * No Inter, no shadcn, no purple, no scale-105.
 */

import { colors, fontStacks } from "../../lib/design";

export const dynamic = "force-dynamic";

interface ManifestFile {
  filename: string;
  year: number;
  edition_label: string;
  edition_key: string;
  row_count: number;
  size_bytes: number;
  sha256: string;
}

interface Manifest {
  generated: string;
  dataset_version: string;
  build_timestamp: string | null;
  total_editions: number;
  total_rows: number;
  columns: string[];
  license: string;
  source: string;
  files: ManifestFile[];
}

async function fetchManifest(): Promise<Manifest | null> {
  const base = process.env.INTERNAL_API_BASE ?? "http://backend:8000";
  try {
    const res = await fetch(`${base}/api/data/manifest`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Manifest;
  } catch {
    return null;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtRows(n: number): string {
  return n.toLocaleString("en-US");
}

// Group files by decade for the table sections
function groupByDecade(files: ManifestFile[]): Map<string, ManifestFile[]> {
  const groups = new Map<string, ManifestFile[]>();
  for (const f of files) {
    const decade = `${Math.floor(f.year / 10) * 10}s`;
    const existing = groups.get(decade) ?? [];
    existing.push(f);
    groups.set(decade, existing);
  }
  return groups;
}

export default async function DataPortalPage() {
  const manifest = await fetchManifest();

  const containerStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: colors.bg,
    color: colors.text,
    fontFamily: fontStacks.body,
    padding: "2rem 1rem",
  };

  const innerStyle: React.CSSProperties = {
    maxWidth: "900px",
    margin: "0 auto",
  };

  if (!manifest) {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <h1
            style={{
              fontFamily: fontStacks.display,
              color: colors.accent,
              fontSize: "2.5rem",
              fontWeight: 900,
            }}
          >
            Open Data Portal
          </h1>
          <p style={{ color: colors.text_dim, marginTop: "1rem" }}>
            Download manifest is not yet available. Run{" "}
            <code
              style={{
                fontFamily: fontStacks.mono,
                color: colors.accent,
                background: colors.surface,
                padding: "0.1rem 0.4rem",
                borderRadius: "3px",
              }}
            >
              build_data_release.py
            </code>{" "}
            to generate the artifacts.
          </p>
        </div>
      </div>
    );
  }

  const byDecade = groupByDecade(manifest.files);
  const totalMB = (
    manifest.files.reduce((s, f) => s + f.size_bytes, 0) /
    1024 /
    1024
  ).toFixed(0);

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        {/* Hero */}
        <div style={{ marginBottom: "2.5rem" }}>
          <h1
            style={{
              fontFamily: fontStacks.display,
              color: colors.accent,
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 900,
              margin: 0,
              lineHeight: 1.1,
              textShadow:
                "0 0 12px rgba(255, 209, 102, 0.45), 0 0 2px rgba(255, 163, 11, 0.7)",
            }}
          >
            Open Data Portal
          </h1>
          <p
            style={{
              color: colors.text_dim,
              marginTop: "0.75rem",
              fontSize: "1.05rem",
              maxWidth: "640px",
              lineHeight: 1.6,
            }}
          >
            Every edition of the USA Ham Callbook Archive as a flat CSV —
            machine-readable, schema-stable, no registration required. Public
            domain (US Government records).
          </p>
        </div>

        {/* Stats banner */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          {[
            { label: "Editions", value: String(manifest.total_editions) },
            { label: "Total rows", value: fmtRows(manifest.total_rows) },
            { label: "Download size", value: `${totalMB} MB` },
            { label: "Version", value: manifest.dataset_version },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderLeft: `4px solid ${colors.accent}`,
                borderRadius: "4px",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "1.4rem",
                  color: colors.accent,
                  fontWeight: 700,
                }}
              >
                {value}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: colors.text_dim,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginTop: "0.25rem",
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Schema */}
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: "4px",
            padding: "1.25rem",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              color: colors.text_dim,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "0.5rem",
            }}
          >
            CSV columns (consistent across all editions)
          </div>
          <code
            style={{
              fontFamily: fontStacks.mono,
              color: colors.glow,
              fontSize: "0.85rem",
              wordBreak: "break-all",
            }}
          >
            {manifest.columns.join(", ")}
          </code>
          <div
            style={{
              marginTop: "0.75rem",
              fontSize: "0.8rem",
              color: colors.text_dim,
            }}
          >
            License:{" "}
            <span style={{ color: colors.text }}>{manifest.license}</span>
            {" · "}
            Source:{" "}
            <a
              href={manifest.source}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: colors.accent }}
            >
              leehite.org/callbooks
            </a>
            {" · "}
            Dataset accuracy ~97.1% (OCR-anchored); verify against original scans
            for primary-source genealogical proof.
          </div>
        </div>

        {/* Morse divider */}
        <div
          style={{
            fontFamily: fontStacks.mono,
            color: colors.border,
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            marginBottom: "2rem",
            userSelect: "none",
          }}
        >
          ·  —  ·  ·  —  ·  ·  ·  —  —  ·
        </div>

        {/* Download table by decade */}
        {Array.from(byDecade.entries()).map(([decade, files]) => (
          <div key={decade} style={{ marginBottom: "2.5rem" }}>
            <h2
              style={{
                fontFamily: fontStacks.display,
                fontSize: "1.3rem",
                color: colors.text,
                fontWeight: 700,
                marginBottom: "0.75rem",
                paddingBottom: "0.4rem",
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              {decade}
            </h2>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.875rem",
              }}
            >
              <thead>
                <tr
                  style={{
                    color: colors.text_dim,
                    textAlign: "left",
                    textTransform: "uppercase",
                    fontSize: "0.7rem",
                    letterSpacing: "0.08em",
                  }}
                >
                  <th style={{ padding: "0.4rem 0.5rem 0.4rem 0" }}>
                    Edition
                  </th>
                  <th style={{ padding: "0.4rem 0.5rem" }}>Rows</th>
                  <th style={{ padding: "0.4rem 0.5rem" }}>Size</th>
                  <th style={{ padding: "0.4rem 0.5rem" }}>SHA-256</th>
                  <th style={{ padding: "0.4rem 0 0.4rem 0.5rem" }}>
                    Download
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.filename}
                    style={{ borderTop: `1px solid ${colors.border}` }}
                  >
                    <td
                      style={{
                        padding: "0.6rem 0.5rem 0.6rem 0",
                        fontFamily: fontStacks.mono,
                        color: colors.text,
                      }}
                    >
                      {f.year}{" "}
                      <span style={{ color: colors.text_dim }}>
                        {f.edition_label}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0.5rem",
                        fontFamily: fontStacks.mono,
                        color: colors.accent,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtRows(f.row_count)}
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0.5rem",
                        fontFamily: fontStacks.mono,
                        color: colors.text_dim,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtBytes(f.size_bytes)}
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0.5rem",
                        fontFamily: fontStacks.mono,
                        fontSize: "0.7rem",
                        color: colors.text_dim,
                        maxWidth: "120px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={f.sha256}
                    >
                      {f.sha256.slice(0, 12)}…
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0 0.6rem 0.5rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <a
                        href={`/api/data/download/${f.filename}`}
                        style={{
                          display: "inline-block",
                          background: "transparent",
                          border: `1px solid ${colors.accent}`,
                          color: colors.accent,
                          borderRadius: "3px",
                          padding: "0.2rem 0.6rem",
                          fontFamily: fontStacks.mono,
                          fontSize: "0.75rem",
                          textDecoration: "none",
                          letterSpacing: "0.04em",
                        }}
                      >
                        CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* Footer note */}
        <div
          style={{
            marginTop: "2rem",
            paddingTop: "1.5rem",
            borderTop: `1px solid ${colors.border}`,
            fontSize: "0.8rem",
            color: colors.text_dim,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: colors.text }}>API access:</strong>{" "}
          <code
            style={{
              fontFamily: fontStacks.mono,
              background: colors.surface,
              padding: "0.1rem 0.3rem",
              borderRadius: "2px",
            }}
          >
            GET /api/data/manifest
          </code>{" "}
          ·{" "}
          <code
            style={{
              fontFamily: fontStacks.mono,
              background: colors.surface,
              padding: "0.1rem 0.3rem",
              borderRadius: "2px",
            }}
          >
            GET /api/data/files?year=1994
          </code>{" "}
          ·{" "}
          <code
            style={{
              fontFamily: fontStacks.mono,
              background: colors.surface,
              padding: "0.1rem 0.3rem",
              borderRadius: "2px",
            }}
          >
            GET /api/data/download/{"{filename}"}
          </code>
          <br />
          Manifest generated:{" "}
          <span style={{ fontFamily: fontStacks.mono, color: colors.text }}>
            {manifest.generated}
          </span>
          {manifest.build_timestamp && (
            <>
              {" "}· DB build:{" "}
              <span style={{ fontFamily: fontStacks.mono, color: colors.text }}>
                {manifest.build_timestamp}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
