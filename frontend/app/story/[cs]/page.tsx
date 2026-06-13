/**
 * /story/[cs] — Heritage Story page.
 *
 * Server component. Fetches /api/story/{cs} from the backend and renders
 * a deterministic prose biography of the callsign, a copyable badge-embed
 * snippet, and a preview of the share-card image.
 *
 * force-dynamic: this page fetches the backend at render time, so we must
 * opt out of Next.js static export (same pattern as all other data pages).
 */

export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { colors, fontStacks } from "../../../lib/design";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

interface StoryFacts {
  callsign: string;
  first_year: number | null;
  last_year: number | null;
  span_years: number | null;
  editions_count: number | null;
  distinct_holders: number | null;
  latest_state: string | null;
  era: string | null;
}

interface StoryResponse {
  callsign: string;
  headline: string;
  prose: string;
  facts: StoryFacts;
  generated_at: string;
}

// -------------------------------------------------------------------------
// Metadata (OG image wired to /card/{cs}.png)
// -------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ cs: string }>;
}) {
  const { cs } = await params;
  const callsign = cs.toUpperCase();
  const cardUrl = `/card/${callsign}.png`;

  return {
    title: `${callsign} — Heritage Story | Ham Callbook Archive`,
    description: `Deterministic biography of amateur radio callsign ${callsign} from the U.S. Callbook Archive.`,
    openGraph: {
      title: `${callsign} — Ham Callbook Archive`,
      description: `Heritage story for ${callsign}`,
      images: [
        {
          url: cardUrl,
          width: 1200,
          height: 630,
          alt: `Share card for ${callsign}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${callsign} — Ham Callbook Archive`,
      images: [cardUrl],
    },
  };
}

// -------------------------------------------------------------------------
// Data fetch
// -------------------------------------------------------------------------

async function fetchStory(cs: string): Promise<StoryResponse | null> {
  const base =
    process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ??
    "http://localhost:8000";
  const url = `${base}/api/story/${encodeURIComponent(cs.toUpperCase())}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`/api/story/${cs} returned ${res.status}`);
    return (await res.json()) as StoryResponse;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/** Render **bold** markdown-lite markers in prose to <strong> spans. */
function renderProse(prose: string): React.ReactNode {
  const parts = prose.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} style={{ color: colors.text, fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

// -------------------------------------------------------------------------
// Page
// -------------------------------------------------------------------------

export default async function StoryPage({
  params,
}: {
  params: Promise<{ cs: string }>;
}) {
  const { cs } = await params;
  const story = await fetchStory(cs);

  if (!story) {
    notFound();
  }

  const { callsign, headline, prose, facts } = story;
  const cardUrl = `/card/${callsign}.png`;

  const badgeEmbed = `<a href="https://hamcallbook.example.com/callsign/${callsign}">
  <img src="https://hamcallbook.example.com/badge/${callsign}.svg"
       alt="${callsign} — Ham Callbook Archive"
       height="44" />
</a>`;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        padding: "0 0 4rem",
      }}
    >
      {/* ── Hero ── */}
      <section
        style={{
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
          padding: "3rem 2rem 2.5rem",
        }}
      >
        <div style={{ maxWidth: "860px", margin: "0 auto" }}>
          {/* breadcrumb */}
          <p
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.75rem",
              color: colors.text_dim,
              marginBottom: "0.75rem",
              letterSpacing: "0.08em",
            }}
          >
            <a
              href={`/callsign/${callsign}`}
              style={{ color: colors.accent, textDecoration: "none" }}
            >
              {callsign}
            </a>
            {" "}/ heritage story
          </p>

          {/* callsign glyph */}
          <h1
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "clamp(2.5rem, 6vw, 4rem)",
              fontWeight: 700,
              color: colors.accent,
              letterSpacing: "0.12em",
              margin: "0 0 0.5rem",
              textShadow:
                "0 0 12px rgba(255,209,102,0.4), 0 0 2px rgba(255,163,11,0.7)",
            }}
          >
            {callsign}
          </h1>

          {/* headline */}
          <p
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(1rem, 2.5vw, 1.35rem)",
              color: colors.text_dim,
              margin: 0,
              fontStyle: "italic",
            }}
          >
            {headline}
          </p>
        </div>
      </section>

      {/* ── Content ── */}
      <div
        style={{
          maxWidth: "860px",
          margin: "0 auto",
          padding: "2.5rem 2rem 0",
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,18rem)",
          gap: "2.5rem",
          alignItems: "start",
        }}
      >
        {/* Left: prose + badge embed */}
        <div>
          {/* Morse divider */}
          <p
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              color: colors.border,
              letterSpacing: "0.25em",
              marginBottom: "1.5rem",
            }}
          >
            · — · · — · · · — — ·
          </p>

          {/* Bio prose */}
          <section aria-label="Heritage biography">
            <h2
              style={{
                fontFamily: fontStacks.display,
                fontSize: "1rem",
                fontWeight: 600,
                color: colors.accent,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: "1rem",
              }}
            >
              Archive Biography
            </h2>
            <p
              style={{
                lineHeight: 1.75,
                fontSize: "1rem",
                color: colors.text_dim,
                margin: 0,
              }}
            >
              {renderProse(prose)}
            </p>
          </section>

          {/* Divider */}
          <p
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              color: colors.border,
              letterSpacing: "0.25em",
              margin: "2rem 0 1.5rem",
            }}
          >
            · — · · — · · · — — ·
          </p>

          {/* Badge embed */}
          <section aria-label="Badge embed code">
            <h2
              style={{
                fontFamily: fontStacks.display,
                fontSize: "1rem",
                fontWeight: 600,
                color: colors.accent,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: "0.75rem",
              }}
            >
              Embeddable Badge
            </h2>
            <p
              style={{
                fontSize: "0.85rem",
                color: colors.text_dim,
                marginBottom: "0.75rem",
              }}
            >
              Copy the snippet below to embed a live badge on any webpage:
            </p>

            {/* Badge preview */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/badge/${callsign}.svg`}
              alt={`${callsign} badge`}
              height={44}
              style={{ display: "block", marginBottom: "1rem" }}
            />

            <pre
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: "4px",
                padding: "1rem",
                fontFamily: fontStacks.mono,
                fontSize: "0.75rem",
                color: colors.text_dim,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {badgeEmbed}
            </pre>
          </section>
        </div>

        {/* Right rail: share-card preview + quick facts */}
        <aside>
          {/* Share card preview */}
          <section
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: "6px",
              overflow: "hidden",
              marginBottom: "1.5rem",
            }}
          >
            <div
              style={{
                padding: "0.6rem 0.75rem",
                borderBottom: `1px solid ${colors.border}`,
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                color: colors.text_dim,
                letterSpacing: "0.06em",
              }}
            >
              SHARE CARD PREVIEW
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardUrl}
              alt={`${callsign} share card`}
              style={{ width: "100%", display: "block" }}
            />
            <div style={{ padding: "0.5rem 0.75rem" }}>
              <a
                href={cardUrl}
                download={`${callsign}-card.png`}
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.72rem",
                  color: colors.accent,
                  textDecoration: "none",
                }}
              >
                ↓ download PNG
              </a>
            </div>
          </section>

          {/* Quick facts */}
          <section
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: "6px",
              padding: "1rem",
            }}
          >
            <h3
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.7rem",
                color: colors.accent,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                margin: "0 0 0.75rem",
              }}
            >
              Quick Facts
            </h3>
            {[
              ["First year", facts.first_year ?? "—"],
              ["Last year", facts.last_year ?? "—"],
              ["Span", facts.span_years != null ? `${facts.span_years} yr` : "—"],
              ["Editions", facts.editions_count ?? "—"],
              ["Holders", facts.distinct_holders ?? "—"],
              ["Era", facts.era ?? "—"],
              ["State", facts.latest_state ?? "—"],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderBottom: `1px solid ${colors.border}`,
                  padding: "0.35rem 0",
                  fontSize: "0.82rem",
                }}
              >
                <span
                  style={{
                    fontFamily: fontStacks.mono,
                    color: colors.text_dim,
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </span>
                <span style={{ color: colors.text, fontFamily: fontStacks.mono }}>
                  {String(value)}
                </span>
              </div>
            ))}
          </section>

          {/* Back link */}
          <div style={{ marginTop: "1rem", textAlign: "center" }}>
            <a
              href={`/callsign/${callsign}`}
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.78rem",
                color: colors.accent,
                textDecoration: "none",
                letterSpacing: "0.04em",
              }}
            >
              ← full callsign page
            </a>
          </div>
        </aside>
      </div>
    </main>
  );
}
