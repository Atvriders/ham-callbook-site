"use client";
/**
 * SuggestCorrection — inline correction-suggestion widget.
 *
 * Usage: drop anywhere on the callsign detail page (or any record-level page).
 * Pre-fill `callsign`, `year`, `edition`, `field`, `oldValue` from the parent
 * to produce a focused, one-click form.
 *
 * On submit POSTs to /api/corrections. Shows inline success/error feedback.
 * No navigation — the form collapses to a "Thank you" note on success.
 *
 * Design: Sodium Vapor palette, JetBrains Mono for callsign display,
 * Fraunces for the heading. No external deps beyond React.
 */

import { useState } from "react";
import { colors, fontStacks } from "../lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  callsign: string;
  year?: number | null;
  edition?: string | null;
  /** Pre-fill which field is being corrected */
  field?: string;
  /** Current (possibly wrong) value */
  oldValue?: string;
}

const CORRECTABLE_FIELDS = [
  { value: "name",          label: "Name" },
  { value: "address",       label: "Address" },
  { value: "city",          label: "City" },
  { value: "state",         label: "State" },
  { value: "zip",           label: "ZIP" },
  { value: "license_class", label: "License class" },
  { value: "callsign",      label: "Callsign" },
  { value: "raw_ocr",       label: "Raw OCR line" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SuggestCorrection({ callsign, year, edition, field = "name", oldValue = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedField, setSelectedField] = useState(field);
  const [newValue, setNewValue] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newValue.trim()) return;
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callsign,
          year: year ?? undefined,
          edition: edition ?? undefined,
          field: selectedField,
          old_value: oldValue || undefined,
          new_value: newValue.trim(),
          source_note: sourceNote.trim() || undefined,
        }),
      });

      if (res.status === 429) {
        setResult({ ok: false, message: "You've reached the hourly submission limit. Try again later." });
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = typeof err?.detail === "string" ? err.detail : "Submission failed. Please try again.";
        setResult({ ok: false, message: msg });
        return;
      }

      setResult({ ok: true, message: "Thank you — your suggestion has been queued for review." });
      setNewValue("");
      setSourceNote("");
    } catch {
      setResult({ ok: false, message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Closed state: a small button -----
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          color: colors.text_dim,
          fontFamily: fontStacks.body,
          fontSize: "0.78rem",
          cursor: "pointer",
          padding: "3px 10px",
          letterSpacing: "0.04em",
          transition: "color 0.15s, border-color 0.15s",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.color = colors.text_dim;
          (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
        }}
      >
        Suggest a correction
      </button>
    );
  }

  // ----- Open state: inline form -----
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "16px 20px",
        maxWidth: 480,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{
          fontFamily: fontStacks.display,
          fontSize: "0.95rem",
          color: colors.text,
          fontWeight: 600,
        }}>
          Suggest a correction for{" "}
          <span style={{ fontFamily: fontStacks.mono, color: colors.accent }}>{callsign}</span>
          {year ? ` (${year})` : ""}
        </span>
        <button
          onClick={() => { setOpen(false); setResult(null); }}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: colors.text_dim,
            fontSize: "1.1rem",
            cursor: "pointer",
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {result?.ok ? (
        <p style={{
          color: colors.success,
          fontFamily: fontStacks.body,
          fontSize: "0.88rem",
          margin: 0,
        }}>
          {result.message}
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Field selector */}
          <label style={{ color: colors.text_dim, fontFamily: fontStacks.body, fontSize: "0.8rem" }}>
            Field to correct
            <select
              value={selectedField}
              onChange={e => setSelectedField(e.target.value)}
              style={inputStyle}
            >
              {CORRECTABLE_FIELDS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>

          {/* Corrected value */}
          <label style={{ color: colors.text_dim, fontFamily: fontStacks.body, fontSize: "0.8rem" }}>
            Corrected value
            <input
              type="text"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder="Enter the correct value…"
              required
              maxLength={500}
              style={inputStyle}
            />
          </label>

          {/* Source note */}
          <label style={{ color: colors.text_dim, fontFamily: fontStacks.body, fontSize: "0.8rem" }}>
            Source / evidence{" "}
            <span style={{ opacity: 0.6 }}>(optional)</span>
            <input
              type="text"
              value={sourceNote}
              onChange={e => setSourceNote(e.target.value)}
              placeholder="e.g. FCC ULS record, QRZ.com, personal knowledge…"
              maxLength={1000}
              style={inputStyle}
            />
          </label>

          {result && !result.ok && (
            <p style={{ color: colors.danger, fontFamily: fontStacks.body, fontSize: "0.82rem", margin: 0 }}>
              {result.message}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button
              type="submit"
              disabled={submitting || !newValue.trim()}
              style={{
                background: colors.accent,
                border: "none",
                borderRadius: 4,
                color: colors.bg,
                fontFamily: fontStacks.body,
                fontSize: "0.85rem",
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
                padding: "6px 18px",
                opacity: (!newValue.trim() || submitting) ? 0.5 : 1,
              }}
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setResult(null); }}
              style={{
                background: "none",
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                color: colors.text_dim,
                fontFamily: fontStacks.body,
                fontSize: "0.85rem",
                cursor: "pointer",
                padding: "6px 12px",
              }}
            >
              Cancel
            </button>
          </div>

          <p style={{
            color: colors.text_dim,
            fontFamily: fontStacks.body,
            fontSize: "0.73rem",
            margin: 0,
            opacity: 0.7,
          }}>
            Submissions are reviewed before any change is made to the archive.
            Honor-system — no account required.
          </p>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared input style
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  background: "#0a0e1a",
  border: "1px solid #2a3349",
  borderRadius: 4,
  color: "#f5ecd9",
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "0.82rem",
  padding: "5px 8px",
  boxSizing: "border-box",
};
