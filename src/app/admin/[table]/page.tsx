import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable } from "@/components/admin/data-table";
import { getTable, keyOf, listRows, primaryKey } from "@/lib/admin";

const PAGE_SIZE = 50;

export default async function TablePage({ params, searchParams }: PageProps<"/admin/[table]">) {
  const { table: name } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const table = await getTable(name);
  if (!table) notFound();

  // One extra row tells us whether there is a next page.
  const rows = await listRows(table, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const editable = primaryKey(table).length > 0;
  const pageLink = (p: number) => `/admin/${name}?page=${p}`;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="font-mono text-xl font-bold">{name}</h1>
        <Link href={`/admin/${name}/row`} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white">
          + New row
        </Link>
      </div>
      <DataTable
        columns={table.columns.map((c) => c.name)}
        rows={rows.slice(0, PAGE_SIZE)}
        editHref={
          editable
            ? (row) => `/admin/${name}/row?${new URLSearchParams(keyOf(table, row) as Record<string, string>)}`
            : undefined
        }
      />
      <div className="mt-4 flex items-center gap-3 text-muted">
        {page > 1 && <Link href={pageLink(page - 1)}>← Prev</Link>}
        <span>Page {page}</span>
        {hasNext && <Link href={pageLink(page + 1)}>Next →</Link>}
      </div>
    </>
  );
}
