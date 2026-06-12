/**
 * /records — Century Club leaderboards page.
 *
 * Server component. Fetches category list + default category data from
 * /api/records.  State and category selection are driven by searchParams
 * so the page is shareable and SSR-safe.
 *
 * Sections:
 *   1. Hero — Fraunces "Century Club" headline + corpus note.
 *   2. Category tab rail — mono pill buttons, one per category.
 *   3. Facet strip — state <select>, district <select>.
 *   4. LeaderboardTable — ranked rows linking to /callsign or /clubs.
 *
 * Aesthetic guardrails (per design contract): NO Inter, NO purple, NO
 * hover:scale-105. All hex values from lib/design.ts.
 */

import Link from "next/link";
import { colors, fontStacks, motifs } from "../../lib/design";
import { LeaderboardTable } from "../../components/records/LeaderboardTable";
import type { LeaderboardRow } from "../../components/records/LeaderboardTable";

export const dynamic = "force-dynamic";

// --------------------------------------------------------------------------- //
// Types                                                                       //
// --------------------------------------------------------------------------- //

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

async function fetchCategories(): Promise<CategoryMeta[]> {
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/records/categories`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    return (await res.json()) as CategoryMeta[];
  } catch {
    return [];
  }
}

async function fetchCategory(
  name: string,
  state: string | null,
  district: string | null,
): Promise<LeaderboardRow[]> {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (district) params.set("district", district);
  const qs = params.toString();
  const url = `${INTERNAL_BASE}/api/records/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    return (await res.json()) as LeaderboardRow[];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------- //
// US states for facet select                                                  //
// --------------------------------------------------------------------------- //

const US_STATES: [string, string][] = [
  ["", "All states"],
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],
  ["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],
  ["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],
  ["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],
  ["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],
  ["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],
  ["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],
  ["WI","Wisconsin"],["WY","Wyoming"],
];

// --------------------------------------------------------------------------- //
// Sub-components (server-safe)                                                //
// --------------------------------------------------------------------------- //

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
        fontSize: "0.75rem",
        letterSpacing: "0.3em",
        textTransform: "uppercase",
      }}
    >
      <span aria-hidden style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
        {motifs.morseDividers.pattern.repeat(4)}
      </span>
      {label ? <span style={{ flexShrink: 0 }}>{label}</span> : null}
      <span aria-hidden style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
        {motifs.morseDividers.pattern.repeat(4)}
      </span>
    </div>
  );
}

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

interface PageProps {
  searchParams: Promise<{ cat?: string; state?: string; district?: string }>;
}

export default async function RecordsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const activeCat = sp.cat ?? "longest_issued";
  const activeState = sp.state ?? null;
  const activeDistrict = sp.district ?? null;

  const [categories, rows] = await Promise.all([
    fetchCategories(),
    fetchCategory(activeCat, activeState, activeDistrict),
  ]);

  const catMeta: CategoryMeta | undefined = categories.find((c) => c.name === activeCat);
  const linkType: "callsign" | "club" = catMeta?.link_type ?? "callsign";
  const sortField: string = catMeta?.sort_field ?? "span_years";
  const catDescription = catMeta?.description ?? "";

  // Build facet URL helper
  function facetHref(overrides: { cat?: string; state?: string; district?: string }): string {
    const p = new URLSearchParams();
    const merged = { cat: activeCat, state: activeState ?? "", district: activeDistrict ?? "", ...overrides };
    if (merged.cat) p.set("cat", merged.cat);
    if (merged.state) p.set("state", merged.state);
    if (merged.district) p.set("district", merged.district);
    return `/records?${p.toString()}`;
  }

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

      {/* --- HERO ---------------------------------------------------------- */}
      <section
        style={{
          position: "relative",
          padding: "5rem 2rem 3rem",
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <Scanlines />
        <div style={{ position: "relative", zIndex: 2 }}>
          <div
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: colors.accent,
              marginBottom: "0.75rem",
            }}
          >
            {motifs.morseDividers.tight} &nbsp; archive · records
          </div>
          <h1
            style={{
              fontFamily: fontStacks.display,
              fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
              fontWeight: 500,
              fontVariationSettings: '"opsz" 144, "SOFT" 20',
              letterSpacing: "-0.02em",
              margin: "0 0 0.75rem",
              color: colors.text,
              lineHeight: 1.05,
              textShadow: motifs.glow.textShadow,
            }}
          >
            Century Club
          </h1>
          <p
            style={{
              maxWidth: "50rem",
              color: colors.text_dim,
              fontSize: "1.05rem",
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            Callsigns and clubs that logged remarkable streaks across 94 years of
            printed callbooks — from 1909 spark-gap operators to the digital era.
            Every entry links to the full archive record.
          </p>
        </div>
      </section>

      {/* --- CATEGORY RAIL ------------------------------------------------- */}
      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <nav
          aria-label="Leaderboard categories"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            paddingBottom: "1.5rem",
          }}
        >
          {categories.map((cat) => {
            const isActive = cat.name === activeCat;
            return (
              <Link
                key={cat.name}
                href={facetHref({ cat: cat.name })}
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.7rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  padding: "0.35rem 0.85rem",
                  borderRadius: "9999px",
                  border: `1px solid ${isActive ? colors.accent : colors.border}`,
                  background: isActive ? colors.accent : "transparent",
                  color: isActive ? colors.bg : colors.text_dim,
                  textDecoration: "none",
                  transition: "none",
                }}
              >
                {cat.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* --- FACETS + TABLE ------------------------------------------------ */}
      <section
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 6rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        {/* Category description */}
        {catDescription ? (
          <p
            style={{
              color: colors.text_dim,
              fontSize: "0.9rem",
              marginBottom: "1.25rem",
              maxWidth: "52rem",
            }}
          >
            {catDescription}
          </p>
        ) : null}

        {/* Facet strip */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: colors.text_dim,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            State
            <form method="get" action="/records" style={{ display: "inline" }}>
              <input type="hidden" name="cat" value={activeCat} />
              {activeDistrict ? <input type="hidden" name="district" value={activeDistrict} /> : null}
              <select
                name="state"
                defaultValue={activeState ?? ""}
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.75rem",
                  background: colors.surface,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "0.2rem",
                  padding: "0.2rem 0.5rem",
                }}
                onChange={undefined}
              >
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code ? code : name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.65rem",
                  letterSpacing: "0.1em",
                  background: colors.accent,
                  color: colors.bg,
                  border: "none",
                  borderRadius: "0.2rem",
                  padding: "0.25rem 0.6rem",
                  cursor: "pointer",
                  marginLeft: "0.35rem",
                }}
              >
                GO
              </button>
            </form>
          </label>

          {activeState ? (
            <Link
              href={facetHref({ state: "" })}
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.65rem",
                color: colors.text_dim,
                textDecoration: "underline",
              }}
            >
              Clear filter
            </Link>
          ) : null}

          <span
            style={{
              marginLeft: "auto",
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              color: colors.text_dim,
            }}
          >
            {rows.length} entries
          </span>
        </div>

        <MorseDivider label={catMeta?.label ?? activeCat} />

        <LeaderboardTable rows={rows} linkType={linkType} sortField={sortField} />

        {/* Footer note */}
        <p
          style={{
            marginTop: "1.5rem",
            fontFamily: fontStacks.body,
            fontSize: "0.78rem",
            color: colors.text_dim,
            maxWidth: "56rem",
            lineHeight: 1.5,
          }}
        >
          Dataset: USA Ham Callbook Archive v2026.06. Spans 1909–2003 across{" "}
          printed editions indexed by OCR + three-way correction. Minimum 3
          qualifying editions required for individual-callsign categories.
          Accuracy ~97.1% (OCR-anchored). Cite original scan for
          primary-source genealogical proof.
        </p>
      </section>

      <div
        style={{
          maxWidth: "min(110rem, 100%)",
          margin: "0 auto",
          padding: "0 2rem 4rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <MorseDivider label="end · 73" />
      </div>
    </main>
  );
}
