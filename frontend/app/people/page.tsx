/**
 * /people — Phonetic People Finder
 *
 * "Was my relative a ham?" — Search the 7.8M-entry callbook archive by name,
 * tolerating abbreviations (Wm. -> William, Robt. -> Robert), initials, and
 * OCR-era spelling drift. Results are grouped into likely-same-person
 * identity clusters with confidence labels.
 *
 * Server component (Next 15 App Router). All params are URL-driven so every
 * search is shareable and bookmarkable.
 *
 * Aesthetic contract: Sodium Vapor palette from lib/design.ts.
 * No Inter, no purple, no scale-105.
 */

import { colors, fontStacks, motifs } from "../../lib/design";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeopleEntry {
  callsign: string;
  norm_name: string;
  first_year: number | null;
  callsign_url: string;
}

interface PersonIdentity {
  identity_key: string;
  display_name: string;
  entries: PeopleEntry[];
  entry_count: number;
  confidence: "high" | "medium" | "low";
  match_basis: "exact" | "initial" | "phonetic";
  earliest_year: number | null;
  latest_year: number | null;
}

interface PeopleResponse {
  query_name: string;
  normalized_query: string;
  phonetic_keys_tried: string[];
  state_filter: string | null;
  decade_filter: number | null;
  total_entries: number;
  truncated: boolean;
  identities: PersonIdentity[];
}

// ---------------------------------------------------------------------------
// Params plumbing
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v.find((x) => x && x.length > 0);
  return v && v.length > 0 ? v : undefined;
}

function normState(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : undefined;
}

function normDecade(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1900 || n > 2000) return undefined;
  return Math.floor(n / 10) * 10;
}

const INTERNAL_BASE =
  process.env.INTERNAL_API_BASE ?? "http://backend:8000";

