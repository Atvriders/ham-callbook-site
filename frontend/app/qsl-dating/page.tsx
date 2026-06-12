/**
 * /qsl-dating — QSL Dating Wizard
 *
 * Server component shell. Renders the page header (static, server-rendered)
 * and mounts the <QslWizard> client island which handles all interactive
 * state and API calls.
 *
 * No data pre-fetching needed here — the wizard is query-driven.
 */

import type { Metadata } from "next";
import { colors, fontStacks, motifs } from "../../lib/design";
import MorseDivider from "../../components/MorseDivider";
import QslWizard from "../../components/QslWizard";

export const metadata: Metadata = {
  title: "QSL Dating Wizard — Ham Callbook Archive",
  description:
    "Narrow the probable send-date of a QSL card using callbook archive data. Enter a callsign plus any known clues (city, state, name, address) to get a date window.",
};

export default function QslDatingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        padding: "2rem 1rem",
      }}
    >
      <div style={{ maxWidth: "52rem", margin: "0 auto" }}>
        {/* ---------------------------------------------------------------- */}
        {/* Hero header                                                       */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ marginBottom: "0.5rem" }}>
          <span
            style={{
              fontFamily: fontStacks.mono,
              fontSize: "0.7rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: colors.accent,
            }}
          >
            Research Tool
          </span>
        </div>
        <h1
          style={{
            fontFamily: fontStacks.display,
            fontSize: "clamp(1.75rem, 5vw, 2.75rem)",
            color: colors.text,
            margin: "0 0 0.5rem 0",
            fontWeight: 900,
            lineHeight: 1.1,
          }}
        >
          QSL Dating Wizard
        </h1>
        <p
          style={{
            fontFamily: fontStacks.body,
            fontSize: "1rem",
            color: colors.text_dim,
            margin: "0 0 0.25rem 0",
            lineHeight: 1.6,
            maxWidth: "38rem",
          }}
        >
          Holding a mystery QSL card? Enter the callsign and any details you
          can read from the card — city, state, operator name, or street
          address. The wizard cross-references the{" "}
          <strong style={{ color: colors.text }}>7.8 million</strong> callbook
          entries to narrow the probable send-date window.
        </p>
        <p
          style={{
            fontFamily: fontStacks.mono,
            fontSize: "0.72rem",
            color: colors.text_dim,
            margin: "0 0 1.5rem 0",
            letterSpacing: "0.04em",
          }}
        >
          Dataset: USA Ham Callbooks v2026.06 · accuracy ~97.1% (OCR-anchored)
        </p>

        <MorseDivider />

        <div style={{ marginTop: "1.5rem" }}>
          <QslWizard />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* How it works                                                      */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ marginTop: "3rem" }}>
          <MorseDivider />
          <h2
            style={{
              fontFamily: fontStacks.display,
              fontSize: "1.15rem",
              color: colors.text,
              margin: "1.25rem 0 0.75rem 0",
              fontWeight: 700,
            }}
          >
            How it works
          </h2>
          <ul
            style={{
              fontFamily: fontStacks.body,
              fontSize: "0.9rem",
              color: colors.text_dim,
              lineHeight: 1.7,
              paddingLeft: "1.25rem",
              margin: 0,
            }}
          >
            <li>
              Each callsign may appear in dozens of annual callbook editions
              spanning 1927–1993.
            </li>
            <li>
              Adding clues (city, state, name, address) filters to only the
              editions where that combination appears, yielding a tighter
              date window.
            </li>
            <li>
              <strong style={{ color: colors.text }}>High confidence</strong>{" "}
              = ≤5 year window.{" "}
              <strong style={{ color: colors.text }}>Medium</strong> = 6–20
              years.{" "}
              <strong style={{ color: colors.text }}>Low</strong> = &gt;20
              years. More clues narrow the window.
            </li>
            <li>
              The amber timeline bar shows all callbook appearances; bright
              ticks mark the editions matching your clues.
            </li>
            <li>
              OCR noise is possible — try partial city or name fragments if an
              exact match returns nothing.
            </li>
          </ul>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Footer note                                                       */}
        {/* ---------------------------------------------------------------- */}
        <div
          style={{
            marginTop: "2.5rem",
            paddingTop: "1rem",
            borderTop: `1px solid ${colors.border}`,
            fontFamily: fontStacks.mono,
            fontSize: "0.65rem",
            color: colors.text_dim,
            letterSpacing: "0.05em",
          }}
        >
          <span style={{ color: colors.accent }}>{motifs.morseDividers.tight}</span>
          {"  "}Dataset accuracy ~97.1% (OCR-anchored); cite original scan for
          primary-source genealogical proof. v2026.06.
        </div>
      </div>
    </main>
  );
}
