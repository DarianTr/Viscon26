import "server-only";
import { after } from "next/server";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { SessionUser } from "./auth";
import { MAX_PHOTOS } from "./photos";
import { notify } from "./push";
import { filterFriends, getFriendStatus, toComment } from "./queries";
import type { Comment, FriendStatus } from "./types";

/*
 * Social actions (kudos, friends, comments, post photos and tags), called from the route handlers in `src/app/api`.
 * Plain CRUD lives in `./users.ts` and `./tasks.ts`.
 * Each function returns false when the target doesn't exist, which the
 * handlers turn into a 404. Whoever is on the receiving end of an action gets
 * a push notification (see `./push.ts`).
 */

const FEED = "/community";
const OWN_POSTS = "/community?tab=you";
const FRIENDS = "/community?tab=friends";

async function sessionTitle(sessionId: string) {
  const row = await db.query.sessions.findFirst({ where: eq(s.sessions.id, sessionId), columns: { title: true } });
  return row?.title ?? "your session";
}

/** Callers check first that the user can see the activity (`getVisibleActivity`). */
export async function setKudos(
  user: SessionUser,
  activity: { id: string; ownerId: string },
  on: boolean,
): Promise<void> {
  if (!on) {
    await db
      .delete(s.kudos)
      .where(and(eq(s.kudos.sessionId, activity.id), eq(s.kudos.userId, user.id)));
    return;
  }
  const added = await db
    .insert(s.kudos)
    .values({ sessionId: activity.id, userId: user.id })
    .onConflictDoNothing()
    .returning({ userId: s.kudos.userId });
  if (added.length === 0 || activity.ownerId === user.id) return;

  after(async () =>
    notify(activity.ownerId, {
      kind: "kudos",
      title: `${user.name} gave you kudos 👏`,
      body: `For "${await sessionTitle(activity.id)}". Keep it up!`,
      url: OWN_POSTS,
      // Unliking and liking again shouldn't ping twice.
      dedupeKey: `kudos:${activity.id}:${user.id}`,
    }),
  );
}

/**
 * `on`: accept their pending request, or else send one. Off: cancel, decline
 * or unfriend — whatever row there is between the two goes. Returns the new
 * status, or null if there's no such user.
 */
export async function setFriend(user: SessionUser, otherId: string, on: boolean): Promise<FriendStatus | null> {
  const userId = user.id;
  const other = await db.query.users.findFirst({
    where: eq(s.users.id, otherId),
    columns: { id: true },
  });
  if (!other) return null;

  const f = s.friendships;
  if (on) {
    const accepted = await db
      .update(f)
      .set({ acceptedAt: new Date() })
      .where(and(eq(f.requesterId, otherId), eq(f.addresseeId, userId), isNull(f.acceptedAt)))
      .returning({ id: f.requesterId });
    if (accepted.length > 0) {
      after(() =>
        notify(otherId, {
          kind: "friend_accept",
          title: `${user.name} accepted your friend request 🤝`,
          body: "You can now see each other's sessions and send challenges.",
          url: FRIENDS,
        }),
      );
    } else {
      // Conflicts if there's already a row for the pair; then it stays as is.
      const requested = await db
        .insert(f)
        .values({ requesterId: userId, addresseeId: otherId })
        .onConflictDoNothing()
        .returning({ id: f.addresseeId });
      if (requested.length > 0) {
        after(() =>
          notify(otherId, {
            kind: "friend_request",
            title: `${user.name} wants to be friends 👋`,
            body: "Accept to study together and challenge each other.",
            url: FRIENDS,
          }),
        );
      }
    }
  } else {
    await db
      .delete(f)
      .where(
        or(
          and(eq(f.requesterId, userId), eq(f.addresseeId, otherId)),
          and(eq(f.requesterId, otherId), eq(f.addresseeId, userId)),
        ),
      );
  }
  return getFriendStatus(userId, otherId);
}

/** Callers check first that `user` can see the activity (`getVisibleActivity`). */
export async function addComment(
  user: SessionUser,
  activity: { id: string; ownerId: string },
  body: string,
): Promise<Comment> {
  const [row] = await db
    .insert(s.comments)
    .values({ sessionId: activity.id, userId: user.id, body })
    .returning();
  if (activity.ownerId !== user.id) {
    after(async () =>
      notify(activity.ownerId, {
        kind: "comment",
        title: `${user.name} commented on "${await sessionTitle(activity.id)}" 💬`,
        body,
        url: OWN_POSTS,
      }),
    );
  }
  return toComment({ ...row, user }, user.id, activity.ownerId);
}

/**
 * Deletes a comment if the user wrote it or owns the activity it's on.
 * False if there is no such comment, or the user may not delete it.
 */
export async function deleteComment(
  userId: string,
  activity: { id: string; ownerId: string },
  commentId: string,
): Promise<boolean> {
  const mayDelete = activity.ownerId === userId ? undefined : eq(s.comments.userId, userId);
  const rows = await db
    .delete(s.comments)
    .where(and(eq(s.comments.id, commentId), eq(s.comments.sessionId, activity.id), mayDelete))
    .returning({ id: s.comments.id });
  return rows.length > 0;
}

/**
 * Adds a photo to the user's own activity (`getOwnActivity`). Null once the
 * post already has `MAX_PHOTOS`.
 */
export async function addPhoto(
  sessionId: string,
  contentType: string,
  data: Buffer,
): Promise<{ id: string; url: string } | null> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(s.sessionPhotos)
    .where(eq(s.sessionPhotos.sessionId, sessionId));
  if (n >= MAX_PHOTOS) return null;

  const [row] = await db
    .insert(s.sessionPhotos)
    .values({ sessionId, contentType, data })
    .returning({ id: s.sessionPhotos.id });
  return { id: row.id, url: `/api/photos/${row.id}` };
}

export async function deletePhoto(sessionId: string, photoId: string): Promise<boolean> {
  const rows = await db
    .delete(s.sessionPhotos)
    .where(and(eq(s.sessionPhotos.id, photoId), eq(s.sessionPhotos.sessionId, sessionId)))
    .returning({ id: s.sessionPhotos.id });
  return rows.length > 0;
}

/**
 * Replaces who's tagged on the user's own activity. Only friends can be
 * tagged; returns false (and changes nothing) if any of `userIds` isn't one.
 */
export async function setTags(owner: SessionUser, sessionId: string, userIds: string[]): Promise<boolean> {
  const ids = [...new Set(userIds)];
  if ((await filterFriends(owner.id, ids)).length !== ids.length) return false;

  await db.transaction(async (tx) => {
    await tx.delete(s.sessionTags).where(eq(s.sessionTags.sessionId, sessionId));
    if (ids.length > 0) {
      await tx.insert(s.sessionTags).values(ids.map((userId) => ({ sessionId, userId })));
    }
  });

  if (ids.length > 0) {
    after(async () => {
      const title = await sessionTitle(sessionId);
      await Promise.all(
        ids.map((userId) =>
          notify(userId, {
            kind: "tag",
            title: `${owner.name} tagged you 🏷️`,
            body: `In "${title}".`,
            url: FEED,
            // Editing the tags again only pings the newly tagged.
            dedupeKey: `tag:${sessionId}:${userId}`,
          }),
        ),
      );
    });
  }
  return true;
}
