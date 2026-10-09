import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

/*
 * Generic, schema-agnostic table access for /admin. It reads the table and
 * column list from information_schema, so new tables show up without code
 * changes. Values travel as text both ways: reads cast every column to text,
 * writes cast the submitted string back to the column's type in Postgres.
 * Table and column names are checked against the catalog and quoted with
 * sql.identifier; values are always bound parameters.
 */

export type Column = {
  name: string;
  /** Postgres type name, e.g. int4, uuid, timestamptz, session_type, _text. */
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  primaryKey: boolean;
};

export type TableInfo = { name: string; columns: Column[] };

/** Row values as text (null stays null), keyed by column name. */
export type Row = Record<string, string | null>;

export async function listTables(): Promise<{ name: string; rows: number }[]> {
  const tables = await db.execute<{ name: string }>(sql`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  return Promise.all(
    tables.map(async ({ name }) => {
      const [{ n }] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(name)}`,
      );
      return { name, rows: n };
    }),
  );
}

/** Column metadata for a public table, or null if there is no such table. */
export async function getTable(name: string): Promise<TableInfo | null> {
  const rows = await db.execute<{
    name: string;
    type: string;
    nullable: boolean;
    has_default: boolean;
    primary_key: boolean;
  }>(sql`
    select c.column_name as name,
           c.udt_name as type,
           c.is_nullable = 'YES' as nullable,
           c.column_default is not null as has_default,
           exists (
             select 1 from information_schema.table_constraints tc
             join information_schema.key_column_usage k
               on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
             where tc.table_schema = 'public' and tc.table_name = c.table_name
               and tc.constraint_type = 'PRIMARY KEY' and k.column_name = c.column_name
           ) as primary_key
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = ${name}
    order by c.ordinal_position
  `);
  if (!rows.length) return null;
  return {
    name,
    columns: rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.nullable,
      hasDefault: r.has_default,
      primaryKey: r.primary_key,
    })),
  };
}

export const primaryKey = (table: TableInfo) => table.columns.filter((c) => c.primaryKey);

const id = (name: string) => sql.identifier(name);
const asText = (table: TableInfo) =>
  sql.join(table.columns.map((c) => sql`${id(c.name)}::text as ${id(c.name)}`), sql`, `);
/**
 * A submitted string cast to the column's type, e.g. `$1::text::"int4"`. The
 * parameter must be bound as text: if Postgres inferred the column type for
 * it, postgres.js would run its own serializer (turning "maybe" into false
 * for a bool, or double-encoding JSON).
 */
const typed = (col: Column, value: string | null) => sql`${value}::text::${id(col.type)}`;

function wherePk(table: TableInfo, pk: Row): SQL {
  const cols = primaryKey(table);
  if (!cols.length) throw new Error(`${table.name} has no primary key`);
  return sql.join(
    cols.map((c) => {
      if (pk[c.name] == null) throw new Error(`Missing key column ${c.name}`);
      return sql`${id(c.name)}::text = ${pk[c.name]}`;
    }),
    sql` and `,
  );
}

export async function listRows(table: TableInfo, limit: number, offset: number): Promise<Row[]> {
  const order = primaryKey(table).length ? primaryKey(table) : table.columns.slice(0, 1);
  return db.execute<Row>(sql`
    select ${asText(table)} from ${id(table.name)}
    order by ${sql.join(order.map((c) => id(c.name)), sql`, `)}
    limit ${limit} offset ${offset}
  `);
}

export async function getRow(table: TableInfo, pk: Row): Promise<Row | null> {
  const [row] = await db.execute<Row>(
    sql`select ${asText(table)} from ${id(table.name)} where ${wherePk(table, pk)}`,
  );
  return row ?? null;
}

/** Columns missing from `values` are left to their default. Returns the new row's key. */
export async function insertRow(table: TableInfo, values: Row): Promise<Row> {
  const cols = table.columns.filter((c) => c.name in values);
  const [row] = await db.execute<Row>(
    cols.length
      ? sql`insert into ${id(table.name)} (${sql.join(cols.map((c) => id(c.name)), sql`, `)})
            values (${sql.join(cols.map((c) => typed(c, values[c.name])), sql`, `)})
            returning ${asText(table)}`
      : sql`insert into ${id(table.name)} default values returning ${asText(table)}`,
  );
  return row;
}

/** Returns the row's (possibly changed) key, or null if it no longer exists. */
export async function updateRow(table: TableInfo, pk: Row, values: Row): Promise<Row | null> {
  const cols = table.columns.filter((c) => c.name in values);
  if (!cols.length) return pk;
  const [row] = await db.execute<Row>(sql`
    update ${id(table.name)}
    set ${sql.join(cols.map((c) => sql`${id(c.name)} = ${typed(c, values[c.name])}`), sql`, `)}
    where ${wherePk(table, pk)}
    returning ${asText(table)}
  `);
  return row ?? null;
}

export async function deleteRow(table: TableInfo, pk: Row): Promise<boolean> {
  const rows = await db.execute(
    sql`delete from ${id(table.name)} where ${wherePk(table, pk)} returning 1`,
  );
  return rows.length > 0;
}

export type QueryResult = { columns: string[]; rows: Row[]; command: string; count: number };

/** Run arbitrary SQL from the console. Values come back as text, like everywhere else here. */
export async function runSql(query: string): Promise<QueryResult> {
  const result = await db.execute(sql.raw(query));
  const columns = (result.columns ?? []).map((c) => c.name);
  const rows = result.map((r) =>
    Object.fromEntries(columns.map((c) => [c, stringify((r as Record<string, unknown>)[c])])),
  );
  return { columns, rows, command: result.command, count: result.count ?? rows.length };
}

function stringify(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The key columns of a row, e.g. for building an edit link. */
export const keyOf = (table: TableInfo, row: Row): Row =>
  Object.fromEntries(primaryKey(table).map((c) => [c.name, row[c.name]]));
