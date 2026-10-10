import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { listTables } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" } };

/** Admin shell: table list on the left. Only admins get past requireAdmin(). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await requireAdmin();
  const tables = await listTables();

  return (
    <div className="flex min-h-dvh text-sm">
      <aside className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-4">
        <Link href="/admin" className="mb-3 px-2 text-base font-bold">
          Database
        </Link>
        {tables.map((t) => (
          <Link
            key={t.name}
            href={`/admin/${t.name}`}
            className="flex justify-between rounded-lg px-2 py-1.5 font-mono hover:bg-surface-2"
          >
            {t.name}
            <span className="text-muted">{t.rows}</span>
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-muted">
          <span className="px-2">@{user.handle}</span>
          <Link href="/" className="rounded-lg px-2 py-1.5 hover:bg-surface-2">
            ← Back to app
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
