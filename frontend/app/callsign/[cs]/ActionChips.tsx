"use client";

/**
 * ActionChips — small client island for the hero chip row: [copy call],
 * [copy link], [CSV export] and [print]. Everything else in the hero stays
 * server-rendered; only these four pills need browser APIs
 * (navigator.clipboard / navigator.share / window.print).
 *
 * Aesthetic: Sodium Vapor (locked). Pills match the QRZ outlink chip in the
 * same row (mono uppercase micro-type, hairline border, 999px radius) but
 * carry a 44px minimum tap target since they are the touch actions on the
 * page. Copy actions flash a brief "copied" confirmation state.
 *
 * All hex comes from lib/design.ts — no hard-coded palette.
 */

import { useEffect, useRef, useState } from "react";

import { colors, fontStacks } from "../../../lib/design";

interface ActionChipsProps {
  /** The callsign this page is showing (already uppercased). */
  callsign: string;
  /** Href of the per-callsign CSV export endpoint. */
  csvHref: string;
}

type CopyTarget = "call" | "link";

/** Shared pill baseline — mirrors the QRZ chip styling in the hero row. */
const PILL: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.45em",
  // 44px minimum tap target (spec) while keeping the pill silhouette.
  minHeight: "2.75rem",
  minWidth: "2.75rem",
  padding: "0.32rem 0.9rem",
  border: `1px solid ${colors.border}`,
  background: "rgba(19,26,45,0.55)",
  borderRadius: "999px",
  fontFamily: fontStacks.mono,
  fontSize: "0.65rem",
  letterSpacing: "0.32em",
  textTransform: "uppercase",
  color: colors.accent,
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * Copy `text` to the clipboard; on failure (insecure context, older mobile
 * browser) fall back to the native share sheet. Returns true when either
 * path succeeded so the caller can flash the confirmation state.
 */
async function copyOrShare(text: string, url?: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the share-sheet fallback
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share(url ? { url } : { text });
      return true;
    }
  } catch {
    // user dismissed the sheet, or share unavailable — treat as no-op
  }
  return false;
}

export default function ActionChips({ callsign, csvHref }: ActionChipsProps) {
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function flash(target: CopyTarget) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied(target);
    timerRef.current = setTimeout(() => setCopied(null), 1600);
  }

  async function handleCopyCall() {
    if (await copyOrShare(callsign)) flash("call");
  }

  async function handleCopyLink() {
    const href = window.location.href;
    if (await copyOrShare(href, href)) flash("link");
  }

  const copiedStyle: React.CSSProperties = {
    borderColor: colors.success,
    color: colors.success,
  };

  return (
    // display:contents keeps the buttons participating in the hero chip
    // row's own flex gap; the class hides all four actions when printing.
    <span className="cs-print-hide" style={{ display: "contents" }}>
      <button
        type="button"
        onClick={() => void handleCopyCall()}
        aria-label={`Copy callsign ${callsign} to clipboard`}
        title="Copy callsign to clipboard"
        style={{ ...PILL, ...(copied === "call" ? copiedStyle : null) }}
      >
        {copied === "call" ? (
          <>
            copied
            <span aria-hidden style={{ fontSize: "0.9em" }}>✓</span>
          </>
        ) : (
          "copy call"
        )}
      </button>

      <button
        type="button"
        onClick={() => void handleCopyLink()}
        aria-label="Copy a link to this record"
        title="Copy a link to this record"
        style={{ ...PILL, ...(copied === "link" ? copiedStyle : null) }}
      >
        {copied === "link" ? (
          <>
            copied
            <span aria-hidden style={{ fontSize: "0.9em" }}>✓</span>
          </>
        ) : (
          "copy link"
        )}
      </button>

      <a
        href={csvHref}
        download={`${callsign}.csv`}
        aria-label={`Download ${callsign} record as CSV`}
        title="Download this record as CSV"
        style={PILL}
      >
        csv
        <span aria-hidden style={{ color: colors.accent_2, fontSize: "0.85em" }}>
          ↓
        </span>
      </a>

      <button
        type="button"
        onClick={() => window.print()}
        aria-label="Print this record"
        title="Print this record"
        style={PILL}
      >
        print
      </button>
    </span>
  );
}
