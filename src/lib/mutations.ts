import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";

/*
 * Social actions (kudos, clubs), called from the route handlers in `src/app/api`.
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

export async function setClubMembership(
  userId: string,
  clubId: string,
  on: boolean,
): Promise<boolean> {
  const club = await db.query.clubs.findFirst({
    where: eq(s.clubs.id, clubId),
    columns: { id: true },
  });
  if (!club) return false;

  if (on) {
    await db.insert(s.clubMembers).values({ clubId, userId }).onConflictDoNothing();
  } else {
    await db
      .delete(s.clubMembers)
      .where(and(eq(s.clubMembers.clubId, clubId), eq(s.clubMembers.userId, userId)));
  }
  return true;
}
