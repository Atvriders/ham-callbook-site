/**
 * /households — Family Stations Browse
 *
 * Browse 123,608 detected household clusters: same normalized address +
 * shared or identical surname = probable family stations. Filterable by
 * state. Each household links to the full address cluster.
 *
 * Server component (Next 15 App Router). URL-driven for shareability.
 *
 * Aesthetic contract: Sodium Vapor palette from lib/design.ts.
 */

import { colors, fontStacks, motifs } from "../../lib/design";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Household {
  cluster_key: string;
  surname: string;
  callsigns: string[];
  first_year: number | null;
  last_year: number | null;
}

interface HouseholdsResponse {
  total: number;
  limit: number;
  offset: number;
  state_filter: string | null;
  households: Household[];
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

const PAGE_SIZE = 50;

async function fetchHouseholds(params: {
  state?: string;
  offset?: number;
}): Promise<HouseholdsResponse | null> {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (params.state) qs.set("state", params.state);
  if (params.offset) qs.set("offset", String(params.offset));
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/households?${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<HouseholdsResponse>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CSS = `
@keyframes hh-rise {
  from { opacity: 0; transform: translateY(0.5rem); }
  to   { opacity: 1; transform: translateY(0); }
}
.hh-rise {
  animation: hh-rise 0.4s cubic-bezier(.22,1,.36,1) both;
  animation-delay: calc(var(--i, 0) * 0.04s);
}
.hh-row:hover { background: rgba(255,163,11,0.07) !important; }
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

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC","PR","GU","VI",
];

function StateFilter({ current }: { current: string | undefined }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "1.5rem" }}>
      <a
        href="/households"
        style={{
          padding: "0.2rem 0.5rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.15em",
          borderRadius: "0.15rem",
          textDecoration: "none",
          color: !current ? colors.bg : colors.text_dim,
          background: !current ? colors.accent : "transparent",
          border: `1px solid ${!current ? colors.accent : colors.border}`,
        }}
      >
        ALL
      </a>
      {US_STATES.map((st) => (
        <a
          key={st}
          href={`/households?state=${st}`}
          style={{
            padding: "0.2rem 0.45rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.1em",
            borderRadius: "0.15rem",
            textDecoration: "none",
            color: current === st ? colors.bg : colors.text_dim,
            background: current === st ? colors.accent : "transparent",
            border: `1px solid ${current === st ? colors.accent : colors.border}`,
          }}
        >
          {st}
        </a>
      ))}
    </div>
  );
}

function HouseholdRow({ hh, index }: { hh: Household; index: number }) {
  const span =
    hh.first_year && hh.last_year
      ? hh.first_year === hh.last_year
        ? String(hh.first_year)
        : `${hh.first_year}–${hh.last_year}`
      : hh.first_year
      ? String(hh.first_year)
      : "";

  const parts = hh.cluster_key.split("|");
  const addr = parts[0] ?? "";
  const city = parts[1] ?? "";
  const state = parts[2] ?? "";

  return (
    <a
      className="hh-rise hh-row"
      href={`/address/${encodeURIComponent(hh.cluster_key)}`}
      style={{
        ["--i" as string]: index % PAGE_SIZE,
        display: "grid",
        gridTemplateColumns: "7rem 1fr 1fr 5rem",
        gap: "0.75rem",
        padding: "0.6rem 0.75rem",
        borderBottom: `1px solid ${colors.border}`,
        textDecoration: "none",
        color: colors.text,
        transition: "background 0.12s ease",
        background: "transparent",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.72rem",
          letterSpacing: "0.1em",
          color: colors.accent,
          fontWeight: 700,
        }}
      >
        {hh.surname}
      </span>
      <span
        style={{
          fontFamily: fontStacks.body,
          fontSize: "0.82rem",
          color: colors.text,
        }}
      >
        {addr}
        {city ? `, ${city}` : ""}
        {state ? `, ${state}` : ""}
      </span>
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
          color: colors.text_dim,
        }}
      >
        {hh.callsigns.slice(0, 4).join(" · ")}
        {hh.callsigns.length > 4 ? ` +${hh.callsigns.length - 4}` : ""}
      </span>
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          letterSpacing: "0.1em",
          color: colors.text_dim,
          textAlign: "right",
        }}
      >
        {span}
      </span>
    </a>
  );
}

function Pagination({
  total,
  offset,
  state,
}: {
  total: number;
  offset: number;
  state: string | undefined;
}) {
  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;
  const hasNext = nextOffset < total;
  const hasPrev = offset > 0;
  const stateParam = state ? `&state=${state}` : "";

  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        justifyContent: "center",
        padding: "1.5rem 0",
        fontFamily: fontStacks.mono,
        fontSize: "0.72rem",
        letterSpacing: "0.2em",
      }}
    >
      {hasPrev ? (
        <a
          href={`/households?offset=${prevOffset}${stateParam}`}
          style={{
            color: colors.accent,
            textDecoration: "none",
            padding: "0.3rem 0.75rem",
            border: `1px solid ${colors.accent}`,
            borderRadius: "0.2rem",
          }}
        >
          ← PREV
        </a>
      ) : (
        <span style={{ color: colors.border }}>← PREV</span>
      )}
      <span style={{ color: colors.text_dim, alignSelf: "center" }}>
        {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
      </span>
      {hasNext ? (
        <a
          href={`/households?offset=${nextOffset}${stateParam}`}
          style={{
            color: colors.accent,
            textDecoration: "none",
            padding: "0.3rem 0.75rem",
            border: `1px solid ${colors.accent}`,
            borderRadius: "0.2rem",
          }}
        >
          NEXT →
        </a>
      ) : (
        <span style={{ color: colors.border }}>NEXT →</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function HouseholdsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const state = firstParam(params["state"])?.toUpperCase().slice(0, 2) ?? undefined;
  const offsetRaw = parseInt(firstParam(params["offset"]) ?? "0", 10);
  const offset = isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const data = await fetchHouseholds({ state, offset });

  return (
    <main
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        position: "relative",
        zIndex: 0,
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
            className="hh-rise"
            style={{
              ["--i" as string]: 0,
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            {motifs.morseDividers.pattern.slice(0, 15)} &nbsp; ham-callbook ·
            family stations
          </div>
          <h1
            className="hh-rise"
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
            FAMILY
            <br />
            STATIONS
          </h1>
          <p
            className="hh-rise"
            style={{
              ["--i" as string]: 2,
              margin: "0.25rem 0 0",
              fontFamily: fontStacks.body,
              fontSize: "1rem",
              color: colors.text_dim,
              maxWidth: "42rem",
              lineHeight: 1.5,
            }}
          >
            123,608 detected household clusters — addresses where two or more
            licensees share a surname across editions. Father-and-son Novices,
            sibling operators, family dynasties.
          </p>
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
            state
              ? `${(data?.total ?? 0).toLocaleString()} households in ${state}`
              : `${(data?.total ?? 123608).toLocaleString()} households`
          }
        />

        <StateFilter current={state} />

        {data === null ? (
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
            Households service unreachable. Retry in a moment.
          </div>
        ) : data.households.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "3rem 2rem",
              color: colors.text_dim,
              fontFamily: fontStacks.body,
            }}
          >
            No household clusters found
            {state ? ` for state ${state}` : ""}.
          </div>
        ) : (
          <>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "7rem 1fr 1fr 5rem",
                gap: "0.75rem",
                padding: "0.4rem 0.75rem",
                borderBottom: `2px solid ${colors.border}`,
                fontFamily: fontStacks.mono,
                fontSize: "0.6rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              <span>Surname</span>
              <span>Address</span>
              <span>Callsigns</span>
              <span style={{ textAlign: "right" }}>Years</span>
            </div>

            {data.households.map((hh, i) => (
              <HouseholdRow key={`${hh.cluster_key}|${hh.surname}`} hh={hh} index={i} />
            ))}

            <Pagination total={data.total} offset={offset} state={state} />

            <p
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.6rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.border,
                textAlign: "center",
                marginTop: "0.5rem",
              }}
            >
              A household = 2+ distinct callsigns at the same address sharing a
              surname across any edition
            </p>
          </>
        )}
      </section>
    </main>
  );
}
