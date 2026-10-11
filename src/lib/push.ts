import "server-only";
import { and, eq } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { db, schema as s } from "@/db";

/*
 * Web Push. Every notification is stored in `notifications` first, then sent to
 * each device the user enabled push on (`push_subscriptions`). Without VAPID
 * keys in the environment, notifications are still stored but nothing is sent.
 */

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

/** The key browsers subscribe with, or null when push isn't configured. */
export const vapidPublicKey = publicKey && privateKey ? publicKey : null;

if (vapidPublicKey) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", publicKey!, privateKey!);
}

export type NotificationInput = {
  kind:
    | "challenge"
    | "challenge_reply"
    | "friend_request"
    | "friend_accept"
    | "kudos"
    | "comment"
    | "tag"
    | "nudge"
    | "test";
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Skip the notification if one with this key was already sent. */
  dedupeKey?: string;
};

/**
 * Store a notification and push it to all the user's devices. Never throws —
 * a failed push must not fail the action that caused it. Returns false if it
 * was a duplicate (see `dedupeKey`).
 */
export async function notify(userId: string, n: NotificationInput): Promise<boolean> {
  try {
    const [row] = await db
      .insert(s.notifications)
      .values({ userId, ...n })
      .onConflictDoNothing()
      .returning({ id: s.notifications.id });
    if (!row) return false;
    await push(userId, { id: row.id, title: n.title, body: n.body, url: n.url, tag: n.kind });
    return true;
  } catch (err) {
    console.error("notify failed", err);
    return false;
  }
}

async function push(userId: string, payload: Record<string, string>) {
  if (!vapidPublicKey) return;
  const subs = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, userId));
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 12 * 60 * 60 },
        );
      } catch (err) {
        // Gone or unknown: the browser dropped the subscription, so do we.
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, sub.endpoint));
        } else {
          console.error("push failed", err);
        }
      }
    }),
  );
}

export async function saveSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
  // A device that switches accounts moves its subscription along.
  await db
    .insert(s.pushSubscriptions)
    .values({ userId, ...sub })
    .onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: { userId, p256dh: sub.p256dh, auth: sub.auth } });
}

export async function deleteSubscription(userId: string, endpoint: string) {
  await db
    .delete(s.pushSubscriptions)
    .where(and(eq(s.pushSubscriptions.endpoint, endpoint), eq(s.pushSubscriptions.userId, userId)));
}
