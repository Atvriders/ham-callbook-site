/**
 * StatusChip — tiny FCC-license-status pill used across search results,
 * the nearby page, and the callsign detail banner.
 *
 * CONTRACT (shared across agents — do not change the signature):
 *
 *   export default function StatusChip({status, label, size}: {
 *     status: string | null;
 *     label?: string | null;
 *     size?: "sm" | "md";
 *   })
 *
 *   status "A"      -> green  "Active"
 *   status "E"      -> amber  "Expired"
 *   status "C"/"T"  -> red    "Cancelled"
 *   null / unknown  -> gray   "Historical"
 *
 * `label` (e.g. a backend-provided `status_label`) overrides the default
 * text; the colour always keys off `status`. Pure presentational component
 * — no hooks, no client boundary — so it renders in both server and client
 * component trees.
 *
 * Aesthetic: Sodium Vapor (locked) — all colours from lib/design.ts.
 */

import { colors, fontStacks } from "../lib/design";

type ChipTone = {
  /** Dot + text colour. */
  fg: string;
  /** Translucent fill behind the pill. */
  bg: string;
  /** 1px border colour. */
  border: string;
  /** Default text when no `label` override is provided. */
  text: string;
};

const TONES: Record<"active" | "expired" | "cancelled" | "historical", ChipTone> = {
  active: {
    fg: colors.success,
    bg: "rgba(93, 211, 168, 0.10)",
    border: "rgba(93, 211, 168, 0.45)",
    text: "Active",
  },
  expired: {
    fg: colors.accent,
    bg: "rgba(255, 163, 11, 0.10)",
    border: "rgba(255, 163, 11, 0.45)",
    text: "Expired",
  },
  cancelled: {
    fg: colors.danger,
    bg: "rgba(255, 85, 85, 0.10)",
    border: "rgba(255, 85, 85, 0.45)",
    text: "Cancelled",
  },
  historical: {
    fg: colors.text_dim,
    bg: "rgba(168, 176, 195, 0.08)",
    border: "rgba(168, 176, 195, 0.35)",
    text: "Historical",
  },
};

function toneFor(status: string | null): ChipTone {
  switch ((status ?? "").trim().toUpperCase()) {
    case "A":
      return TONES.active;
    case "E":
      return TONES.expired;
    case "C":
    case "T":
      return TONES.cancelled;
    default:
      // null, empty, or any unrecognised code reads as archive-only.
      return TONES.historical;
  }
}

export default function StatusChip({
  status,
  label,
  size,
}: {
  status: string | null;
  label?: string | null;
  size?: "sm" | "md";
}) {
  const tone = toneFor(status);
  const text = (label ?? "").trim() || tone.text;
  const sz = size ?? "sm";

  const fontSize = sz === "md" ? "0.68rem" : "0.58rem";
  const padding = sz === "md" ? "3px 9px" : "1px 7px";
  const dotPx = sz === "md" ? 6 : 5;

  return (
    <span
      title={`FCC license status: ${text}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sz === "md" ? "0.45em" : "0.4em",
        padding,
        borderRadius: "999px",
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.fg,
        fontFamily: fontStacks.mono,
        fontSize,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        lineHeight: 1.5,
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      <span
        aria-hidden
        style={{
          width: dotPx,
          height: dotPx,
          borderRadius: "50%",
          background: tone.fg,
          boxShadow: `0 0 6px ${tone.fg}`,
          flexShrink: 0,
        }}
      />
      {text}
    </span>
  );
}
