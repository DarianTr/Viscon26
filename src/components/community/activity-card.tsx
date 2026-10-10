"use client";

import { useRef, useState } from "react";
import { BrainIcon, CameraIcon, CommentIcon, EditIcon, MapPinIcon, SwordsIcon, UsersIcon, XIcon } from "@/components/icons";
import { WashiTape } from "@/components/mascot/doodles";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Avatar, Button, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatMinutes, sessionTypes, subjectColor } from "@/lib/session-types";
import { MAX_PHOTOS } from "@/lib/photos";
import { shrinkImage } from "@/lib/shrink-image";
import type { Activity, Comment } from "@/lib/types";
import { ChallengeFriends } from "./challenge-friends";
import { CommentThread } from "./comment-thread";
import { TagFriends } from "./tag-friends";

/** A Strava-style activity post for a finished study session. */
export function ActivityCard({ activity }: { activity: Activity }) {
  const [liked, setLiked] = useState(activity.kudoed);
  // The server count already includes our own kudos, if we gave them.
  const others = activity.kudos - (activity.kudoed ? 1 : 0);
  const type = sessionTypes[activity.type];
  const [showComments, setShowComments] = useState(false);
  /** Fetched the first time the thread is opened. */
  const [comments, setComments] = useState<Comment[] | null>(null);
  const commentCount = comments?.length ?? activity.comments;
  const [photos, setPhotos] = useState(activity.photos);
  const [tagged, setTagged] = useState(activity.tagged);
  const [showTags, setShowTags] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [challengeSent, setChallengeSent] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, confirmDialog] = useConfirm();

  const [title, setTitle] = useState(activity.title);
  const [note, setNote] = useState(activity.note);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    setTitleDraft(title);
    setNoteDraft(note ?? "");
    setEditError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditError(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setEditError("Give the session a title.");
      return;
    }
    const nextNote = noteDraft.trim() || null;
    setSavingEdit(true);
    setEditError(null);
    try {
      await api.updateActivity(activity.id, { title: nextTitle, note: nextNote });
      setTitle(nextTitle);
      setNote(nextNote);
      setEditing(false);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleKudos() {
    const next = !liked;
    setLiked(next);
    api.setKudos(activity.id, next).catch(() => setLiked(!next));
  }

  function toggleComments() {
    setShowComments(!showComments);
    if (comments === null) {
      api
        .listComments(activity.id)
        .then(setComments)
        .catch(() => setComments([]));
    }
  }

  async function uploadPhotos(files: FileList) {
    setUploading(true);
    setPhotoError(null);
    try {
      for (const file of [...files].slice(0, MAX_PHOTOS - photos.length)) {
        const photo = await api.addPhoto(activity.id, await shrinkImage(file));
        setPhotos((ps) => [...ps, photo]);
      }
    } catch (err) {
      setPhotoError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  /** After confirming, optimistically remove, putting it back if the request fails. */
  async function removePhoto(photo: Activity["photos"][number]) {
    const ok = await confirm({
      preview: (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="size-24 rounded-2xl object-cover ring-1 ring-border" />
      ),
      title: "Delete this photo?",
      message: "It will be removed from your post for good.",
      confirmLabel: "Delete photo",
    });
    if (!ok) return;
    // Updater functions, since an upload may have finished while the dialog was open.
    const index = photos.indexOf(photo);
    setPhotos((ps) => ps.filter((p) => p.id !== photo.id));
    api.deletePhoto(activity.id, photo.id).catch((err) => {
      setPhotos((ps) => [...ps.slice(0, index), photo, ...ps.slice(index)]);
      setPhotoError(err.message);
    });
  }

  // A tiny, stable (not re-randomized on re-render) scrapbook tilt per post.
  const tilt = (activity.id.charCodeAt(0) + activity.id.charCodeAt(activity.id.length - 1)) % 2 === 0;

  return (
    <Card className={`relative overflow-visible p-0 ${tilt ? "sm:-rotate-[0.5deg]" : "sm:rotate-[0.5deg]"}`}>
      <WashiTape
        color={tilt ? "var(--pink)" : "var(--gold)"}
        className={`sticker-settle absolute -top-3 left-6 ${tilt ? "-rotate-3" : "rotate-3"}`}
      />
      {confirmDialog}
      {activity.mine && (
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) uploadPhotos(e.target.files);
            e.target.value = "";
          }}
        />
      )}
      <div className="flex items-center gap-3 px-4 pt-4">
        <Avatar initials={activity.user.initials} hue={activity.user.hue} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{activity.user.name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            {activity.postedAgo}
            {!activity.shared && " · Only you"}
            {activity.location && (
              <>
                {" · "}
                <MapPinIcon className="size-3" /> {activity.location}
              </>
            )}
          </p>
        </div>
        <span className={`-rotate-1 rounded-full border-2 border-current px-2.5 py-0.5 text-[11px] font-bold ${type.soft}`}>
          {type.label}
        </span>
      </div>

      <div className="px-4 pt-3">
        {editing ? (
          <form onSubmit={saveEdit} className="flex flex-col gap-2">
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={200}
              placeholder="Session title"
              autoFocus
              className="w-full rounded-xl border-2 border-border bg-surface-2 px-3 py-2 font-display text-lg font-bold outline-none focus:border-accent"
            />
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Add a caption…"
              className="w-full resize-none rounded-xl border-2 border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {editError && <p className="text-sm text-tempo">{editError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} disabled={savingEdit}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-lg font-bold">{title}</h3>
              {activity.mine && (
                <button
                  onClick={startEdit}
                  aria-label="Edit title and caption"
                  className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:text-foreground"
                >
                  <EditIcon className="size-4" />
                </button>
              )}
            </div>
            {note ? (
              <p className="mt-1 text-sm">{note}</p>
            ) : (
              activity.mine && (
                <button
                  onClick={startEdit}
                  className="mt-1 text-sm text-muted italic transition-colors hover:text-foreground"
                >
                  + Add a caption…
                </button>
              )
            )}
          </>
        )}
        {tagged.length > 0 && (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted">
            <span className="flex -space-x-2">
              {tagged.slice(0, 3).map((u) => (
                <span key={u.id} className="rounded-full ring-2 ring-surface">
                  <Avatar initials={u.initials} hue={u.hue} size="sm" />
                </span>
              ))}
            </span>
            <span className="min-w-0">
              with <span className="font-medium text-foreground">{listNames(tagged.map((u) => u.name))}</span>
            </span>
          </p>
        )}
      </div>

      {photos.length > 0 ? (
        <PhotoGrid photos={photos} onRemove={activity.mine ? removePhoto : undefined} />
      ) : (
        activity.mine && (
          <div className="px-4 pt-3">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-border py-6 text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <CameraIcon className={`size-6 ${uploading ? "animate-pulse" : ""}`} />
              <span className="text-sm font-bold">{uploading ? "Uploading…" : "Add a photo"}</span>
              <span className="text-xs">Posts with a photo get noticed more</span>
            </button>
          </div>
        )
      )}
      {photoError && <p className="px-4 pt-2 text-sm text-tempo">{photoError}</p>}

      <dl className="grid grid-cols-3 gap-2 px-4 pt-4">
        <Metric label="Subject" value={activity.subject} className={subjectColor(activity.subject).text} />
        <Metric label="Time" value={formatMinutes(activity.minutes)} />
        <Metric label="Focus" value={activity.focus === null ? "–" : `${activity.focus}%`} />
      </dl>

      {activity.trace && activity.trace.length > 1 ? (
        <FocusTrace values={activity.trace} />
      ) : (
        <div className="h-2" />
      )}

      <div className="flex items-center gap-1 border-t-2 border-border px-2 py-1.5">
        <button
          onClick={toggleKudos}
          aria-pressed={liked}
          className={`hover-wiggle flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition-colors ${
            liked ? "text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          <BrainIcon className={`size-5 transition-transform ${liked ? "mascot-pop scale-110 fill-current" : ""}`} />
          {others + (liked ? 1 : 0)} braincells
        </button>
        <button
          onClick={toggleComments}
          aria-expanded={showComments}
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition-colors ${
            showComments ? "text-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          <CommentIcon className="size-5" />
          {commentCount}
        </button>

        {activity.mine && (
          <div className="ml-auto flex items-center">
            {photos.length > 0 && (
              <button
                onClick={() => fileInput.current?.click()}
                disabled={uploading || photos.length >= MAX_PHOTOS}
                aria-label="Add photos"
                title={photos.length >= MAX_PHOTOS ? `At most ${MAX_PHOTOS} photos` : "Add photos"}
                className="rounded-full p-2 text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                <CameraIcon className={`size-5 ${uploading ? "animate-pulse" : ""}`} />
              </button>
            )}
            <button
              onClick={() => {
                setShowChallenge(!showChallenge);
                setChallengeSent(null);
              }}
              aria-expanded={showChallenge}
              aria-label="Challenge friends"
              title="Challenge friends to beat this"
              className={`rounded-full p-2 transition-colors ${showChallenge ? "text-foreground" : "text-muted hover:text-foreground"}`}
            >
              <SwordsIcon className="size-5" />
            </button>
            <button
              onClick={() => setShowTags(!showTags)}
              aria-expanded={showTags}
              aria-label="Tag friends"
              title="Tag friends you studied with"
              className={`rounded-full p-2 transition-colors ${showTags ? "text-foreground" : "text-muted hover:text-foreground"}`}
            >
              <UsersIcon className="size-5" />
            </button>
          </div>
        )}
      </div>

      {showTags && (
        <TagFriends
          activityId={activity.id}
          tagged={tagged}
          onSaved={(next) => {
            setTagged(next);
            setShowTags(false);
          }}
        />
      )}

      {showChallenge && (
        <ChallengeFriends
          activityId={activity.id}
          onSent={(sent) => {
            setShowChallenge(false);
            setChallengeSent(
              sent === 0
                ? "They already have this challenge waiting."
                : `Challenge sent to ${sent} ${sent === 1 ? "friend" : "friends"}. ⚔️`,
            );
          }}
        />
      )}
      {challengeSent && <p className="border-t border-border px-4 py-3 text-sm text-muted">{challengeSent}</p>}

      {showComments && (
        <CommentThread activityId={activity.id} comments={comments} onChange={setComments} />
      )}
    </Card>
  );
}

/** "Lena", "Lena and Jonas", "Lena, Jonas and 2 others". */
function listNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** One photo full width; more in a two-column grid, the first spanning both when odd. */
function PhotoGrid({
  photos,
  onRemove,
}: {
  photos: Activity["photos"];
  onRemove?: (photo: Activity["photos"][number]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 px-4 pt-3">
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className={`group relative overflow-hidden rounded-2xl bg-surface-2 ${
            photos.length % 2 === 1 && i === 0 ? "col-span-2 aspect-[4/3]" : "aspect-square"
          }`}
        >
          <a href={photo.url} target="_blank" rel="noreferrer">
            {/* Served by our own authenticated route, so next/image's optimizer can't fetch it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="" loading="lazy" className="size-full object-cover" />
          </a>
          {onRemove && (
            <button
              onClick={() => onRemove(photo)}
              aria-label="Remove photo"
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/55 text-white"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted uppercase tracking-wide">{label}</dt>
      <dd className={`truncate font-display font-bold ${className}`}>{value}</dd>
    </div>
  );
}

/** Focus-over-time sparkline — a quiet footnote, not the headline of the post. */
function FocusTrace({ values }: { values: number[] }) {
  const w = 300;
  const h = 24;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - v * (h - 4)}`);
  const line = `M${points.join(" L")}`;
  return (
    <div className="mx-4 mt-3 mb-2 text-muted" title="Focus over the session">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full opacity-60" aria-label="Focus over the session">
        <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" opacity={0.08} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
