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

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);

/**
 * Origin the browser sees, also behind the deploy's reverse proxy. Deployed
 * hosts are always HTTPS: the organizers' proxy terminates TLS and forwards
 * `X-Forwarded-Proto: http`, which would give calendar apps a plain-http link
 * that only redirects to the login page.
 */
export function publicOrigin(headers: Headers) {
  const host = headers.get("x-forwarded-host")?.split(",")[0].trim() ?? headers.get("host") ?? "localhost:3000";
  return `${isLocal(host) ? "http" : "https"}://${host}`;
}

const envOrigin = (value: string | undefined) => value?.trim().replace(/\/$/, "") || null;

/**
 * Origin calendar clients fetch the feed from. They can't get past a login
 * wall, so when the app sits behind one (the VisCon VM), CALENDAR_FEED_ORIGIN
 * points at an address that reaches the server directly — see deploy/README.md.
 */
export function feedOrigin(headers: Headers) {
  return envOrigin(process.env.CALENDAR_FEED_ORIGIN) ?? publicOrigin(headers);
}

/**
 * Origin for links back into the app from inside the feed. The feed itself is
 * fetched on the direct address, which isn't where people use the app.
 */
export function appOrigin(headers: Headers) {
  return envOrigin(process.env.APP_ORIGIN) ?? publicOrigin(headers);
}
