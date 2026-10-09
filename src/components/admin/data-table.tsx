import Link from "next/link";
import type { Row } from "@/lib/admin";

/** Read-only grid of text values; long values are truncated (hover for all). */
export function DataTable({
  columns,
  rows,
  editHref,
}: {
  columns: string[];
  rows: Row[];
  editHref?: (row: Row) => string;
}) {
  if (!rows.length) return <p className="text-muted">No rows.</p>;

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-border">
      <table className="w-full font-mono text-xs">
        <thead className="bg-surface-2 text-left">
          <tr>
            {editHref && <th className="px-3 py-2" />}
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border hover:bg-surface">
              {editHref && (
                <td className="px-3 py-1.5">
                  <Link href={editHref(row)} className="text-accent">
                    edit
                  </Link>
                </td>
              )}
              {columns.map((c) => (
                <td key={c} title={row[c] ?? "NULL"} className="max-w-64 truncate px-3 py-1.5 whitespace-nowrap">
                  {row[c] ?? <span className="text-muted">NULL</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
