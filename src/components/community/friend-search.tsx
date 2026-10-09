"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import type { FriendStatus, Person } from "@/lib/types";

const sections: { status: FriendStatus; title: string }[] = [
  { status: "received", title: "Friend requests" },
  { status: "friends", title: "Friends" },
  { status: "sent", title: "Sent requests" },
];

/**
 * Search people by name or handle and send them friend requests. Empty search
 * lists incoming requests, friends and sent requests.
 */
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

  /**
   * Optimistically send, accept, cancel, decline or unfriend; the server's
   * answer wins, and the feed and leaderboard refresh after.
   */
  function setFriend(person: Person, on: boolean) {
    if (!on && person.status === "friends" && !confirm(`Remove ${person.name} from your friends?`)) return;
    const apply = (status: FriendStatus) =>
      setPeople((ps) => ps.map((p) => (p.id === person.id ? { ...p, status } : p)));
    apply(on ? (person.status === "received" ? "friends" : "sent") : "none");
    api
      .setFriend(person.id, on)
      .then((status) => {
        apply(status);
        router.refresh();
      })
      .catch((err) => {
        apply(person.status);
        setError(err.message);
      });
  }

  const searching = query.trim() !== "";
  // Declined and cancelled requests drop out of the lists.
  const shown = searching ? people : people.filter((p) => p.status !== "none");

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

      {error && <p className="px-1 text-sm text-tempo">{error}</p>}

      {shown.length === 0 && !loading && (
        <Card className="py-10 text-center text-sm text-muted">
          {searching
            ? `No one matches “${query.trim()}”.`
            : "No friends yet — search for classmates above and send them a request."}
        </Card>
      )}

      {searching ? (
        shown.length > 0 && <PersonList people={shown} loading={loading} onSet={setFriend} />
      ) : (
        sections.map(({ status, title }) => {
          const group = shown.filter((p) => p.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} className="flex flex-col gap-2">
              <p className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {title} · {group.length}
              </p>
              <PersonList people={group} loading={loading} onSet={setFriend} />
            </section>
          );
        })
      )}
    </div>
  );
}

function PersonList({
  people,
  loading,
  onSet,
}: {
  people: Person[];
  loading: boolean;
  onSet: (person: Person, on: boolean) => void;
}) {
  return (
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
              </p>
            </div>
            <FriendButtons person={p} onSet={onSet} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

const button = "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors";
const primary = `${button} bg-accent-soft text-accent`;
const secondary = `${button} bg-surface-2 text-muted`;

function FriendButtons({ person, onSet }: { person: Person; onSet: (person: Person, on: boolean) => void }) {
  switch (person.status) {
    case "received":
      return (
        <div className="flex shrink-0 gap-2">
          <button onClick={() => onSet(person, false)} className={secondary}>
            Decline
          </button>
          <button onClick={() => onSet(person, true)} className={primary}>
            Accept
          </button>
        </div>
      );
    case "friends":
      return (
        <button onClick={() => onSet(person, false)} className={secondary}>
          Friends
        </button>
      );
    case "sent":
      return (
        <button onClick={() => onSet(person, false)} className={secondary} title="Cancel request">
          Requested
        </button>
      );
    case "none":
      return (
        <button onClick={() => onSet(person, true)} className={primary}>
          Add friend
        </button>
      );
  }
}
