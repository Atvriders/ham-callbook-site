/**
 * /callsign/[cs] — Callsign detail page.
 *
 * Server component. Fetches the historical record + nearby callsigns +
 * club reverse-lookup in parallel against the FastAPI service (Caddy
 * proxies /api/*). The "live activity" panel is rendered under
 * <Suspense> so a slow PSK Reporter / RBN / FCC ULS round-trip never
 * blocks the historical render.
 *
 * Aesthetic: Sodium Vapor (locked). This is the SHOWCASE page — the
 * detail view a user shares — so the editorial-magazine treatment is
 * cranked up:
 *
 *   - HERO            : character-by-character reveal of the callsign in
 *                       JetBrains Mono with per-glyph amber halo and a
 *                       polished-chassis floor reflection. Tube-radio
 *                       dial decorations flank the page edges (SVG knobs
 *                       and an S-meter).
 *   - HOLDER NAME     : Fraunces variable opsz cranked huge.
 *   - ASYMMETRIC GRID : wide left (timeline + appearances) + narrow
 *                       right rail (latest record card, license-class
 *                       pip, era tag, ProvenanceLine).
 *   - HOLDERS         : sits inside a "spectrum band" surround labelled
 *                       like a frequency dial (kHz ticks across the top).
 *   - ACTIVITY PANEL  : rendered as if on a CRT — green-on-black inner
 *                       frame, scan lines, a pulsing TUNING indicator.
 *   - DIVIDERS        : morse-code text divider between every section.
 *   - MOTION          : staggered entrance reveals choreographed by the
 *                       <Reveal/> client island; the rest of the page
 *                       stays server-rendered.
 *
 * Type stack:
 *   - Fraunces (variable opsz) for display / holder name
 *   - JetBrains Mono for the hero callsign and all tabular data
 *   - Geist Sans for body copy
 *
 * Aesthetic guardrails (per the design contract):
 *   - NO Inter, NO purple gradients, NO hover:scale-105.
 *   - All hex colours come from lib/design.ts — no hard-coded palette.
 */

import { Suspense } from "react";
import { notFound } from "next/navigation";

import { callsignClub } from "../../../lib/club_api";
import { colors, fontStacks, motifs } from "../../../lib/design";
import { cleanOCRName, cleanOCRCity, cleanOCRState, classLabelForCode } from "../../../lib/ocrClean";
import ClubBadge from "../../../components/ClubBadge";
import EraTag from "../../../components/EraTag";
import LicenseClassPip from "../../../components/LicenseClassPip";
import ProvenanceLine from "../../../components/ProvenanceLine";

import HeroCallsign from "./HeroCallsign";
import Reveal from "./Reveal";
import TuningKnob from "./TuningKnob";
import TuningIndicator from "./TuningIndicator";
import CiteThisRecord from "../../../components/CiteThisRecord";
import PrintedLineageCard, { type PrintedLineageResponse } from "../../../components/PrintedLineageCard";

// ---------------------------------------------------------------------------
// Local types — mirror the FastAPI response shapes for the endpoints this
// page consumes. We keep them inline (rather than extending lib/types.ts)
// because some of them — CallsignDetail, NearbyCallsigns, UnifiedActivity
// Snapshot — are page-local concerns that the rest of the frontend doesn't
// share yet.
// ---------------------------------------------------------------------------

interface CallsignLatest {
  callsign: string;
  year: number;
  edition: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  license_class: string | null;
}

interface StateTenure {
  state: string;
  first_year: number;
  last_year: number;
  editions_count: number;
}

interface LicenseClassPeriod {
  license_class: string;
  first_year: number;
  last_year: number;
  editions_count: number;
}

interface CallsignDetail {
  callsign: string;
  found: boolean;
  latest: CallsignLatest;
  first_seen_year: number;
  last_seen_year: number;
  editions_count: number;
  distinct_years: number;
  states_held: StateTenure[];
  license_class_progression: LicenseClassPeriod[];
}

interface CallsignHistoryItem {
  callsign: string;
  year: number;
  edition: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  license_class: string | null;
}

interface HolderGroup {
  holder_key: string;
  display_name: string;
  name_variants: string[];
  first_year: number;
  last_year: number;
  years: number[];
  editions_count: number;
  cities: string[];
  states: string[];
}

interface HoldersHistoryResult {
  callsign: string;
  distinct_holders: number;
  holders: HolderGroup[];
}

interface NearbyCallsign {
  callsign: string;
  distance: number;
  last_year: number;
  name: string | null;
  state: string | null;
}

interface NearbyCallsigns {
  callsign: string;
  prefix: string;
  suffix: string;
  nearby: NearbyCallsign[];
}

interface UnifiedActivitySpot {
  ts: string;
  mode: string | null;
  freq_khz: number | null;
  band: string | null;
  snr: number | null;
  spotter: string | null;
  rx_loc: string | null;
}

interface UnifiedFccLicense {
  callsign: string;
  full_name: string | null;
  status: string | null;
  status_label: string | null;
  is_active: boolean;
  grant_date: string | null;
}

interface UnifiedActivitySnapshot {
  callsign: string;
  source: "psk_reporter" | "rbn" | "fcc_uls" | "none" | string;
  found: boolean;
  fetched_at?: string;
  spot_count?: number;
  last_seen?: string | null;
  bands?: string[];
  modes?: string[];
  receivers?: string[];
  spots?: UnifiedActivitySpot[];
  license?: UnifiedFccLicense | null;
  sources?: Record<string, Record<string, unknown>>;
}

/**
 * Bare FccUlsRecord shape returned by /api/activity/{cs}/uls. Mirrors the
 * backend Pydantic model. `state` / `zip` / `expired_date` are not yet on
 * the server model but are referenced in the task spec — we declare them
 * optional so the hero degrades gracefully today and lights up the moment
 * the server starts emitting them.
 */
interface FccUlsRecord {
  callsign: string;
  first?: string | null;
  last?: string | null;
  full_name?: string | null;
  entity_name?: string | null;
  is_club?: boolean;
  status?: string | null;
  status_label?: string | null;
  is_active?: boolean;
  grant_date?: string | null;
  expired_date?: string | null;
  state?: string | null;
  zip?: string | null;
  source?: string;
}

interface QrzPublicProfile {
  callsign: string;
  source_url?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  license_class?: string | null;
  grid?: string | null;
  itu_zone?: number | string | null;
  cq_zone?: number | string | null;
  bio_snippet?: string | null;
  fetched_at?: number | null;
  cached?: boolean;
}

interface QrzEnvelope {
  callsign: string;
  found: boolean;
  source: string;
  profile?: QrzPublicProfile;
}

interface DistrictCompanion {
  callsign: string;
  companion: string | null;
  direction: 'renumbered_from' | 'continued_as' | 'w_prefix_added' | 'digit_predecessor' | null;
  companion_first_year: number | null;
  companion_last_year: number | null;
  companion_last_year_pre_reorg: number | null;
  reorg_year: number;
  basis: string | null;
}

// ---------------------------------------------------------------------------
// ULS chain types (new endpoint: /api/callsign/{cs}/uls_chain)
// ---------------------------------------------------------------------------

interface UlsLineage {
  prev_callsign: string | null;
  fwd_callsign:  string | null;
}

interface UlsLicenseRecord {
  usi:          string;
  holder:       string;
  status:       string;
  grant_date:   string | null;
  expired_date: string | null;
  cancel_date:  string | null;
}

interface UlsChain {
  callsign: string;
  records:  UlsLicenseRecord[];
  lineage:  UlsLineage;
}

/**
 * Resolved current holder used by the hero. `source` discriminates the
 * provenance chip; everything else is best-effort and may be missing.
 */
type CurrentHolderSource = "fcc_uls" | "qrz" | "archive" | "none";

interface CurrentHolder {
  source: CurrentHolderSource;
  /** Display name (already cleaned). Empty string means "no name known". */
  name: string;
  /** Raw FCC status code if source is fcc_uls (A/E/C/X). */
  status: string | null;
  /** Human-readable status label (Active / Expired / Cancelled / ...). */
  statusLabel: string | null;
  state: string | null;
  grantDate: string | null;
  expiredDate: string | null;
  zip: string | null;
  is_club: boolean;
  /** For source === 'archive', the year of the archive record. */
  archiveYear: number | null;
}

// ---------------------------------------------------------------------------
// API base + fetch helper (mirrors lib/club_api.ts behaviour).
// ---------------------------------------------------------------------------

const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(
  /\/+$/,
  "",
);

async function apiGet<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layout constants — keep one place to tune the asymmetric page rhythm.
// ---------------------------------------------------------------------------

/** Outer page padding + container clamp, applied per-section. */
const PAGE_CONTAINER: React.CSSProperties = {
  maxWidth: "min(110rem, 100%)",
  margin: "0 auto",
  padding: "0 2rem",
  position: "relative",
  zIndex: 2,
};

