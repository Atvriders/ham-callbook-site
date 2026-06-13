/**
 * Shared TypeScript types for the ham-callbook API contract.
 *
 * The FastAPI backend serializes Pydantic v2 models whose shapes match
 * these interfaces. Frontend code (server components, client fetchers,
 * search UI) imports from this file; if you add a field on the backend,
 * mirror it here in the same PR.
 */

// ---------------------------------------------------------------------------
// Core record — one row in the `entries` table after FTS5 enrichment.
// ---------------------------------------------------------------------------

/**
 * A single callbook line item. One physical printed line in one edition.
 *
 * `raw_ocr` is the verbatim OCR text for that line, kept so the UI can
 * fall back to it when a structured field is null or obviously garbled.
 *
 * `flag` is the data-quality flag emitted by the Data phase (`'ok'`,
 * `'low_conf'`, `'corrected'`, `'manual'`, etc.) and is `null` when no
 * flag has been assigned.
 *
 * `source` identifies the upstream provenance of the record — typically
 * `'callbook'` for the bulk corpus, `'uls'` for FCC ULS-anchored rows,
 * or `'corrected'` for rows fixed by the 3-way correction pass.
 */
export interface Entry {
  year: number;
  edition: string;
  callsign: string;
  license_class: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  raw_ocr: string | null;
  flag: string | null;
  source: string;
}

// ---------------------------------------------------------------------------
// Callsign history — per-edition appearances of one callsign.
// ---------------------------------------------------------------------------

/**
 * One row of the `callsign_history` view: the operator who held a given
 * callsign in a given edition, with the source-quality grade attached
 * (e.g. `'A'`=ULS-anchored, `'B'`=high-confidence OCR, `'C'`=low OCR).
 */
export interface CallsignHistoryItem {
  year: number;
  edition: string;
  name: string | null;
  city: string | null;
  state: string | null;
  license_class: string | null;
  source_quality?: "A" | "B" | "C" | "D" | string;
}

/**
 * A "holder" cluster — the set of editions where the same operator
 * appears to have held the callsign, grouped by inferred identity.
 * `years` is sorted ascending and may be sparse (e.g. [1936, 1937, 1947]
 * when there was a wartime gap).
 */
export interface HolderCluster {
  name: string;
  years: number[];
  state?: string;
  city?: string;
}

/**
 * Aggregate response for /callsign/{callsign}/holders — answers the
 * question "who has held this callsign across the 20th century?".
 */
export interface HoldersHistoryResult {
  callsign: string;
  /** total rows in `entries` for this callsign across all editions */
  total_appearances: number;
  /** estimate of distinct people who held the callsign (post-clustering) */
  distinct_holders: number;
  holders: HolderCluster[];
}

// ---------------------------------------------------------------------------
// Search — FTS5 results with facets.
// ---------------------------------------------------------------------------

/**
 * One match returned by /search. `kind` distinguishes the FTS column
 * that matched so the UI can route the click target appropriately
 * (callsign hit → callsign detail, name hit → operator detail, etc.).
 *
 * `score` is the FTS5 BM25 score, lower-is-better in SQLite's
 * convention; the backend may invert/normalize before returning.
 *
 * `snippet` is the FTS5 `snippet()` output with `<mark>` tags around
 * matched terms — safe to render as HTML after sanitization.
 */
export interface SearchHit {
  kind: "callsign" | "name" | "city";
  score: number;
  callsign: string;
  year: number;
  edition: string;
  name: string | null;
  city: string | null;
  state: string | null;
  snippet: string;
}

export interface SearchFacets {
  years: { year: number; count: number }[];
  states: { state: string; count: number }[];
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  facets: SearchFacets;
}

// ---------------------------------------------------------------------------
// Stats — corpus-level aggregates for the landing/marginalia panels.
// ---------------------------------------------------------------------------

