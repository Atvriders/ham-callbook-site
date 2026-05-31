"use client";

/**
 * ActivityPanel — live "is this callsign on the air right now?" panel
 * with three stacked rows:
 *
 *   1. PSK waterfall — ASCII waterfall of recent PSK Reporter spots,
 *      rendered as a mono-spaced glyph grid (no canvas, no images).
 *   2. RBN spots — Reverse Beacon Network skimmer hits, list view.
 *   3. FCC ULS status — current FCC license grant/expiry/class line.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 * The ASCII waterfall riffs on the locked ``motifs.oscilloscope`` —
 * mono-spaced amplitude glyphs ▁▂▃▄▅▆▇█ tinted amber.
 *
 * This component is intentionally PRESENTATIONAL. The page passes in
 * the three data slices; if any slice is undefined, the panel shows a
 * tasteful empty state ("NO SPOTS IN LAST 24H") rather than collapsing.
 * That matches the locked design philosophy: empty states should still
 * carry mood, never just whitespace.
 */

import { colors, fontStacks, motifs } from "@/lib/design";

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/** One bin in the PSK waterfall row: a timestamp + relative strength 0..1. */
export interface PSKWaterfallBin {
  /** Bin label, e.g. "14:02" or relative "−2h". Rendered under the strip. */
  label?: string;
  /** Normalized strength in [0, 1]. */
  strength: number;
  /** Optional band string for the tooltip / aria-label. */
  band?: string;
}

/** One Reverse Beacon Network spot. */
export interface RBNSpot {
  /** Skimmer / spotter callsign. */
  spotter: string;
  /** Frequency in kHz, e.g. 14025.3. */
  freqKhz: number;
  /** Mode, e.g. "CW", "FT8". */
  mode?: string;
  /** SNR in dB, optional. */
  snrDb?: number;
  /** Relative timestamp, e.g. "12s ago". */
  age?: string;
}

/** FCC ULS license status snapshot. */
export interface FCCULSStatus {
  /** Current grant class, e.g. "EXTRA", "GENERAL". */
  licenseClass?: string | null;
  /** ISO date string of grant. */
  grantDate?: string | null;
  /** ISO date string of expiry. */
  expiryDate?: string | null;
  /** Operator name on the grant. */
  name?: string | null;
  /** Free-form status, e.g. "ACTIVE", "EXPIRED", "CANCELED". */
  status?: string | null;
  /** When falsy and bins.length===0 etc, the empty state is shown. */
  uls_id?: string | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActivityPanelProps {
  callsign: string;
  /** PSK waterfall bins, oldest first. Empty → empty state. */
  pskBins?: PSKWaterfallBin[];
  /** RBN spots, newest first. */
  rbnSpots?: RBNSpot[];
  /** FCC ULS status snapshot. */
  fccStatus?: FCCULSStatus | null;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a [0,1] strength onto one of the motif's amplitude glyphs. */
function strengthGlyph(strength: number): string {
  const chars = motifs.oscilloscope.chars;
  if (!Number.isFinite(strength) || strength <= 0) return " ";
  const idx = Math.min(
    chars.length - 1,
    Math.max(0, Math.floor(strength * chars.length))
  );
  return chars[idx] ?? " ";
}

/** Format a frequency in kHz as MHz with 3 decimal places. */
function fmtFreq(freqKhz: number): string {
  if (!Number.isFinite(freqKhz)) return "—";
  return (freqKhz / 1000).toFixed(3);
}

// ---------------------------------------------------------------------------
// Sub-rows
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: fontStacks.mono,
        fontSize: 10,
        letterSpacing: "0.24em",
        color: colors.accent,
        textTransform: "uppercase",
        marginBottom: 8,
        textShadow: motifs.glow.textShadow,
      }}
    >
      {children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div
      style={{
        fontFamily: fontStacks.mono,
        fontSize: 11,
        letterSpacing: "0.16em",
        color: colors.text_dim,
        textTransform: "uppercase",
        padding: "6px 0",
      }}
    >
      ─ {text} ─
    </div>
  );
}

function PSKRow({ bins }: { bins: PSKWaterfallBin[] }) {
  if (!bins || bins.length === 0) {
    return <EmptyLine text="no psk reporter spots in last 24h" />;
  }

  // Render up to ~60 bins; the strip stretches to fill its container.
  const trimmed = bins.slice(-60);
  const glyphs = trimmed.map((b) => strengthGlyph(b.strength)).join("");
  const peak = trimmed.reduce((m, b) => Math.max(m, b.strength), 0);

  return (
    <div>
      <pre
        aria-label="PSK waterfall"
        style={{
          margin: 0,
          fontFamily: fontStacks.mono,
          fontSize: 16,
          lineHeight: 1.05,
          letterSpacing: "0.04em",
          color: colors.accent,
          textShadow: motifs.glow.textShadow,
          whiteSpace: "pre",
          overflow: "hidden",
        }}
      >
        {glyphs}
      </pre>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: fontStacks.mono,
          fontSize: 9.5,
          letterSpacing: "0.16em",
          color: colors.text_dim,
          textTransform: "uppercase",
        }}
      >
        <span>−24h</span>
        <span>peak {Math.round(peak * 100)}%</span>
        <span>now</span>
      </div>
    </div>
  );
}

