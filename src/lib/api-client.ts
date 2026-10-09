import type { Item } from "./types";

/**
 * Thin client for the backend in `src/app/api`. Relative URLs keep it working
 * in dev, in preview and in production without any configuration.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  listItems: () => request<{ items: Item[] }>("/items").then((r) => r.items),

  createItem: (title: string) =>
    request<{ item: Item }>("/items", {
      method: "POST",
      body: JSON.stringify({ title }),
    }).then((r) => r.item),

  updateItem: (id: string, patch: { title?: string; done?: boolean }) =>
    request<{ item: Item }>(`/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.item),

  deleteItem: (id: string) =>
    request<void>(`/items/${id}`, { method: "DELETE" }),
};
