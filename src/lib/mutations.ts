import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { SessionUser } from "./auth";
import { getFriendStatus, toComment } from "./queries";
import type { Comment, FriendStatus } from "./types";

/*
 * Social actions (kudos, friends, comments), called from the route handlers in `src/app/api`.
 * Plain CRUD lives in `./users.ts` and `./tasks.ts`.
 * Each function returns false when the target doesn't exist, which the
 * handlers turn into a 404.
 */

/** Callers check first that the user can see the activity (`getVisibleActivity`). */
export async function setKudos(userId: string, sessionId: string, on: boolean): Promise<void> {
  if (on) {
    await db.insert(s.kudos).values({ sessionId, userId }).onConflictDoNothing();
  } else {
    await db
      .delete(s.kudos)
      .where(and(eq(s.kudos.sessionId, sessionId), eq(s.kudos.userId, userId)));
  }
}

/**
 * `on`: accept their pending request, or else send one. Off: cancel, decline
 * or unfriend — whatever row there is between the two goes. Returns the new
 * status, or null if there's no such user.
 */
export async function setFriend(userId: string, otherId: string, on: boolean): Promise<FriendStatus | null> {
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
    if (accepted.length === 0) {
      // Conflicts if there's already a row for the pair; then it stays as is.
      await db.insert(f).values({ requesterId: userId, addresseeId: otherId }).onConflictDoNothing();
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
