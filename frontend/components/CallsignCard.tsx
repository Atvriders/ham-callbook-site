/**
 * CallsignCard — compact display card for one callsign entry.
 *
 * Used in search results, browse pages, and "related" rails. Shows the
 * callsign in big mono with a sodium glow, the operator name + QTH in
 * editorial body type, and a strip of metadata (year, edition, license
 * class, source-quality grade) along the bottom in mono small-caps.
 *
 * The card is a Link to `/callsign/{callsign}` and gets a faint amber
 * border glow on hover — NOT a scale transform (the spec explicitly
 * forbids `hover:scale-105` for that reason).
 *
 * Server component — no client-side state is needed.
 */

import Link from "next/link";

import { colors, fontStacks, motifs } from "../lib/design";
import type { Entry } from "../lib/types";
import { cleanOCRName, cleanOCRCity, cleanOCRState, classLabelForCode } from "../lib/ocrClean";

interface CallsignCardProps {
  /**
   * The entry to render. Most fields are optional/nullable because OCR
   * doesn't always recover every column.
   */
  entry: Entry;
  /**
   * Optional source-quality grade pulled from the FTS layer (A/B/C/D).
   * When provided we surface it in the bottom-strip as a coloured pip.
   */
  sourceQuality?: "A" | "B" | "C" | "D" | string;
  /**
   * Pre-rendered FTS `snippet()` output. The backend emits text with
   * literal `<mark>…</mark>` wrappers around matched terms; everything
   * else is OCR'd text that may contain stray angle brackets or
   * ampersands. We HTML-escape everything except the `<mark>` tags
   * ourselves below (see `renderSnippet`) so it's safe to use even if
   * the API layer forgets to sanitize.
   */
  snippetHtml?: string;
  /**
   * Override the click target. Defaults to `/callsign/{callsign}`; the
   * search results page may override to a deeper link that preserves the
   * search query context for back-nav.
   */
  href?: string;
}

/**
 * Format a city/state pair for display, handling either being null.
 * Applies OCR cleanup to both fields before joining.
 * "Newington, CT" / "—, CT" / "Newington" / "" depending on what we have.
 */
function formatQth(city: string | null, state: string | null): string {
  const cleanCity = cleanOCRCity(city) || null;
  const cleanState = cleanOCRState(city, state) || null;
  if (cleanCity && cleanState) return `${cleanCity}, ${cleanState}`;
  if (cleanCity) return cleanCity;
  if (cleanState) return cleanState;
  return "";
}

/**
 * Render an FTS snippet safely. The backend wraps matched terms in
 * literal `<mark>…</mark>` tags but the OCR'd context between/around
 * those tags can contain raw `<`, `>`, `&` characters. We do the
 * sanitization ourselves rather than trusting upstream:
 *
 *   1. HTML-escape the entire string.
 *   2. Selectively un-escape ONLY the `<mark>` / `</mark>` tag pairs
 *      that we know the backend emits.
 *
 * The result is safe to feed `dangerouslySetInnerHTML` — anything else
 * the OCR pipeline might produce stays inert.
 */
function renderSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

/**
 * Pick a colour for the source-quality pip. A = success green,
 * B/C neutral, D danger. Falls back to dim text for unknown grades.
 */
function gradeColor(grade?: string): string {
  switch (grade) {
    case "A":
      return colors.success;
    case "B":
      return colors.accent;
    case "C":
      return colors.text_dim;
    case "D":
      return colors.danger;
    default:
      return colors.text_dim;
  }
}

export default function CallsignCard({
  entry,
  sourceQuality,
  snippetHtml,
  href,
}: CallsignCardProps) {
  const qth = formatQth(entry.city, entry.state);
  const target = href ?? `/callsign/${encodeURIComponent(entry.callsign)}`;

  return (
    <Link
      href={target}
      className="group block rounded-lg p-5 transition-colors duration-150"
      style={{
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
      }}
    >
      <article className="flex flex-col gap-3">
        {/* Header row: callsign + year tick */}
        <div className="flex items-baseline justify-between gap-4">
          <h3
            className="text-2xl sm:text-3xl"
            style={{
              fontFamily: fontStacks.mono,
              color: colors.accent,
              letterSpacing: "0.08em",
              textShadow: motifs.glow.textShadow,
              fontWeight: 500,
            }}
          >
            {entry.callsign}
          </h3>
          <span
            className="shrink-0 text-xs uppercase tracking-[0.2em]"
            style={{
              fontFamily: fontStacks.mono,
              color: colors.text_dim,
            }}
          >
            {entry.year}
            <span style={{ opacity: 0.5 }}> · {entry.edition}</span>
          </span>
        </div>

        {/* Body — name + QTH, or snippet when from search */}
        <div className="space-y-1">
          {snippetHtml ? (
            <p
              className="text-sm leading-snug"
              style={{ fontFamily: fontStacks.body, color: colors.text }}
              // HTML-escaped here; only literal <mark> tags survive.
              dangerouslySetInnerHTML={{ __html: renderSnippet(snippetHtml) }}
            />
          ) : (
            <>
              <p
                className="text-base leading-snug"
                style={{
                  fontFamily: fontStacks.display,
                  color: colors.text,
                  fontVariationSettings: '"opsz" 14',
                }}
              >
                {entry.name ? cleanOCRName(entry.name) || (
                  <span style={{ color: colors.text_dim, fontStyle: "italic" }}>
                    name unrecovered
                  </span>
                ) : (
                  <span style={{ color: colors.text_dim, fontStyle: "italic" }}>
                    name unrecovered
                  </span>
                )}
              </p>
              {qth ? (
                <p
                  className="text-sm"
                  style={{
                    fontFamily: fontStacks.body,
                    color: colors.text_dim,
                  }}
                >
                  {qth}
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Bottom strip: license class · source · grade */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[10px] uppercase tracking-[0.22em]"
          style={{
            fontFamily: fontStacks.mono,
            color: colors.text_dim,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          {entry.license_class ? (
            <span>
              class&nbsp;
              <span style={{ color: colors.text }}>{classLabelForCode(entry.license_class, entry.year)}</span>
            </span>
          ) : null}
          <span>
            src&nbsp;
            <span style={{ color: colors.text }}>{entry.source}</span>
          </span>
          {sourceQuality ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: gradeColor(sourceQuality) }}
              />
              grade&nbsp;
              <span style={{ color: gradeColor(sourceQuality) }}>
                {sourceQuality}
              </span>
            </span>
          ) : null}
          {entry.flag ? (
            <span style={{ color: colors.accent_2 }}>
              flag&nbsp;{entry.flag}
            </span>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
