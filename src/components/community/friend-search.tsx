"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@/components/icons";
import { ExpressionMascot } from "@/components/mascot/expression-mascot";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Avatar, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { emptyStateLines } from "@/lib/mascot";
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
  const [confirm, confirmDialog] = useConfirm();

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
  async function setFriend(person: Person, on: boolean) {
    if (
      !on &&
      person.status === "friends" &&
      !(await confirm({
        preview: <Avatar initials={person.initials} hue={person.hue} size="lg" />,
        title: `Remove ${person.name}?`,
        message: "You'll stop seeing each other's sessions. To be friends again, one of you will need to send a new request.",
        confirmLabel: "Remove friend",
      }))
    ) {
      return;
    }
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
        className="w-full rounded-full border-2 border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
      />

      {error && <p className="px-1 text-sm text-tempo">{error}</p>}
      {confirmDialog}

      {shown.length === 0 && !loading && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <ExpressionMascot expression="sleepy" size={96} />
          <p className="max-w-[26ch] text-sm text-muted">
            {searching ? `No one matches “${query.trim()}”.` : emptyStateLines.noFriends}
          </p>
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

const button = "shrink-0 rounded-full border-2 px-4 py-1.5 text-sm font-bold transition-colors";
const primary = `${button} border-accent/30 bg-accent-soft text-accent`;
const secondary = `${button} border-border bg-surface-2 text-muted`;

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
        <button
          onClick={() => onSet(person, false)}
          aria-label={`Remove ${person.name} from friends`}
          className={`${button} group grid bg-surface-2 text-muted hover:bg-tempo/10 hover:text-tempo focus-visible:bg-tempo/10 focus-visible:text-tempo`}
        >
          {/* Both labels share one grid cell, so the button keeps its width when they swap. */}
          <span className="col-start-1 row-start-1 flex items-center justify-center gap-1 group-hover:invisible group-focus-visible:invisible">
            <CheckIcon className="size-4" /> Friends
          </span>
          <span className="invisible col-start-1 row-start-1 group-hover:visible group-focus-visible:visible">Remove</span>
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