function RBNRow({ spots }: { spots: RBNSpot[] }) {
  if (!spots || spots.length === 0) {
    return <EmptyLine text="no rbn skimmer hits" />;
  }
  const top = spots.slice(0, 5);
  return (
    <div role="list">
      {top.map((s, i) => (
        <div
          key={`${s.spotter}-${i}`}
          role="listitem"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) auto auto auto",
            gap: 12,
            padding: "5px 0",
            borderBottom:
              i === top.length - 1 ? "none" : `1px dashed ${colors.border}`,
            fontFamily: fontStacks.mono,
            fontSize: 12,
            color: colors.text,
          }}
        >
          <span style={{ color: colors.text }}>{s.spotter}</span>
          <span style={{ color: colors.accent, letterSpacing: "0.04em" }}>
            {fmtFreq(s.freqKhz)} MHz
          </span>
          <span
            style={{
              color: colors.text_dim,
              letterSpacing: "0.12em",
              fontSize: 10.5,
              textTransform: "uppercase",
              minWidth: 40,
              textAlign: "right",
            }}
          >
            {s.mode ?? "—"}
          </span>
          <span
            style={{
              color: colors.text_dim,
              fontSize: 10.5,
              letterSpacing: "0.1em",
              minWidth: 70,
              textAlign: "right",
            }}
          >
            {typeof s.snrDb === "number" ? `${s.snrDb} dB` : ""}
            {s.age ? ` ${s.age}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function FCCRow({ status }: { status?: FCCULSStatus | null }) {
  if (!status || (!status.licenseClass && !status.status && !status.uls_id)) {
    return <EmptyLine text="no fcc uls record" />;
  }

  const rows: [string, string | null | undefined][] = [
    ["Status", status.status],
    ["Class", status.licenseClass],
    ["Name", status.name],
    ["Granted", status.grantDate],
    ["Expires", status.expiryDate],
    ["ULS ID", status.uls_id],
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        rowGap: 4,
        columnGap: 14,
      }}
    >
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontSize: 10,
                letterSpacing: "0.2em",
                color: colors.text_dim,
                textTransform: "uppercase",
                paddingTop: 2,
              }}
            >
              {k}
            </span>
            <span
              style={{
                fontFamily:
                  k === "Class" || k === "Status"
                    ? fontStacks.mono
                    : fontStacks.body,
                fontSize: 13,
                color:
                  k === "Status" && v === "EXPIRED"
                    ? colors.danger
                    : k === "Status" && v === "ACTIVE"
                    ? colors.success
                    : colors.text,
                letterSpacing: k === "Class" ? "0.08em" : "0",
              }}
            >
              {v}
            </span>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ActivityPanel({
  callsign,
  pskBins,
  rbnSpots,
  fccStatus,
  className,
}: ActivityPanelProps) {
  return (
    <section
      className={className}
      aria-label={`Live activity for ${callsign}`}
      style={{
        position: "relative",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        padding: "18px 20px",
        // sodium-vapor halo around the panel
        boxShadow: `0 0 0 1px rgba(255,163,11,0.04), 0 8px 28px rgba(0,0,0,0.45)`,
        overflow: "hidden",
      }}
    >
      {/* panel header */}
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 10,
            letterSpacing: "0.32em",
            color: colors.accent,
            textTransform: "uppercase",
            textShadow: motifs.glow.textShadow,
          }}
        >
          On the Air
        </div>
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: 11,
            color: colors.text,
            letterSpacing: "0.06em",
          }}
        >
          {callsign}
        </div>
      </header>

      {/* PSK waterfall */}
      <div style={{ marginBottom: 18 }}>
        <SectionHeading>PSK Reporter — last 24h</SectionHeading>
        <PSKRow bins={pskBins ?? []} />
      </div>

      {/* Morse-code divider */}
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          color: colors.text_dim,
          textAlign: "center",
          padding: "6px 0 12px",
        }}
        aria-hidden="true"
      >
        {motifs.morseDividers.pattern}
      </div>

      {/* RBN spots */}
      <div style={{ marginBottom: 18 }}>
        <SectionHeading>Reverse Beacon Network</SectionHeading>
        <RBNRow spots={rbnSpots ?? []} />
      </div>

      {/* Morse-code divider */}
      <div
        style={{
          fontFamily: fontStacks.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          color: colors.text_dim,
          textAlign: "center",
          padding: "6px 0 12px",
        }}
        aria-hidden="true"
      >
        {motifs.morseDividers.pattern}
      </div>

      {/* FCC ULS */}
      <div>
        <SectionHeading>FCC ULS Status</SectionHeading>
        <FCCRow status={fccStatus} />
      </div>
    </section>
  );
}
