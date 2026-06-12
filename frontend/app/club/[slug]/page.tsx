/**
 * /club/[slug] — Per-club detail in Sodium Vapor. (Editorial.)
 *
 * Server component. Aggregates three backend endpoints:
 *
 *   * GET /api/club/{slug}            — headline + nested roster.
 *   * GET /api/club/{slug}/history    — every per-entry detection.
 *   * GET /api/club/{slug}/related?limit=8 — sibling clubs.
 *
 * The HEADLINE is the <ClubMultiCallsignTimeline/>: horizontal phosphor
 * bands across the 1909→1997 century. Everything above and below is
 * editorial chrome that frames it as the centerpiece. The eyebrow,
 * the display name, the stat strip, and the morse rune are all sized
 * and weighted to ladder into the timeline rather than compete with it.
 *
 * Layout, top → bottom:
 *
 *   1. HERO — Asymmetric two-column. Left: oversized Fraunces italic
 *      display name (the memorable thing); the variable opsz axis goes
 *      to 144 for the wordmark itself. Right: marginalia column with
 *      breadcrumb, location, type pip, four-up stat strip.
 *   2. HEADLINE VISUALIZATION — ClubMultiCallsignTimeline.
 *   3. ROSTER — DataTable.
 *   4. YEAR-BY-YEAR HISTORY — Accordion (<details>).
 *   5. RELATED CLUBS — ClubCard grid.
 */

import Link from "next/link";

import { colors, fontStacks, motifs } from "../../../lib/design";
import { cleanOCRCity, cleanOCRState } from "../../../lib/ocrClean";
import ClubMultiCallsignTimeline, {
  type ClubCallsignEntry,
} from "../../../components/ClubMultiCallsignTimeline";
import ClubCard from "../../../components/ClubCard";
import ClubTypePip from "../../../components/ClubTypePip";
import RosterTable from "./RosterTable";
import CiteThisRecord from "../../../components/CiteThisRecord";

// ---------------------------------------------------------------------------
// Wire types — mirror Club, ClubDetection, RelatedClub in app/routes/club.py.
// ---------------------------------------------------------------------------

interface ClubCallsign {
  callsign: string;
  first_year: number | null;
  last_year: number | null;
  appearance_count: number;
  location_summary: string | null;
}

interface ClubFull {
  slug: string;
  display_name: string | null;
  normalized_name: string | null;
  callsign_count: number;
  appearance_count: number;
  first_year: number | null;
  last_year: number | null;
  dominant_state: string | null;
  dominant_city: string | null;
  club_type: string | null;
  callsigns: ClubCallsign[];
}

interface ClubHistoryItem {
  year: number | null;
  edition: string | null;
  callsign: string | null;
  city: string | null;
  state: string | null;
  raw_name: string | null;
}

interface RelatedClubItem {
  slug: string;
  display_name: string;
  callsign_count: number;
  appearance_count: number;
  first_year: number | null;
  last_year: number | null;
  dominant_state: string | null;
  dominant_city: string | null;
  club_type: string | null;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(
  /\/+$/,
  "",
);

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Decorative motifs
// ---------------------------------------------------------------------------

function Grain() {
  const { opacity, baseFrequency } = motifs.grain;
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
       <filter id='n'>
         <feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='2' stitchTiles='stitch'/>
         <feColorMatrix values='0 0 0 0 1  0 0 0 0 0.64  0 0 0 0 0.04  0 0 0 0.6 0'/>
       </filter>
       <rect width='100%' height='100%' filter='url(#n)'/>
     </svg>`,
  );
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        zIndex: 1,
      }}
    />
  );
}

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
          rgba(255, 209, 102, 0.6) 0px,
          rgba(255, 209, 102, 0.6) 1px,
          transparent 1px,
          transparent ${spacingPx}px
        )`,
        mixBlendMode: "overlay",
      }}
    />
  );
}

function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "2.5rem 0",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
      {label ? <span style={{ flexShrink: 0 }}>{label}</span> : null}
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLocation(c: { dominant_city: string | null; dominant_state: string | null }) {
  if (c.dominant_city && c.dominant_state) return `${c.dominant_city}, ${c.dominant_state}`;
  return c.dominant_state ?? c.dominant_city ?? null;
}

