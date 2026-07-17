"use client";

/**
 * NearbyExplorer — client island for /nearby.
 *
 * Owns the address input, calls GET /api/nearby?q=..., and renders the
 * ring-grouped result list. Handles every response state in the contract:
 *
 *   - building     — index warming up: poll every 3 s, max 20 tries, with a
 *                    "warming up the map index…" sweep panel.
 *   - dense        — "Showing the N closest of T hams within 10 mi".
 *   - expanded     — "Only N hams nearby — expanded to R mi to show the
 *                    nearest."
 *   - normal       — plain "T hams within R mi".
 *   - 400 / 404    — helpful empty-states ("try a ZIP or City, ST").
 *
 * Results group visually into range rings (<5 mi, 5–25 mi, 25+ mi); every
 * callsign links to /callsign/X and carries a StatusChip + distance badge.
 *
 * ?q= deep links: the parent server shell passes initialQuery (and keys the
 * island by it), so a prefilled query auto-runs on mount. Manual searches
 * sync the URL via history.replaceState — no router nav, no remount.
 *
 * Aesthetic: Sodium Vapor (locked). All tokens from lib/design.ts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { colors, fontStacks } from "@/lib/design";
import StatusChip from "@/components/StatusChip";
import EmptyState from "@/components/EmptyState";

// ---------------------------------------------------------------------------
// API types — mirror the /api/nearby contract exactly.
// ---------------------------------------------------------------------------

interface NearbyQueryEcho {
  raw: string;
  zip: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lon: number;
  matched_by: "zip" | "city-state" | "city";
}

interface NearbyResult {
  callsign: string;
  name: string | null;
  city: string | null;
  state: string | null;
  zip: string;
  distance_mi: number;
  last_seen_year: number;
  status: "A" | "E" | "C" | "T" | null;
  status_label: string | null;
}

interface NearbyReady {
  query: NearbyQueryEcho;
  index_ready: true;
  radius_mi: number;
  dense: boolean;
  expanded: boolean;
  total_in_radius: number;
  results: NearbyResult[];
}

interface NearbyBuilding {
  index_ready: false;
  building: true;
  eta_s: number;
}

type NearbyResponse = NearbyReady | NearbyBuilding;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_MS = 3000;
const MAX_POLLS = 20;
const LIMIT = 60;

const EXAMPLES = ["80301", "Boulder, CO", "225 Main St, Newington, CT 06111"];

type Phase =
  | "idle"
  | "loading"
  | "building"
  | "build-timeout"
  | "bad-query" // 400
  | "not-found" // 404
  | "error"
  | "results";

/** Ring buckets — must mirror the visual grouping in the contract. */
const RINGS = [
  {
    key: "close",
    label: "Within 5 mi",
    test: (d: number) => d < 5,
    color: colors.glow,
  },
  {
    key: "mid",
    label: "5 – 25 mi",
    test: (d: number) => d >= 5 && d < 25,
    color: colors.accent,
  },
  {
    key: "far",
    label: "Beyond 25 mi",
    test: (d: number) => d >= 25,
    color: colors.accent_2,
  },
] as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "10" for 10.0, "12.5" for 12.5 — radii read cleaner without a fake .0 */
function fmtRadius(r: number): string {
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Human place line for the matched center, e.g. "ZIP 80301 · Boulder, CO". */
function describeCenter(q: NearbyQueryEcho): string {
  const place = [q.city, q.state].filter(Boolean).join(", ");
  if (q.matched_by === "zip" && q.zip) {
    return place ? `ZIP ${q.zip} · ${place}` : `ZIP ${q.zip}`;
  }
  return place || q.raw;
}

/** "40.02°N 105.26°W" — archival chart-coordinate flavor. */
function fmtLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function DistanceBadge({ mi }: { mi: number }) {
  return (
    <span
      style={{
        fontFamily: fontStacks.mono,
        fontSize: "0.72rem",
        letterSpacing: "0.08em",
        color: colors.glow,
        border: `1px solid ${colors.accent_2}`,
        borderRadius: 2,
        padding: "0.2rem 0.55rem",
        background: "rgba(255,163,11,0.07)",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
      }}
    >
      {mi.toFixed(1)} mi
    </span>
  );
}

/** Concentric-ring glyph used in group headers — tiny inline SVG. */
function RingGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill="none" stroke={color} strokeWidth="1" opacity="0.45" />
      <circle cx="8" cy="8" r="4" fill="none" stroke={color} strokeWidth="1" opacity="0.75" />
      <circle cx="8" cy="8" r="1.5" fill={color} />
    </svg>
  );
}

