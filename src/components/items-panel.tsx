"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { Item } from "@/lib/types";

export function ItemsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<unknown>) {
    setError(null);
    work()
      .then(() => api.listItems())
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    api
      .listItems()
      .then(setItems)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Items</h2>
      <p className="mt-1 text-sm opacity-60">
        Every action below is a request to the backend.
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) return;
          setTitle("");
          run(() => api.createItem(value));
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add an item…"
          className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <button
          type="submit"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
        >
          Add
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm opacity-60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm opacity-60">Nothing here yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => run(() => api.updateItem(item.id, { done: !item.done }))}
                className="size-4 accent-current"
              />
              <span className={`flex-1 text-sm ${item.done ? "line-through opacity-50" : ""}`}>
                {item.title}
              </span>
              <button
                onClick={() => run(() => api.deleteItem(item.id))}
                className="text-xs uppercase tracking-wide opacity-50 transition-opacity hover:opacity-100"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
