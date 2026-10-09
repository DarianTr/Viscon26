import { randomUUID } from "node:crypto";
import type { Item } from "./types";

export type { Item };

type Store = { items: Map<string, Item> };

// The dev server re-evaluates modules on HMR, which would wipe a plain
// module-level Map. Keeping the store on globalThis makes it survive reloads.
const globalForStore = globalThis as unknown as { __store?: Store };
const store: Store = (globalForStore.__store ??= { items: new Map() });

if (store.items.size === 0) {
  for (const title of ["Pitch the idea", "Ship the MVP", "Win the hackathon"]) {
    const item: Item = {
      id: randomUUID(),
      title,
      done: false,
      createdAt: new Date().toISOString(),
    };
    store.items.set(item.id, item);
  }
}

// Everything below is async so swapping this file for a real database
// (Prisma, Drizzle, Supabase, ...) is a drop-in change.

export async function listItems(): Promise<Item[]> {
  return [...store.items.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export async function getItem(id: string): Promise<Item | undefined> {
  return store.items.get(id);
}

export async function createItem(data: { title: string }): Promise<Item> {
  const item: Item = {
    id: randomUUID(),
    title: data.title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  store.items.set(item.id, item);
  return item;
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<Item, "title" | "done">>,
): Promise<Item | undefined> {
  const existing = store.items.get(id);
  if (!existing) return undefined;

  const updated: Item = { ...existing, ...patch };
  store.items.set(id, updated);
  return updated;
}

export async function deleteItem(id: string): Promise<boolean> {
  return store.items.delete(id);
}
