/**
 * /address — Address Time Machine
 *
 * "Did a ham live in my house?" — Reverse-search the 7.8M-entry callbook
 * archive by street address to find every licensed amateur radio operator
 * who ever lived there across all editions from 1927 onward.
 *
 * Server component (Next 15 App Router). URL-driven so every search is
 * shareable and bookmarkable.
 *
 * Aesthetic contract: Sodium Vapor palette from lib/design.ts.
 */

import { colors, fontStacks, motifs } from "../../lib/design";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClusterEntry {
  callsign: string;
  year: number;
  edition: string | null;
  name: string | null;
  raw_address: string | null;
  city: string | null;
  state: string | null;
}

interface Household {
  cluster_key: string;
  surname: string;
  callsigns: string[];
  first_year: number | null;
  last_year: number | null;
}

interface AddressCluster {
  cluster_key: string;
  normalized_address: string;
  city: string | null;
  state: string | null;
  callsign_count: number;
  entry_count_total: number;
  suspect_large: boolean;
  entries: ClusterEntry[];
  households?: Household[];
}

interface SearchResponse {
  query: string;
  normalized_query: string;
  city_filter: string | null;
  state_filter: string | null;
  total: number;
  clusters: AddressCluster[];
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v.find((x) => x && x.length > 0);
  return v && v.length > 0 ? v : undefined;
}

const INTERNAL_BASE = process.env.INTERNAL_API_BASE ?? "http://localhost:8000";

async function fetchSearch(params: {
  q: string;
  city?: string;
  state?: string;
}): Promise<SearchResponse | null> {
  const qs = new URLSearchParams({ q: params.q, limit: "30" });
  if (params.city) qs.set("city", params.city);
  if (params.state) qs.set("state", params.state);
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/address/search?${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<SearchResponse>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CSS = `
@keyframes at-rise {
  from { opacity: 0; transform: translateY(0.6rem); }
  to   { opacity: 1; transform: translateY(0); }
}
.at-rise {
  animation: at-rise 0.45s cubic-bezier(.22,1,.36,1) both;
  animation-delay: calc(var(--i, 0) * 0.07s);
}
@keyframes at-fade { from { opacity: 0; } to { opacity: 1; } }
.at-fade { animation: at-fade 0.4s ease both; animation-delay: calc(var(--i, 0) * 0.06s); }
`;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Grain() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        opacity: 0.03,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        zIndex: 0,
      }}
    />
  );
}

function SearchForm({
  q,
  state,
}: {
  q: string | undefined;
  state: string | undefined;
}) {
  return (
    <form
      method="GET"
      action="/address"
      style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
    >
      <input
        name="q"
        defaultValue={q ?? ""}
        placeholder="123 Main St"
        required
        minLength={3}
        autoComplete="street-address"
        style={{
          flex: "1 1 16rem",
          minWidth: "12rem",
          background: "transparent",
          border: `1px solid ${colors.border}`,
          borderRadius: "0.2rem",
          color: colors.text,
          fontFamily: fontStacks.mono,
          fontSize: "0.9rem",
          letterSpacing: "0.05em",
          padding: "0.6rem 0.75rem",
          outline: "none",
        }}
      />
      <input
        name="state"
        defaultValue={state ?? ""}
        placeholder="State (IL)"
        maxLength={2}
        style={{
          width: "5rem",
          background: "transparent",
          border: `1px solid ${colors.border}`,
          borderRadius: "0.2rem",
          color: colors.text,
          fontFamily: fontStacks.mono,
          fontSize: "0.9rem",
          letterSpacing: "0.1em",
          padding: "0.6rem 0.75rem",
          outline: "none",
        }}
      />
      <button
        type="submit"
        style={{
          background: colors.accent,
          border: "none",
          borderRadius: "0.2rem",
          color: colors.bg,
          cursor: "pointer",
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.25em",
          padding: "0.6rem 1.2rem",
          textTransform: "uppercase",
        }}
      >
        SEARCH
      </button>
    </form>
  );
}

function MorseDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "2rem 0 1.5rem",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.62rem",
        letterSpacing: "0.35em",
        textTransform: "uppercase",
      }}
    >
      <span>{motifs.morseDividers.pattern}</span>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: "1px", background: colors.border }} />
    </div>
  );
}

