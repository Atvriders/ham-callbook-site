"use client";

/**
 * EmptyState — "no results" placard for tables, search, and rosters.
 *
 * Aesthetic: Sodium Vapor (locked). Imports tokens from lib/design.ts.
 *
 * Design intent
 *   - Mirrors a printed callbook errata slip: thin amber rule, a small
 *     mono-spaced "NO COPY" eyebrow, a Fraunces headline, optional body
 *     copy, and an optional CTA slot.
 *   - Default headline uses radio-operator vernacular ("Nothing heard")
 *     so it ties into the rest of the typography.
 *   - Used inline by DataTable's ``emptyFallback`` and the Facets /
 *     Pagination wrappers when a search returns zero hits.
 */

import type { CSSProperties, ReactNode } from "react";
import { colors, fontStacks } from "@/lib/design";

export interface EmptyStateProps {
  /** Mono-spaced eyebrow above the headline. Defaults "No Copy". */
  eyebrow?: string;
  /** Display-serif headline. Defaults "Nothing heard". */
  title?: string;
  /** Body copy describing what was searched / why this is empty. */
  description?: ReactNode;
  /** Optional CTA — a button / link rendered below the body copy. */
  action?: ReactNode;
  /** Horizontal padding override. */
  padding?: number;
  className?: string;
  style?: CSSProperties;
}

export default function EmptyState({
  eyebrow = "No Copy",
  title = "Nothing heard",
  description,
  action,
  padding = 32,
  className,
  style,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 10,
        padding: `${padding}px ${padding}px`,
        border: `1px dashed ${colors.border}`,
        borderRadius: 2,
        background: "rgba(255,163,11,0.02)",
        color: colors.text,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: fontStacks.mono,
          fontSize: 10.5,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: colors.accent,
        }}
      >
        {eyebrow}
      </span>

      <h3
        style={{
          margin: 0,
          fontFamily: fontStacks.display,
          fontVariationSettings: '"opsz" 32',
          fontWeight: 500,
          fontSize: 26,
          letterSpacing: "-0.01em",
          color: colors.text,
        }}
      >
        {title}
      </h3>

      {description && (
        <p
          style={{
            margin: 0,
            maxWidth: 420,
            fontFamily: fontStacks.body,
            fontSize: 14,
            lineHeight: 1.5,
            color: colors.text_dim,
          }}
        >
          {description}
        </p>
      )}

      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
