/**
 * Typed fetch wrappers for the FastAPI backend.
 *
 * Base URL precedence:
 *   1. `NEXT_PUBLIC_API_BASE`        — explicit override (e.g. for previews)
 *   2. `/api`                        — default (Caddy in prod, Next rewrite in dev)
 *
 * Every helper here returns the typed payload directly and throws an
 * `ApiError` on non-2xx — call sites decide whether to surface or swallow.
 */

import type {
  Entry,
  HoldersHistoryResult,
  CallsignHistoryItem,
  SearchResults,
  StatsResponse,
  ActivitySnapshot,
  FccUlsLookup,
} from "./types";

export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "/api";

/** Thrown when the API responds with a non-2xx status. */
export class ApiError extends Error {
  status: number;
  url: string;
  body?: unknown;
  constructor(message: string, status: number, url: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** Build a fully-qualified URL with optional query params (skip null/undef). */
function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${trimmed}`;
  if (!query) return url;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === "") continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Core JSON fetcher. Server components can pass `next: { revalidate }` and
 * client components can pass `cache: 'no-store'` via `init`.
 */
async function jsonFetch<T>(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
  init?: RequestInit,
): Promise<T> {
  const url = buildUrl(path, query);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        // ignore
      }
    }
    throw new ApiError(
      `API ${res.status} ${res.statusText} on ${url}`,
      res.status,
      url,
      body,
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchParams {
  q: string;
  year?: number;
  state?: string;
  limit?: number;
  offset?: number;
}

export function searchEntries(
  params: SearchParams,
  init?: RequestInit,
): Promise<SearchResults> {
  return jsonFetch<SearchResults>("/search", { ...params }, init);
}

// ---------------------------------------------------------------------------
// Callsign — detail, holders, history
// ---------------------------------------------------------------------------

export function getCallsignEntries(
  callsign: string,
  init?: RequestInit,
): Promise<Entry[]> {
  return jsonFetch<Entry[]>(`/callsign/${encodeURIComponent(callsign)}`, undefined, init);
}

export function getCallsignHistory(
  callsign: string,
  init?: RequestInit,
): Promise<CallsignHistoryItem[]> {
  return jsonFetch<CallsignHistoryItem[]>(
    `/callsign/${encodeURIComponent(callsign)}/history`,
    undefined,
    init,
  );
}

export function getCallsignHolders(
  callsign: string,
  init?: RequestInit,
): Promise<HoldersHistoryResult> {
  return jsonFetch<HoldersHistoryResult>(
    `/callsign/${encodeURIComponent(callsign)}/holders`,
    undefined,
    init,
  );
}

// ---------------------------------------------------------------------------
// Live cross-references — PSK Reporter / RBN / FCC ULS
// ---------------------------------------------------------------------------

export function getCallsignActivity(
  callsign: string,
  init?: RequestInit,
): Promise<ActivitySnapshot> {
  // FIX-C: backend exposes the unified live snapshot at /api/activity/{cs},
  // not /api/callsign/{cs}/activity. Adapting frontend to the backend contract.
  return jsonFetch<ActivitySnapshot>(
    `/activity/${encodeURIComponent(callsign)}`,
    undefined,
    init,
  );
}

export function getCallsignFcc(
  callsign: string,
  init?: RequestInit,
): Promise<FccUlsLookup> {
  // FIX-C: backend exposes the FCC ULS snapshot at /api/activity/{cs}/uls.
  return jsonFetch<FccUlsLookup>(
    `/activity/${encodeURIComponent(callsign)}/uls`,
    undefined,
    init,
  );
}

// ---------------------------------------------------------------------------
// Stats / editions
// ---------------------------------------------------------------------------

export function getStats(init?: RequestInit): Promise<StatsResponse> {
  return jsonFetch<StatsResponse>("/stats", undefined, init);
}

export interface EditionSummary {
  year: number;
  edition: string;
  entry_count: number;
}

export function getEditions(init?: RequestInit): Promise<EditionSummary[]> {
  // FIX-C: backend exposes the editions list under the browse router at
  // /api/browse/editions, not /api/editions.
  return jsonFetch<EditionSummary[]>("/browse/editions", undefined, init);
}

// ---------------------------------------------------------------------------
// Re-exports — convenience for call sites that want both helpers + types.
// ---------------------------------------------------------------------------

export type {
  Entry,
  HoldersHistoryResult,
  CallsignHistoryItem,
  SearchResults,
  StatsResponse,
  ActivitySnapshot,
  FccUlsLookup,
} from "./types";
