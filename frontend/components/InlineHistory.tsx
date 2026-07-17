"use client";

/**
 * InlineHistory — per-search-hit lazy history expander for /search.
 *
 * The /search results table is a server-rendered CSS grid whose "rows" are
 * `display: contents` anchors. This client island renders TWO extra grid
 * items per hit:
 *
 *   1. a chevron button cell (the per-hit "History" toggle), and
 *   2. — only while expanded — a full-width panel (`gridColumn: 1 / -1`)
 *      containing a compact printed-edition timeline
 *      (year · edition · place · state).
 *
 * Data is fetched lazily from `GET /api/callsign/{cs}/history` (which
 * returns a bare `CallsignHistoryItem[]` — see backend
 * app/routes/callsign.py) on FIRST expand only, and memoised in a
 * module-level promise cache so duplicate callsigns on the same page
 * share one request. Nothing is fetched until the user expands a row —
 * the search page stays fast.
 *
 * A page-level master toggle (`HistoryMasterToggle`) broadcasts a window
 * CustomEvent that every mounted InlineHistory listens for, so "Show
 * history" expands (and fetches) all visible rows without the server page
 * needing a shared client parent.
 *
 * Aesthetic: Sodium Vapor (locked) — tokens from lib/design.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { colors, fontStacks } from "../lib/design";

// ---------------------------------------------------------------------------
// Types + fetch cache.
// ---------------------------------------------------------------------------

/** Mirrors the backend `CallsignHistoryItem` Pydantic model (fields we use). */
export interface InlineHistoryItem {
  callsign: string;
  year: number;
  edition: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  license_class: string | null;
  /** One-off state outlier sandwiched by an agreeing pair — likely OCR misread. */
  state_suspect?: boolean;
  state_consensus?: string | null;
}

/** Window event the master toggle broadcasts. detail: {expanded: boolean}. */
export const HISTORY_TOGGLE_ALL_EVENT = "ham:history-toggle-all";

/**
 * Module-level promise cache: the same callsign can appear in several rows
 * of one results page (different editions) — they share a single request.
 * `null` = fetch failed (retryable next mount), `[]` = genuinely no rows.
 */
const historyCache = new Map<string, Promise<InlineHistoryItem[] | null>>();

