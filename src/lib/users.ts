import "server-only";
import { asc, eq, ilike, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { User } from "./types";

/** Data layer for /api/users. */

type Row = typeof s.users.$inferSelect;
export type NewUser = Pick<Row, "handle" | "name"> &
  Partial<Pick<Row, "hue" | "program" | "weeklyGoalHours">>;
export type UserPatch = Partial<NewUser>;

// Never send the password hash (or admin flag) out through the API.
function toUser(row: Row): User {
  const { passwordHash, isAdmin, ...user } = row;
  return { ...user, createdAt: row.createdAt.toISOString() };
}

export async function listUsers(opts: {
  q?: string;
  limit: number;
  offset: number;
}): Promise<User[]> {
  const pattern = opts.q && `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = await db
    .select()
    .from(s.users)
    .where(pattern ? or(ilike(s.users.name, pattern), ilike(s.users.handle, pattern)) : undefined)
    .orderBy(asc(s.users.createdAt), asc(s.users.handle))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map(toUser);
}

export async function getUser(id: string): Promise<User | undefined> {
  const [row] = await db.select().from(s.users).where(eq(s.users.id, id));
  return row && toUser(row);
}

export async function createUser(data: NewUser): Promise<User> {
  const [row] = await db.insert(s.users).values(data).returning();
  return toUser(row);
}

export async function updateUser(id: string, patch: UserPatch): Promise<User | undefined> {
  const [row] = await db.update(s.users).set(patch).where(eq(s.users.id, id)).returning();
  return row && toUser(row);
}

/** Also deletes everything the user owns (tasks, kudos, follows, …). */
export async function deleteUser(id: string): Promise<boolean> {
  const rows = await db.delete(s.users).where(eq(s.users.id, id)).returning({ id: s.users.id });
  return rows.length > 0;
}
