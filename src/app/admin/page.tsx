import { SqlConsole } from "@/components/admin/sql-console";

export default function AdminHome() {
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">SQL console</h1>
      <p className="mb-4 text-muted">
        Runs directly against the database, with no undo. Pick a table on the left to browse and edit rows.
      </p>
      <SqlConsole />
    </>
  );
}
