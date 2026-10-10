"use client";

import { useState } from "react";
import { XIcon } from "@/components/icons";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Avatar } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import type { Comment } from "@/lib/types";

/** The comments under an activity: the list, a box to add one, delete for your own. */
export function CommentThread({
  activityId,
  comments,
  onChange,
}: {
  activityId: string;
  /** Null while loading. */
  comments: Comment[] | null;
  onChange: (comments: Comment[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !comments) return;
    setSending(true);
    api
      .addComment(activityId, body)
      .then((comment) => {
        onChange([...comments, comment]);
        setDraft("");
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setSending(false));
  }

  /** After confirming, optimistically remove, putting it back if the request fails. */
  async function remove(comment: Comment) {
    const ok = await confirm({
      preview: (
        <p className="line-clamp-3 max-w-full rounded-2xl bg-surface-2 px-3 py-2 text-left text-sm break-words">
          {comment.body}
        </p>
      ),
      title: "Delete comment?",
      message: comment.mine ? "This can't be undone." : `${comment.user.name} wrote this on your post. This can't be undone.`,
      confirmLabel: "Delete",
    });
    // The modal blocks the comment form, so `comments` is still current here.
    if (!ok || !comments) return;
    const before = comments;
    onChange(comments.filter((c) => c.id !== comment.id));
    api.deleteComment(activityId, comment.id).catch((err) => {
      onChange(before);
      setError(err.message);
    });
  }

  return (
    <div className="border-t-2 border-border px-4 py-3">
      {confirmDialog}
      {comments === null && <p className="py-2 text-sm text-muted">Loading comments…</p>}

      {comments && comments.length > 0 && (
        <ul className="mb-3 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar initials={c.user.initials} hue={c.user.hue} size="sm" />
              <div className="min-w-0 flex-1 rounded-2xl bg-surface-2 px-3 py-2">
                <p className="text-xs">
                  <span className="font-semibold">{c.mine ? "You" : c.user.name}</span>
                  <span className="text-muted"> · {c.postedAgo}</span>
                </p>
                <p className="text-sm break-words whitespace-pre-line">{c.body}</p>
              </div>
              {c.canDelete && (
                <button
                  onClick={() => remove(c)}
                  aria-label="Delete comment"
                  className="self-center rounded-full p-1 text-muted hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mb-2 text-sm text-tempo">{error}</p>}

      {comments && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={comments.length ? "Add a comment" : "Be the first to comment"}
            maxLength={1000}
            className="min-w-0 flex-1 rounded-full border-2 border-border bg-surface-2 px-4 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            disabled={sending || !draft.trim()}
            className="rounded-full border-2 border-foreground bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            Post
          </button>
        </form>
      )}
    </div>
  );
}