function Timeline({ entries }: { entries: ClusterEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.year - b.year);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        marginTop: "0.75rem",
      }}
    >
      {sorted.map((e, i) => (
        <div
          key={`${e.callsign}-${e.year}-${i}`}
          className="at-fade"
          style={{
            ["--i" as string]: i,
            display: "grid",
            gridTemplateColumns: "4.5rem 1fr 1fr",
            gap: "0.5rem",
            padding: "0.45rem 0.6rem",
            background: `${colors.surface}88`,
            borderLeft: `2px solid ${colors.border}`,
            borderRadius: "0 0.15rem 0.15rem 0",
            fontSize: "0.8rem",
          }}
        >
          <span
            style={{
              fontFamily: fontStacks.mono,
              color: colors.accent,
              fontSize: "0.75rem",
              letterSpacing: "0.05em",
            }}
          >
            {e.year}
            {e.edition ? ` ${e.edition.slice(0, 3)}` : ""}
          </span>
          <a
            href={`/callsign/${e.callsign.toUpperCase()}`}
            style={{
              fontFamily: fontStacks.mono,
              color: colors.text,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.82rem",
              letterSpacing: "0.06em",
            }}
          >
            {e.callsign.toUpperCase()}
          </a>
          <span style={{ color: colors.text_dim, fontFamily: fontStacks.body }}>
            {e.name ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function HouseholdBadges({ households }: { households: Household[] }) {
  if (!households || households.length === 0) return null;
  return (
    <div
      style={{
        marginTop: "0.75rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.4rem",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.6rem",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        household:
      </span>
      {households.map((hh) => (
        <a
          key={`${hh.cluster_key}|${hh.surname}`}
          href={`/households?cluster=${encodeURIComponent(hh.cluster_key)}&surname=${encodeURIComponent(hh.surname)}`}
          style={{
            padding: "0.15rem 0.5rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.68rem",
            letterSpacing: "0.1em",
            color: colors.bg,
            background: colors.accent,
            textDecoration: "none",
            borderRadius: "0.15rem",
          }}
        >
          {hh.surname} ({hh.callsigns.length} call{hh.callsigns.length !== 1 ? "s" : ""},{" "}
          {hh.first_year}
          {hh.last_year && hh.last_year !== hh.first_year ? `–${hh.last_year}` : ""})
        </a>
      ))}
    </div>
  );
}

function ClusterCard({
  cluster,
  index,
}: {
  cluster: AddressCluster;
  index: number;
}) {
  const parts = cluster.cluster_key.split("|");
  const city = parts[1] ?? cluster.city ?? "";
  const state = parts[2] ?? cluster.state ?? "";
  const yearsRange =
    cluster.entries.length > 0
      ? `${Math.min(...cluster.entries.map((e) => e.year))}–${Math.max(...cluster.entries.map((e) => e.year))}`
      : "";

  return (
    <article
      className="at-rise"
      style={{
        ["--i" as string]: index,
        border: `1px solid ${colors.border}`,
        borderRadius: "0.3rem",
        padding: "1.25rem 1.25rem 1rem",
        background: colors.surface,
        position: "relative",
      }}
    >
      {cluster.suspect_large && (
        <span
          style={{
            position: "absolute",
            top: "0.6rem",
            right: "0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.58rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: colors.text_dim,
            border: `1px solid ${colors.border}`,
            padding: "0.1rem 0.35rem",
            borderRadius: "0.1rem",
          }}
        >
          high-traffic address
        </span>
      )}

      <div
        style={{
          fontFamily: fontStacks.display,
          fontSize: "1.15rem",
          fontWeight: 600,
          color: colors.text,
          marginBottom: "0.2rem",
        }}
      >
        {cluster.normalized_address}
      </div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.68rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: colors.text_dim,
          marginBottom: "0.75rem",
          display: "flex",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <span>
          {city}
          {state ? `, ${state}` : ""}
        </span>
        <span style={{ color: colors.accent }}>{cluster.callsign_count} licensees</span>
        {yearsRange && <span>{yearsRange}</span>}
        <a
          href={`/address/${encodeURIComponent(cluster.cluster_key)}`}
          style={{
            color: colors.accent,
            textDecoration: "none",
            marginLeft: "auto",
          }}
        >
          permalink ↗
        </a>
      </div>

      <Timeline entries={cluster.entries} />
      <HouseholdBadges households={cluster.households ?? []} />
    </article>
  );
}

function EmptyPrompt() {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "4rem 2rem",
        color: colors.text_dim,
        fontFamily: fontStacks.body,
      }}
    >
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "3rem",
          letterSpacing: "0.1em",
          color: colors.border,
          marginBottom: "1rem",
        }}
      >
        · — ·
      </div>
      <p style={{ maxWidth: "28rem", margin: "0 auto", lineHeight: 1.6 }}>
        Enter a street address above to search across all callbook editions from
        1927 onward. Discover every licensed amateur radio operator who ever
        lived there.
      </p>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "3rem 2rem",
        color: colors.text_dim,
        fontFamily: fontStacks.body,
      }}
    >
      <p>
        No multi-occupant address clusters found for{" "}
        <strong style={{ color: colors.text }}>{query}</strong>. Try a shorter
        street name or omit the number.
      </p>
      <p
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.2em",
          marginTop: "0.75rem",
          color: colors.border,
        }}
      >
        Note: only addresses shared by 2+ licensees are in the archive index.
        Single-occupant addresses are not indexed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AddressPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = firstParam(params["q"]);
  const state = firstParam(params["state"])?.toUpperCase().slice(0, 2) ?? undefined;

  const results = q ? await fetchSearch({ q, state }) : null;
  const hasResults = results !== null && results.clusters.length > 0;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
        position: "relative",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Grain />

      {/* Hero */}
      <section
        style={{
          position: "relative",
          padding: "4rem 2rem 2.5rem",
          maxWidth: "min(90rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: motifs.scanlines.opacity,
            backgroundImage: `repeating-linear-gradient(
              to bottom,
              rgba(255,209,102,0.6) 0px,
              rgba(255,209,102,0.6) 1px,
              transparent 1px,
              transparent ${motifs.scanlines.spacingPx}px
            )`,
            mixBlendMode: "overlay",
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <div
            className="at-rise"
            style={{
              ["--i" as string]: 0,
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            {motifs.morseDividers.tight ?? "·  —  ·"} &nbsp; ham-callbook ·
            address time machine
          </div>
          <h1
            className="at-rise"
            style={{
              ["--i" as string]: 1,
              fontFamily: fontStacks.display,
              fontSize: "clamp(2.5rem, 8vw, 6rem)",
              fontWeight: 600,
              fontVariationSettings: '"opsz" 144',
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              margin: 0,
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            ADDRESS
            <br />
            TIME MACHINE
          </h1>
          <p
            className="at-rise"
            style={{
              ["--i" as string]: 2,
              margin: "0.25rem 0 0",
              fontFamily: fontStacks.body,
              fontSize: "1rem",
              color: colors.text_dim,
              maxWidth: "38rem",
              lineHeight: 1.5,
            }}
          >
            Did a ham live in your house? Search every callbook edition from
            1927 onward by street address and discover the amateur radio
            history of any location.
          </p>
          <div
            className="at-rise"
            style={{ ["--i" as string]: 3, marginTop: "0.75rem" }}
          >
            <SearchForm q={q} state={state} />
          </div>
        </div>
      </section>

      {/* Body */}
      <section
        style={{
          padding: "0 2rem 6rem",
          maxWidth: "min(90rem, 100%)",
          margin: "0 auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider
          label={
            q && results
              ? results.total === 0
                ? "no results"
                : `${results.total} cluster${results.total !== 1 ? "s" : ""} — normalized: ${results.normalized_query}`
              : "enter an address above"
          }
        />

        {!q ? (
          <EmptyPrompt />
        ) : results === null ? (
          <div
            style={{
              padding: "2rem",
              border: `1px solid ${colors.danger}`,
              borderRadius: "0.25rem",
              color: colors.danger,
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              letterSpacing: "0.1em",
            }}
          >
            Address search service unreachable. Retry in a moment.
          </div>
        ) : !hasResults ? (
          <NoResults query={q} />
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
          >
            {results.clusters.map((cluster, i) => (
              <ClusterCard
                key={cluster.cluster_key}
                cluster={cluster}
                index={i}
              />
            ))}
            <p
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.62rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.border,
                textAlign: "center",
                marginTop: "1rem",
              }}
            >
              Showing up to 30 clusters · Only addresses shared by 2+
              licensees are indexed
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
