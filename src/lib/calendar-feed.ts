import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";

/*
 * Each user can have one secret calendar feed URL. Knowing the URL is the only
 * thing that grants access — calendar clients can't log in — so the token is
 * long and random, and resetting it cuts off every old subscription.
 */

export const newCalendarToken = () => randomBytes(24).toString("base64url");

/** "abc….ics" from the URL → the owner of that feed, or null. */
export async function findFeedOwner(segment: string) {
  const token = segment.replace(/\.ics$/, "");
  if (!/^[\w-]{32}$/.test(token)) return null;
  const [user] = await db
    .select({ id: s.users.id, name: s.users.name })
    .from(s.users)
    .where(eq(s.users.calendarToken, token));
  return user ?? null;
}

/** Origin the browser sees, also behind the deploy's reverse proxy. */
export function publicOrigin(headers: Headers) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Origin calendar clients fetch the feed from. They can't get past a login
 * wall, so when the app sits behind one (the VisCon VM), CALENDAR_FEED_ORIGIN
 * points at an address that reaches the server directly — see deploy/README.md.
 */
export function feedOrigin(headers: Headers) {
  return process.env.CALENDAR_FEED_ORIGIN?.replace(/\/$/, "") || publicOrigin(headers);
}
