import Link from "next/link";
import { notFound } from "next/navigation";
import { RowForm } from "@/components/admin/row-form";
import { getRow, getTable, primaryKey, type Row } from "@/lib/admin";
import { removeRow, saveRow } from "../../actions";

/**
 * /admin/:table/row            → insert a new row
 * /admin/:table/row?<pk>=<v>   → edit (or delete) the row with that key
 */
export default async function RowPage({ params, searchParams }: PageProps<"/admin/[table]/row">) {
  const { table: name } = await params;
  const query = await searchParams;
  const table = await getTable(name);
  if (!table) notFound();

  const pkCols = primaryKey(table);
  const key: Row | null = pkCols.some((c) => typeof query[c.name] === "string")
    ? Object.fromEntries(pkCols.map((c) => [c.name, String(query[c.name] ?? "")]))
    : null;
  const row = key && (await getRow(table, key));
  if (key && !row) notFound();

  return (
    <>
      <Link href={`/admin/${name}`} className="text-muted">
        ← {name}
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-bold">{key ? "Edit row" : "New row"}</h1>
      {query.saved && <p className="mb-4 text-recovery">Saved.</p>}
      <RowForm
        // Remount after a save so the inputs show the stored values.
        key={JSON.stringify(row)}
        columns={table.columns}
        row={row}
        save={saveRow.bind(null, name, key)}
        remove={key ? removeRow.bind(null, name, key) : undefined}
      />
    </>
  );
}
