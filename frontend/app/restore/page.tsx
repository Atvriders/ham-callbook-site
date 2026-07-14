/**
 * /restore — Help Restore the Record
 *
 * Server component. Shows records most likely to contain OCR errors,
 * ranked from the audit tables (corrections_3way, uls_anchor, sample_confidence,
 * implausible names). Each row has a quick Suggest / Skip flow via the
 * SuggestCorrection client component.
 *
 * Reads ?page= and ?edition= from searchParams for pagination and edition
 * faceting. force-dynamic ensures fresh audit data on every request.
 */

export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense } from "react";
import { colors, fontStacks } from "../../lib/design";
import { SuggestCorrection } from "../../components/SuggestCorrection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorstRecord {
  callsign: string;
  year: number | null;
  edition: string | null;
  name: string | null;
  rank_score: number;
  rank_reason: string;
}

interface WorstResponse {
  page: number;
  page_size: number;
  total: number;
  items: WorstRecord[];
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const INTERNAL_BASE = process.env.INTERNAL_API_BASE ?? "http://backend:8000";

async function fetchWorst(page: number, edition?: string): Promise<WorstResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: "40" });
  if (edition) params.set("edition", edition);
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/restore/worst?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) return { page, page_size: 40, total: 0, items: [] };
    return (await res.json()) as WorstResponse;
  } catch {
    return { page, page_size: 40, total: 0, items: [] };
  }
}

// ---------------------------------------------------------------------------
// Rank badge colors
// ---------------------------------------------------------------------------

function rankColor(score: number): string {
  if (score >= 3) return colors.danger;
  if (score === 2) return colors.accent;
  return colors.text_dim;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function RestorePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; edition?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);
  const edition = sp.edition?.trim() || undefined;

  const data = await fetchWorst(page, edition);
  const totalPages = data.total > 0 ? Math.ceil(data.total / data.page_size) : 0;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        paddingBottom: "4rem",
      }}
    >
      {/* ---- Hero ---- */}
      <div
        style={{
          borderBottom: `1px solid ${colors.border}`,
          padding: "2.5rem 2rem 2rem",
          maxWidth: 900,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            fontFamily: fontStacks.display,
            fontSize: "clamp(1.6rem, 4vw, 2.6rem)",
            fontWeight: 700,
            color: colors.text,
            margin: "0 0 0.5rem",
            letterSpacing: "-0.01em",
          }}
        >
          Help Restore the Record
        </h1>
        <p style={{ color: colors.text_dim, fontSize: "0.92rem", margin: "0 0 1rem", maxWidth: 600 }}>
          These entries are flagged as most likely to contain OCR errors — misread names,
          address bleeds, or conflicts with FCC records. Browse and suggest corrections.
          Every fix improves the archive for future researchers.
        </p>

        {/* Edition filter */}
        <form method="get" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label
            htmlFor="edition-filter"
            style={{ color: colors.text_dim, fontSize: "0.82rem" }}
          >
            Filter by edition:
          </label>
          <input
            id="edition-filter"
            name="edition"
            defaultValue={edition ?? ""}
            placeholder="e.g. 1987_Winter"
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: colors.text,
              fontFamily: fontStacks.mono,
              fontSize: "0.82rem",
              padding: "4px 10px",
              width: 160,
            }}
          />
          <button
            type="submit"
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              color: colors.accent,
              fontFamily: fontStacks.body,
              fontSize: "0.82rem",
              cursor: "pointer",
              padding: "4px 14px",
            }}
          >
            Filter
          </button>
          {edition && (
            <Link
              href="/restore"
              style={{ color: colors.text_dim, fontSize: "0.8rem" }}
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* ---- Stats bar ---- */}
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "0.75rem 2rem",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          gap: "1.5rem",
          fontSize: "0.8rem",
          color: colors.text_dim,
        }}
      >
        <span>
          <strong style={{ color: colors.text }}>{data.total.toLocaleString()}</strong> flagged records
        </span>
        {edition && (
          <span>
            Edition: <strong style={{ color: colors.accent, fontFamily: fontStacks.mono }}>{edition}</strong>
          </span>
        )}
        <span>Page {page + 1}{totalPages > 0 ? ` of ${totalPages}` : ""}</span>
      </div>

      {/* ---- Record list ---- */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem 2rem" }}>
        {data.items.length === 0 ? (
          <p style={{ color: colors.text_dim, fontStyle: "italic" }}>
            No flagged records found{edition ? ` for edition "${edition}"` : ""}.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {data.items.map((rec, i) => (
              <article
                key={`${rec.callsign}-${rec.year ?? "?"}-${rec.edition ?? "?"}-${i}`}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <Link
                    href={`/callsign/${rec.callsign}`}
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: "1.15rem",
                      fontWeight: 700,
                      color: colors.accent,
                      textDecoration: "none",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {rec.callsign}
                  </Link>

                  {rec.year != null && (
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.82rem",
                        color: colors.text_dim,
                        paddingTop: 3,
                      }}
                    >
                      {rec.year}
                    </span>
                  )}

                  {rec.edition && (
                    <span
                      style={{
                        fontFamily: fontStacks.mono,
                        fontSize: "0.75rem",
                        color: colors.text_dim,
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 3,
                        padding: "1px 6px",
                      }}
                    >
                      {rec.edition}
                    </span>
                  )}

                  {/* Rank badge */}
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "0.72rem",
                      fontFamily: fontStacks.body,
                      color: rankColor(rec.rank_score),
                      border: `1px solid ${rankColor(rec.rank_score)}`,
                      borderRadius: 3,
                      padding: "1px 6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rec.rank_score === 3 ? "HIGH" : rec.rank_score === 2 ? "MEDIUM" : "LOW"} priority
                  </span>
                </div>

                {/* Name */}
                {rec.name && (
                  <div style={{ fontSize: "0.9rem", color: colors.text }}>
                    {rec.name}
                  </div>
                )}

                {/* Rank reason */}
                <div
                  style={{
                    fontSize: "0.77rem",
                    color: colors.text_dim,
                    fontStyle: "italic",
                  }}
                >
                  {rec.rank_reason}
                </div>

                {/* Suggest correction widget */}
                <Suspense fallback={null}>
                  <SuggestCorrection
                    callsign={rec.callsign}
                    year={rec.year}
                    edition={rec.edition}
                    oldValue={rec.name ?? ""}
                  />
                </Suspense>
              </article>
            ))}
          </div>
        )}

        {/* ---- Pagination ---- */}
        {totalPages > 1 && (
          <nav
            style={{
              display: "flex",
              gap: 8,
              marginTop: "2rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {page > 0 && (
              <PaginationLink
                href={buildHref(page - 1, edition)}
                label="← Previous"
              />
            )}
            <span style={{ color: colors.text_dim, fontSize: "0.82rem" }}>
              {page + 1} / {totalPages}
            </span>
            {page < totalPages - 1 && (
              <PaginationLink
                href={buildHref(page + 1, edition)}
                label="Next →"
              />
            )}
          </nav>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHref(page: number, edition?: string): string {
  const p = new URLSearchParams({ page: String(page) });
  if (edition) p.set("edition", edition);
  return `/restore?${p}`;
}

function PaginationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        color: colors.accent,
        fontFamily: fontStacks.body,
        fontSize: "0.85rem",
        padding: "5px 14px",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
