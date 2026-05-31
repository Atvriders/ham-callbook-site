"use client";

/**
 * EntriesTable — client wrapper around <DataTable /> for the /state/[s] page.
 *
 * The parent /state/[s]/page.tsx is a React Server Component. Next.js forbids
 * passing functions (e.g. column.render, rowKey) across the server→client
 * boundary because they aren't serializable. This thin "use client" wrapper
 * owns the render functions internally and receives only plain-serializable
 * row data (StateEntry[]) from the server component.
 */

import Link from "next/link";

import { colors } from "../../../lib/design";
import DataTable, {
  type DataTableColumn,
} from "../../../components/DataTable";
import { cleanOCRName, cleanOCRCity, classLabelForCode } from "../../../lib/ocrClean";

export interface StateEntry {
  year: number | null;
  edition: string | null;
  callsign: string | null;
  license_class: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export default function EntriesTable({ entries }: { entries: StateEntry[] }) {
  const columns: DataTableColumn<StateEntry>[] = [
    {
      key: "callsign",
      label: "Callsign",
      width: "minmax(6rem, 8rem)",
      mono: true,
      render: (row) =>
        row.callsign ? (
          <Link
            href={`/callsign/${encodeURIComponent(row.callsign)}`}
            style={{
              color: colors.accent,
              textDecoration: "none",
            }}
          >
            {row.callsign}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "name",
      label: "Name",
      width: "minmax(0, 2fr)",
      render: (row) => cleanOCRName(row.name) || "—",
    },
    {
      key: "city",
      label: "City",
      width: "minmax(0, 1.4fr)",
      render: (row) => cleanOCRCity(row.city) || "—",
    },
    { key: "year", label: "Year", width: "minmax(4rem, 5rem)", align: "right" },
    {
      key: "edition",
      label: "Edition",
      width: "minmax(5rem, 7rem)",
      align: "right",
    },
    {
      key: "license_class",
      label: "Class",
      width: "minmax(3.5rem, 4.5rem)",
      align: "right",
      mono: true,
      render: (row) => {
        const label = classLabelForCode(row.license_class, row.year as number | null);
        return label !== "—" ? (
          <span style={{ color: colors.glow }}>{label}</span>
        ) : (
          "—"
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]}
      rows={entries as unknown as Record<string, unknown>[]}
      rowKey={(r) => {
        const e = r as unknown as StateEntry;
        return `${e.callsign ?? "?"}-${e.year ?? "?"}-${e.edition ?? "?"}`;
      }}
    />
  );
}
