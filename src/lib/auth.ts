import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";

/*
 * Login is done by the VIScon reverse proxy in front of the app: it signs the
 * user in and adds two trusted headers to every request,
 *
 *   X-User-Id    the user's email (ETH addresses normalized to <user>@ethz.ch)
 *   X-User-Name  their full name, non-ASCII characters percent-encoded
 *
 * We only map that email to a row in `users`. Someone the proxy let in but who
 * has no row yet is sent to /signup to pick a handle.
 *
 * The headers are only trustworthy while the app is reachable through the
 * proxy alone: never open the app's port in the VM firewall.
 *
 * Without the proxy (local development) there are no headers; DEV_USER_ID and
 * DEV_USER_NAME stand in for them.
 */

/** Who the proxy says is visiting. */
export type Identity = { email: string; name: string };

export type SessionUser = typeof s.users.$inferSelect;

function decodeName(raw: string) {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** The proxy's identity for this request, or null if there is none. Cached for the request. */
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const h = await headers();
  const email = (h.get("x-user-id") ?? process.env.DEV_USER_ID ?? "").trim().toLowerCase();
  if (!email) return null;
  const name = decodeName(h.get("x-user-name") ?? process.env.DEV_USER_NAME ?? "");
  return { email, name };
});

/** The signed-up user behind this request, or null. Cached for the rest of the request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const identity = await getIdentity();
  if (!identity) return null;
  const user = await db.query.users.findFirst({ where: eq(s.users.email, identity.email) });
  return user ?? null;
});

/** For pages and server actions: the signed-up user, or a redirect to /signup. */
export async function requireUser(): Promise<SessionUser> {
  return (await getSessionUser()) ?? redirect("/signup");
}

/** For admin pages and actions. Non-admins get a 404, so /admin isn't advertised. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