function formatYearSpan(c: { first_year: number | null; last_year: number | null }) {
  if (c.first_year == null && c.last_year == null) return "—";
  if (c.first_year != null && c.last_year != null) {
    if (c.first_year === c.last_year) return `${c.first_year}`;
    return `${c.first_year} → ${c.last_year}`;
  }
  return `${c.first_year ?? c.last_year}`;
}

/**
 * Split the display name into two parts so we can typeset the trailing
 * word (often "Club", "Society", "ARC") in italics for editorial drama.
 * Returns [stem, tail] where tail may be empty.
 */
function splitDisplayName(name: string): [string, string] {
  const trimmed = name.trim();
  if (!trimmed) return [trimmed, ""];
  const idx = trimmed.lastIndexOf(" ");
  if (idx < 1) return [trimmed, ""];
  return [trimmed.slice(0, idx), trimmed.slice(idx + 1)];
}

function groupHistoryByYear(items: ClubHistoryItem[]): Map<number | "unknown", ClubHistoryItem[]> {
  const buckets = new Map<number | "unknown", ClubHistoryItem[]>();
  for (const item of items) {
    const key: number | "unknown" = item.year ?? "unknown";
    const list = buckets.get(key);
    if (list) {
      list.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  return new Map(
    [...buckets.entries()].sort((a, b) => {
      const ak = a[0] === "unknown" ? -Infinity : a[0];
      const bk = b[0] === "unknown" ? -Infinity : b[0];
      return bk - ak;
    }),
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ClubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);

  const [club, history, related] = await Promise.all([
    apiGet<ClubFull>(`/api/club/${encodeURIComponent(decodedSlug)}`).catch(
      () => null as ClubFull | null,
    ),
    apiGet<ClubHistoryItem[]>(
      `/api/club/${encodeURIComponent(decodedSlug)}/history`,
    ).catch(() => [] as ClubHistoryItem[]),
    apiGet<RelatedClubItem[]>(
      `/api/club/${encodeURIComponent(decodedSlug)}/related?limit=8`,
    ).catch(() => [] as RelatedClubItem[]),
  ]);

  if (!club) {
    return (
      <main
        style={{
          position: "relative",
          minHeight: "100vh",
          background: colors.bg,
          color: colors.text,
          fontFamily: fontStacks.body,
          padding: "5rem 2rem",
        }}
      >
        <Grain />
        <div style={{ position: "relative", zIndex: 2 }}>
          <h1
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(2.5rem, 6vw, 5rem)",
              fontVariationSettings: '"opsz" 96',
              margin: 0,
              textShadow: motifs.glow.textShadow,
            }}
          >
            Unknown club
          </h1>
          <p style={{ color: colors.text_dim, marginTop: "1rem" }}>
            No club found for slug “{decodedSlug}”.
          </p>
          <Link
            href="/clubs"
            style={{
              display: "inline-block",
              marginTop: "1.5rem",
              padding: "0.625rem 1rem",
              border: `1px solid ${colors.accent}`,
              color: colors.accent,
              fontFamily: fontStacks.mono,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontSize: "0.75rem",
              textDecoration: "none",
            }}
          >
            ← Back to clubs
          </Link>
        </div>
      </main>
    );
  }

  const displayName = club.display_name ?? club.normalized_name ?? club.slug;
  const [nameStem, nameTail] = splitDisplayName(displayName);
  const location = formatLocation(club);
  const yearSpan = formatYearSpan(club);
  const groupedHistory = groupHistoryByYear(history);

  // Build the timeline payload.
  const timelineCallsigns: ClubCallsignEntry[] = club.callsigns
    .filter((c) => c.first_year !== null && c.last_year !== null)
    .map((c) => ({
      callsign: c.callsign,
      first_year: c.first_year as number,
      last_year: c.last_year as number,
      appearance_count: c.appearance_count,
    }));

  const minYear = Math.min(
    ...timelineCallsigns.map((c) => c.first_year),
    1909,
  );
  const maxYear = Math.max(
    ...timelineCallsigns.map((c) => c.last_year),
    1997,
  );
  const timelineRange: [number, number] = [
    Math.max(1909, minYear - 2),
    Math.min(2003, maxYear + 2),
  ];

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
      }}
    >
      <Grain />

      {/* Staggered entrance keyframes — server-safe (no client component). */}
      <style>{`
        @keyframes sv-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sv-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes sv-glow-pulse {
          0%,100% { text-shadow: 0 0 14px rgba(255,209,102,0.35), 0 0 2px rgba(255,163,11,0.6); }
          50%     { text-shadow: 0 0 26px rgba(255,209,102,0.55), 0 0 4px rgba(255,163,11,0.95); }
        }
        .sv-rise  { animation: sv-rise 700ms cubic-bezier(.2,.7,.2,1) both; }
        .sv-fade  { animation: sv-fade 800ms ease-out both; }
        .sv-pulse { animation: sv-glow-pulse 3.4s ease-in-out infinite; }
        .sv-d-0 { animation-delay: 0ms; }
        .sv-d-1 { animation-delay: 90ms; }
        .sv-d-2 { animation-delay: 180ms; }
        .sv-d-3 { animation-delay: 280ms; }
        .sv-d-4 { animation-delay: 400ms; }
        .sv-d-5 { animation-delay: 540ms; }
      `}</style>

      {/* --- HERO ---------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "4rem 2rem 2rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />

        {/* Asymmetric two-column hero: a 7/5 split so the wordmark
            dominates while the marginalia column reads as a printed
            catalogue side-note. */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "grid",
            gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)",
            columnGap: "3rem",
            rowGap: "2rem",
            alignItems: "end",
          }}
        >
          {/* Breadcrumb / eyebrow — spans the whole row. */}
          <div
            className="sv-fade sv-d-0"
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/"
              style={{ color: colors.text_dim, textDecoration: "none" }}
            >
              ham-callbook
            </Link>
            <span aria-hidden>·</span>
            <Link
              href="/clubs"
              style={{ color: colors.text_dim, textDecoration: "none" }}
            >
              clubs
            </Link>
            <span aria-hidden>·</span>
            <span aria-hidden style={{ opacity: 0.7 }}>
              {motifs.morseDividers.tight}
            </span>
            {location ? (
              <>
                <span aria-hidden>·</span>
                <span style={{ color: colors.glow }}>{location}</span>
              </>
            ) : null}
          </div>

          {/* THE wordmark — the one memorable thing on this page. */}
          <h1
            className="sv-rise sv-d-1"
            style={{
              margin: 0,
              fontFamily: fontStacks.display,
              fontSize: "clamp(2.75rem, 8.5vw, 7.5rem)",
              fontVariationSettings: '"opsz" 144, "wght" 500, "SOFT" 50',
              lineHeight: 0.92,
              letterSpacing: "-0.03em",
              color: colors.text,
              textShadow: motifs.glow.textShadow,
              wordBreak: "break-word",
            }}
          >
            {nameTail ? (
              <>
                <span style={{ display: "block" }}>{nameStem}</span>
                <span
                  className="sv-pulse"
                  style={{
                    fontStyle: "italic",
                    fontVariationSettings:
                      '"opsz" 144, "wght" 400, "SOFT" 100',
                    color: colors.glow,
                    display: "inline-block",
                    marginTop: "0.05em",
                  }}
                >
                  {nameTail}.
                </span>
              </>
            ) : (
              <span className="sv-pulse">{displayName}.</span>
            )}
          </h1>

          {/* Marginalia column — type pip + stat ladder. */}
          <aside
            className="sv-rise sv-d-3"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              paddingBottom: "1rem",
              borderLeft: `1px solid ${colors.border}`,
              paddingLeft: "1.5rem",
            }}
          >
            {club.club_type ? (
              <div>
                <ClubTypePip type={club.club_type} size={14} />
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1.25rem 1.75rem",
              }}
            >
              <StatCell
                label="Callsigns"
                value={club.callsign_count.toLocaleString()}
              />
              <StatCell
                label="Appearances"
                value={club.appearance_count.toLocaleString()}
              />
              <StatCell label="Active" value={yearSpan} mono />
              <StatCell label="QTH" value={location ?? "—"} mono />
            </div>

            <div
              aria-hidden
              style={{
                fontFamily: fontStacks.mono,
                color: colors.text_dim,
                fontSize: "0.65rem",
                letterSpacing: "0.32em",
                opacity: 0.45,
              }}
            >
              {motifs.morseDividers.pattern}
            </div>
          </aside>
        </div>
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="the long century" />
      </div>

      {/* --- HEADLINE VISUALIZATION ---------------------------------- */}
      <section
        className="sv-rise sv-d-2"
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        {timelineCallsigns.length === 0 ? (
          <div style={emptyStyle}>
            No dated callsign holdings recorded for this club.
          </div>
        ) : (
          <ClubMultiCallsignTimeline
            callsigns={timelineCallsigns}
            yearRange={timelineRange}
          />
        )}
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="roster" />
      </div>

      {/* --- ROSTER -------------------------------------------------- */}
      <section
        className="sv-rise sv-d-1"
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionHeader
          title="Roster"
          tail="held"
          hint={`${club.callsigns.length} callsigns`}
        />
        {club.callsigns.length === 0 ? (
          <div style={emptyStyle}>Roster is empty.</div>
        ) : (
          <RosterTable rows={club.callsigns} />
        )}
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="year by year" />
      </div>

      {/* --- YEAR-BY-YEAR HISTORY ------------------------------------ */}
      <section
        className="sv-rise sv-d-1"
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <SectionHeader
          title="History"
          tail="logged"
          hint={`${history.length.toLocaleString()} detections`}
        />
        {history.length === 0 ? (
          <div style={emptyStyle}>No detections on file.</div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {[...groupedHistory.entries()].map(([year, items], idx) => (
              <details
                key={String(year)}
                open={idx < 2}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderLeft: `3px solid ${colors.accent}`,
                  borderRadius: "0.125rem",
                  overflow: "hidden",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    padding: "0.9rem 1.125rem",
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "baseline",
                    gap: "1rem",
                    listStyle: "none",
                  }}
                >
                  <span
                    style={{
                      fontFamily: fontStacks.display,
                      fontSize: "1.5rem",
                      fontVariationSettings: '"opsz" 60, "SOFT" 50',
                      color: colors.text,
                      letterSpacing: "-0.01em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {year === "unknown" ? "—" : year}
                  </span>
                  <span
                    aria-hidden
                    style={{
                      borderTop: `1px dashed ${colors.border}`,
                      alignSelf: "center",
                      marginTop: "0.25rem",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: fontStacks.mono,
                      fontSize: "0.7rem",
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      color: colors.text_dim,
                    }}
                  >
                    <span style={{ color: colors.accent }}>
                      {items.length.toString().padStart(2, "0")}
                    </span>{" "}
                    detection{items.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <div
                  style={{
                    padding: "0 1.125rem 1.125rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                  }}
                >
                  {items.map((it, i) => (
                    <div
                      key={`${it.callsign}-${it.edition}-${i}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(6rem, 8rem) minmax(5rem, 7rem) minmax(0, 1fr) minmax(0, 1fr)",
                        gap: "1rem",
                        padding: "0.5rem 0",
                        borderTop: `1px dashed ${colors.border}`,
                        fontSize: "0.85rem",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          color: colors.accent,
                          letterSpacing: "0.05em",
                          fontWeight: 600,
                        }}
                      >
                        {it.callsign ? (
                          <Link
                            href={`/callsign/${encodeURIComponent(it.callsign)}`}
                            style={{
                              color: colors.accent,
                              textDecoration: "none",
                            }}
                          >
                            {it.callsign}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </span>
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          fontSize: "0.75rem",
                          color: colors.text_dim,
                          letterSpacing: "0.08em",
                        }}
                      >
                        {it.edition ?? "—"}
                      </span>
                      <span
                        style={{
                          fontFamily: fontStacks.display,
                          fontVariationSettings: '"opsz" 14, "wght" 400',
                          color: colors.text,
                          fontStyle: "italic",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {it.raw_name ? `“${it.raw_name}”` : "—"}
                      </span>
                      <span
                        style={{
                          fontFamily: fontStacks.mono,
                          color: colors.text_dim,
                          fontSize: "0.78rem",
                          letterSpacing: "0.04em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {[cleanOCRCity(it.city), cleanOCRState(it.city, it.state)].filter(Boolean).join(", ") || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
        }}
      >
        <MorseDivider label="related" />
      </div>

      {/* --- RELATED CLUBS ------------------------------------------- */}
      <section
        className="sv-rise sv-d-2"
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 6rem",
        }}
      >
        <SectionHeader
          title="Sister stations"
          tail="nearby"
          hint={
            related.length > 0
              ? `${related.length} sibling${related.length === 1 ? "" : "s"}`
              : "none"
          }
        />
        {related.length === 0 ? (
          <div style={emptyStyle}>
            No sibling clubs in {location ?? "this region"} matched the
            classifier.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))",
              gap: "1rem",
            }}
          >
            {related.map((r) => (
              <ClubCard key={r.slug} club={r} variant="compact" />
            ))}
          </div>
        )}
      </section>

      {/* --- CITE THIS RECORD -------------------------------------------- */}
      <section style={{ maxWidth: "min(110rem, 100%)", margin: "0 auto", padding: "0 2rem 4rem" }}>
        <CiteThisRecord
          recordType="club"
          identifier={decodedSlug}
          displayName={club.display_name ?? undefined}
          editionList={Array.from(
            { length: ((club.last_year ?? club.first_year) != null && club.first_year != null)
                ? (club.last_year ?? club.first_year)! - club.first_year! + 1
                : 0 },
            (_, i) => String((club.first_year ?? 0) + i)
          )}
          permalink={`https://callbook.archive/clubs/${encodeURIComponent(decodedSlug)}`}
          datasetVersion="v2026.06"
          accessDate={new Date().toISOString().slice(0, 10)}
        />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept in the page module since they aren't reused.
// ---------------------------------------------------------------------------

function StatCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  /** When true, render value in JetBrains Mono (for year spans / locations). */
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.6rem",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? fontStacks.mono : fontStacks.display,
          fontVariationSettings: mono
            ? undefined
            : '"opsz" 36, "wght" 500, "SOFT" 50',
          fontSize: mono ? "1.05rem" : "1.5rem",
          letterSpacing: mono ? "0.04em" : "-0.01em",
          color: colors.accent,
          textShadow: motifs.glow.textShadow,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionHeader({
  title,
  tail,
  hint,
}: {
  title: string;
  /** Optional italic continuation set after the title in Fraunces italic. */
  tail?: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "baseline",
        gap: "1rem",
        marginBottom: "1rem",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: fontStacks.display,
          fontSize: "clamp(1.5rem, 2.4vw, 2.1rem)",
          fontVariationSettings: '"opsz" 60, "SOFT" 50',
          color: colors.text,
          letterSpacing: "-0.015em",
        }}
      >
        {title}
        {tail ? (
          <span
            style={{
              marginLeft: "0.5rem",
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 60, "wght" 400',
              color: colors.text_dim,
              fontSize: "0.75em",
            }}
          >
            {tail}.
          </span>
        ) : null}
      </h2>
      {hint ? (
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: colors.text_dim,
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: "2rem 1rem",
  textAlign: "center",
  color: colors.text_dim,
  fontFamily: fontStacks.mono,
  fontSize: "0.85rem",
  letterSpacing: "0.1em",
  border: `1px dashed ${colors.border}`,
  borderRadius: "0.125rem",
};

// ---------------------------------------------------------------------------
// Page metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  return {
    title: decoded,
    description: `Roster, timeline, and detection history for the ${decoded} amateur radio club.`,
  };
}