export interface StatsResponse {
  total_entries: number;
  distinct_callsigns: number;
  /** rough distinct-holders estimate after name+location clustering */
  distinct_holders_est: number;
  per_year: { year: number; count: number }[];
  per_state: { state: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Live activity — optional cross-reference against modern HF networks.
// ---------------------------------------------------------------------------

export interface ActivitySpot {
  /** ISO-8601 timestamp of the spot */
  ts: string;
  /** mode reported by the spotter (FT8, CW, SSB, RTTY, ...) */
  mode: string;
  /** frequency in kHz */
  freq_khz: number;
  /** signal-to-noise ratio in dB */
  snr: number;
  /** spotter callsign */
  spotter: string;
  /** receiver location — typically a 4- or 6-char Maidenhead grid */
  rx_loc: string;
}

export interface ActivitySnapshot {
  callsign: string;
  spots: ActivitySpot[];
  /** ISO-8601 of the most recent spot across all sources, if any */
  last_seen?: string;
  source: "psk_reporter" | "rbn" | "none";
}

// ---------------------------------------------------------------------------
// FCC ULS — modern license database cross-reference (or null if not held).
// ---------------------------------------------------------------------------

export interface FccUlsRecord {
  callsign: string;
  /** ULS license status: 'A' active, 'C' cancelled, 'E' expired, ... */
  status: string;
  first_name: string | null;
  last_name: string | null;
  /** ISO-8601 date */
  grant_date: string | null;
  /** ISO-8601 date */
  expired_date: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Either an FCC ULS record or null when the callsign is not currently
 * held in the modern ULS database (e.g. a 1930s callsign that was never
 * re-issued).
 */
export type FccUlsLookup = FccUlsRecord | null;

// ---------------------------------------------------------------------------
// Clubs — the `clubs` / `club_callsigns` / `club_detections` triplet that
// the Data phase materialises by clustering club-shaped operator names.
// ---------------------------------------------------------------------------

/**
 * One row from the ``clubs`` table as projected by the discovery and
 * listing endpoints (``/api/clubs/search``, ``/api/clubs/by-letter``,
 * ``/api/clubs/notable``, and ``/api/club/{slug}/related``).
 *
 * ``slug`` is the URL-safe primary key in the ``clubs`` table and what
 * every other club endpoint takes as its path parameter. ``display_name``
 * is the human-readable form ("REDWOOD EMPIRE ARC"); ``normalized_name``
 * is intentionally omitted on the listing endpoints because it's only
 * useful when rendering a detail page.
 *
 * ``callsign_count`` is the DISTINCT-callsigns count attributed to this
 * club; ``appearance_count`` is the total (callsign x year) entry count,
 * so a club with one callsign that appeared in 30 editions has
 * ``callsign_count=1`` and ``appearance_count=30``. The "Notable Clubs"
 * rail sorts by ``appearance_count`` because that's a better proxy for
 * historical visibility than the raw callsign count.
 *
 * ``dominant_state`` / ``dominant_city`` are the most common location
 * across all attributed entries — useful for "clubs near you" and for
 * disambiguating identically-named clubs in different regions.
 *
 * ``club_type`` is the detected classification label (``'arc'``,
 * ``'radio club'``, ``'amateur radio association'``, ``'university'``,
 * etc.) emitted by ``app.integrations.club_detect``. Null when the
 * heuristic couldn't pin a label confidently.
 */
export interface ClubSummary {
  slug: string;
  display_name: string;
  callsign_count: number;
  appearance_count: number;
  first_year: number | null;
  last_year: number | null;
  dominant_state: string | null;
  dominant_city: string | null;
  club_type: string | null;
}

/**
 * One callsign in a club's roster (``club_callsigns`` row).
 *
 * ``first_year`` / ``last_year`` bracket the window in which the callsign
 * appeared *under this club's name*; the same callsign could of course
 * appear outside that window under a different (or no) club affiliation.
 *
 * ``location_summary`` is the most representative city/state string for
 * the (slug, callsign) pair — typically the dominant location across the
 * year window. It's pre-formatted for direct display ("Petaluma, CA").
 */
export interface ClubCallsign {
  callsign: string;
  first_year: number | null;
  last_year: number | null;
  appearance_count: number;
  location_summary: string | null;
}

/**
 * Full per-club detail returned by ``GET /api/club/{slug}``.
 *
 * Extends ``ClubSummary`` with the ``normalized_name`` (the lower-cased,
 * punctuation-stripped form used by the slug builder) and the complete
 * callsign roster nested inline. The roster is sorted by ``first_year``
 * ascending so the frontend can render a stable historical timeline
 * without re-sorting on the client.
 */
export interface ClubFull extends ClubSummary {
  normalized_name: string | null;
  callsigns: ClubCallsign[];
}

/**
 * One ``club_detections`` row returned by ``GET /api/club/{slug}/history``.
 *
 * Each row is one match of an ``entries`` row against the club detector,
 * carrying the raw OCR'd operator name (``raw_name``) so the frontend can
 * show "this is what the printed callbook said" alongside the cleaned-up
 * ``display_name``. ``year`` + ``edition`` + ``callsign`` together identify
 * the exact callbook line.
 */
export interface ClubHistoryItem {
  year: number | null;
  edition: string | null;
  callsign: string | null;
  city: string | null;
  state: string | null;
  raw_name: string | null;
}

// ---------------------------------------------------------------------------
// Defunct Clubs — precomputed artifact types for the Silent Keys feature.
// ---------------------------------------------------------------------------

/**
 * One callsign's fate as computed during defunct-club precompute.
 * - dead_missing: never in ULS (pre-digital era assignment)
 * - dead_expired: ULS status 'E'
 * - dead_cancelled: ULS status 'C' or 'T'
 * - reissued_individual: ULS status 'A' but reassigned to a person, not a club
 */
export type CallsignFate =
  | "dead_missing"
  | "dead_expired"
  | "dead_cancelled"
  | "reissued_individual";

export interface DefunctCallsignFate {
  callsign: string;
  fate: CallsignFate;
  uls_status: string | null;
}

/**
 * Era sub-class enum. Four buckets based on when the club last appeared.
 */
export type EraClass =
  | "pre_war"
  | "mid_century"
  | "incentive_licensing"
  | "post_boom";

/**
 * Summary row for the /clubs/defunct listing page.
 */
export interface DefunctClubSummary {
  slug: string;
  display_name: string;
  first_year: number | null;
  last_year: number | null;
  span_years: number;
  appearance_count: number;
  callsign_count: number;
  dominant_state: string | null;
  dominant_city: string | null;
  club_type: string | null;
  era_class: EraClass;
}

/**
 * Detail record for a single defunct club (embedded in the artifact).
 */
export interface DefunctClubDetail extends DefunctClubSummary {
  callsign_fates: DefunctCallsignFate[];
  years_silent: number;
}

/**
 * Facets returned alongside the listing.
 */
export interface DefunctFacets {
  by_state: Record<string, number>;
  by_era: Record<string, number>;
}

/**
 * Full paginated response from GET /api/clubs/defunct.
 */
export interface DefunctClubList {
  total: number;
  clubs: DefunctClubSummary[];
  facets: DefunctFacets;
}

/**
 * Meta response from GET /api/clubs/defunct/meta.
 */
export interface DefunctMeta {
  total: number;
  gap_years: number;
  generated: string;
}

/**
 * Reverse lookup payload from ``GET /api/callsign/{cs}/club``.
 *
 * Answers "is this callsign a known club?" with a flag and, when true,
 * the slug + display name + year range to link onward to the detail page.
 *
 * ``years`` follows the backend convention of a two-element
 * ``[first_year, last_year]`` array when both endpoints are known. When
 * only one bound is known we return a single-element array; when neither
 * is known we return ``[]``. The endpoint never 404s — a non-club
 * callsign comes back as ``{ is_club: false, years: [] }``.
 */
export interface CallsignClubInfo {
  is_club: boolean;
  club_slug: string | null;
  display_name: string | null;
  years: number[];
  club_type: string | null;
}
