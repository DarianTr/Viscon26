"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/admin/actions";
import type { Column, Row } from "@/lib/admin";

const input = "w-full rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs ring-1 ring-border outline-none focus:ring-accent";

/**
 * One field per column, as text. Postgres casts the text back to the column
 * type on save, so anything it accepts works (e.g. `{1,2}` for arrays, JSON
 * for jsonb, `2026-10-12 09:00+02` for timestamps).
 */
export function RowForm({
  columns,
  row,
  save,
  remove,
}: {
  columns: Column[];
  row: Row | null;
  save: (prev: ActionState, form: FormData) => Promise<ActionState>;
  remove?: () => Promise<ActionState>;
}) {
  const [state, saveAction, saving] = useActionState(save, undefined);
  const [removeState, removeAction, removing] = useActionState(async () => remove?.(), undefined);
  const error = state?.error ?? removeState?.error;

  return (
    <form action={saveAction} className="flex max-w-2xl flex-col gap-3">
      {columns.map((c) => {
        const value = row?.[c.name];
        const long = (value?.length ?? 0) > 60 || c.type === "jsonb" || c.type === "json";
        return (
          <label key={c.name} className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className="font-mono font-semibold">{c.name}</span>
              <span className="text-xs text-muted">
                {c.type}
                {c.primaryKey && " · key"}
                {!row && c.hasDefault && " · blank = default"}
              </span>
              {c.nullable && (
                <span className="ml-auto flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" name={`null:${c.name}`} defaultChecked={row != null && value === null} />
                  null
                </span>
              )}
            </span>
            {long ? (
              <textarea name={`col:${c.name}`} defaultValue={value ?? ""} rows={4} className={input} />
            ) : (
              <input name={`col:${c.name}`} defaultValue={value ?? ""} className={input} />
            )}
          </label>
        );
      })}
      {error && <p className="text-tempo">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
          {saving ? "Saving…" : row ? "Save" : "Insert"}
        </button>
        {remove && (
          <button
            formAction={removeAction}
            disabled={removing}
            onClick={(e) => {
              if (!confirm("Delete this row? Rows that reference it may be deleted too.")) e.preventDefault();
            }}
            className="rounded-lg bg-surface-2 px-4 py-2 font-semibold text-tempo disabled:opacity-60"
          >
            {removing ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </form>
  );
}