function RingHeader({
  label,
  color,
  count,
}: {
  label: string;
  color: string;
  count: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        margin: "1.75rem 0 0.75rem",
      }}
    >
      <RingGlyph color={color} />
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.72rem",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.72rem",
          color: colors.text_dim,
          whiteSpace: "nowrap",
        }}
      >
        · {count}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${colors.border}, transparent)`,
        }}
      />
    </div>
  );
}

function ResultRow({ r, ringColor }: { r: NearbyResult; ringColor: string }) {
  const place = [r.city, r.state].filter(Boolean).join(", ");
  return (
    <li
      style={{
        listStyle: "none",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: "0.35rem 1rem",
        alignItems: "start",
        padding: "0.8rem 1rem",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${ringColor}`,
        borderRadius: 2,
      }}
    >
      {/* Left: callsign + status, then name / place */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.35rem 0.6rem",
          }}
        >
          <Link
            href={`/callsign/${encodeURIComponent(r.callsign)}`}
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "1.02rem",
              letterSpacing: "0.1em",
              color: colors.text,
              textDecoration: "none",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.glow;
              e.currentTarget.style.textShadow =
                "0 0 12px rgba(255, 209, 102, 0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.text;
              e.currentTarget.style.textShadow = "none";
            }}
          >
            {r.callsign}
          </Link>
          <StatusChip status={r.status} label={r.status_label} size="sm" />
        </div>
        <div
          style={{
            marginTop: "0.2rem",
            fontFamily: fontStacks.body,
            fontSize: "0.86rem",
            lineHeight: 1.45,
            color: colors.text_dim,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {r.name ? (
            <span style={{ color: colors.text }}>{r.name}</span>
          ) : (
            <span style={{ fontStyle: "italic" }}>name not printed</span>
          )}
          {(place || r.zip) && (
            <>
              {" · "}
              {place}
              {place && r.zip ? " " : ""}
              {r.zip}
            </>
          )}
        </div>
      </div>

      {/* Right: distance badge + last-seen year */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "0.3rem",
        }}
      >
        <DistanceBadge mi={r.distance_mi} />
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.62rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: colors.text_dim,
            whiteSpace: "nowrap",
          }}
        >
          last seen {r.last_seen_year}
        </span>
      </div>
    </li>
  );
}

/** Clickable example-query chips shown in idle + error states. */
function ExampleChips({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        justifyContent: "center",
      }}
    >
      {EXAMPLES.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => onPick(ex)}
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
            color: colors.text_dim,
            background: "transparent",
            border: `1px dashed ${colors.border}`,
            borderRadius: 2,
            padding: "0.45rem 0.8rem",
            cursor: "pointer",
            transition: "color 150ms ease, border-color 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.accent;
            e.currentTarget.style.borderColor = colors.accent_2;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.text_dim;
            e.currentTarget.style.borderColor = colors.border;
          }}
        >
          {ex}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main island
// ---------------------------------------------------------------------------

