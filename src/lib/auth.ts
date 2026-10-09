import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db, schema as s } from "@/db";

/*
 * Cookie sessions backed by the auth_sessions table. The cookie holds a random
 * token; the database only stores its SHA-256, so a leaked table can't be used
 * to log in. Logging out deletes the row, which ends the session everywhere.
 */

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

/** A user row without the password hash — safe to pass around. */
export type SessionUser = Omit<typeof s.users.$inferSelect, "passwordHash">;

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(s.authSessions).values({ tokenHash: sha256(token), userId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(s.authSessions).where(eq(s.authSessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** The logged-in user, or null. Cached for the rest of the request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ user: s.users })
    .from(s.authSessions)
    .innerJoin(s.users, eq(s.users.id, s.authSessions.userId))
    .where(and(eq(s.authSessions.tokenHash, sha256(token)), gt(s.authSessions.expiresAt, new Date())));
  if (!row) return null;
  const { passwordHash, ...user } = row.user;
  return user;
});

/** For pages and server actions: the logged-in user, or a redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  return (await getSessionUser()) ?? redirect("/login");
}

/** For admin pages and actions. Non-admins get a 404, so /admin isn't advertised. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
