"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  deleteRow,
  getTable,
  insertRow,
  keyOf,
  runSql,
  updateRow,
  type QueryResult,
  type Row,
} from "@/lib/admin";

/*
 * Every action re-checks that the caller is an admin: server actions are
 * public endpoints, whichever page renders them.
 */

export type ActionState = { error?: string } | undefined;
export type SqlState = { query: string; result?: QueryResult; error?: string } | undefined;

const message = (err: unknown) =>
  (err as { cause?: { message?: string } })?.cause?.message ??
  (err instanceof Error ? err.message : String(err));

async function tableOrThrow(name: string) {
  const table = await getTable(name);
  if (!table) throw new Error(`No table ${name}`);
  return table;
}

const editUrl = (table: string, key: Row) =>
  `/admin/${table}/row?${new URLSearchParams(key as Record<string, string>)}`;

/**
 * Turn the submitted form into column values. Inserts skip blank fields so
 * the column's default applies; on both insert and update, a ticked "null"
 * box stores NULL.
 */
function readValues(form: FormData, columns: string[], skipBlank: boolean): Row {
  const values: Row = {};
  for (const name of columns) {
    if (form.get(`null:${name}`)) values[name] = null;
    else {
      const value = form.get(`col:${name}`);
      if (value === null || (skipBlank && value === "")) continue;
      values[name] = String(value);
    }
  }
  return values;
}

/** Insert (key null) or update one row; on success go to its edit page. */
export async function saveRow(
  tableName: string,
  key: Row | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireAdmin();
  let saved: Row | null;
  try {
    const table = await tableOrThrow(tableName);
    const values = readValues(form, table.columns.map((c) => c.name), !key);
    const row = key ? await updateRow(table, key, values) : await insertRow(table, values);
    saved = row && keyOf(table, row);
  } catch (err) {
    return { error: message(err) };
  }
  if (!saved) return { error: "Row no longer exists" };
  revalidatePath(`/admin`, "layout");
  redirect(`${editUrl(tableName, saved)}&saved=1`);
}

export async function removeRow(tableName: string, key: Row): Promise<ActionState> {
  await requireAdmin();
  try {
    await deleteRow(await tableOrThrow(tableName), key);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath(`/admin`, "layout");
  redirect(`/admin/${tableName}`);
}

export async function runQuery(_prev: SqlState, form: FormData): Promise<SqlState> {
  await requireAdmin();
  const query = String(form.get("query") ?? "");
  if (!query.trim()) return { query };
  try {
    const result = await runSql(query);
    revalidatePath(`/admin`, "layout");
    return { query, result };
  } catch (err) {
    return { query, error: message(err) };
  }
}