export default function NearbyExplorer({
  initialQuery,
}: {
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<NearbyReady | null>(null);
  const [etaS, setEtaS] = useState<number | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Monotonic run id — any submit/unmount invalidates in-flight polls.
  const runIdRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function run(rawQ: string) {
    const q = rawQ.trim();
    if (!q) return;
    const id = ++runIdRef.current;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setPhase("loading");
    setData(null);
    setPollCount(0);
    setEtaS(null);

    // Keep the URL shareable without a router nav (no island remount).
    try {
      window.history.replaceState(null, "", `/nearby?q=${encodeURIComponent(q)}`);
    } catch {
      /* history not writable — cosmetic only */
    }

    let attempts = 0;

    const attempt = async () => {
      try {
        const res = await fetch(
          `/api/nearby?q=${encodeURIComponent(q)}&limit=${LIMIT}`,
          { cache: "no-store" },
        );
        if (runIdRef.current !== id) return;
        if (res.status === 400) {
          setPhase("bad-query");
          return;
        }
        if (res.status === 404) {
          setPhase("not-found");
          return;
        }
        if (!res.ok) {
          setPhase("error");
          return;
        }
        const json = (await res.json()) as NearbyResponse;
        if (runIdRef.current !== id) return;

        if (!json.index_ready) {
          attempts += 1;
          setEtaS(json.eta_s);
          setPollCount(attempts);
          if (attempts >= MAX_POLLS) {
            setPhase("build-timeout");
            return;
          }
          setPhase("building");
          timerRef.current = window.setTimeout(attempt, POLL_MS);
          return;
        }

        setData(json);
        setPhase("results");
      } catch {
        if (runIdRef.current === id) setPhase("error");
      }
    };

    void attempt();
  }

  // ?q= deep link: auto-run once on mount (island is keyed by initialQuery).
  useEffect(() => {
    if (initialQuery) run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickExample(ex: string) {
    setQuery(ex);
    run(ex);
  }

  // Group results into range rings — only non-empty rings render.
  const ringGroups = useMemo(() => {
    if (!data) return [];
    return RINGS.map((ring) => ({
      ring,
      rows: data.results.filter((r) => ring.test(r.distance_mi)),
    })).filter((g) => g.rows.length > 0);
  }, [data]);

  return (
    <section aria-label="Nearby ham search">
      {/* Scoped keyframes for the warm-up sweep + result reveal. */}
      <style>{`
        @keyframes nearby-pulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.35); }
        }
        @keyframes nearby-ring-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes nearby-rise {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nearby-anim { animation: none !important; }
        }
      `}</style>

      {/* ------------------------------------------------------------------ */}
      {/* Search form                                                         */}
      {/* ------------------------------------------------------------------ */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: "0.6rem",
          width: "100%",
        }}
      >
        <label htmlFor="nearby-q" style={{ position: "absolute", left: -9999 }}>
          ZIP code, city, or address
        </label>
        <input
          id="nearby-q"
          name="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`80301 · Boulder, CO · 225 Main St, Newington, CT`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "0.95rem 1.1rem",
            background: colors.surface,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderBottom: `2px solid ${colors.accent}`,
            borderRadius: "0.25rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.95rem",
            letterSpacing: "0.03em",
            outline: "none",
            caretColor: colors.accent,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderBottomColor = colors.glow;
            e.currentTarget.style.boxShadow = `0 4px 24px -8px ${colors.accent}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderBottomColor = colors.accent;
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <button
          type="submit"
          disabled={phase === "loading" || phase === "building"}
          style={{
            padding: "0 1.3rem",
            background: colors.accent,
            color: colors.bg,
            border: "none",
            borderRadius: "0.25rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.75rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 600,
            cursor:
              phase === "loading" || phase === "building"
                ? "progress"
                : "pointer",
            opacity: phase === "loading" || phase === "building" ? 0.7 : 1,
            boxShadow: `0 0 14px -4px ${colors.glow}`,
            whiteSpace: "nowrap",
          }}
        >
          Sweep
        </button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* State panels                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginTop: "1.5rem" }}>
        {phase === "idle" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.9rem",
              padding: "2rem 1rem",
              border: `1px dashed ${colors.border}`,
              borderRadius: 2,
              background: "rgba(255,163,11,0.02)",
            }}
          >
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.68rem",
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                color: colors.text_dim,
              }}
            >
              Standing by — try one of these
            </span>
            <ExampleChips onPick={pickExample} />
          </div>
        )}

        {phase === "loading" && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.7rem",
              padding: "1.4rem 1rem",
              justifyContent: "center",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: colors.text_dim,
            }}
          >
            <span
              aria-hidden
              className="nearby-anim"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: colors.accent,
                boxShadow: `0 0 10px ${colors.glow}`,
                animation: "nearby-pulse 1.1s ease-in-out infinite",
              }}
            />
            Scanning the band…
          </div>
        )}

        {phase === "building" && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.8rem",
              padding: "2rem 1rem",
              border: `1px solid ${colors.border}`,
              borderRadius: 2,
              background: colors.surface,
            }}
          >
            {/* Rotating radar sweep over concentric rings */}
            <svg
              width="56"
              height="56"
              viewBox="0 0 56 56"
              aria-hidden
              style={{ display: "block" }}
            >
              <circle cx="28" cy="28" r="26" fill="none" stroke={colors.border} strokeWidth="1" />
              <circle cx="28" cy="28" r="17" fill="none" stroke={colors.border} strokeWidth="1" />
              <circle cx="28" cy="28" r="8" fill="none" stroke={colors.border} strokeWidth="1" />
              <circle cx="28" cy="28" r="2" fill={colors.accent} />
              <g
                className="nearby-anim"
                style={{
                  transformOrigin: "28px 28px",
                  animation: "nearby-ring-sweep 2.4s linear infinite",
                }}
              >
                <line
                  x1="28"
                  y1="28"
                  x2="28"
                  y2="3"
                  stroke={colors.glow}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              </g>
            </svg>
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.78rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              warming up the map index…
            </span>
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.68rem",
                letterSpacing: "0.08em",
                color: colors.text_dim,
                textAlign: "center",
              }}
            >
              first sweep builds the location index
              {etaS !== null ? ` · ready in ~${etaS}s` : ""} · poll{" "}
              {pollCount}/{MAX_POLLS}
            </span>
          </div>
        )}

        {phase === "build-timeout" && (
          <EmptyState
            eyebrow="QRX — Stand By"
            title="The index is still warming up"
            description="The location index is taking longer than expected to build. Give it a minute, then sweep again."
            action={
              <button
                type="button"
                onClick={() => run(query)}
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.75rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: colors.bg,
                  background: colors.accent,
                  border: "none",
                  borderRadius: 2,
                  padding: "0.6rem 1.2rem",
                  cursor: "pointer",
                }}
              >
                Sweep again
              </button>
            }
          />
        )}

        {phase === "bad-query" && (
          <EmptyState
            eyebrow="No Fix"
            title="Can't read that location"
            description={
              <>
                That didn&rsquo;t parse as a US location — try a 5-digit ZIP
                or a <strong style={{ color: colors.text }}>City, ST</strong>{" "}
                pair like &ldquo;Boulder, CO&rdquo;.
              </>
            }
            action={<ExampleChips onPick={pickExample} />}
          />
        )}

        {phase === "not-found" && (
          <EmptyState
            eyebrow="Off the Chart"
            title="Location not found"
            description={
              <>
                That ZIP or city isn&rsquo;t in the gazetteer — check the
                spelling, or try a ZIP or{" "}
                <strong style={{ color: colors.text }}>City, ST</strong>{" "}
                instead.
              </>
            }
            action={<ExampleChips onPick={pickExample} />}
          />
        )}

        {phase === "error" && (
          <EmptyState
            eyebrow="QSB — Signal Lost"
            title="The sweep failed"
            description="Something went wrong reaching the archive. Check your connection and try again."
            action={
              <button
                type="button"
                onClick={() => run(query)}
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.75rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: colors.bg,
                  background: colors.accent,
                  border: "none",
                  borderRadius: 2,
                  padding: "0.6rem 1.2rem",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            }
          />
        )}

        {phase === "results" && data && (
          <div
            className="nearby-anim"
            style={{ animation: "nearby-rise 400ms ease-out both" }}
          >
            {/* -------------------------------------------------------------- */}
            {/* Summary strip — dense / expanded / normal messaging             */}
            {/* -------------------------------------------------------------- */}
            <div
              style={{
                padding: "0.9rem 1rem",
                border: `1px solid ${colors.border}`,
                borderLeft: `3px solid ${colors.accent}`,
                borderRadius: 2,
                background: "rgba(255,163,11,0.04)",
              }}
            >
              <div
                style={{
                  fontFamily: fontStacks.body,
                  fontSize: "0.95rem",
                  lineHeight: 1.5,
                  color: colors.text,
                }}
              >
                {data.dense ? (
                  <>
                    Showing the{" "}
                    <strong style={{ color: colors.accent }}>
                      {data.results.length}
                    </strong>{" "}
                    closest of{" "}
                    <strong style={{ color: colors.accent }}>
                      {data.total_in_radius.toLocaleString()}
                    </strong>{" "}
                    hams within 10 mi
                  </>
                ) : data.expanded ? (
                  <>
                    Only{" "}
                    <strong style={{ color: colors.accent }}>
                      {data.results.length}
                    </strong>{" "}
                    hams nearby — expanded to{" "}
                    <strong style={{ color: colors.accent }}>
                      {fmtRadius(data.radius_mi)} mi
                    </strong>{" "}
                    to show the nearest.
                  </>
                ) : (
                  <>
                    <strong style={{ color: colors.accent }}>
                      {data.total_in_radius.toLocaleString()}
                    </strong>{" "}
                    hams within{" "}
                    <strong style={{ color: colors.accent }}>
                      {fmtRadius(data.radius_mi)} mi
                    </strong>
                  </>
                )}
              </div>
              <div
                style={{
                  marginTop: "0.35rem",
                  fontFamily: fontStacks.mono,
                  fontSize: "0.68rem",
                  letterSpacing: "0.08em",
                  color: colors.text_dim,
                }}
              >
                Centered on {describeCenter(data.query)} ·{" "}
                {fmtLatLon(data.query.lat, data.query.lon)}
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Ring groups                                                     */}
            {/* -------------------------------------------------------------- */}
            {data.results.length === 0 ? (
              <div style={{ marginTop: "1.25rem" }}>
                <EmptyState
                  eyebrow="Nothing Heard"
                  title="No hams on the chart"
                  description={`No archived callsigns with a mappable ZIP within ${fmtRadius(
                    data.radius_mi,
                  )} mi of ${describeCenter(data.query)}. Try a bigger town nearby.`}
                />
              </div>
            ) : (
              ringGroups.map(({ ring, rows }) => (
                <div key={ring.key}>
                  <RingHeader
                    label={ring.label}
                    color={ring.color}
                    count={rows.length}
                  />
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    {rows.map((r) => (
                      <ResultRow
                        key={`${r.callsign}-${r.zip}`}
                        r={r}
                        ringColor={ring.color}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
