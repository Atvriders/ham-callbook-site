"use client";

/**
 * RecentCallsigns — "recently viewed" strip backed by localStorage.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Storage contract
 *   - Key: ``recent_callsigns`` — a JSON array of callsign strings,
 *     most-recent-first. The callsign detail page records visits via the
 *     exported ``recordRecent()`` helper; this component only ever reads
 *     (and clears) the list, so it degrades gracefully to rendering
 *     nothing when no page has recorded a visit yet.
 *   - Reads are fully defensive: malformed JSON, non-arrays, non-string
 *     members, and absent/blocked localStorage all collapse to ``[]``.
 *
 * Behaviour
 *   - Renders a labelled row of CallsignBadge links (max 8, most recent
 *     first) plus a quiet "clear" affordance. Self-hides (returns null)
 *     when the list is empty, so mounting it unconditionally is safe.
 *   - Listens for the ``storage`` event so a visit recorded in another
 *     tab refreshes the strip here too.
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";

import CallsignBadge from "@/components/CallsignBadge";
import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "recent_callsigns";
/** How many callsigns we keep in localStorage. */
const MAX_STORED = 24;
/** How many the strip shows. */
const MAX_SHOWN = 8;

/** Defensive read of the recent-callsigns list. Never throws. */
function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const cs = item.trim().toUpperCase();
      // Callsigns are short; anything longer is garbage we refuse to render.
      if (!cs || cs.length > 12 || seen.has(cs)) continue;
      seen.add(cs);
      out.push(cs);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Record a callsign visit. Exported for the callsign detail page (owned
 * by another module) to call on mount — most-recent-first, deduped,
 * capped at MAX_STORED. Safe to call in any environment; silently no-ops
 * when localStorage is unavailable.
 */
export function recordRecent(callsign: string): void {
  if (typeof window === "undefined") return;
  const cs = callsign.trim().toUpperCase();
  if (!cs || cs.length > 12) return;
  try {
    const next = [cs, ...readRecent().filter((c) => c !== cs)].slice(
      0,
      MAX_STORED,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage quota / privacy mode — ignore */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RecentCallsignsProps {
  /** Optional style passthrough for the root element (spacing, animation). */
  style?: CSSProperties;
  /** Eyebrow label. Defaults to "recently viewed". */
  label?: string;
}

export default function RecentCallsigns({
  style,
  label = "recently viewed",
}: RecentCallsignsProps) {
  const [calls, setCalls] = useState<string[]>([]);

  useEffect(() => {
    setCalls(readRecent());
    // Cross-tab sync — a visit recorded elsewhere refreshes this strip.
    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY || e.key === null) setCalls(readRecent());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setCalls([]);
  }, []);

  // Self-hide until the callsign page has recorded at least one visit.
  if (calls.length === 0) return null;

  return (
    <section
      aria-label="Recently viewed callsigns"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.5rem 0.6rem",
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.62rem",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: colors.text_dim,
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden style={{ color: colors.accent_2 }}>
          {motifs.morseDividers.tight}
        </span>{" "}
        &nbsp;{label}
      </span>
      {calls.slice(0, MAX_SHOWN).map((cs) => (
        <CallsignBadge
          key={cs}
          callsign={cs}
          href={`/callsign/${encodeURIComponent(cs)}`}
        />
      ))}
      <button
        type="button"
        onClick={clear}
        aria-label="Clear recently viewed callsigns"
        style={{
          background: "transparent",
          border: `1px solid ${colors.border}`,
          borderRadius: 2,
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.62rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          padding: "4px 8px",
          cursor: "pointer",
          transition: "color 120ms ease, border-color 120ms ease",
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
        clear
      </button>
    </section>
  );
}
