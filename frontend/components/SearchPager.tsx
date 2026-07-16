"use client";

/**
 * SearchPager — client-side pagination + sort controls for /search.
 *
 * The /search route is a server component whose URL state is owned by
 * ``buildHref()`` in app/search/page.tsx. Functions can't cross the
 * server→client boundary, so this file mirrors that helper's URL shape
 * exactly (`buildSearchHref` below): defaults are omitted (page=1,
 * per=25, sort=score) and params appear in the same q/year/state/
 * edition/sort/page/per order.
 *
 * Exports
 *   - default ``SearchPager`` — windowed page strip (wraps
 *     components/Pagination.tsx) + "page N of M · rows" meta line.
 *   - ``SearchSortSelect``    — sort dropdown that rewrites ?sort= and
 *     resets to page 1.
 *   - ``RetrySearchLink``     — used by app/not-found.tsx: reads the last
 *     path segment of the current URL and links to /search?q={segment},
 *     so a dead /callsign/K3XYZ URL retries "K3XYZ" instead of landing
 *     on a blank search page.
 *
 * Aesthetic: Sodium Vapor (locked) — tokens from lib/design.ts.
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import Pagination from "@/components/Pagination";
import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// URL building — mirrors buildHref() in app/search/page.tsx.
// ---------------------------------------------------------------------------

/** Default page size — must match DEFAULT_PER_PAGE in app/search/page.tsx. */
const DEFAULT_PER_PAGE = 25;

/** Serializable subset of the /search URL state. */
export interface SearchUrlParams {
  q?: string;
  year?: number;
  state?: string;
  edition?: string;
  sort?: string;
  per?: number;
}

function buildSearchHref(params: SearchUrlParams, page: number): string {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.year !== undefined) usp.set("year", String(params.year));
  if (params.state) usp.set("state", params.state);
  if (params.edition) usp.set("edition", params.edition);
  if (params.sort && params.sort !== "score") usp.set("sort", params.sort);
  if (page > 1) usp.set("page", String(page));
  if (params.per !== undefined && params.per !== DEFAULT_PER_PAGE)
    usp.set("per", String(params.per));
  const qs = usp.toString();
  return qs ? `/search?${qs}` : "/search";
}

// ---------------------------------------------------------------------------
// SearchPager
// ---------------------------------------------------------------------------

export interface SearchPagerProps {
  /** Current URL params (everything except page). */
  params: SearchUrlParams;
  /** 1-indexed current page. */
  page: number;
  /** Total page count (already clamped by the server page). */
  totalPages: number;
  /** Total row count, for the meta line. */
  total: number;
}

export default function SearchPager({
  params,
  page,
  totalPages,
  total,
}: SearchPagerProps) {
  const router = useRouter();

  const onPageChange = useCallback(
    (next: number) => {
      router.push(buildSearchHref(params, next));
    },
    [router, params],
  );

  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Results pagination"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.75rem 1rem",
        marginTop: "2rem",
        paddingTop: "1.25rem",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.7rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        Page{" "}
        <span style={{ color: colors.accent }}>
          {page.toString().padStart(3, "0")}
        </span>{" "}
        of {totalPages.toString().padStart(3, "0")} · {total.toLocaleString()}{" "}
        rows
      </span>
      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// SearchSortSelect
// ---------------------------------------------------------------------------

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "score", label: "relevance" },
  { value: "year", label: "year ↑" },
  { value: "year_desc", label: "year ↓" },
  { value: "callsign", label: "callsign a–z" },
];

export interface SearchSortSelectProps {
  /** Current URL params (sort inside is ignored; ``sort`` prop wins). */
  params: SearchUrlParams;
  /** Currently active sort value. */
  sort: string;
}

export function SearchSortSelect({ params, sort }: SearchSortSelectProps) {
  const router = useRouter();

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        fontFamily: fontStacks.mono,
        fontSize: "0.62rem",
        letterSpacing: "0.25em",
        textTransform: "uppercase",
        color: colors.text_dim,
      }}
    >
      sort
      <select
        value={sort}
        aria-label="Sort results"
        onChange={(e) => {
          // Changing the sort always resets to page 1.
          router.push(
            buildSearchHref({ ...params, sort: e.target.value }, 1),
          );
        }}
        style={{
          background: colors.surface,
          color: colors.text,
          border: `1px solid ${colors.border}`,
          borderRadius: "0.15rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.72rem",
          letterSpacing: "0.06em",
          padding: "0.45rem 0.5rem",
          minHeight: 38,
          cursor: "pointer",
          outline: "none",
        }}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// RetrySearchLink — 404 recovery.
// ---------------------------------------------------------------------------

export interface RetrySearchLinkProps {
  /** Style passthrough so app/not-found.tsx keeps its SOS button design. */
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Link to /search that carries the term the visitor was trying to reach:
 * the last path segment of the current (404'd) URL, decoded and stripped
 * of slashes. Falls back to a bare /search link before hydration or when
 * the segment is unusable.
 */
export function RetrySearchLink({ style, children }: RetrySearchLinkProps) {
  const [term, setTerm] = useState<string>("");

  useEffect(() => {
    try {
      const path = window.location.pathname;
      const segment = path.split("/").filter((s) => s.length > 0).pop() ?? "";
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        /* malformed escape — use the raw segment */
      }
      decoded = decoded.replace(/\//g, "").trim();
      // Refuse absurdly long segments — they read as noise in a search box.
      if (decoded && decoded.length <= 64) setTerm(decoded);
    } catch {
      /* no window / opaque URL — keep the plain /search fallback */
    }
  }, []);

  const href = term ? `/search?q=${encodeURIComponent(term)}` : "/search";

  return (
    <a
      href={href}
      style={style}
      title={term ? `Search the archive for "${term}"` : undefined}
    >
      {children ?? "Retry search"}
    </a>
  );
}
