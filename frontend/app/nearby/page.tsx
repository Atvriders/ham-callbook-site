/**
 * /nearby — Hams Near Me
 *
 * Server component shell. Renders the static page header (metadata, hero
 * copy, how-it-works) and mounts the <NearbyExplorer> client island which
 * owns all interactive state: the address input, /api/nearby fetching,
 * index-warm-up polling, and the ring-grouped result list.
 *
 * Reads ?q= from searchParams so deep links (e.g. the callsign page's
 * "See all nearby →") prefill and auto-run the search. The island is
 * keyed by that value so client-side navigation to a new ?q= remounts
 * and re-runs.
 */

import type { Metadata } from "next";
import { colors, fontStacks, motifs } from "../../lib/design";
import MorseDivider from "../../components/MorseDivider";
import NearbyExplorer from "./NearbyExplorer";

export const metadata: Metadata = {
  title: "Hams Near Me — Ham Callbook Atlas",
  description:
    "Enter a ZIP code, city, or address and sweep the surrounding miles for every amateur radio callsign in the archive — distance, license status, and last printed appearance.",
};

export default async function NearbyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const initialQuery = (sp.q ?? "").trim();

  return (
    <main
      style={{
        minHeight: "100dvh",
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
            Direction Finder
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
          Hams Near Me
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
          Drop a pin anywhere in the United States — a ZIP code, a hometown,
          or a full mailing address — and sweep the surrounding miles for
          every callsign in the archive. Each hit shows its distance, FCC
          license status, and the last edition it was printed in.
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
          Range rings at 5 / 25 mi · positions from each call&rsquo;s latest
          printed ZIP · 33,791 ZCTA centroids
        </p>

        <MorseDivider />

        <div style={{ marginTop: "1.5rem" }}>
          <NearbyExplorer key={initialQuery} initialQuery={initialQuery} />
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
              Type a five-digit ZIP, a{" "}
              <strong style={{ color: colors.text }}>City, ST</strong> pair,
              or a whole mailing address — if a ZIP appears anywhere in the
              query it wins.
            </li>
            <li>
              Every callsign is pinned to its most recent printed address
              that carries a valid ZIP (editions 1979 through the 2003 CD),
              located via ZCTA centroids — accurate to the neighborhood, not
              the doorstep.
            </li>
            <li>
              Results sweep outward in range rings. If fewer than a dozen
              hams sit within 10 mi, the search widens automatically — out
              to 250 mi if it must.
            </li>
            <li>
              Status chips come from the FCC ULS snapshot.{" "}
              <strong style={{ color: colors.text }}>Historical</strong>{" "}
              means the call exists only in the printed archive.
            </li>
            <li>
              The very first search after a restart warms up the location
              index — give it a few seconds; the page keeps polling for you.
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
          <span style={{ color: colors.accent }}>
            {motifs.morseDividers.tight}
          </span>
          {"  "}Distances are centroid-to-centroid great-circle miles;
          printed addresses may predate a move. Cite the original scan for
          primary-source proof.
        </div>
      </div>
    </main>
  );
}
