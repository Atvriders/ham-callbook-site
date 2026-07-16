/**
 * /records/{category}/{rank} — shareable Century Club record card.
 *
 * Server component backed by GET /api/records/{category}/{rank} — a
 * single leaderboard row deep-link. The page is intentionally a "card":
 * one big callsign (linked to the full archive record), the stat that
 * earned the rank, the category label, and a rank badge. generateMetadata
 * reuses the existing OG card endpoint (/card/{cs}.png) so pasting the
 * URL into a chat unfurls the same amber card as a callsign page.
 *
 * Aesthetic guardrails (per design contract): NO Inter, NO purple, NO
 * hover:scale-105. All hex values from lib/design.ts.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { colors, fontStacks, motifs } from "../../../../lib/design";

// --------------------------------------------------------------------------- //
// Types                                                                       //
// --------------------------------------------------------------------------- //

interface RecordDetail {
  category: string;
  category_label: string;
  rank: number;
  callsign?: string;
  slug?: string;
  display_name?: string;
  holder_name?: string;
  first_year?: number;
  last_year?: number;
  span_years?: number;
  edition_count?: number;
  run_editions?: number;
  distinct_holders?: number;
  appearance_count?: number;
  state?: string;
  uls_status?: string;
  [key: string]: unknown;
}

interface CategoryMeta {
  name: string;
  label: string;
  description: string;
  sort_field: string;
  link_type: "callsign" | "club";
}

// --------------------------------------------------------------------------- //
// Fetch helpers                                                                //
// --------------------------------------------------------------------------- //

const INTERNAL_BASE = process.env.INTERNAL_API_BASE ?? "http://backend:8000";

async function fetchRecord(
  category: string,
  rank: number,
): Promise<RecordDetail | null> {
  const url = `${INTERNAL_BASE}/api/records/${encodeURIComponent(category)}/${rank}`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as RecordDetail;
  } catch {
    return null;
  }
}

async function fetchCategoryMeta(name: string): Promise<CategoryMeta | null> {
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/records/categories`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const cats = (await res.json()) as CategoryMeta[];
    return cats.find((c) => c.name === name) ?? null;
  } catch {
    return null;
  }
}

function parseRank(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || String(n) !== raw.trim()) return null;
  return n;
}

// --------------------------------------------------------------------------- //
// Stat formatting — mirrors LeaderboardTable's per-sort_field metric.          //
// --------------------------------------------------------------------------- //

function statForRecord(
  record: RecordDetail,
  sortField: string | undefined,
): { value: string; caption: string } {
  if (sortField === "first_year" && record.first_year != null) {
    return { value: String(record.first_year), caption: "first appeared" };
  }
  if (sortField === "distinct_holders" && record.distinct_holders != null) {
    return {
      value: String(record.distinct_holders),
      caption: "distinct holders",
    };
  }
  if (record.span_years != null) {
    return { value: `${record.span_years}`, caption: "years on the air" };
  }
  if (record.appearance_count != null) {
    return {
      value: String(record.appearance_count),
      caption: "edition appearances",
    };
  }
  if (record.edition_count != null) {
    return { value: String(record.edition_count), caption: "editions" };
  }
  return { value: "—", caption: "record" };
}

// --------------------------------------------------------------------------- //
// Metadata — same OG-card pattern as app/callsign/[cs]/page.tsx.              //
// --------------------------------------------------------------------------- //

interface PageProps {
  // Next.js 15 server-component contract: dynamic params arrive as Promises.
  params: Promise<{ category: string; rank: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { category: catRaw, rank: rankRaw } = await params;
  const category = decodeURIComponent(catRaw ?? "");
  const rank = parseRank(decodeURIComponent(rankRaw ?? ""));
  const record = rank !== null ? await fetchRecord(category, rank) : null;

  if (!record) {
    return { title: "Record" };
  }

  const callsign = record.callsign?.toUpperCase();
  const subject = callsign ?? record.display_name ?? record.slug ?? "Record";
  const title = `${subject} — №${record.rank} · ${record.category_label}`;
  const description = `Rank ${record.rank} in the Century Club "${record.category_label}" leaderboard of the USA Ham Callbook Archive.`;

  if (!callsign) {
    return { title, description };
  }

  const API_BASE_META: string = (typeof window === "undefined"
    ? (process.env.INTERNAL_API_BASE ?? "http://backend:8000")
    : ""
  ).replace(/\/+$/, "");
  const cardImage = `${API_BASE_META}/card/${encodeURIComponent(callsign)}.png`;

  return {
    title,
    description,
    openGraph: {
      images: [cardImage],
    },
    twitter: {
      card: "summary_large_image",
      images: [cardImage],
    },
  };
}

// --------------------------------------------------------------------------- //
// Local motif — hero-only scanlines (same recipe as /records).                 //
// --------------------------------------------------------------------------- //

function Scanlines() {
  const { opacity, spacingPx } = motifs.scanlines;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          rgba(255,209,102,0.6) 0px,
          rgba(255,209,102,0.6) 1px,
          transparent 1px,
          transparent ${spacingPx}px
        )`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

// --------------------------------------------------------------------------- //
// Page                                                                        //
// --------------------------------------------------------------------------- //

export default async function RecordDetailPage({ params }: PageProps) {
  const { category: catRaw, rank: rankRaw } = await params;
  const category = decodeURIComponent(catRaw ?? "");
  const rank = parseRank(decodeURIComponent(rankRaw ?? ""));
  if (rank === null) notFound();

  const [record, catMeta] = await Promise.all([
    fetchRecord(category, rank),
    fetchCategoryMeta(category),
  ]);
  if (!record) notFound();

  const linkType: "callsign" | "club" =
    catMeta?.link_type ?? (record.slug ? "club" : "callsign");
  const callsign = record.callsign?.toUpperCase();
  const subject =
    linkType === "club"
      ? (record.display_name ?? record.slug ?? "—")
      : (callsign ?? "—");
  const subjectHref =
    linkType === "club"
      ? `/clubs/${encodeURIComponent(record.slug ?? "")}`
      : `/callsign/${encodeURIComponent(callsign ?? "")}`;
  const stat = statForRecord(record, catMeta?.sort_field);
  const isTop3 = record.rank <= 3;
  const span =
    record.first_year != null && record.last_year != null
      ? `${record.first_year}–${record.last_year}`
      : null;

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100dvh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4rem 1.5rem 6rem",
      }}
    >
      {/* Breadcrumb back to the leaderboard */}
      <nav
        aria-label="Breadcrumb"
        style={{
          width: "100%",
          maxWidth: "44rem",
          marginBottom: "1.25rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}
      >
        <Link
          href={`/records?cat=${encodeURIComponent(record.category)}`}
          style={{ color: colors.text_dim, textDecoration: "none" }}
        >
          ← Century Club · {record.category_label}
        </Link>
      </nav>

      {/* The shareable card */}
      <article
        aria-label={`Record card: rank ${record.rank}, ${record.category_label}`}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "44rem",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `4px solid ${isTop3 ? colors.accent : colors.border}`,
          borderRadius: "0.25rem",
          overflow: "hidden",
          padding: "2.5rem 2rem 2.25rem",
        }}
      >
        <Scanlines />
        <div style={{ position: "relative", zIndex: 2 }}>
          {/* Eyebrow + rank badge row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "1rem",
              flexWrap: "wrap",
              marginBottom: "1.5rem",
            }}
          >
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.65rem",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              {motifs.morseDividers.tight} &nbsp; century club
            </span>
            <span
              aria-label={`Rank ${record.rank}`}
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.85rem",
                letterSpacing: "0.15em",
                padding: "0.3rem 0.8rem",
                borderRadius: "9999px",
                border: `1px solid ${isTop3 ? colors.accent : colors.border}`,
                color: isTop3 ? colors.bg : colors.text_dim,
                background: isTop3 ? colors.accent : "transparent",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              № {record.rank}
            </span>
          </div>

          {/* Category label */}
          <div
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: colors.text_dim,
              marginBottom: "0.5rem",
            }}
          >
            {record.category_label}
          </div>

          {/* Big callsign (or club name), linked to the full record */}
          <h1 style={{ margin: "0 0 0.75rem" }}>
            <Link
              href={subjectHref}
              style={{
                fontFamily: fontStacks.mono,
                fontSize:
                  linkType === "club"
                    ? "clamp(1.6rem, 6vw, 2.8rem)"
                    : "clamp(2.4rem, 10vw, 4.5rem)",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: colors.accent,
                textDecoration: "none",
                textShadow: motifs.glow.textShadow,
                lineHeight: 1.05,
                overflowWrap: "anywhere",
              }}
            >
              {subject}
            </Link>
          </h1>

          {/* Holder name, when the archive knows it */}
          {linkType === "callsign" && record.holder_name ? (
            <div
              style={{
                fontFamily: fontStacks.body,
                fontSize: "1rem",
                color: colors.text_dim,
                marginBottom: "1.5rem",
              }}
            >
              {record.holder_name}
              {record.state ? ` · ${record.state}` : ""}
            </div>
          ) : record.state ? (
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.8rem",
                color: colors.text_dim,
                marginBottom: "1.5rem",
              }}
            >
              {record.state}
            </div>
          ) : (
            <div style={{ marginBottom: "1.5rem" }} />
          )}

          {/* The record's stat */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.75rem",
              flexWrap: "wrap",
              borderTop: `1px solid ${colors.border}`,
              paddingTop: "1.25rem",
            }}
          >
            <span
              style={{
                fontFamily: fontStacks.display,
                fontVariationSettings: '"opsz" 144, "SOFT" 20',
                fontSize: "clamp(2.5rem, 8vw, 4rem)",
                fontWeight: 500,
                lineHeight: 1,
                color: colors.glow,
                textShadow: motifs.glow.textShadow,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {stat.value}
            </span>
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.75rem",
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              {stat.caption}
            </span>
            {span ? (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: fontStacks.mono,
                  fontSize: "0.85rem",
                  color: colors.text_dim,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {span}
              </span>
            ) : null}
          </div>

          {/* Category description as the card's fine print */}
          {catMeta?.description ? (
            <p
              style={{
                margin: "1.25rem 0 0",
                fontFamily: fontStacks.body,
                fontSize: "0.82rem",
                lineHeight: 1.55,
                color: colors.text_dim,
              }}
            >
              {catMeta.description}
            </p>
          ) : null}
        </div>
      </article>

      {/* Under-card actions */}
      <div
        style={{
          width: "100%",
          maxWidth: "44rem",
          marginTop: "1.25rem",
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          letterSpacing: "0.12em",
        }}
      >
        <Link
          href={subjectHref}
          style={{ color: colors.accent, textDecoration: "underline" }}
        >
          Full archive record →
        </Link>
        <Link
          href={`/records?cat=${encodeURIComponent(record.category)}`}
          style={{ color: colors.text_dim, textDecoration: "underline" }}
        >
          Full leaderboard
        </Link>
      </div>
    </main>
  );
}
