/**
 * Display formatters for the ham-callbook UI.
 *
 * Keep these pure and dependency-free — they're imported by both server
 * and client components and must be tree-shakeable.
 */

/**
 * Normalize a callsign for display: uppercase, trim, strip internal spaces.
 * Returns the empty string for null/undefined so JSX can render `{value}`
 * without a guard.
 *
 *   formatCallsign("  k6abc  ") → "K6ABC"
 *   formatCallsign(null)         → ""
 */
export function formatCallsign(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Format a year for display. Negative or implausible values fall back to
 * an em-dash so we never render `NaN` or `-1`.
 *
 *   formatYear(1936)  → "1936"
 *   formatYear(null)  → "—"
 */
export function formatYear(year: number | null | undefined): string {
  if (year === null || year === undefined) return "—";
  if (!Number.isFinite(year)) return "—";
  if (year < 1900 || year > 2100) return "—";
  return String(Math.trunc(year));
}

/**
 * Convert an OCR'd callbook name (typically ALL CAPS, comma-inverted) into
 * a presentable Title Case form. Keeps initials and short tokens uppercase
 * so "F. R. SMITH" → "F. R. Smith" rather than "F. R. Smith".
 *
 *   formatName("SMITH, JOHN A")     → "John A. Smith"
 *   formatName("HACKETT, F R")      → "F. R. Hackett"
 *   formatName(null)                → ""
 */
export function formatName(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  // Detect "LAST, FIRST MIDDLE" inversion and flip it.
  const commaIdx = trimmed.indexOf(",");
  let raw: string;
  if (commaIdx > 0) {
    const last = trimmed.slice(0, commaIdx).trim();
    const rest = trimmed.slice(commaIdx + 1).trim();
    raw = rest ? `${rest} ${last}` : last;
  } else {
    raw = trimmed;
  }

  return raw
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      // Already-uppercase 1-2 char tokens are likely initials → keep, append period if missing.
      const stripped = token.replace(/\.+$/, "");
      if (stripped.length <= 2 && stripped === stripped.toUpperCase()) {
        return stripped.length === 1 ? `${stripped}.` : token;
      }
      // Handle hyphenated and apostrophe-ized surnames.
      return stripped
        .toLowerCase()
        .replace(/(^|[\s'\-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(" ");
}

/**
 * Format a "City, ST" pair, gracefully omitting missing halves.
 *
 *   formatLocation("Petaluma", "CA") → "Petaluma, CA"
 *   formatLocation(null, "CA")        → "CA"
 *   formatLocation("Petaluma", null)  → "Petaluma"
 */
export function formatLocation(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  const c = city?.trim();
  const s = state?.trim().toUpperCase();
  if (c && s) return `${titleCaseSimple(c)}, ${s}`;
  if (c) return titleCaseSimple(c);
  if (s) return s;
  return "";
}

/** Lightweight Title Case helper for city names — used internally. */
function titleCaseSimple(value: string): string {
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => (/^\s+$/.test(part) || part === "-" ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/**
 * Format a count with thousands separators and a singular/plural noun.
 *
 *   formatCount(1)      → "1 entry"
 *   formatCount(12345)  → "12,345 entries"
 */
export function formatCount(
  n: number,
  singular = "entry",
  plural = "entries",
): string {
  const safe = Number.isFinite(n) ? Math.trunc(n) : 0;
  return `${safe.toLocaleString("en-US")} ${safe === 1 ? singular : plural}`;
}

/**
 * Convert an FTS5 snippet with `<mark>...</mark>` tags into a sanitized
 * fragment safe to render. We accept only `<mark>` and `</mark>` and HTML
 * escape everything else, so the result can flow into `dangerouslySetInnerHTML`.
 */
export function sanitizeSnippet(snippet: string | null | undefined): string {
  if (!snippet) return "";
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/&lt;mark&gt;/g, '<mark class="bg-transparent text-[color:var(--color-accent)] amber-glow-soft">')
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