/** Wide-left + narrow-right rail grid. Mirrors motifs.asymmetricGrid. */
const TWO_COL: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 22rem)",
  gap: "2.5rem",
  alignItems: "start",
};

// ---------------------------------------------------------------------------
// Decorative shared bits (Scanlines, Grain, MorseDivider, era helper) —
// kept inline so the page is self-contained while the broader frontend
// hasn't extracted these into a /components folder yet. They mirror the
// look/feel locked into /clubs/page.tsx for visual consistency.
// ---------------------------------------------------------------------------

function Scanlines({ heavy = false }: { heavy?: boolean }) {
  const { opacity, spacingPx } = motifs.scanlines;
  // The CRT-mode (activity panel) variant uses a slightly stronger green
  // overlay; the hero variant uses the spec amber.
  const lineColor = heavy
    ? "rgba(93, 211, 168, 0.55)"
    : "rgba(255, 209, 102, 0.6)";
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: heavy ? 0.18 : opacity,
        backgroundImage: `repeating-linear-gradient(
          to bottom,
          ${lineColor} 0px,
          ${lineColor} 1px,
          transparent 1px,
          transparent ${spacingPx}px
        )`,
        mixBlendMode: "overlay",
      }}
    />
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

function MorseDivider({ label }: { label?: string }) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        margin: "3rem 0 2rem",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.35em",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
      {label ? (
        <span
          style={{
            flexShrink: 0,
            color: colors.accent,
            textShadow: "0 0 8px rgba(255,209,102,0.35)",
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        aria-hidden
        style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {motifs.morseDividers.pattern.repeat(6)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------

function yearSpan(first: number | null | undefined, last: number | null | undefined): string {
  const f = first ?? "—";
  const l = last ?? "—";
  if (f === l) return String(f);
  return `${f}–${l}`;
}

function joinNonEmpty(parts: (string | null | undefined)[], sep = ", "): string {
  return parts.filter((p) => p && p.length > 0).join(sep);
}

function formatDistance(d: number): string {
  if (d === 0) return "·";
  const sign = d > 0 ? "+" : "−";
  return `${sign}${Math.abs(d)}`;
}

/**
 * Render the holder name in title-case-ish form. The corpus name field is
 * usually printed in all-caps in the original callbook; we honour that for
 * the display string by leaving uppercase alone so it carries the period
 * feel, but collapse multi-space runs for safety.
 */
function cleanName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * QRZ's public page returns a literal "Login is required for additional
 * detail." placeholder for the name field when the scrape is unauthed.
 * Treat that — and any obvious sentinel — as "no name".
 */
function isUsableQrzName(raw: string | null | undefined): boolean {
  const n = cleanName(raw).toLowerCase();
  if (!n) return false;
  if (n.startsWith("login is required")) return false;
  if (n === "n/a" || n === "unknown") return false;
  return true;
}

const CLUB_KEYWORDS = /\b(club|arc|ares|races|amateur radio|society|assoc|league|univ|college|institute|school|scouts?|repeater|emergency|skywarn|mars|military|vfw|legion|radio assn)\b/i;
function isClubByName(name: string | null | undefined): boolean {
  return !!name && CLUB_KEYWORDS.test(name);
}

function cleanMergedAddress(addr: string | null | undefined): string | null | undefined {
  if (!addr || addr.length < 50) return addr;
  const m = addr.match(/\b([A-Z]{2})\s{1,5}([0-9bBlBoO&sS]{5})\b/);
  if (m && m.index !== undefined) {
    const cut = m.index + m[0].length;
    if (addr.slice(cut).trim().length > 20) return addr.slice(0, cut).trim();
  }
  return addr;
}

/**
 * Resolve the CURRENT holder for the hero, in priority order:
 *
 *   1. FCC ULS row whose status is one of {A, E} (Active or Expired-but-
 *      still-tracked-by-the-FCC) — authoritative current data.
 *   2. QRZ public scrape if it returned a non-placeholder name.
 *   3. Historical archive fallback — the most-recent callbook record we
 *      have. The hero then displays a "no current FCC license on file"
 *      banner with the archive year.
 */
function resolveCurrentHolder(
  uls: FccUlsRecord | null,
  qrz: QrzEnvelope | null,
  detail: CallsignDetail,
): CurrentHolder {
  const ulsStatus = (uls?.status ?? "").toUpperCase();
  if (uls && (ulsStatus === "A" || ulsStatus === "E")) {
    const composed =
      cleanName(uls.full_name) ||
      cleanName(joinNonEmpty([uls.first, uls.last], " "));
    return {
      source: "fcc_uls",
      name: composed,
      status: ulsStatus,
      statusLabel: uls.status_label ?? (ulsStatus === "A" ? "Active" : "Expired"),
      state: uls.state ?? null,
      grantDate: uls.grant_date ?? null,
      expiredDate: uls.expired_date ?? null,
      zip: uls.zip ?? null,
      is_club: uls?.is_club ?? false,
      archiveYear: null,
    };
  }

  if (qrz && qrz.found && qrz.profile && isUsableQrzName(qrz.profile.name)) {
    return {
      source: "qrz",
      name: cleanName(qrz.profile.name),
      status: null,
      statusLabel: "Listed on QRZ",
      state: qrz.profile.state ?? null,
      grantDate: null,
      expiredDate: null,
      zip: qrz.profile.zip ?? null,
      is_club: false,
      archiveYear: null,
    };
  }

  // Fall back to the archive's latest record.
  const archiveName = cleanName(detail.latest.name);
  return {
    source: archiveName ? "archive" : "none",
    name: archiveName,
    status: null,
    statusLabel: "No FCC record",
    state: cleanOCRState(detail.latest.city, detail.latest.state) || null,
    grantDate: null,
    expiredDate: null,
    zip: detail.latest.zip ?? null,
    is_club: false,
    archiveYear: detail.latest.year ?? detail.last_seen_year ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sub-components.
// ---------------------------------------------------------------------------

/**
 * Section header — small mono kicker over a Fraunces title with a tally
 * pill on the right. Used for every major page section so the rhythm is
 * legible at a glance even before the eye reaches the dividers.
 */
function SectionHeader({
  kicker,
  title,
  tally,
}: {
  kicker: string;
  title: string;
  tally?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "1.5rem",
        marginBottom: "1.25rem",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: colors.accent,
            marginBottom: "0.4rem",
          }}
        >
          {kicker}
        </div>
        <h2
          style={{
            fontFamily: fontStacks.display,
            fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
            fontWeight: 500,
            fontVariationSettings: '"opsz" 60',
            margin: 0,
            lineHeight: 1.05,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
      </div>
      {tally ? (
        <span
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: colors.text_dim,
            whiteSpace: "nowrap",
          }}
        >
          {tally}
        </span>
      ) : null}
    </div>
  );
}

/**
 * (a) Latest record — the most-recent callbook line, rendered in the
 * narrow right rail of the page's asymmetric grid alongside the license-
 * class pip and the era tag. The card itself is editorial: small mono
 * kicker, big Fraunces holder name, mono address block.
 */
function LatestRecordCard({ detail, isClub = false }: { detail: CallsignDetail; isClub?: boolean }) {
  const l = detail.latest;
  const addr = joinNonEmpty([l.address]);
  const cityLine = joinNonEmpty([cleanOCRCity(l.city), cleanOCRState(l.city, l.state), l.zip], " ");
  return (
    <section
      aria-labelledby="latest-heading"
      style={{
        position: "relative",
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: "1.5rem 1.75rem",
        borderRadius: "0.25rem",
      }}
    >
      {/* Tiny corner ticks — feels like a punched index card */}
      <CornerTicks />

      <div
        id="latest-heading"
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.65rem",
          fontWeight: 500,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: colors.accent,
          margin: "0 0 0.75rem",
        }}
      >
        Latest record · {l.edition ?? String(l.year)}
      </div>
      <div
        style={{
          fontFamily: fontStacks.display,
          fontSize: "1.6rem",
          fontWeight: 500,
          fontVariationSettings: '"opsz" 36',
          lineHeight: 1.15,
          color: colors.text,
        }}
      >
        {cleanOCRName(l.name) || "—"}
      </div>
      {addr ? (
        <div
          style={{
            marginTop: "0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            color: colors.text,
            letterSpacing: "0.02em",
          }}
        >
          {cleanMergedAddress(addr)}
        </div>
      ) : null}
      {cityLine ? (
        <div
          style={{
            marginTop: "0.125rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.85rem",
            color: colors.text_dim,
            letterSpacing: "0.04em",
          }}
        >
          {cityLine}
        </div>
      ) : null}

      {/* Marginalia tick figures, laid out as a compact two-column grid. */}
      <div
        style={{
          marginTop: "1.5rem",
          paddingTop: "1.25rem",
          borderTop: `1px dashed ${colors.border}`,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem 0.75rem",
        }}
      >
        <Marginal label="Year" value={String(l.year)} />
        <Marginal label="Class" value={classLabelForCode(l.license_class, l.year, isClub)} />
        <Marginal
          label="Editions"
          value={detail.editions_count.toString().padStart(3, "0")}
        />
        <Marginal
          label="Span"
          value={yearSpan(detail.first_seen_year, detail.last_seen_year)}
        />
      </div>

      <div
        style={{
          marginTop: "1.25rem",
          paddingTop: "1rem",
          borderTop: `1px dashed ${colors.border}`,
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          flexWrap: "wrap",
        }}
      >
        <LicenseClassPip licenseClass={l.license_class} size={22} />
        <EraTag year={l.year} />
      </div>

      <div style={{ marginTop: "1rem" }}>
        <ProvenanceLine
          source="Callbook"
          edition={l.edition}
          year={l.year}
          ocrPercent={null}
        />
      </div>
    </section>
  );
}

function Marginal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.6rem",
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "1.05rem",
          color: colors.accent,
          marginTop: "0.15rem",
          textShadow: "0 0 8px rgba(255,209,102,0.25)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Tiny absolutely-positioned crosshair ticks at the four corners of a
 * surface. Looks like the registration marks on a press sheet — gives
 * cards a printed/typeset feel without a heavy border.
 */
function CornerTicks() {
  const tick: React.CSSProperties = {
    position: "absolute",
    width: 10,
    height: 10,
    borderColor: colors.accent,
    borderStyle: "solid",
    opacity: 0.75,
  };
  return (
    <>
      <span
        aria-hidden
        style={{
          ...tick,
          top: -1,
          left: -1,
          borderWidth: "1px 0 0 1px",
        }}
      />
      <span
        aria-hidden
        style={{
          ...tick,
          top: -1,
          right: -1,
          borderWidth: "1px 1px 0 0",
        }}
      />
      <span
        aria-hidden
        style={{
          ...tick,
          bottom: -1,
          left: -1,
          borderWidth: "0 0 1px 1px",
        }}
      />
      <span
        aria-hidden
        style={{
          ...tick,
          bottom: -1,
          right: -1,
          borderWidth: "0 1px 1px 0",
        }}
      />
    </>
  );
}

/**
 * Spectrum band surround for the HoldersTimeline. Renders a thin amber
 * tick rail across the top with kHz-style major/minor ticks, anchoring
 * the timeline so it reads as a frequency dial rather than a generic
 * chart. The bar's start/end labels show the actual first/last years so
 * the dial is calibrated to the data, not decoration.
 */
function SpectrumBand({
  firstYear,
  lastYear,
  children,
}: {
  firstYear: number;
  lastYear: number;
  children: React.ReactNode;
}) {
  // Major ticks every 10 years, minor every 2.
  const span = Math.max(1, lastYear - firstYear);
  const majorYears: number[] = [];
  for (let y = Math.ceil(firstYear / 10) * 10; y <= lastYear; y += 10) {
    majorYears.push(y);
  }
  const minorYears: number[] = [];
  for (let y = Math.ceil(firstYear / 2) * 2; y <= lastYear; y += 2) {
    if (!majorYears.includes(y)) minorYears.push(y);
  }

  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${colors.border}`,
        background:
          "linear-gradient(180deg, rgba(255,163,11,0.04) 0%, rgba(19,26,45,0) 30%)",
        borderRadius: "0.25rem",
        padding: "0",
      }}
    >
      <CornerTicks />

      {/* Top dial rail */}
      <div
        style={{
          position: "relative",
          height: 38,
          borderBottom: `1px solid ${colors.border}`,
          padding: "0 1rem",
          display: "flex",
          alignItems: "center",
          background: "rgba(10,14,26,0.55)",
        }}
      >
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.6rem",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: colors.accent,
            marginRight: "1rem",
            whiteSpace: "nowrap",
            textShadow: "0 0 6px rgba(255,209,102,0.5)",
          }}
        >
          {firstYear} kc
        </div>
        <div
          style={{
            flex: 1,
            position: "relative",
            height: "100%",
          }}
        >
          {/* Major ticks */}
          {majorYears.map((y) => {
            const pct = ((y - firstYear) / span) * 100;
            return (
              <div
                key={`maj-${y}`}
                style={{
                  position: "absolute",
                  left: `${pct}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: colors.accent,
                  opacity: 0.85,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: 4,
                    transform: "translateY(-50%)",
                    fontFamily: fontStacks.mono,
                    fontSize: "0.55rem",
                    letterSpacing: "0.1em",
                    color: colors.text_dim,
                    whiteSpace: "nowrap",
                  }}
                >
                  {y}
                </span>
              </div>
            );
          })}
          {/* Minor ticks */}
          {minorYears.map((y) => {
            const pct = ((y - firstYear) / span) * 100;
            return (
              <div
                key={`min-${y}`}
                style={{
                  position: "absolute",
                  left: `${pct}%`,
                  bottom: 0,
                  height: 6,
                  width: 1,
                  background: colors.text_dim,
                  opacity: 0.35,
                }}
              />
            );
          })}
        </div>
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.6rem",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: colors.accent,
            marginLeft: "1rem",
            whiteSpace: "nowrap",
            textShadow: "0 0 6px rgba(255,209,102,0.5)",
          }}
        >
          {lastYear} kc
        </div>
      </div>

      {/* Inner timeline frame */}
      <div style={{ padding: "1.25rem 1rem 1rem" }}>{children}</div>
    </div>
  );
}

