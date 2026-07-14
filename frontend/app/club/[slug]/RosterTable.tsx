"use client";

/**
 * RosterTable — client wrapper around <DataTable /> for /club/[slug].
 *
 * The parent /club/[slug]/page.tsx is a React Server Component. Next.js
 * forbids passing functions (column.render, rowKey) across the
 * server→client boundary because they aren't serializable. This thin
 * "use client" wrapper owns the render functions internally and receives
 * only plain-serializable row data (ClubCallsignRow[]) from the server
 * component.
 */

import Link from "next/link";

import { colors } from "../../../lib/design";
import DataTable, {
  type DataTableColumn,
} from "../../../components/DataTable";

export interface ClubCallsignRow {
  callsign: string;
  first_year: number | null;
  last_year: number | null;
  appearance_count: number;
  location_summary: string | null;
}

export default function RosterTable({ rows }: { rows: ClubCallsignRow[] }) {
  const columns: DataTableColumn<ClubCallsignRow>[] = [
    {
      key: "callsign",
      label: "Callsign",
      width: "minmax(6rem, 8rem)",
      mono: true,
      render: (row) => (
        <Link
          href={`/callsign/${encodeURIComponent(row.callsign)}`}
          style={{
            color: colors.accent,
            textDecoration: "none",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          {row.callsign}
        </Link>
      ),
    },
    {
      key: "first_year",
      label: "First",
      width: "minmax(4rem, 5rem)",
      align: "right",
    },
    {
      key: "last_year",
      label: "Last",
      width: "minmax(4rem, 5rem)",
      align: "right",
    },
    {
      key: "appearance_count",
      label: "Appearances",
      width: "minmax(6rem, 7rem)",
      align: "right",
      render: (row) => (
        <span style={{ color: colors.glow }}>
          {row.appearance_count.toLocaleString()}
        </span>
      ),
    },
    {
      key: "location_summary",
      label: "Location",
      width: "minmax(0, 1.4fr)",
    },
  ];

  return (
    <DataTable
      columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]}
      rows={rows as unknown as Record<string, unknown>[]}
      rowKey={(r) => (r as unknown as ClubCallsignRow).callsign}
      // Fixed column minimums total ~20rem; give Location breathing room and
      // let DataTable's overflow wrapper scroll sideways on narrow phones.
      minWidth="34rem"
    />
  );
}