async function fetchPeople(params: {
  name: string;
  state?: string;
  decade?: number;
}): Promise<PeopleResponse | null> {
  const usp = new URLSearchParams();
  usp.set("name", params.name);
  if (params.state) usp.set("state", params.state);
  if (params.decade !== undefined) usp.set("decade", String(params.decade));

  const url = `${INTERNAL_BASE}/api/people?${usp.toString()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PeopleResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scoped CSS
// ---------------------------------------------------------------------------

const CSS = `
@keyframes pf-rise {
  from { opacity: 0; transform: translateY(0.4rem); filter: blur(2px); }
  to   { opacity: 1; transform: translateY(0);      filter: blur(0); }
}
.pf-rise {
  opacity: 0;
  animation: pf-rise 480ms cubic-bezier(0.2, 0.65, 0.2, 1) forwards;
  animation-delay: calc(var(--i, 0) * 28ms + 60ms);
}
.pf-card {
  border: 1px solid ${colors.border};
  border-radius: 0.25rem;
  background: ${colors.surface};
  transition: border-color 220ms ease, background 220ms ease;
}
.pf-card:hover {
  border-color: ${colors.accent_2};
  background: rgba(255,163,11,0.04);
}
.pf-call-link {
  text-decoration: none;
  color: ${colors.accent};
  font-family: ${fontStacks.mono};
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: text-shadow 180ms ease;
  text-shadow: 0 0 8px rgba(255,209,102,0.35), 0 0 2px rgba(255,163,11,0.5);
}
.pf-call-link:hover {
  text-shadow: 0 0 18px rgba(255,209,102,0.85), 0 0 4px rgba(255,163,11,0.95);
}
.pf-decade-btn {
  padding: 0.35rem 0.7rem;
  font-family: ${fontStacks.mono};
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  border: 1px solid ${colors.border};
  color: ${colors.text_dim};
  background: transparent;
  text-decoration: none;
  border-radius: 0.15rem;
  transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
  cursor: pointer;
  display: inline-block;
}
.pf-decade-btn:hover, .pf-decade-btn[data-active="true"] {
  color: ${colors.bg};
  background: ${colors.accent};
  border-color: ${colors.accent};
}
@media (prefers-reduced-motion: reduce) {
  .pf-rise { animation: none !important; opacity: 1 !important; transform: none !important; }
}
`;

// ---------------------------------------------------------------------------
// Badge colors for confidence
// ---------------------------------------------------------------------------

const CONF_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  high:   { bg: "rgba(93,211,168,0.12)", fg: colors.success,   label: "HIGH CONFIDENCE" },
  medium: { bg: "rgba(255,163,11,0.10)", fg: colors.accent,    label: "POSSIBLE MATCH"  },
  low:    { bg: "rgba(168,176,195,0.08)", fg: colors.text_dim,  label: "WEAK MATCH"      },
};

const CONF_FALLBACK: { bg: string; fg: string; label: string } = {
  bg: "rgba(168,176,195,0.08)", fg: colors.text_dim, label: "WEAK MATCH",
};

const BASIS_LABEL: Record<string, string> = {
  exact:   "exact name",
  initial: "initials match",
  phonetic: "sounds like",
};

// ---------------------------------------------------------------------------
// Grain overlay
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
        position: "fixed", inset: 0, pointerEvents: "none",
        opacity, backgroundImage: `url("data:image/svg+xml,${svg}")`, zIndex: 1,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// MorseDivider
// ---------------------------------------------------------------------------

function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      style={{
        display: "flex", alignItems: "center", gap: "1rem",
        margin: "2rem 0", color: colors.text_dim,
        fontFamily: fontStacks.mono, fontSize: "0.7rem",
        letterSpacing: "0.3em", textTransform: "uppercase",
      }}
    >
      <span aria-hidden style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
        {motifs.morseDividers.pattern.repeat(5)}
      </span>
      {label && <span style={{ flexShrink: 0 }}>{label}</span>}
      <span aria-hidden style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
        {motifs.morseDividers.pattern.repeat(5)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search form
// ---------------------------------------------------------------------------

const DECADES = [1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

function SearchForm({
  name, state, decade,
}: {
  name?: string; state?: string; decade?: number;
}) {
  return (
    <form
      method="GET"
      action="/people"
      style={{
        display: "flex", flexDirection: "column", gap: "1rem",
        maxWidth: "52rem",
      }}
    >
      {/* Name input */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          name="name"
          defaultValue={name ?? ""}
          placeholder="Name — e.g. Wm. H. Smith, Robt. Jones, Charles Miller"
          autoFocus
          style={{
            flex: "1 1 18rem",
            padding: "0.9rem 1.1rem",
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontFamily: fontStacks.mono,
            fontSize: "0.95rem",
            letterSpacing: "0.03em",
            outline: "none",
            borderRadius: "0.25rem",
          }}
        />
        <select
          name="state"
          defaultValue={state ?? ""}
          style={{
            padding: "0.9rem 0.75rem",
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            color: state ? colors.text : colors.text_dim,
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            letterSpacing: "0.08em",
            outline: "none",
            borderRadius: "0.25rem",
            minWidth: "7rem",
          }}
        >
          <option value="">Any state</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          type="submit"
          style={{
            padding: "0.9rem 1.75rem",
            background: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.bg,
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 700,
            cursor: "pointer",
            borderRadius: "0.25rem",
          }}
        >
          SEARCH
        </button>
      </div>

      {/* Decade filter strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", alignItems: "center" }}>
        <span style={{
          fontFamily: fontStacks.mono, fontSize: "0.62rem",
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: colors.text_dim, marginRight: "0.25rem",
        }}>
          era
        </span>
        <a
          href={name ? `/people?name=${encodeURIComponent(name)}${state ? `&state=${state}` : ""}` : "/people"}
          className="pf-decade-btn"
          data-active={decade === undefined ? "true" : "false"}
        >
          All
        </a>
        {DECADES.map((d) => (
          <a
            key={d}
            href={`/people?${new URLSearchParams({
              ...(name ? { name } : {}),
              ...(state ? { state } : {}),
              decade: String(d),
            }).toString()}`}
            className="pf-decade-btn"
            data-active={decade === d ? "true" : "false"}
          >
            {d}s
          </a>
        ))}
        {/* Preserve decade when form is submitted */}
        {decade !== undefined && (
          <input type="hidden" name="decade" value={String(decade)} />
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Identity card
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence, match_basis }: { confidence: string; match_basis: string }) {
  const style = CONF_STYLES[confidence] ?? CONF_FALLBACK;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.4rem",
      padding: "0.2rem 0.55rem",
      background: style.bg,
      color: style.fg,
      fontFamily: fontStacks.mono,
      fontSize: "0.58rem",
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      borderRadius: "0.15rem",
      border: `1px solid ${style.fg}33`,
    }}>
      {style.label}
      <span style={{ opacity: 0.7, letterSpacing: "0.1em" }}>
        · {BASIS_LABEL[match_basis] ?? match_basis}
      </span>
    </span>
  );
}

function YearRange({ earliest, latest }: { earliest: number | null; latest: number | null }) {
  if (!earliest && !latest) return null;
  const label = earliest === latest || !latest
    ? String(earliest ?? latest)
    : `${earliest}–${latest}`;
  return (
    <span style={{
      fontFamily: fontStacks.mono,
      fontSize: "0.75rem",
      color: colors.text_dim,
      letterSpacing: "0.06em",
    }}>
      {label}
    </span>
  );
}

function CallEntry({ entry }: { entry: PeopleEntry }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      padding: "0.45rem 0",
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <a
        href={entry.callsign_url}
        className="pf-call-link"
        style={{ fontSize: "1rem", minWidth: "5.5rem" }}
      >
        {entry.callsign}
      </a>
      {entry.first_year !== null && (
        <span style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          color: colors.text_dim,
          letterSpacing: "0.06em",
        }}>
          first seen {entry.first_year}
        </span>
      )}
    </div>
  );
}

function IdentityCard({ identity, index }: { identity: PersonIdentity; index: number }) {
  const showing = identity.entries.slice(0, 8);
  const overflow = identity.entry_count - showing.length;

  return (
    <article
      className={`pf-card pf-rise`}
      style={{
        padding: "1.25rem 1.5rem",
        ["--i" as string]: index,
      }}
    >
      {/* Header row */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "0.6rem",
        marginBottom: "0.875rem",
      }}>
        <h3 style={{
          margin: 0,
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 36',
          fontSize: "1.25rem",
          fontWeight: 500,
          color: colors.text,
          letterSpacing: "-0.01em",
        }}>
          {identity.display_name}
        </h3>
        <ConfidenceBadge
          confidence={identity.confidence}
          match_basis={identity.match_basis}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <YearRange
            earliest={identity.earliest_year}
            latest={identity.latest_year}
          />
          <span style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.2em",
            color: colors.text_dim,
            textTransform: "uppercase",
          }}>
            {identity.entry_count} callsign{identity.entry_count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Entry list */}
      <div>
        {showing.map((entry) => (
          <CallEntry key={`${entry.callsign}-${entry.first_year ?? 0}`} entry={entry} />
        ))}
        {overflow > 0 && (
          <p style={{
            margin: "0.6rem 0 0",
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            color: colors.text_dim,
            letterSpacing: "0.1em",
          }}>
            +{overflow} more — search by callsign to see all
          </p>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Empty / prompt states
// ---------------------------------------------------------------------------

function EmptyPrompt() {
  const examples = ["Wm. H. Smith", "Robt. Jones", "Geo. Washington", "Chas. Miller"];
  return (
    <div
      className="pf-rise"
      style={{
        ["--i" as string]: 0,
        padding: "3.5rem 2rem",
        textAlign: "center",
        border: `1px solid ${colors.border}`,
        borderRadius: "0.25rem",
        background: colors.surface,
      }}
    >
      <div style={{
        fontFamily: fontStacks.mono,
        fontSize: "0.65rem",
        letterSpacing: "0.4em",
        textTransform: "uppercase",
        color: colors.accent,
        marginBottom: "1rem",
      }}>
        {motifs.morseDividers.tight} &nbsp; was my relative a ham?
      </div>
      <div style={{
        fontFamily: fontStacks.display,
        fontVariationSettings: '"opsz" 96',
        fontSize: "clamp(2rem, 5vw, 3.5rem)",
        fontWeight: 600,
        color: colors.text,
        lineHeight: 1.05,
        letterSpacing: "-0.02em",
        textShadow: motifs.glow.textShadow,
        marginBottom: "1rem",
      }}>
        Search by name.
      </div>
      <p style={{
        maxWidth: "34rem",
        margin: "0 auto 1.75rem",
        fontFamily: fontStacks.body,
        fontSize: "0.95rem",
        color: colors.text_dim,
        lineHeight: 1.6,
      }}>
        The phonetic finder understands how names appeared in 20th-century
        callbooks — abbreviations like{" "}
        <span style={{ fontFamily: fontStacks.mono, color: colors.text }}>Wm.</span>,
        {" "}<span style={{ fontFamily: fontStacks.mono, color: colors.text }}>Robt.</span>,
        {" "}<span style={{ fontFamily: fontStacks.mono, color: colors.text }}>Chas.</span>{" "}
        and initials like <span style={{ fontFamily: fontStacks.mono, color: colors.text }}>W. H. Smith</span>.
        Results are grouped into likely-same-person clusters.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
        {examples.map((ex) => (
          <a
            key={ex}
            href={`/people?name=${encodeURIComponent(ex)}`}
            style={{
              padding: "0.45rem 0.9rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.78rem",
              letterSpacing: "0.08em",
              border: `1px solid ${colors.accent_2}`,
              color: colors.accent,
              textDecoration: "none",
              borderRadius: "0.15rem",
              background: "rgba(255,163,11,0.05)",
            }}
          >
            {ex}
          </a>
        ))}
      </div>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div
      className="pf-rise"
      style={{
        ["--i" as string]: 0,
        padding: "3rem 2rem",
        textAlign: "center",
        border: `1px dashed ${colors.border}`,
        borderRadius: "0.25rem",
      }}
    >
      <div style={{
        fontFamily: fontStacks.display,
        fontVariationSettings: '"opsz" 72',
        fontSize: "clamp(2rem, 4vw, 3rem)",
        fontWeight: 600,
        color: colors.text_dim,
        marginBottom: "0.75rem",
      }}>
        No match for &ldquo;{query}&rdquo;
      </div>
      <p style={{
        maxWidth: "32rem",
        margin: "0 auto",
        fontFamily: fontStacks.body,
        fontSize: "0.9rem",
        color: colors.text_dim,
        lineHeight: 1.55,
      }}>
        Try a shorter name, just the surname, or remove state and decade filters.
        Phonetic matching works best with at least a surname.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const name = firstParam(sp.name)?.trim();
  const state = normState(firstParam(sp.state));
  const decade = normDecade(firstParam(sp.decade));

  const results = name ? await fetchPeople({ name, state, decade }) : null;

  const hasResults = results !== null && results.identities.length > 0;
  const totalLabel = results
    ? `${results.total_entries.toLocaleString()} entr${results.total_entries === 1 ? "y" : "ies"} · ${results.identities.length} identit${results.identities.length === 1 ? "y" : "ies"}`
    : "awaiting search";

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100dvh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
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
        {/* Scanlines */}
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0, pointerEvents: "none",
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
        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div
            className="pf-rise"
            style={{
              ["--i" as string]: 0,
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            {motifs.morseDividers.tight} &nbsp; ham-callbook · people finder
          </div>
          <h1
            className="pf-rise"
            style={{
              ["--i" as string]: 1,
              fontFamily: fontStacks.display,
              fontSize: "clamp(3rem, 9vw, 7rem)",
              fontWeight: 600,
              fontVariationSettings: '"opsz" 144',
              lineHeight: 0.92,
              letterSpacing: "-0.02em",
              margin: 0,
              color: colors.text,
              textShadow: motifs.glow.textShadow,
            }}
          >
            PEOPLE
          </h1>
          <p
            className="pf-rise"
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
            Name-first search across 7.8 million callbook entries. Finds abbreviations,
            initials, and phonetic variants automatically.
          </p>
          <div className="pf-rise" style={{ ["--i" as string]: 3, marginTop: "0.75rem" }}>
            <SearchForm name={name} state={state} decade={decade} />
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
        <MorseDivider label={name ? totalLabel : "enter a name above"} />

        {!name ? (
          <EmptyPrompt />
        ) : results === null ? (
          <div style={{
            padding: "2rem",
            border: `1px solid ${colors.danger}`,
            borderRadius: "0.25rem",
            color: colors.danger,
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            letterSpacing: "0.1em",
          }}>
            People search service unreachable. Retry in a moment.
          </div>
        ) : !hasResults ? (
          <NoResults query={name} />
        ) : (
          <>
            {/* Active filters display */}
            {(state || decade !== undefined) && (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: "0.5rem",
                marginBottom: "1.5rem",
              }}>
                <span style={{
                  fontFamily: fontStacks.mono, fontSize: "0.62rem",
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: colors.text_dim, alignSelf: "center",
                }}>
                  filters active:
                </span>
                {state && (
                  <a
                    href={`/people?name=${encodeURIComponent(name)}${decade !== undefined ? `&decade=${decade}` : ""}`}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontFamily: fontStacks.mono, fontSize: "0.72rem",
                      letterSpacing: "0.1em", color: colors.bg,
                      background: colors.accent, textDecoration: "none",
                      borderRadius: "0.15rem",
                    }}
                  >
                    STATE · {state} <span style={{ fontWeight: 700 }}>×</span>
                  </a>
                )}
                {decade !== undefined && (
                  <a
                    href={`/people?name=${encodeURIComponent(name)}${state ? `&state=${state}` : ""}`}
                    style={{
                      padding: "0.25rem 0.5rem",
                      fontFamily: fontStacks.mono, fontSize: "0.72rem",
                      letterSpacing: "0.1em", color: colors.bg,
                      background: colors.accent, textDecoration: "none",
                      borderRadius: "0.15rem",
                    }}
                  >
                    ERA · {decade}s <span style={{ fontWeight: 700 }}>×</span>
                  </a>
                )}
              </div>
            )}

            {/* Search metadata */}
            <div style={{
              marginBottom: "1.5rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.68rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: colors.text_dim,
              display: "flex",
              flexWrap: "wrap",
              gap: "1rem",
            }}>
              <span>
                normalized: <span style={{ color: colors.text }}>{results.normalized_query}</span>
              </span>
              <span>
                keys tried: <span style={{ color: colors.text }}>{results.phonetic_keys_tried.join(", ")}</span>
              </span>
              {results.truncated && (
                <span style={{ color: colors.accent }}>
                  results truncated — narrow with filters
                </span>
              )}
            </div>

            {/* Identity cards grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 28rem), 1fr))",
              gap: "1rem",
            }}>
              {results.identities.map((identity, i) => (
                <IdentityCard key={identity.identity_key} identity={identity} index={i} />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
