/**
 * Footer — provenance, attributions, and meta navigation.
 *
 * The site's data has a story (digitised printed callbooks, FCC ULS
 * cross-reference, OCR confidence grading) and the footer is where we
 * tell it succinctly. It's intentionally text-heavy and editorial —
 * three columns of marginalia rather than a wall of social icons.
 *
 * Anatomy
 *   - <MorseDivider/> sits above the footer proper instead of an <hr>,
 *     reinforcing the radio aesthetic.
 *   - Provenance column on the left (the editorial pitch + sitemark).
 *   - Three section columns: Data sources · Methodology · External links.
 *     Each heading carries a short dit/dah prefix in JetBrains Mono.
 *   - Colophon strip with the year, dataset name, and a sign-off in
 *     italic Fraunces — "73 de ARCHIVE" — the radio operator's
 *     traditional farewell. That's the memorable thing here.
 *
 * Server component — nothing runs at runtime.
 */

import Link from "next/link";

import { colors, fontStacks, motifs } from "../lib/design";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

interface FooterSection {
  heading: string;
  /** Tiny morse glyph prefix for the column heading. */
  glyph: string;
  links: FooterLink[];
}

const SECTION_LINKS: readonly FooterSection[] = [
  {
    heading: "Data sources",
    glyph: "·—·",
    links: [
      { href: "/about#sources", label: "Printed callbooks (1909–1999)" },
      { href: "/about#uls", label: "FCC ULS database" },
      { href: "/about#ocr", label: "OCR confidence grading" },
    ],
  },
  {
    heading: "Methodology",
    glyph: "—··",
    links: [
      { href: "/about", label: "Project & method" },
      { href: "/about#data-quality", label: "Data quality notes" },
      { href: "/about#corrections", label: "Submit a correction" },
    ],
  },
  {
    heading: "External",
    glyph: "···—",
    links: [
      { href: "https://www.fcc.gov/uls", label: "FCC ULS", external: true },
      { href: "https://www.arrl.org", label: "ARRL", external: true },
      { href: "/about#license", label: "License & terms" },
    ],
  },
] as const;

/**
 * Decorative morse divider — a single long row of dits and dahs in
 * the mono stack, with a centred amber glyph anchoring it. Replaces
 * <hr> throughout the site.
 */
function MorseDivider() {
  return (
    <div
      aria-hidden
      className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      style={{ padding: "1.25rem 0" }}
    >
      <div
        style={{
          fontFamily: fontStacks.mono,
          color: colors.text_dim,
          opacity: 0.55,
          letterSpacing: "0.45em",
          fontSize: "0.7rem",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
        }}
      >
        <span style={{ flex: 1, height: 1, background: colors.border }} />
        <span>{motifs.morseDividers.pattern}</span>
        <span
          style={{
            color: colors.accent,
            letterSpacing: "0.1em",
            textShadow: motifs.glow.textShadow,
          }}
        >
          ◇
        </span>
        <span>{motifs.morseDividers.pattern}</span>
        <span style={{ flex: 1, height: 1, background: colors.border }} />
      </div>
    </div>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="mt-24 w-full"
      style={{
        borderTop: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        color: colors.text, // bone cream baseline on midnight
      }}
    >
      <MorseDivider />

      <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-12 pt-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        {/* Provenance column — the editorial pitch (wide left) */}
        <div className="lg:col-span-5">
          <div
            className="mb-3 text-sm tracking-[0.22em]"
            style={{
              fontFamily: fontStacks.display,
              color: colors.text,
              fontVariationSettings: '"opsz" 48, "SOFT" 30',
              fontWeight: 500,
            }}
          >
            USA{" "}
            <span
              className="italic"
              style={{
                color: colors.accent,
                fontVariationSettings: '"opsz" 48, "SOFT" 100, "WONK" 1',
                textShadow: motifs.glow.textShadow,
              }}
            >
              HAM
            </span>{" "}
            CALLBOOKS
          </div>
          <p
            className="max-w-md text-sm leading-relaxed"
            style={{ fontFamily: fontStacks.body, color: colors.text_dim }}
          >
            A searchable archive of 20th-century United States amateur radio
            callbooks, cross-referenced against the modern FCC ULS database
            and graded for OCR confidence. Built for radio historians,
            genealogists, and anyone tracing a callsign&rsquo;s lineage.
          </p>
        </div>

        {/* Three link columns */}
        {SECTION_LINKS.map((section) => (
          <nav
            key={section.heading}
            aria-label={section.heading}
            className="lg:col-span-2"
            style={{ minWidth: 0 }}
          >
            <div
              className="mb-3 flex items-baseline gap-2 text-xs uppercase tracking-[0.22em]"
              style={{
                fontFamily: fontStacks.mono,
                color: colors.accent,
              }}
            >
              <span
                aria-hidden
                style={{
                  color: colors.accent_2,
                  letterSpacing: "0.15em",
                  opacity: 0.75,
                }}
              >
                {section.glyph}
              </span>
              {section.heading}
            </div>
            <ul className="space-y-1.5">
              {section.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm transition-colors duration-150 hover:text-[var(--color-accent,#ffa30b)]"
                      style={{
                        fontFamily: fontStacks.body,
                        color: colors.text_dim,
                      }}
                    >
                      {link.label}
                      <span
                        aria-hidden
                        style={{
                          marginLeft: "0.35em",
                          color: colors.accent_2,
                          fontFamily: fontStacks.mono,
                          fontSize: "0.85em",
                        }}
                      >
                        ↗
                      </span>
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm transition-colors duration-150 hover:text-[var(--color-accent,#ffa30b)]"
                      style={{
                        fontFamily: fontStacks.body,
                        color: colors.text_dim,
                      }}
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}

        {/* Sign-off column — small but the memorable detail */}
        <div className="lg:col-span-1">
          <div
            className="text-right text-lg leading-tight italic"
            style={{
              fontFamily: fontStacks.display,
              fontVariationSettings: '"opsz" 60, "SOFT" 100, "WONK" 1',
              color: colors.accent,
              textShadow: motifs.glow.textShadow,
              letterSpacing: "0.02em",
            }}
            title="ham operator's traditional farewell — best regards, from"
          >
            73
            <br />
            de
            <br />
            <span
              style={{
                fontFamily: fontStacks.mono,
                fontStyle: "normal",
                fontSize: "0.7rem",
                color: colors.text_dim,
                textShadow: "none",
                letterSpacing: "0.18em",
              }}
            >
              ARCHIVE
            </span>
          </div>
        </div>
      </div>

      {/* Colophon strip */}
      <div
        className="mx-auto max-w-7xl px-4 pb-8 text-xs sm:px-6 lg:px-8"
        style={{
          fontFamily: fontStacks.mono,
          color: colors.text_dim,
          opacity: 0.7,
          borderTop: `1px solid ${colors.border}`,
          paddingTop: "1rem",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <span style={{ color: colors.accent_2, letterSpacing: "0.2em" }}>
              {motifs.morseDividers.tight}
            </span>
            &nbsp;&nbsp;{year} &middot; archival project, no affiliation with
            the FCC or ARRL.
          </span>
          <span>
            corpus:{" "}
            <span style={{ color: colors.accent }}>OCR + ULS</span>
            &nbsp;&middot;&nbsp; dataset:{" "}
            <span style={{ color: colors.accent }}>USA_Ham_Callbooks</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
