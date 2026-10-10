"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import type { Person } from "@/lib/types";

const taunts = ["Bet you can't.", "Your turn. Don't embarrass yourself.", "This one hurt. Now you."];

/** Under your own activity: dare friends to match it. */
export function ChallengeFriends({ activityId, onSent }: { activityId: string; onSent: (sent: number) => void }) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .searchPeople("")
      .then((people) => setFriends(people.filter((p) => p.status === "friends")))
      .catch((err) => setError(err.message));
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  function send() {
    setSending(true);
    setError(null);
    api
      .sendChallenge(activityId, [...selected], message)
      .then(onSent)
      .catch((err) => setError(err.message))
      .finally(() => setSending(false));
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Who has to beat this?</p>
      {friends === null && !error && <p className="py-2 text-sm text-muted">Loading friends…</p>}
      {friends?.length === 0 && (
        <p className="py-2 text-sm text-muted">Add friends under Community → Friends to challenge them.</p>
      )}
      {friends && friends.length > 0 && (
        <>
          <ul className="mb-3 flex max-h-64 flex-col overflow-y-auto">
            {friends.map((f) => (
              <li key={f.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={selected.has(f.id)}
                    onChange={() => toggle(f.id)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <Avatar initials={f.initials} hue={f.hue} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={200}
            placeholder={taunts[0]}
            className="mb-2 w-full rounded-xl border-2 border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mb-3 flex flex-wrap gap-1.5">
            {taunts.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMessage(t)}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted hover:text-foreground"
              >
                {t}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mb-2 text-sm text-tempo">{error}</p>}
      {friends && friends.length > 0 && (
        <button
          onClick={send}
          disabled={sending || selected.size === 0}
          className="rounded-full border-2 border-foreground bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : `Challenge${selected.size > 0 ? ` ${selected.size}` : ""}`}
        </button>
      )}
    </div>
  );
}