/**
 * (b) HoldersTimeline — one horizontal lane per distinct holder, with a
 * span bar across the years they held the call. Pure server-rendered SVG —
 * no chart library, fits the brutalist-data look.
 */
function HoldersTimeline({ holders }: { holders: HoldersHistoryResult }) {
  if (holders.holders.length === 0) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.85rem",
        }}
      >
        No holders identified. {motifs.morseDividers.tight}
      </div>
    );
  }

  const yMin = Math.min(...holders.holders.map((h) => h.first_year));
  const yMax = Math.max(...holders.holders.map((h) => h.last_year));
  const span = Math.max(1, yMax - yMin);

  const PX_PER_YEAR = 12;
  const ROW_H = 30;
  const PAD_LEFT = 220;
  const PAD_RIGHT = 40;
  const AXIS_H = 22;
  const W = PAD_LEFT + span * PX_PER_YEAR + PAD_RIGHT;
  const H = holders.holders.length * ROW_H + AXIS_H + 18;

  // Pick decade ticks for readability.
  const tickYears: number[] = [];
  for (let y = Math.ceil(yMin / 10) * 10; y <= yMax; y += 10) tickYears.push(y);
  if (tickYears[0] !== yMin) tickYears.unshift(yMin);
  if (tickYears[tickYears.length - 1] !== yMax) tickYears.push(yMax);

  return (
    <div style={{ overflowX: "auto", paddingBottom: "0.5rem" }}>
      <svg
        role="img"
        aria-label={`Holders timeline for ${holders.callsign}`}
        width={W}
        height={H}
        style={{ display: "block", minWidth: "100%" }}
      >
        {/* Decade gridlines */}
        {tickYears.map((y) => {
          const x = PAD_LEFT + (y - yMin) * PX_PER_YEAR;
          return (
            <line
              key={`grid-${y}`}
              x1={x}
              x2={x}
              y1={0}
              y2={holders.holders.length * ROW_H}
              stroke={colors.border}
              strokeDasharray="2 4"
              opacity={0.55}
            />
          );
        })}

        {/* One row per holder */}
        {holders.holders.map((h, i) => {
          const yTop = i * ROW_H;
          const x1 = PAD_LEFT + (h.first_year - yMin) * PX_PER_YEAR;
          const x2 = PAD_LEFT + (h.last_year - yMin) * PX_PER_YEAR + PX_PER_YEAR;
          const barY = yTop + ROW_H / 2 - 4;
          const barH = 8;
          return (
            <g key={h.holder_key}>
              {/* Name label, clipped within the left pad */}
              <text
                x={PAD_LEFT - 12}
                y={yTop + ROW_H / 2 + 4}
                textAnchor="end"
                fontFamily={fontStacks.display}
                fontSize={13}
                fill={colors.text}
              >
                {cleanOCRName(h.display_name).slice(0, 28)}
              </text>
              {/* Span bar */}
              <rect
                x={x1}
                y={barY}
                width={Math.max(4, x2 - x1)}
                height={barH}
                fill={colors.accent}
                opacity={0.9}
                rx={1}
              />
              {/* Year markers for sparse-year holders */}
              {h.years.map((yr) => {
                const cx = PAD_LEFT + (yr - yMin) * PX_PER_YEAR + PX_PER_YEAR / 2;
                return (
                  <circle
                    key={`${h.holder_key}-${yr}`}
                    cx={cx}
                    cy={barY + barH / 2}
                    r={2.2}
                    fill={colors.glow}
                  />
                );
              })}
              {/* First/last year flanks */}
              <text
                x={x1 - 6}
                y={yTop + ROW_H / 2 + 4}
                textAnchor="end"
                fontFamily={fontStacks.mono}
                fontSize={10}
                fill={colors.text_dim}
              >
                {h.first_year}
              </text>
              <text
                x={x2 + 6}
                y={yTop + ROW_H / 2 + 4}
                textAnchor="start"
                fontFamily={fontStacks.mono}
                fontSize={10}
                fill={colors.text_dim}
              >
                {h.last_year}
              </text>
            </g>
          );
        })}

        {/* Axis */}
        <line
          x1={PAD_LEFT}
          x2={W - PAD_RIGHT}
          y1={holders.holders.length * ROW_H + 4}
          y2={holders.holders.length * ROW_H + 4}
          stroke={colors.border}
        />
        {tickYears.map((y) => {
          const x = PAD_LEFT + (y - yMin) * PX_PER_YEAR;
          return (
            <g key={`tick-${y}`}>
              <line
                x1={x}
                x2={x}
                y1={holders.holders.length * ROW_H + 4}
                y2={holders.holders.length * ROW_H + 10}
                stroke={colors.border}
              />
              <text
                x={x}
                y={holders.holders.length * ROW_H + AXIS_H + 6}
                textAnchor="middle"
                fontFamily={fontStacks.mono}
                fontSize={10}
                fill={colors.text_dim}
              >
                {y}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * (c) All-editions table — one row per callbook appearance.
 */
function AppearancesTable({ history }: { history: CallsignHistoryItem[] }) {
  if (history.length === 0) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.85rem",
        }}
      >
        No appearances recorded.
      </div>
    );
  }

  return (
    <div
      role="table"
      aria-label="All edition appearances"
      style={{
        display: "grid",
        gridTemplateColumns:
          "5rem 5rem minmax(0, 1.5fr) minmax(0, 1fr) 4rem 4rem",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <div role="row" style={{ display: "contents" }}>
        {["Year", "Edition", "Holder", "Location", "State", "Class"].map(
          (label, i) => (
            <div
              key={label}
              role="columnheader"
              style={{
                padding: "0.5rem 0.75rem",
                fontFamily: fontStacks.mono,
                fontSize: "0.65rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: colors.text_dim,
                borderBottom: `1px solid ${colors.border}`,
                textAlign: i === 4 || i === 5 ? "right" : "left",
              }}
            >
              {label}
            </div>
          ),
        )}
      </div>

      {history.map((row, i) => (
        <div
          role="row"
          key={`${row.year}-${row.edition}-${i}`}
          style={{ display: "contents" }}
        >
          <div
            role="cell"
            style={{
              padding: "0.55rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              color: colors.accent,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {row.year}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.55rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              color: colors.text_dim,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {row.edition ?? "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.55rem 0.75rem",
              fontFamily: fontStacks.display,
              fontSize: "0.95rem",
              fontVariationSettings: '"opsz" 18',
              color: colors.text,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {cleanOCRName(row.name) || "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.55rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              color: colors.text,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {cleanOCRCity(row.city, row.state) || "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.55rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              color: colors.text_dim,
              textAlign: "right",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {cleanOCRState(row.city, row.state) || "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.55rem 0.75rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.85rem",
              color: colors.text_dim,
              textAlign: "right",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {classLabelForCode(row.license_class, row.year)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * (d) ActivityPanel — async-rendered under Suspense so the historical
 * sections (which only need cheap SQLite hits) don't wait for PSK Reporter
 * + RBN + the FCC ULS bulk snapshot to respond.
 *
 * Visual treatment is a CRT screen: deep-black inner frame with a green
 * phosphor glow on text + numbers + the "TUNING" indicator. The amber
 * sodium-vapor palette stays in the right-rail status pips so the panel
 * still reads as part of the page system.
 */
async function ActivityPanel({ callsign }: { callsign: string }) {
  const snap = await apiGet<UnifiedActivitySnapshot>(
    `/api/activity/${encodeURIComponent(callsign)}`,
    // Activity is bounded slow; allow up to 60s edge cache to dedupe bursts.
    { next: { revalidate: 60 } },
  );

  if (!snap) {
    return (
      <div
        style={{
          padding: "1.25rem 1.5rem",
          border: `1px dashed ${colors.border}`,
          borderRadius: "0.25rem",
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.85rem",
        }}
      >
        Live activity sources unreachable.
      </div>
    );
  }

  const sources = snap.sources ?? {};
  const psk = sources["psk_reporter"] ?? {};
  const rbn = sources["rbn"] ?? {};
  const uls = sources["fcc_uls"] ?? {};

  // CRT-screen colour overrides used inside the panel only.
  const phosphor = "rgb(93, 211, 168)";
  const phosphorDim = "rgba(93, 211, 168, 0.55)";
  const crtBg =
    "radial-gradient(ellipse at 50% 30%, #062216 0%, #03110b 70%, #010906 100%)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 14rem)",
        gap: "1.5rem",
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        borderRadius: "0.25rem",
        padding: "1.25rem",
        position: "relative",
      }}
    >
      <CornerTicks />

      {/* CRT sub-frame */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: "0.5rem",
          border: "1px solid rgba(93,211,168,0.35)",
          background: crtBg,
          padding: "1.25rem 1.5rem",
          boxShadow:
            "inset 0 0 60px rgba(0,0,0,0.85), inset 0 0 18px rgba(93,211,168,0.18)",
        }}
      >
        <Scanlines heavy />

        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.65rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: phosphor,
              textShadow: "0 0 8px rgba(93,211,168,0.7)",
            }}
          >
            CH 14 · Live Activity
          </div>
          <TuningIndicator
            label={snap.found ? "LOCKED" : "TUNING"}
          />
          <span
            style={{
              marginLeft: "auto",
              fontFamily: fontStacks.mono,
              fontSize: "0.6rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: phosphorDim,
            }}
          >
            src {snap.source}
          </span>
        </div>

        <div style={{ position: "relative", zIndex: 2 }}>
          {snap.found && snap.spots && snap.spots.length > 0 ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  flexWrap: "wrap",
                  marginBottom: "1rem",
                }}
              >
                <CrtStat label="Spots" value={(snap.spot_count ?? snap.spots.length).toString()} />
                <CrtStat
                  label="Last seen"
                  value={
                    snap.last_seen
                      ? snap.last_seen.replace("T", " ").replace("Z", "Z")
                      : "—"
                  }
                />
                <CrtStat label="Bands" value={(snap.bands ?? []).join(" ") || "—"} />
                <CrtStat label="Modes" value={(snap.modes ?? []).join(" ") || "—"} />
              </div>
              <CrtSpotsTable spots={snap.spots.slice(0, 12)} />
            </>
          ) : snap.license ? (
            <LicenseCard license={snap.license} />
          ) : (
            <div
              style={{
                padding: "1rem 0",
                color: phosphorDim,
                fontFamily: fontStacks.mono,
                fontSize: "0.85rem",
              }}
            >
              No on-air spots in the last 24 hours, and no current FCC license.
            </div>
          )}
        </div>
      </div>

      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.75rem",
          color: colors.text_dim,
        }}
      >
        <div
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: colors.accent,
            marginBottom: "0.25rem",
          }}
        >
          Sources
        </div>
        <SourcePip name="PSK Reporter" found={Boolean(psk.found)} note={String(psk.spot_count ?? "")} />
        <SourcePip name="RBN" found={Boolean(rbn.found)} note={String(rbn.spot_count ?? "")} />
        <SourcePip
          name="FCC ULS"
          found={Boolean(uls.found)}
          note={uls.status ? String(uls.status) : ""}
        />
        <div
          style={{
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: `1px dashed ${colors.border}`,
          }}
        >
          <TuningKnob variant="meter" size={150} pulseMs={4800} />
        </div>
      </aside>
    </div>
  );
}

