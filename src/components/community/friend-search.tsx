"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import type { Person } from "@/lib/types";

/** Search people by name or handle and follow them. Empty search lists who you follow. */
export function FriendSearch({ friends }: { friends: Person[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState(friends);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<AbortController>(undefined);

  /** Debounced search; a newer keystroke cancels the older request. */
  function search(q: string) {
    setQuery(q);
    clearTimeout(timer.current);
    inflight.current?.abort();
    timer.current = setTimeout(() => {
      const controller = (inflight.current = new AbortController());
      setLoading(true);
      api
        .searchPeople(q.trim(), { signal: controller.signal })
        .then((found) => {
          setPeople(found);
          setError(null);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
  }

  /** Optimistically follow or unfollow; the feed and leaderboard refresh after. */
  function toggleFollow(id: string, on: boolean) {
    const apply = (following: boolean) =>
      setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, following } : p)));
    apply(on);
    api
      .setFollow(id, on)
      .then(() => router.refresh())
      .catch(() => apply(!on));
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search by name or @handle"
        autoCapitalize="none"
        autoComplete="off"
        className="w-full rounded-2xl bg-surface px-4 py-3 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-accent"
      />

      {!query.trim() && (
        <p className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">Following</p>
      )}

      {error && <p className="px-1 text-sm text-tempo">{error}</p>}

      {people.length === 0 && !loading && (
        <Card className="py-10 text-center text-sm text-muted">
          {query.trim() ? `No one matches “${query.trim()}”.` : "You don't follow anyone yet — search for classmates above."}
        </Card>
      )}

      {people.length > 0 && (
        <Card className={`p-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <ul>
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl px-3 py-3">
                <Avatar initials={p.initials} hue={p.hue} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-sm text-muted">
                    @{p.handle}
                    {p.program && ` · ${p.program}`}
                    {p.followsYou && !p.following && " · Follows you"}
                  </p>
                </div>
                <button
                  onClick={() => toggleFollow(p.id, !p.following)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    p.following ? "bg-surface-2 text-muted" : "bg-accent-soft text-accent"
                  }`}
                >
                  {p.following ? "Following" : p.followsYou ? "Follow back" : "Follow"}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
