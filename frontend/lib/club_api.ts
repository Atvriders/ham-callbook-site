/**
 * Typed fetch helpers for the club-related API surface.
 *
 * The FastAPI backend exposes three routers that together cover clubs:
 *
 *   * ``/api/clubs/*``       — listing + discovery (search, by-letter,
 *                              notable, types breakdown).
 *   * ``/api/club/{slug}/*`` — per-club detail, history, roster, related.
 *   * ``/api/callsign/{cs}/club`` — reverse lookup: is this callsign a club?
 *
 * Caddy fronts the backend and rewrites public ``/api/*`` paths to the
 * FastAPI service, so the frontend always talks to ``/api/...`` regardless
 * of whether it's running locally (Next dev server) or behind the proxy
 * in production.
 *
 * ``NEXT_PUBLIC_API_BASE`` overrides the base URL — useful when the
 * frontend is deployed to a different origin than the API (e.g. Vercel
 * preview deployments hitting the production API). When unset we use an
 * empty string so fetches are same-origin and Caddy handles the routing.
 *
 * Every helper here:
 *   * URL-encodes path/query components — slugs and callsigns can contain
 *     punctuation that would otherwise break the URL.
 *   * Omits empty/undefined query parameters so the FastAPI defaults kick
 *     in (rather than us forwarding ``?limit=undefined``).
 *   * Throws on non-2xx so callers can decide how to surface failures;
 *     the caller is responsible for wrapping in try/catch where needed.
 */

import type {
  CallsignClubInfo,
  ClubCallsign,
  ClubFull,
  ClubHistoryItem,
  ClubSummary,
} from "./types";

// ---------------------------------------------------------------------------
// Base URL + low-level fetch helper.
// ---------------------------------------------------------------------------

/**
 * Resolved API origin. Empty string means "same origin as the page", which
 * is the production deployment shape (Caddy proxies ``/api`` to FastAPI).
 */
const API_BASE: string = (
  process.env.NEXT_PUBLIC_API_BASE ?? ""
).replace(/\/+$/, "");

/**
 * Wire-level GET helper. Centralised so we have one place to add tracing,
 * cache headers, or auth in the future.
 *
 * @param path   API path beginning with ``/api/...``.
 * @param init   Optional ``fetch`` init overrides (e.g. ``cache``, ``next``).
 */
async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    // Default to no-store so server components don't accidentally cache
    // a stale roster. Pages that want ISR can pass `next: { revalidate }`.
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    // Surface the body when it's short — FastAPI returns ``{"detail": ...}``
    // which is the most useful thing to log when an endpoint 404s.
    let detail = "";
    try {
      const text = await res.text();
      detail = text.length > 512 ? `${text.slice(0, 512)}...` : text;
    } catch {
      // Body unreadable; swallow and fall through to the bare status.
    }
    throw new Error(
      `GET ${url} failed: ${res.status} ${res.statusText}${
        detail ? ` — ${detail}` : ""
      }`,
    );
  }

  return (await res.json()) as T;
}

/**
 * Build a query string from an object, dropping null/undefined values and
 * leaving the leading "?" off when there's nothing to emit.
 */
function qs(params: Record<string, string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.length === 0) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// /api/clubs/* — discovery + listing.
// ---------------------------------------------------------------------------

/**
 * Free-text club search via FTS5. When ``q`` is empty/omitted the backend
 * degrades to a "most-active clubs" browse so the page always has rows.
 */
export function clubsSearch(
  q?: string,
  limit?: number,
  offset?: number,
  init?: RequestInit,
): Promise<ClubSummary[]> {
  const query = qs({ q: q ?? null, limit, offset });
  return apiGet<ClubSummary[]>(`/api/clubs/search${query}`, init);
}

/**
 * Alphabetical browse. ``letter`` must be a single A-Z character; the
 * backend 400s on anything else, so we URL-encode but otherwise pass it
 * through verbatim.
 */
export function clubsByLetter(
  letter: string,
  init?: RequestInit,
): Promise<ClubSummary[]> {
  return apiGet<ClubSummary[]>(
    `/api/clubs/by-letter/${encodeURIComponent(letter)}`,
    init,
  );
}

/**
 * Top-N clubs by ``appearance_count`` — powers the "Notable Clubs" rail.
 */
export function clubsNotable(init?: RequestInit): Promise<ClubSummary[]> {
  return apiGet<ClubSummary[]>(`/api/clubs/notable`, init);
}

/**
 * Breakdown of clubs by detected ``club_type`` (e.g. 'arc', 'radio club').
 * Used for the "Browse by Type" facet on the clubs landing page.
 */
export function clubsTypes(
  init?: RequestInit,
): Promise<{ club_type: string; count: number }[]> {
  return apiGet<{ club_type: string; count: number }[]>(
    `/api/clubs/types`,
    init,
  );
}

// ---------------------------------------------------------------------------
// /api/club/{slug}/* — per-club detail.
// ---------------------------------------------------------------------------

/**
 * Headline club row + nested callsign roster ordered by first_year.
 * 404s when ``slug`` is unknown — caller should handle.
 */
export function club(slug: string, init?: RequestInit): Promise<ClubFull> {
  return apiGet<ClubFull>(`/api/club/${encodeURIComponent(slug)}`, init);
}

/**
 * Every per-entry detection for the club, chronologically ordered.
 * Returns ``[]`` (not 404) when the slug exists but has no detections —
 * matches the backend's contract.
 */
export function clubHistory(
  slug: string,
  init?: RequestInit,
): Promise<ClubHistoryItem[]> {
  return apiGet<ClubHistoryItem[]>(
    `/api/club/${encodeURIComponent(slug)}/history`,
    init,
  );
}

/**
 * Just the roster — same shape as ``ClubFull.callsigns`` but as a
 * standalone endpoint so the frontend can lazy-load without re-fetching
 * the headline row.
 */
export function clubCallsigns(
  slug: string,
  init?: RequestInit,
): Promise<ClubCallsign[]> {
  return apiGet<ClubCallsign[]>(
    `/api/club/${encodeURIComponent(slug)}/callsigns`,
    init,
  );
}

/**
 * Sibling clubs in the same ``dominant_state`` + ``club_type``. Backend
 * caps the limit at 50; we don't enforce it here so the server stays the
 * source of truth.
 */
export function clubRelated(
  slug: string,
  limit?: number,
  init?: RequestInit,
): Promise<ClubSummary[]> {
  const query = qs({ limit });
  return apiGet<ClubSummary[]>(
    `/api/club/${encodeURIComponent(slug)}/related${query}`,
    init,
  );
}

// ---------------------------------------------------------------------------
// /api/callsign/{cs}/club — reverse lookup.
// ---------------------------------------------------------------------------

/**
 * Is this callsign known to be a club station? Returns a flagged result
 * with optional slug + display name + year range when the answer is yes.
 * Never 404s — a non-club callsign comes back as ``{ is_club: false }``.
 */
export function callsignClub(
  cs: string,
  init?: RequestInit,
): Promise<CallsignClubInfo> {
  return apiGet<CallsignClubInfo>(
    `/api/callsign/${encodeURIComponent(cs)}/club`,
    init,
  );
}
