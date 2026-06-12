"use client";

/**
 * CiteThisRecord — collapsible citation generator for callsign, club, and
 * edition records.
 *
 * Supports six formats: Evidence Explained, Chicago, MLA, APA, BibTeX, Plain.
 * All formatting is pure-function (no hooks, no fetch). The component lazily
 * fetches the dataset version from /api/health once on mount so the version
 * string is always current. Falls back to the static literal "v2026.06" if
 * the fetch fails or is still in-flight.
 *
 * No modal — renders as an inline collapsible (<details>/<summary>). Styling
 * follows the Sodium Vapor locked tokens from lib/design.ts.
 *
 * Strict-TS safe: all array index accesses guarded with ?? fallbacks.
 */

import { useState, useEffect } from "react";
import { colors, fontStacks } from "@/lib/design";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface CiteProps {
  recordType: "callsign" | "club" | "edition";
  /** Callsign (e.g. "W3ABC"), club slug, or year string */
  identifier: string;
  /** Operator or club display name (optional) */
  displayName?: string;
  /** Ordered array of edition keys, e.g. ["1941_Spring", "1946_Fall"] */
  editionList: string[];
  /** Canonical absolute URL for this record */
  permalink: string;
  /** Dataset version — caller supplies "v2026.06"; component may override from /api/health */
  datasetVersion: string;
  /** ISO date string for "Accessed" field, e.g. "2026-06-12" */
  accessDate: string;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

type Format = "evidence" | "chicago" | "mla" | "apa" | "bibtex" | "plain";

const FORMAT_LABELS: Record<Format, string> = {
  evidence: "Evidence Explained",
  chicago: "Chicago",
  mla: "MLA",
  apa: "APA",
  bibtex: "BibTeX",
  plain: "Plain Text",
};

const ACCURACY_NOTE =
  "Dataset accuracy ~97.1% (OCR-anchored); cite original scan for primary-source genealogical proof.";

/** Convert "1941_Spring" → "1941 Spring" */
function prettyEdition(key: string): string {
  return key.replace(/_/g, " ");
}

function editionListPretty(editionList: string[]): string {
  return editionList.map(prettyEdition).join(", ");
}

/** Derive a BibTeX-safe key from the identifier */
function bibtexKey(identifier: string): string {
  return identifier.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_callbook";
}

/** Uppercase first letter of display name for surname-first sort. */
function surnameFirst(displayName: string | undefined): string {
  if (!displayName) return "";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return displayName;
  const last = parts[parts.length - 1] ?? displayName;
  const rest = parts.slice(0, -1).join(" ");
  return `${last}, ${rest}`;
}

export function formatCitation(fmt: Format, props: CiteProps): string {
  const {
    recordType,
    identifier,
    displayName,
    editionList,
    permalink,
    datasetVersion,
    accessDate,
  } = props;

  const editions = editionListPretty(editionList);
  const surnameName = surnameFirst(displayName);
  const name = displayName ?? identifier;
  const label =
    recordType === "callsign"
      ? `${identifier} — ${name}`
      : recordType === "club"
      ? `${name}`
      : `Edition ${identifier}`;

  const sourceLabel = "USA Ham Callbook Archive";

  switch (fmt) {
    case "evidence":
      return [
        surnameName
          ? `${surnameName} (${identifier}). ${sourceLabel}, ${datasetVersion}.`
          : `${identifier}. ${sourceLabel}, ${datasetVersion}.`,
        editions ? ` Editions: ${editions}.` : "",
        ` <${permalink}>. Accessed ${accessDate}.`,
        `\n\n${ACCURACY_NOTE}`,
      ].join("");

    case "chicago":
      return [
        `${sourceLabel}. "${label}." ${datasetVersion}. ${permalink}. Accessed ${accessDate}.`,
        `\n\n${ACCURACY_NOTE}`,
      ].join("");

    case "mla":
      return [
        `"${identifier}." ${sourceLabel}, ${datasetVersion}, ${permalink}. Accessed ${accessDate}.`,
        `\n\n${ACCURACY_NOTE}`,
      ].join("");

    case "apa":
      return [
        `${sourceLabel}. (2026). ${identifier}`,
        editions ? ` [Ham radio license records, ${editions}].` : ".",
        ` ${datasetVersion}. ${permalink}`,
        `\n\n${ACCURACY_NOTE}`,
      ].join("");

    case "bibtex":
      return [
        `@misc{${bibtexKey(identifier)},`,
        `\n  title        = {${label}},`,
        `\n  howpublished = {\\url{${permalink}}},`,
        `\n  note         = {${sourceLabel} ${datasetVersion}; accessed ${accessDate}; ${ACCURACY_NOTE}}`,
        `\n}`,
      ].join("");

    case "plain":
    default:
      return [
        displayName
          ? `${identifier} (${displayName}). ${sourceLabel} ${datasetVersion}.`
          : `${identifier}. ${sourceLabel} ${datasetVersion}.`,
        editions ? ` Editions: ${editions}.` : "",
        ` ${permalink}. Accessed ${accessDate}.`,
        `\n\n${ACCURACY_NOTE}`,
      ].join("");
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CiteThisRecord(props: CiteProps) {
  const [activeFormat, setActiveFormat] = useState<Format>("evidence");
  const [copied, setCopied] = useState(false);
  const [liveVersion, setLiveVersion] = useState<string>(props.datasetVersion);

  // Fetch live dataset version from /api/health once on mount
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "dataset_version" in data &&
          typeof (data as Record<string, unknown>)["dataset_version"] === "string"
        ) {
          const v = (data as Record<string, string>)["dataset_version"];
          if (v) setLiveVersion(v);
        }
      })
      .catch(() => {
        /* silently fall back to prop value */
      });
    return () => controller.abort();
  }, []);

  const citationProps: CiteProps = { ...props, datasetVersion: liveVersion };
  const citationText = formatCitation(activeFormat, citationProps);

  function handleCopy() {
    navigator.clipboard.writeText(citationText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const formats = Object.entries(FORMAT_LABELS) as [Format, string][];

  return (
    <details
      style={{
        borderLeft: `4px solid ${colors.accent}`,
        background: colors.surface,
        borderRadius: "0 4px 4px 0",
        marginTop: "2rem",
        fontFamily: fontStacks.body,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "0.75rem 1rem",
          color: colors.accent,
          fontFamily: fontStacks.display,
          fontSize: "0.95rem",
          letterSpacing: "0.04em",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "0.8em", opacity: 0.7 }}>▶</span>
        Cite This Record
      </summary>

      <div style={{ padding: "0 1rem 1rem 1rem" }}>
        {/* Format selector row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.4rem",
            marginBottom: "0.75rem",
          }}
        >
          {formats.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveFormat(key)}
              style={{
                padding: "0.25rem 0.6rem",
                fontSize: "0.75rem",
                fontFamily: fontStacks.mono,
                cursor: "pointer",
                borderRadius: "3px",
                border: `1px solid ${activeFormat === key ? colors.accent : colors.border}`,
                background:
                  activeFormat === key ? colors.accent : "transparent",
                color: activeFormat === key ? colors.bg : colors.text_dim,
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Citation output */}
        <pre
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.8rem",
            color: colors.text,
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: "3px",
            padding: "0.75rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: "0 0 0.75rem 0",
            lineHeight: 1.6,
          }}
        >
          {citationText}
        </pre>

        {/* Copy button + version tag row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <button
            onClick={handleCopy}
            style={{
              padding: "0.35rem 0.9rem",
              fontSize: "0.8rem",
              fontFamily: fontStacks.mono,
              cursor: "pointer",
              borderRadius: "3px",
              border: `1px solid ${colors.accent}`,
              background: copied ? colors.accent : "transparent",
              color: copied ? colors.bg : colors.accent,
              transition: "all 0.15s",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <span
            style={{
              fontSize: "0.7rem",
              fontFamily: fontStacks.mono,
              color: colors.text_dim,
              opacity: 0.7,
            }}
          >
            {liveVersion} · accessed {props.accessDate}
          </span>
        </div>
      </div>
    </details>
  );
}
