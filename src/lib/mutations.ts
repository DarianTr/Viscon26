import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { SessionUser } from "./auth";
import { toComment } from "./queries";
import type { Comment } from "./types";

/*
 * Social actions (kudos, follows, comments), called from the route handlers in `src/app/api`.
 * Plain CRUD lives in `./users.ts` and `./tasks.ts`.
 * Each function returns false when the target doesn't exist, which the
 * handlers turn into a 404.
 */

export async function setKudos(userId: string, sessionId: string, on: boolean): Promise<boolean> {
  const session = await db.query.sessions.findFirst({
    where: eq(s.sessions.id, sessionId),
    columns: { id: true },
  });
  if (!session) return false;

  if (on) {
    await db.insert(s.kudos).values({ sessionId, userId }).onConflictDoNothing();
  } else {
    await db
      .delete(s.kudos)
      .where(and(eq(s.kudos.sessionId, sessionId), eq(s.kudos.userId, userId)));
  }
  return true;
}

export async function setFollow(userId: string, followeeId: string, on: boolean): Promise<boolean> {
  const followee = await db.query.users.findFirst({
    where: eq(s.users.id, followeeId),
    columns: { id: true },
  });
  if (!followee) return false;

  if (on) {
    await db.insert(s.follows).values({ followerId: userId, followeeId }).onConflictDoNothing();
  } else {
    await db
      .delete(s.follows)
      .where(and(eq(s.follows.followerId, userId), eq(s.follows.followeeId, followeeId)));
  }
  return true;
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
