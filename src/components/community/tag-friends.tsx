"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { MAX_TAGS } from "@/lib/photos";
import type { Person, UserSummary } from "@/lib/types";

/** Pick which friends you studied with, under your own activity. */
export function TagFriends({
  activityId,
  tagged,
  onSaved,
}: {
  activityId: string;
  tagged: UserSummary[];
  onSaved: (tagged: UserSummary[]) => void;
}) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [selected, setSelected] = useState(() => new Set(tagged.map((u) => u.id)));
  const [saving, setSaving] = useState(false);
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

  function save() {
    if (!friends) return;
    setSaving(true);
    api
      .setTags(activityId, [...selected])
      .then(() => onSaved(friends.filter((f) => selected.has(f.id))))
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Who did you study with?</p>
      {friends === null && !error && <p className="py-2 text-sm text-muted">Loading friends…</p>}
      {friends?.length === 0 && (
        <p className="py-2 text-sm text-muted">Add friends under Community → Friends to tag them.</p>
      )}
      {friends && friends.length > 0 && (
        <ul className="mb-3 flex max-h-64 flex-col overflow-y-auto">
          {friends.map((f) => (
            <li key={f.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  disabled={!selected.has(f.id) && selected.size >= MAX_TAGS}
                  onChange={() => toggle(f.id)}
                  className="size-4 accent-[var(--accent)]"
                />
                <Avatar initials={f.initials} hue={f.hue} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mb-2 text-sm text-tempo">{error}</p>}
      {friends && friends.length > 0 && (
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
      )}
    </div>
  );
}