function CrtStat({ label, value }: { label: string; value: string }) {
  const phosphor = "rgb(93, 211, 168)";
  return (
    <div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "0.6rem",
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: "rgba(93,211,168,0.55)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "1rem",
          color: phosphor,
          marginTop: "0.125rem",
          textShadow: "0 0 8px rgba(93,211,168,0.55)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SourcePip({
  name,
  found,
  note,
}: {
  name: string;
  found: boolean;
  note?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: found ? colors.accent : colors.border,
          boxShadow: found ? "0 0 8px rgba(255,209,102,0.6)" : "none",
        }}
      />
      <span style={{ color: colors.text }}>{name}</span>
      {note ? <span aria-hidden>· {note}</span> : null}
    </div>
  );
}

function CrtSpotsTable({ spots }: { spots: UnifiedActivitySpot[] }) {
  const phosphor = "rgb(93, 211, 168)";
  const phosphorDim = "rgba(93, 211, 168, 0.55)";
  return (
    <div
      role="table"
      aria-label="Recent spots"
      style={{
        display: "grid",
        gridTemplateColumns:
          "10rem 4rem 5rem 6rem 6rem minmax(0, 1fr)",
        borderTop: `1px solid rgba(93,211,168,0.25)`,
      }}
    >
      <div role="row" style={{ display: "contents" }}>
        {["Time", "Mode", "Band", "Freq", "SNR", "Spotter"].map((l) => (
          <div
            key={l}
            role="columnheader"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.6rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: phosphorDim,
              borderBottom: `1px solid rgba(93,211,168,0.25)`,
            }}
          >
            {l}
          </div>
        ))}
      </div>
      {spots.map((s, i) => (
        <div role="row" key={i} style={{ display: "contents" }}>
          <div
            role="cell"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: phosphor,
              borderBottom: `1px solid rgba(93,211,168,0.18)`,
            }}
          >
            {s.ts.replace("T", " ").replace("Z", "")}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: phosphor,
              textShadow: "0 0 6px rgba(93,211,168,0.5)",
              borderBottom: `1px solid rgba(93,211,168,0.18)`,
            }}
          >
            {s.mode ?? "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: phosphorDim,
              borderBottom: `1px solid rgba(93,211,168,0.18)`,
            }}
          >
            {s.band ?? "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: phosphor,
              borderBottom: `1px solid rgba(93,211,168,0.18)`,
            }}
          >
            {s.freq_khz != null ? `${s.freq_khz.toFixed(1)}` : "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: phosphorDim,
              borderBottom: `1px solid rgba(93,211,168,0.18)`,
            }}
          >
            {s.snr != null ? `${s.snr} dB` : "—"}
          </div>
          <div
            role="cell"
            style={{
              padding: "0.4rem 0.6rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: phosphor,
              borderBottom: `1px solid rgba(93,211,168,0.18)`,
            }}
          >
            {joinNonEmpty([s.spotter, s.rx_loc], " · ") || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

function LicenseCard({ license }: { license: UnifiedFccLicense }) {
  const phosphor = "rgb(93, 211, 168)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem 0",
      }}
    >
      <div
        style={{
          fontFamily: fontStacks.display,
          fontSize: "1.25rem",
          fontVariationSettings: '"opsz" 24',
          color: phosphor,
          textShadow: "0 0 8px rgba(93,211,168,0.55)",
        }}
      >
        {license.full_name ?? license.callsign}
      </div>
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.8rem",
          color: "rgba(93,211,168,0.55)",
          letterSpacing: "0.08em",
        }}
      >
        <span>
          <span>STATUS </span>
          <span style={{ color: license.is_active ? phosphor : colors.danger }}>
            {license.status_label ?? license.status ?? "—"}
          </span>
        </span>
        {license.grant_date ? (
          <span>
            <span>GRANT </span>
            <span style={{ color: phosphor }}>{license.grant_date}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Lightweight placeholder shown while ActivityPanel's promise is pending.
 */
function ActivityPanelFallback() {
  return (
    <div
      aria-live="polite"
      style={{
        padding: "1.25rem 1.5rem",
        border: `1px dashed ${colors.border}`,
        borderRadius: "0.25rem",
        color: colors.text_dim,
        fontFamily: fontStacks.mono,
        fontSize: "0.8rem",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <TuningIndicator />
      <span>Polling PSK · RBN · FCC ULS {motifs.morseDividers.tight}</span>
    </div>
  );
}

/**
 * (e) Nearby callsigns — a compact responsive grid, distance-sorted.
 */
function NearbyList({ nearby }: { nearby: NearbyCallsigns }) {
  if (nearby.nearby.length === 0) {
    return (
      <div
        style={{
          color: colors.text_dim,
          fontFamily: fontStacks.mono,
          fontSize: "0.85rem",
        }}
      >
        No suffix-adjacent callsigns indexed.
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
        gap: "0.4rem",
      }}
    >
      {nearby.nearby.map((n) => (
        <a
          key={n.callsign}
          href={`/callsign/${encodeURIComponent(n.callsign)}`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "0.5rem",
            padding: "0.55rem 0.75rem",
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            textDecoration: "none",
            fontFamily: fontStacks.mono,
            borderRadius: "0.125rem",
            transition: "border-color 200ms ease, color 200ms ease",
          }}
        >
          <span
            style={{
              fontSize: "0.95rem",
              color: colors.accent,
              letterSpacing: "0.04em",
            }}
          >
            {n.callsign}
          </span>
          <span
            aria-hidden
            style={{ color: colors.text_dim, fontSize: "0.7rem" }}
          >
            {formatDistance(n.distance)}
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              color: colors.text_dim,
              marginLeft: "auto",
              maxWidth: "8rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={cleanOCRName(n.name) || ""}
          >
            {cleanOCRName(n.name) || "—"}
          </span>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero-level current-holder components.
// ---------------------------------------------------------------------------

/**
 * Eyebrow chip that sits between the giant callsign and the holder name.
 * Reads at a glance as either:
 *
 *   CURRENT · FCC ULS               (status A or E)
 *   CURRENT · QRZ.COM               (QRZ public scrape filled in)
 *   ARCHIVE · LAST IN <year> CALLBOOK   (no live source — historical only)
 *
 * Colour-coded with the spec amber for live, dim text for archive, so the
 * eye can tell at a glance whether the page is showing them a current
 * licensee or a historical record.
 */
function HeroSourceChip({
  holder,
  detail,
}: {
  holder: CurrentHolder;
  detail: CallsignDetail;
}) {
  let kicker: string;
  let label: string;
  let live: boolean;
  if (holder.source === "fcc_uls") {
    kicker = "Current";
    label = "FCC ULS";
    live = true;
  } else if (holder.source === "qrz") {
    kicker = "Current";
    label = "QRZ.com";
    live = true;
  } else {
    kicker = "Archive";
    const yr = holder.archiveYear ?? detail.last_seen_year;
    label = `Last in ${yr} callbook`;
    live = false;
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.6rem",
        alignSelf: "flex-start",
        padding: "0.32rem 0.7rem",
        border: `1px solid ${live ? colors.accent : colors.border}`,
        background: live ? "rgba(255,163,11,0.08)" : "rgba(19,26,45,0.55)",
        borderRadius: "999px",
        fontFamily: fontStacks.mono,
        fontSize: "0.65rem",
        letterSpacing: "0.32em",
        textTransform: "uppercase",
        color: live ? colors.glow : colors.text_dim,
        boxShadow: live ? "0 0 12px rgba(255,209,102,0.25)" : "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: live ? colors.accent : colors.border,
          boxShadow: live ? "0 0 6px rgba(255,209,102,0.7)" : "none",
        }}
      />
      <span style={{ color: live ? colors.accent : colors.text_dim }}>
        {kicker}
      </span>
      <span aria-hidden style={{ opacity: 0.55 }}>·</span>
      <span style={{ color: live ? colors.glow : colors.text }}>{label}</span>
    </div>
  );
}

/**
 * Status strip under the holder name: a coloured status pip + label
 * (Active / Expired / Cancelled / No FCC record) plus state and
 * grant-date callouts when the data is present.
 *
 * Colour mapping mirrors the FCC ULS status alphabet:
 *   A (Active)    -> success green pip
 *   E (Expired)   -> amber accent (still tracked, but not active)
 *   C (Cancelled) -> danger red
 *   anything else -> dim grey (covers archive fallback and unknown)
 */
function HeroStatusStrip({ holder }: { holder: CurrentHolder }) {
  let pipColor: string;
  let labelColor: string;
  if (holder.source === "fcc_uls" && holder.status === "A") {
    pipColor = colors.success;
    labelColor = colors.success;
  } else if (holder.source === "fcc_uls" && holder.status === "E") {
    pipColor = colors.accent;
    labelColor = colors.accent;
  } else if (holder.source === "fcc_uls" && holder.status === "C") {
    pipColor = colors.danger;
    labelColor = colors.danger;
  } else if (holder.source === "qrz") {
    pipColor = colors.accent;
    labelColor = colors.text;
  } else {
    // Archive fallback: no current FCC license on file.
    pipColor = colors.border;
    labelColor = colors.text_dim;
  }

  const archiveCaption =
    holder.source === "archive" || holder.source === "none"
      ? `No current FCC license on file. Last archive record from ${
          holder.archiveYear ?? "—"
        }.`
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.5rem 1.5rem",
          fontFamily: fontStacks.mono,
          fontSize: "0.8rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: colors.text_dim,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.55rem",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              borderRadius: 999,
              background: pipColor,
              boxShadow:
                pipColor === colors.border
                  ? "none"
                  : `0 0 8px ${pipColor}`,
            }}
          />
          <span style={{ color: labelColor, letterSpacing: "0.18em" }}>
            {holder.statusLabel ?? "—"}
          </span>
        </span>

        {holder.state ? (
          <span>
            <span style={{ opacity: 0.6 }}>State </span>
            <span style={{ color: colors.text }}>{holder.state}</span>
          </span>
        ) : null}

        {holder.grantDate ? (
          <span>
            <span style={{ opacity: 0.6 }}>Granted </span>
            <span style={{ color: colors.text }}>{holder.grantDate}</span>
          </span>
        ) : null}

        {holder.expiredDate ? (
          <span>
            <span style={{ opacity: 0.6 }}>Expires </span>
            <span style={{ color: colors.text }}>{holder.expiredDate}</span>
          </span>
        ) : null}

        {holder.zip ? (
          <span>
            <span style={{ opacity: 0.6 }}>ZIP </span>
            <span style={{ color: colors.text }}>{holder.zip}</span>
          </span>
        ) : null}
      </div>

      {archiveCaption ? (
        <p
          style={{
            margin: 0,
            fontFamily: fontStacks.body,
            fontSize: "0.85rem",
            color: colors.text_dim,
            lineHeight: 1.4,
          }}
        >
          {archiveCaption}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Banner shown in the hero when the callsign has a 1947 district-reorg
 * companion (renumbered from or continued as another call).
 */
function DistrictReorgBanner({ data }: { data: DistrictCompanion | null }) {
  if (!data || !data.companion) return null;
  const is1928 = data.direction === 'w_prefix_added' || data.direction === 'digit_predecessor';
  const bannerLabel = is1928 ? '1928 W-PREFIX ADDITION' : '1947 DISTRICT REORG';
  const verb = data.direction === 'continued_as'
    ? 'Continued as'
    : data.direction === 'w_prefix_added'
      ? 'W-prefix added:'
      : data.direction === 'digit_predecessor'
        ? 'Digit-only predecessor:'
        : 'Previously held as';
  const preRange = (data.direction === 'renumbered_from' && data.companion_first_year && data.companion_last_year_pre_reorg)
    ? `(${data.companion_first_year}-${data.companion_last_year_pre_reorg})`
    : (data.direction === 'continued_as' && data.companion_first_year && data.companion_last_year)
      ? `(${data.companion_first_year}-${data.companion_last_year})`
      : (data.direction === 'w_prefix_added' && data.companion_first_year)
        ? `active from ${data.companion_first_year}`
        : (data.direction === 'digit_predecessor' && data.companion_first_year && data.companion_last_year)
          ? `(${data.companion_first_year}-${data.companion_last_year})`
          : '';
  return (
    <div style={{
      border: '1px solid rgba(255,163,11,0.4)', background: 'rgba(255,163,11,0.06)',
      padding: '0.5rem 0.85rem', borderRadius: 4, marginTop: '0.75rem',
      fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: '0.78rem',
      color: '#ffa30b', display: 'flex', alignItems: 'center', gap: '0.6rem'
    }}>
      <span style={{ opacity: 0.7 }}>{bannerLabel}</span>
      <span style={{ opacity: 0.4 }}>::</span>
      <span>{verb} <a href={`/callsign/${data.companion}`} style={{ color: '#ffa30b', textDecoration: 'underline' }}>{data.companion}</a> {preRange}</span>
    </div>
  );
}

/**
 * Callsign lineage chip row — shown in the hero when AM.dat reveals a
 * prev_callsign (the operator previously held a different call) or a
 * fwd_callsign (another call points back at this one as its previous call).
 */
function CallsignLineageChip({ lineage }: { lineage: UlsLineage | null | undefined }) {
  if (!lineage) return null;
  const chips: Array<{ label: string; call: string }> = [];
  if (lineage.prev_callsign)
    chips.push({ label: "previously", call: lineage.prev_callsign });
  if (lineage.fwd_callsign)
    chips.push({ label: "upgraded to", call: lineage.fwd_callsign });
  if (chips.length === 0) return null;
  return (
    <div style={{
      border: "1px solid rgba(255,163,11,0.3)",
      background: "rgba(255,163,11,0.04)",
      padding: "0.45rem 0.85rem",
      borderRadius: 4,
      marginTop: "0.75rem",
      fontFamily: fontStacks.mono,
      fontSize: "0.78rem",
      color: colors.accent,
      display: "flex",
      alignItems: "center",
      gap: "0.6rem",
      flexWrap: "wrap",
    }}>
      <span style={{ opacity: 0.6, letterSpacing: "0.3em", textTransform: "uppercase" }}>
        OPERATOR LINEAGE
      </span>
      {chips.map(({ label, call }) => (
        <span key={call} style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <span style={{ opacity: 0.35 }}>◆</span>
          <span style={{ opacity: 0.75 }}>{label}</span>
          <a
            href={`/callsign/${call}`}
            style={{ color: colors.accent, textDecoration: "underline", fontWeight: 600 }}
          >
            {call}
          </a>
        </span>
      ))}
    </div>
  );
}

/**
 * FCC License Chain — table of all historical license records for this
 * callsign from HD.dat (multiple USI rows = multiple licensees over time).
 * Only rendered when records.length > 1 (single-record is already shown
 * by the hero's FCC ULS section).
 */
function FccLicenseChain({ chain }: { chain: UlsChain | null | undefined }) {
  if (!chain || chain.records.length === 0) return null;
  // Only show the multi-record view when there's more than one USI.
  // Single-holder calls have the data in the hero already.
  if (chain.records.length < 2) return null;

  const statusLabel = (s: string) =>
    s === "A" ? "ACTIVE" : s === "E" ? "EXPIRED" : s === "C" ? "CANCELLED" : s;
  const statusColor = (s: string): string =>
    s === "A" ? colors.success : s === "C" ? colors.danger : colors.text_dim;

  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: "0.25rem",
      overflow: "hidden",
      position: "relative",
    }}>
      <CornerTicks />
      {/* Column header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "6rem minmax(0, 1fr) 6rem 8rem 8rem 8rem",
        borderBottom: `1px solid ${colors.border}`,
        background: "rgba(10,14,26,0.55)",
      }}>
        {["USI", "Holder", "Status", "Granted", "Expires", "Cancelled"].map((col, i) => (
          <div key={col} style={{
            padding: "0.45rem 0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.6rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: colors.text_dim,
            textAlign: i > 2 ? "right" : "left",
          }}>
            {col}
          </div>
        ))}
      </div>
      {chain.records.map((rec, idx) => (
        <div key={rec.usi} style={{
          display: "grid",
          gridTemplateColumns: "6rem minmax(0, 1fr) 6rem 8rem 8rem 8rem",
          borderBottom: idx < chain.records.length - 1 ? `1px solid ${colors.border}` : undefined,
          background: idx % 2 === 0 ? "transparent" : "rgba(255,163,11,0.018)",
        }}>
          <div style={{
            padding: "0.5rem 0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.75rem",
            color: colors.text_dim,
          }}>
            {rec.usi}
          </div>
          <div style={{
            padding: "0.5rem 0.75rem",
            fontFamily: fontStacks.display,
            fontSize: "0.9rem",
            fontVariationSettings: '"opsz" 18',
            color: colors.text,
          }}>
            {rec.holder || "—"}
          </div>
          <div style={{
            padding: "0.5rem 0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.72rem",
            letterSpacing: "0.1em",
            color: statusColor(rec.status),
          }}>
            {statusLabel(rec.status)}
          </div>
          <div style={{
            padding: "0.5rem 0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            color: colors.text,
            textAlign: "right",
          }}>
            {rec.grant_date ?? "—"}
          </div>
          <div style={{
            padding: "0.5rem 0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            color: colors.text_dim,
            textAlign: "right",
          }}>
            {rec.expired_date ?? "—"}
          </div>
          <div style={{
            padding: "0.5rem 0.75rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            color: rec.cancel_date ? colors.danger : colors.text_dim,
            textAlign: "right",
          }}>
            {rec.cancel_date ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Demoted archive summary — this is the content the page hero USED to
 * show before the current-holder refactor (latest record name, year, full
 * historical span, edition count). Visually subordinate: smaller display
 * font, dimmed accents, single-row layout — the reader's primary signal
 * is now the LIVE current holder above this section.
 */
function ArchiveSummary({ detail, isClub = false }: { detail: CallsignDetail; isClub?: boolean }) {
  const l = detail.latest;
  const cityLine = joinNonEmpty([cleanOCRCity(l.city), cleanOCRState(l.city, l.state), l.zip], " ");
  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${colors.border}`,
        background:
          "linear-gradient(180deg, rgba(255,163,11,0.025) 0%, rgba(19,26,45,0) 50%)",
        padding: "1.5rem 1.75rem",
        borderRadius: "0.25rem",
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        gap: "1.5rem",
        alignItems: "start",
      }}
      className="cs-archive-summary"
    >
      <CornerTicks />

      <div>
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.6rem",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: colors.text_dim,
            marginBottom: "0.5rem",
          }}
        >
          Last archive record · {l.edition ?? String(l.year)}
        </div>
        <div
          style={{
            fontFamily: fontStacks.display,
            fontSize: "clamp(1.3rem, 2.4vw, 1.7rem)",
            fontWeight: 500,
            fontVariationSettings: '"opsz" 36',
            lineHeight: 1.15,
            color: cleanOCRName(l.name) ? colors.text : colors.text_dim,
          }}
        >
          {cleanOCRName(l.name) || "—"}
        </div>
        {l.address ? (
          <div
            style={{
              marginTop: "0.55rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: colors.text,
              letterSpacing: "0.02em",
            }}
          >
            {cleanMergedAddress(l.address)}
          </div>
        ) : null}
        {cityLine ? (
          <div
            style={{
              marginTop: "0.1rem",
              fontFamily: fontStacks.mono,
              fontSize: "0.8rem",
              color: colors.text_dim,
              letterSpacing: "0.04em",
            }}
          >
            {cityLine}
          </div>
        ) : null}
        <div style={{ marginTop: "0.9rem" }}>
          <ProvenanceLine
            source="Callbook"
            edition={l.edition}
            year={l.year}
            ocrPercent={null}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.9rem 0.75rem",
          paddingLeft: "1rem",
          borderLeft: `1px dashed ${colors.border}`,
        }}
      >
        <Marginal label="Year" value={String(l.year)} />
        <Marginal label="Class" value={classLabelForCode(l.license_class, l.year, isClub)} />
        <Marginal
          label="Editions"
          value={detail.editions_count.toString().padStart(3, "0")}
        />
        <Marginal
          label="Span"
          value={yearSpan(detail.first_seen_year, detail.last_seen_year)}
        />
        <Marginal
          label="First"
          value={String(detail.first_seen_year ?? "—")}
        />
        <Marginal
          label="Last"
          value={String(detail.last_seen_year ?? "—")}
        />
        <div
          style={{
            gridColumn: "1 / -1",
            marginTop: "0.25rem",
            display: "flex",
            alignItems: "center",
            gap: "0.55rem",
            flexWrap: "wrap",
          }}
        >
          <LicenseClassPip licenseClass={l.license_class} size={20} />
          <EraTag year={l.year} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page entry point.
// ---------------------------------------------------------------------------

interface PageProps {
  // Next.js 15 server-component contract: dynamic params arrive as Promises.
  params: Promise<{ cs: string }>;
}

import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cs: csRaw } = await params;
  const callsign = decodeURIComponent(csRaw ?? "").toUpperCase();
  const API_BASE_META: string = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");
  return {
    title: callsign,
    openGraph: {
      images: [`${API_BASE_META}/card/${encodeURIComponent(callsign)}.png`],
    },
    twitter: {
      card: "summary_large_image",
      images: [`${API_BASE_META}/card/${encodeURIComponent(callsign)}.png`],
    },
  };
}

export default async function CallsignPage({ params }: PageProps) {
  const { cs: csRaw } = await params;
  const callsign = decodeURIComponent(csRaw ?? "").toUpperCase();
  if (!/^[A-Z0-9/]{3,12}$/.test(callsign)) {
    notFound();
  }

  // Parallel fetches. The historical endpoints are cheap SQLite hits; the
  // CURRENT-holder sources (FCC ULS bulk-snapshot, QRZ public scrape) are
  // also hit here so the hero can render the *live* licensee, not the
  // historical-archive name. We explicitly null-check rather than .catch()
  // the promise so a single 404 for /history (rare for very old callsigns)
  // doesn't doom the whole page. The ULS endpoint is cheap (in-memory
  // hash lookup); QRZ can stall a few hundred ms but is short-circuited
  // by upstream cache. ActivityPanel still does its own fetch under
  // Suspense — we don't share state between this top-level data load and
  // that subtree so the activity panel can render independently.
  const [detail, history, holders, nearby, clubInfo, ulsRecord, qrzEnvelope, districtCompanion, ulsChain, printedLineage] =
    await Promise.all([
      apiGet<CallsignDetail>(
        `/api/callsign/${encodeURIComponent(callsign)}`,
      ),
      apiGet<CallsignHistoryItem[]>(
        `/api/callsign/${encodeURIComponent(callsign)}/history`,
      ),
      apiGet<HoldersHistoryResult>(
        `/api/callsign/${encodeURIComponent(callsign)}/holders`,
      ),
      apiGet<NearbyCallsigns>(
        `/api/callsign/${encodeURIComponent(callsign)}/nearby`,
      ),
      callsignClub(callsign).catch(() => null),
      apiGet<FccUlsRecord>(
        `/api/activity/${encodeURIComponent(callsign)}/uls`,
      ),
      apiGet<QrzEnvelope>(
        `/api/activity/${encodeURIComponent(callsign)}/qrz`,
      ),
      apiGet<DistrictCompanion>(
        `/api/callsign/${encodeURIComponent(callsign)}/district_companion`,
      ).catch(() => null),
      apiGet<UlsChain>(
        `/api/callsign/${encodeURIComponent(callsign)}/uls_chain`,
      ).catch(() => null),
      apiGet<PrintedLineageResponse>(
        `/api/lineage/${encodeURIComponent(callsign)}`,
      ).catch(() => null),
    ]);

  if (!detail) {
    notFound();
  }

  const currentHolder = resolveCurrentHolder(ulsRecord, qrzEnvelope, detail);
  const heroHolder = currentHolder.name;

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: fontStacks.body,
        zIndex: 0,
        overflow: "hidden",
      }}
    >
      <Grain />

      {/* ------------------------------------------------------------------
          DECORATIVE EDGE DIALS — tube-radio knobs in the margins. They
          sit absolutely so they don't disturb the page flow but anchor
          the corners with a vintage-bench feel. Hidden on small viewports
          to avoid stealing space from the content.
          ------------------------------------------------------------------ */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "6rem",
          left: "1.5rem",
          zIndex: 2,
          display: "none",
        }}
        className="cs-edge-dial cs-edge-dial-left"
      >
        <TuningKnob variant="knob" size={88} pulseMs={6000} />
      </div>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "5.5rem",
          right: "1.5rem",
          zIndex: 2,
          display: "none",
        }}
        className="cs-edge-dial cs-edge-dial-right"
      >
        <TuningKnob variant="meter" size={140} pulseMs={5200} />
      </div>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "22rem",
          right: "2rem",
          zIndex: 2,
          display: "none",
        }}
        className="cs-edge-dial cs-edge-dial-right"
      >
        <TuningKnob variant="knob" size={72} pulseMs={4400} />
      </div>

      {/* Media query bound to the class above — show edge dials on wide
          viewports only. Inline <style> keeps the page self-contained. */}
      <style>{`
        @media (min-width: 1280px) {
          .cs-edge-dial { display: block !important; }
        }
      `}</style>

      {/* --- HERO -------------------------------------------------------- */}
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

        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          <Reveal delay={0}>
            <div
              style={{
                fontFamily: fontStacks.mono,
                fontSize: "0.75rem",
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: colors.accent,
              }}
            >
              {motifs.morseDividers.tight} &nbsp; ham-callbook · callsign
            </div>
          </Reveal>

          <HeroCallsign callsign={detail.latest.callsign} />

          <Reveal delay={0.35}><DistrictReorgBanner data={districtCompanion ?? null} /></Reveal>
          <Reveal delay={0.37}><CallsignLineageChip lineage={ulsChain?.lineage ?? null} /></Reveal>
          {printedLineage?.found ? (
            <Reveal delay={0.38}><PrintedLineageCard data={printedLineage} /></Reveal>
          ) : null}

          {/* Source provenance chip — tells the reader at a glance whether
              the name they're about to read is the LIVE current licensee
              (FCC ULS), a QRZ.com listing, or the ARCHIVE fallback. */}
          <Reveal delay={0.4}>
            <HeroSourceChip holder={currentHolder} detail={detail} />
          </Reveal>

          {currentHolder.source === "archive" ||
          currentHolder.source === "none" ? (
            <Reveal delay={0.45}>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontFamily: fontStacks.display,
                    fontStyle: "italic",
                    fontSize: "clamp(1.5rem, 3.5vw, 2.75rem)",
                    fontWeight: 400,
                    fontVariationSettings: '"opsz" 72',
                    lineHeight: 1.1,
                    letterSpacing: "-0.005em",
                    color: colors.text_dim,
                  }}
                >
                  No current FCC license
                </p>
                {currentHolder.archiveYear ? (
                  <p
                    style={{
                      margin: "0.5rem 0 0",
                      fontFamily: fontStacks.body,
                      fontSize: "0.95rem",
                      lineHeight: 1.4,
                      color: colors.text_dim,
                    }}
                  >
                    Most recent archive record from {currentHolder.archiveYear}
                  </p>
                ) : null}
              </div>
            </Reveal>
          ) : heroHolder ? (
            <Reveal delay={0.45}>
              <p
                style={{
                  margin: 0,
                  fontFamily: fontStacks.display,
                  fontSize: "clamp(1.5rem, 3.5vw, 2.75rem)",
                  fontWeight: 500,
                  fontVariationSettings: '"opsz" 72',
                  lineHeight: 1.1,
                  letterSpacing: "-0.005em",
                  color: colors.text,
                }}
              >
                {heroHolder}
              </p>
            </Reveal>
          ) : (
            <Reveal delay={0.45}>
              <p
                style={{
                  margin: 0,
                  fontFamily: fontStacks.display,
                  fontStyle: "italic",
                  fontSize: "clamp(1.25rem, 2.8vw, 2rem)",
                  fontWeight: 400,
                  fontVariationSettings: '"opsz" 60',
                  lineHeight: 1.15,
                  color: colors.text_dim,
                }}
              >
                Holder unknown.
              </p>
            </Reveal>
          )}

          {/* Status strip — Active / Expired / Cancelled / No FCC record,
              with state + grant-date callouts when present. Lives directly
              under the holder name so the reader knows the *state* of the
              license without scrolling. */}
          <Reveal delay={0.5}>
            <HeroStatusStrip holder={currentHolder} />
          </Reveal>

          <Reveal delay={0.55}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "1rem 1.5rem",
                marginTop: "0.25rem",
              }}
            >
              <span
                style={{
                  fontFamily: fontStacks.mono,
                  fontSize: "0.75rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: colors.text_dim,
                }}
              >
                Archive span{" "}
                <span style={{ color: colors.text }}>
                  {yearSpan(detail.first_seen_year, detail.last_seen_year)}
                </span>
                {" · "}
                {detail.editions_count} edition
                {detail.editions_count === 1 ? "" : "s"}
              </span>
              {clubInfo && clubInfo.is_club && clubInfo.club_slug ? (
                <ClubBadge
                  displayName={clubInfo.display_name ?? detail.latest.callsign}
                  years={clubInfo.years ?? []}
                  clubType={clubInfo.club_type}
                  href={`/club/${encodeURIComponent(clubInfo.club_slug)}`}
                  compact
                />
              ) : null}
            </div>
          </Reveal>
        </div>
      </section>

      {/* --- ARCHIVE (demoted: what the hero USED to show) --------------- */}
      <div style={PAGE_CONTAINER}>
        <MorseDivider label="callbook archive" />
      </div>

      <section style={PAGE_CONTAINER}>
        <Reveal delay={0.05}>
          <SectionHeader
            kicker="Paper trail"
            title="In the callbook archive"
            tally={`${detail.editions_count
              .toString()
              .padStart(3, "0")} editions`}
          />
          {(() => {
            const archiveIsClub = (clubInfo?.is_club ?? false) || (ulsRecord?.is_club ?? false) || isClubByName(detail?.latest?.name);
            return <ArchiveSummary detail={detail} isClub={archiveIsClub} />;
          })()}
        </Reveal>
      </section>

      {/* --- FCC LICENSE RECORDS ----------------------------------------- */}
      {ulsChain && ulsChain.records.length >= 2 ? (
        <>
          <div style={PAGE_CONTAINER}>
            <MorseDivider label="fcc license records" />
          </div>
          <section style={PAGE_CONTAINER}>
            <Reveal delay={0.05}>
              <SectionHeader
                kicker="ULS era · 1997+"
                title="FCC license history"
                tally={`${ulsChain.records.length.toString().padStart(2, "0")} records`}
              />
              <FccLicenseChain chain={ulsChain} />
            </Reveal>
          </section>
        </>
      ) : null}

      {/* --- ASYMMETRIC MAIN GRID ---------------------------------------- */}
      <div style={PAGE_CONTAINER}>
        <MorseDivider label="record · holders" />
      </div>

      <section style={PAGE_CONTAINER}>
        <div style={TWO_COL} className="cs-two-col">
          {/* LEFT: timeline */}
          <Reveal delay={0.05}>
            <SectionHeader
              kicker="VFO sweep"
              title="Holders"
              tally={`${(holders?.distinct_holders ?? 0)
                .toString()
                .padStart(2, "0")} distinct`}
            />
            {holders ? (
              <SpectrumBand
                firstYear={Math.min(
                  ...(holders.holders.map((h) => h.first_year).length
                    ? holders.holders.map((h) => h.first_year)
                    : [detail.first_seen_year]),
                )}
                lastYear={Math.max(
                  ...(holders.holders.map((h) => h.last_year).length
                    ? holders.holders.map((h) => h.last_year)
                    : [detail.last_seen_year]),
                )}
              >
                <HoldersTimeline holders={holders} />
              </SpectrumBand>
            ) : (
              <div
                style={{
                  color: colors.text_dim,
                  fontFamily: fontStacks.mono,
                  fontSize: "0.85rem",
                }}
              >
                Holder data unavailable.
              </div>
            )}
          </Reveal>

          {/* RIGHT RAIL: latest record card + marginalia */}
          <Reveal delay={0.15} style={{ position: "sticky", top: "1.5rem" }}>
            <LatestRecordCard detail={detail} isClub={(clubInfo?.is_club ?? false) || (ulsRecord?.is_club ?? false) || isClubByName(detail?.latest?.name)} />
          </Reveal>
        </div>

        {/* Collapse to single column on narrow viewports */}
        <style>{`
          @media (max-width: 960px) {
            .cs-two-col { grid-template-columns: minmax(0, 1fr) !important; }
            .cs-archive-summary { grid-template-columns: minmax(0, 1fr) !important; }
          }
        `}</style>
      </section>

      <div style={PAGE_CONTAINER}>
        <MorseDivider label="all appearances" />
      </div>

      {/* --- APPEARANCES TABLE ------------------------------------------- */}
      <section style={PAGE_CONTAINER}>
        <Reveal delay={0.05}>
          <SectionHeader
            kicker="Edition log"
            title="All appearances"
            tally={`${(history?.length ?? 0).toString().padStart(3, "0")} editions`}
          />
          <AppearancesTable history={history ?? []} />
        </Reveal>
      </section>

      <div style={PAGE_CONTAINER}>
        <MorseDivider label="live activity" />
      </div>

      {/* --- ACTIVITY PANEL (Suspense) ----------------------------------- */}
      <section style={PAGE_CONTAINER}>
        <Reveal delay={0.05}>
          <SectionHeader
            kicker="On-air now"
            title="Live activity"
          />
          <Suspense fallback={<ActivityPanelFallback />}>
            <ActivityPanel callsign={callsign} />
          </Suspense>
        </Reveal>
      </section>

      <div style={PAGE_CONTAINER}>
        <MorseDivider label="nearby" />
      </div>

      {/* --- NEARBY CALLSIGNS -------------------------------------------- */}
      <section
        style={{ ...PAGE_CONTAINER, padding: "0 2rem 6rem" }}
      >
        <Reveal delay={0.05}>
          <SectionHeader
            kicker={
              nearby && nearby.prefix && nearby.suffix
                ? `suffix space ${nearby.prefix}·${nearby.suffix}`
                : "suffix space"
            }
            title="Nearby"
          />
          {nearby ? (
            <NearbyList nearby={nearby} />
          ) : (
            <div
              style={{
                color: colors.text_dim,
                fontFamily: fontStacks.mono,
                fontSize: "0.85rem",
              }}
            >
              Nearby callsigns unavailable.
            </div>
          )}
        </Reveal>
      </section>

      {/* --- CITE THIS RECORD -------------------------------------------- */}
      <section style={{ ...PAGE_CONTAINER, padding: "0 2rem 4rem" }}>
        <CiteThisRecord
          recordType="callsign"
          identifier={callsign}
          displayName={detail.latest.name ?? undefined}
          editionList={(history ?? []).map((h) => h.edition ?? String(h.year))}
          permalink={`https://callbook.archive/callsign/${callsign}`}
          datasetVersion="v2026.06"
          accessDate={new Date().toISOString().slice(0, 10)}
        />
      </section>
    </main>
  );
}

export const dynamic = "force-dynamic";
