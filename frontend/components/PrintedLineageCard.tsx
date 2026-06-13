/**
 * PrintedLineageCard — amber evidence card for KN→K / WN→W Novice upgrade links.
 *
 * Shown on the callsign detail page when the printed-lineage artifact
 * finds a deterministic link between a Novice prefix call (KN4ABC) and
 * its K/W upgrade target (K4ABC).
 *
 * Role variants:
 *   - 'novice'  — current callsign IS the Novice call; card shows the
 *                 upgrade it became.
 *   - 'upgrade' — current callsign IS the upgraded call; card shows the
 *                 Novice call it came from.
 *
 * Design: Sodium Vapor amber, border-left accent bar, mono metadata row,
 * confidence pip.  No interactive state — server component safe.
 */

import Link from "next/link";
import { colors, fontStacks } from "../lib/design";

// ---------------------------------------------------------------------------
// Types (mirrors backend PrintedLineageLink Pydantic model)
// ---------------------------------------------------------------------------

export interface PrintedLineageLinkData {
  novice_call: string;
  upgrade_call: string;
  prefix_type: string;
  novice_first_year: number;
  novice_last_year: number;
  upgrade_first_year: number;
  score: number;
  confidence: string; // "high" | "medium"
  match_basis: string[];
  uls_confirmed: boolean;
  label: string;
}

export interface PrintedLineageResponse {
  callsign: string;
  found: boolean;
  role: "novice" | "upgrade" | null;
  link: PrintedLineageLinkData | null;
}

interface Props {
  data: PrintedLineageResponse | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a confidence badge — amber for high, dim for medium. */
function ConfidencePip({ confidence }: { confidence: string }) {
  const isHigh = confidence === "high";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        fontFamily: fontStacks.mono,
        fontSize: "0.6rem",
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: isHigh ? colors.accent : colors.text_dim,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: "0.45rem",
          height: "0.45rem",
          borderRadius: "50%",
          backgroundColor: isHigh ? colors.accent : colors.text_dim,
          opacity: isHigh ? 1 : 0.55,
        }}
      />
      {confidence} confidence
    </span>
  );
}

/** Format the match basis array into a human-readable phrase. */
function basisPhrase(basis: string[]): string {
  const labels: Record<string, string> = {
    name: "name",
    name_partial: "surname",
    address: "address",
    address_partial: "address prefix",
  };
  const mapped = basis.map((b) => labels[b] ?? b);
  if (mapped.length === 0) return "matched by proximity";
  if (mapped.length === 1) return `matched by ${mapped[0]}`;
  const last = mapped[mapped.length - 1];
  return `matched by ${mapped.slice(0, -1).join(", ")} & ${last}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PrintedLineageCard({ data }: Props) {
  if (!data || !data.found || !data.link) return null;

  const { link, role } = data;

  // Determine which call is "theirs" (the one on the page) vs "related".
  const relatedCall =
    role === "novice" ? link.upgrade_call : link.novice_call;
  const directionLabel =
    role === "novice" ? "Likely upgraded to" : "Likely upgraded from";

  // Year phrase
  const yearPhrase =
    role === "novice"
      ? `~${link.upgrade_first_year}`
      : `Novice ${link.novice_first_year}–${link.novice_last_year}`;

  return (
    <div
      role="note"
      aria-label="Novice upgrade lineage"
      style={{
        display: "flex",
        gap: "1rem",
        padding: "1rem 1.25rem",
        borderRadius: "0.375rem",
        background: `${colors.accent}0d`, // amber at ~5% opacity
        border: `1px solid ${colors.accent}40`,
        borderLeft: `3px solid ${colors.accent}`,
        marginTop: "1rem",
      }}
    >
      {/* Icon column — vintage "Novice" telegraph key glyph */}
      <span
        aria-hidden
        style={{
          fontFamily: fontStacks.mono,
          fontSize: "1.1rem",
          color: colors.accent,
          lineHeight: 1,
          paddingTop: "0.1rem",
          flexShrink: 0,
          opacity: 0.85,
        }}
      >
        ·—
      </span>

      {/* Body */}
      <div style={{ minWidth: 0 }}>
        {/* Kicker */}
        <div
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.58rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: colors.accent,
            marginBottom: "0.4rem",
            opacity: 0.85,
          }}
        >
          Novice Upgrade Lineage
        </div>

        {/* Main sentence */}
        <p
          style={{
            margin: 0,
            fontFamily: fontStacks.body,
            fontSize: "0.95rem",
            lineHeight: 1.45,
            color: colors.text,
          }}
        >
          {directionLabel}{" "}
          <Link
            href={`/callsign/${encodeURIComponent(relatedCall)}`}
            style={{
              fontFamily: fontStacks.mono,
              fontWeight: 600,
              color: colors.accent,
              textDecoration: "underline",
              textDecorationColor: `${colors.accent}60`,
              textUnderlineOffset: "3px",
            }}
          >
            {relatedCall}
          </Link>
          {", "}
          {yearPhrase}
          {link.uls_confirmed ? (
            <span
              title="Confirmed by FCC ULS lineage record"
              style={{
                marginLeft: "0.5rem",
                fontFamily: fontStacks.mono,
                fontSize: "0.65rem",
                color: colors.success,
                letterSpacing: "0.1em",
              }}
            >
              ✓ ULS confirmed
            </span>
          ) : null}
        </p>

        {/* Evidence metadata row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.75rem",
            marginTop: "0.6rem",
            fontFamily: fontStacks.mono,
            fontSize: "0.62rem",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: colors.text_dim,
          }}
        >
          <ConfidencePip confidence={link.confidence} />
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{basisPhrase(link.match_basis)}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>
            {link.prefix_type}→{link.prefix_type === "KN" ? "K" : "W"} rule
          </span>
        </div>
      </div>
    </div>
  );
}
