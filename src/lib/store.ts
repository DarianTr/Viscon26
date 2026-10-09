import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Item } from "./types";

export type { Item };

/** Data layer for the starter /api/items endpoints, backed by Postgres. */

function toItem(row: typeof s.items.$inferSelect): Item {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export async function listItems(): Promise<Item[]> {
  const rows = await db.select().from(s.items).orderBy(asc(s.items.createdAt));
  return rows.map(toItem);
}

export async function getItem(id: string): Promise<Item | undefined> {
  const [row] = await db.select().from(s.items).where(eq(s.items.id, id));
  return row && toItem(row);
}

export async function createItem(data: { title: string }): Promise<Item> {
  const [row] = await db.insert(s.items).values(data).returning();
  return toItem(row);
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<Item, "title" | "done">>,
): Promise<Item | undefined> {
  const [row] = await db.update(s.items).set(patch).where(eq(s.items.id, id)).returning();
  return row && toItem(row);
}

export async function deleteItem(id: string): Promise<boolean> {
  const rows = await db.delete(s.items).where(eq(s.items.id, id)).returning({ id: s.items.id });
  return rows.length > 0;
}