function fetchHistory(callsign: string): Promise<InlineHistoryItem[] | null> {
  const key = callsign.toUpperCase();
  let pending = historyCache.get(key);
  if (!pending) {
    pending = fetch(`/api/callsign/${encodeURIComponent(key)}/history`, {
      headers: { Accept: "application/json" },
    })
      .then((res) => {
        // 404 = not in the printed corpus at all — render as "no records".
        if (res.status === 404) return [] as InlineHistoryItem[];
        if (!res.ok) return null;
        return res.json() as Promise<InlineHistoryItem[]>;
      })
      .catch(() => null);
    historyCache.set(key, pending);
    // Don't cache failures — allow a retry on the next expand.
    void pending.then((items) => {
      if (items === null) historyCache.delete(key);
    });
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Shared style fragments.
// ---------------------------------------------------------------------------

const MONO_MICRO: React.CSSProperties = {
  fontFamily: fontStacks.mono,
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
};

// ---------------------------------------------------------------------------
// InlineHistory — chevron cell + expandable timeline panel.
// ---------------------------------------------------------------------------

export default function InlineHistory({ callsign }: { callsign: string }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<InlineHistoryItem[] | null | undefined>(
    undefined, // undefined = not loaded yet; null = load failed
  );
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    void fetchHistory(callsign).then((result) => {
      loadingRef.current = false;
      if (!mountedRef.current) return;
      setItems(result);
      setLoading(false);
    });
  }, [callsign]);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && items === undefined) load();
      return next;
    });
  }, [items, load]);

  // Master "Show history" toggle broadcasts to every mounted row.
  useEffect(() => {
    const onToggleAll = (e: Event) => {
      const wantExpanded = Boolean(
        (e as CustomEvent<{ expanded?: boolean }>).detail?.expanded,
      );
      setExpanded(wantExpanded);
      if (wantExpanded) load();
    };
    window.addEventListener(HISTORY_TOGGLE_ALL_EVENT, onToggleAll);
    return () =>
      window.removeEventListener(HISTORY_TOGGLE_ALL_EVENT, onToggleAll);
  }, [load]);

  // Retry path: user re-expands after a failed load.
  useEffect(() => {
    if (expanded && items === null && !loadingRef.current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <>
      {/* Chevron cell — sits OUTSIDE the row's <a> so clicking it never
          navigates. Styled to match the sibling grid cells. */}
      <div
        style={{
          padding: "0.45rem 0.4rem",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} printed-edition history for ${callsign}`}
          title={`${expanded ? "Hide" : "Show"} edition history`}
          style={{
            width: "1.6rem",
            height: "1.6rem",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: expanded ? "rgba(255, 163, 11, 0.12)" : "transparent",
            border: `1px solid ${expanded ? colors.accent_2 : colors.border}`,
            borderRadius: "0.2rem",
            color: expanded ? colors.accent : colors.text_dim,
            cursor: "pointer",
            padding: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              fontSize: "0.7rem",
              lineHeight: 1,
              transition: "transform 180ms ease",
              transform: expanded ? "rotate(90deg)" : "none",
            }}
          >
            ▸
          </span>
        </button>
      </div>

      {/* Expanded panel — spans the full grid width. */}
      {expanded ? (
        <div
          style={{
            gridColumn: "1 / -1",
            borderBottom: `1px solid ${colors.border}`,
            borderLeft: `2px solid ${colors.accent_2}`,
            background:
              "linear-gradient(180deg, rgba(255,163,11,0.045) 0%, rgba(19,26,45,0.35) 100%)",
            padding: "0.6rem 1rem 0.7rem 1.25rem",
          }}
        >
          {loading || items === undefined ? (
            <div style={{ ...MONO_MICRO, color: colors.text_dim }}>
              ·—· tuning the archive…
            </div>
          ) : items === null ? (
            <div style={{ ...MONO_MICRO, color: colors.danger }}>
              History unavailable — collapse and re-expand to retry.
            </div>
          ) : items.length === 0 ? (
            <div style={{ ...MONO_MICRO, color: colors.text_dim }}>
              No printed-edition records for {callsign}.
            </div>
          ) : (
            <HistoryTimeline callsign={callsign} items={items} />
          )}
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Compact timeline — year · edition · place · state, one line per edition.
// ---------------------------------------------------------------------------

function HistoryTimeline({
  callsign,
  items,
}: {
  callsign: string;
  items: InlineHistoryItem[];
}) {
  const first = items[0]?.year;
  const last = items[items.length - 1]?.year;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "0.35rem",
        }}
      >
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.58rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: colors.accent,
          }}
        >
          Printed history · {callsign}
        </span>
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.6rem",
            letterSpacing: "0.15em",
            color: colors.text_dim,
            whiteSpace: "nowrap",
          }}
        >
          {items.length} edition{items.length === 1 ? "" : "s"}
          {first !== undefined && last !== undefined
            ? ` · ${first === last ? first : `${first}–${last}`}`
            : ""}
        </span>
      </div>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxHeight: "15rem",
          overflowY: "auto",
        }}
      >
        {items.map((it, i) => {
          const place = (it.city ?? "").trim();
          const suspect = Boolean(it.state_suspect && it.state_consensus);
          return (
            <li
              key={`${it.year}-${it.edition ?? ""}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "3.2rem minmax(6rem, 9rem) minmax(0, 1fr) 3.5rem",
                gap: "0.75rem",
                alignItems: "baseline",
                padding: "0.18rem 0",
                borderBottom:
                  i < items.length - 1
                    ? `1px dashed rgba(42, 51, 73, 0.6)`
                    : "none",
              }}
            >
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.74rem",
                  color: colors.accent,
                }}
              >
                {it.year}
              </span>
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.62rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: colors.text_dim,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {it.edition ?? "—"}
              </span>
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.72rem",
                  color: colors.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {place || "—"}
              </span>
              {suspect ? (
                <span
                  title={
                    `This edition printed "${it.state}", but the surrounding ` +
                    `editions agree on "${it.state_consensus}" — the printed ` +
                    `value is likely an OCR misread.`
                  }
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.7rem",
                    color: colors.text_dim,
                    fontStyle: "italic",
                    textAlign: "right",
                    cursor: "help",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span aria-hidden style={{ color: colors.accent }}>
                    ⚠{" "}
                  </span>
                  {it.state_consensus}?
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: fontStacks.mono,
                    fontSize: "0.72rem",
                    color: colors.text_dim,
                    textAlign: "right",
                    letterSpacing: "0.1em",
                  }}
                >
                  {(it.state ?? "").trim() || "—"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryMasterToggle — page-level "Show history" broadcast button.
// ---------------------------------------------------------------------------

export function HistoryMasterToggle() {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      window.dispatchEvent(
        new CustomEvent(HISTORY_TOGGLE_ALL_EVENT, {
          detail: { expanded: next },
        }),
      );
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={expanded}
      title={
        expanded
          ? "Collapse every row's edition history"
          : "Expand the edition history under every visible result"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45em",
        padding: "0.35rem 0.7rem",
        background: expanded ? "rgba(255, 163, 11, 0.12)" : "transparent",
        border: `1px solid ${expanded ? colors.accent : colors.border}`,
        borderRadius: "0.2rem",
        color: expanded ? colors.accent : colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.62rem",
        fontWeight: 600,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          fontSize: "0.75em",
          transition: "transform 180ms ease",
          transform: expanded ? "rotate(90deg)" : "none",
        }}
      >
        ▸
      </span>
      {expanded ? "Hide history" : "Show history"}
    </button>
  );
}
