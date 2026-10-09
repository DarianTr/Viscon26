"use client";

import { useActionState } from "react";
import { runQuery } from "@/app/admin/actions";
import { DataTable } from "./data-table";

const MAX_ROWS = 500;

export function SqlConsole() {
  const [state, action, running] = useActionState(runQuery, undefined);
  const result = state?.result;

  return (
    <>
      <form action={action} className="flex flex-col gap-2">
        <textarea
          name="query"
          defaultValue={state?.query ?? "select handle, name, is_admin from users order by handle;"}
          rows={6}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          className="w-full rounded-xl bg-surface-2 p-3 font-mono text-xs ring-1 ring-border outline-none focus:ring-accent"
        />
        <div className="flex items-center gap-3">
          <button disabled={running} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
            {running ? "Running…" : "Run"}
          </button>
          <span className="text-xs text-muted">⌘/Ctrl + Enter</span>
        </div>
      </form>

      <div className="mt-5">
        {state?.error && <pre className="whitespace-pre-wrap text-tempo">{state.error}</pre>}
        {result && (
          <>
            <p className="mb-2 text-muted">
              {result.command} · {result.count} row{result.count === 1 ? "" : "s"}
              {result.rows.length > MAX_ROWS && ` (showing first ${MAX_ROWS})`}
            </p>
            {result.columns.length > 0 && (
              <DataTable columns={result.columns} rows={result.rows.slice(0, MAX_ROWS)} />
            )}
          </>
        )}
      </div>
    </>
  );
}
