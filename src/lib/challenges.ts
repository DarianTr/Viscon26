import "server-only";
import { after } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s } from "@/db";
import type { SessionUser } from "./auth";
import { notify } from "./push";
import { filterFriends, timeAgo } from "./queries";
import { beatChallenge, formatEffort, initials } from "./session-types";
import type { Challenge, SessionType } from "./types";

/*
 * Challenges: dare friends to match one of your completed sessions. Accepting
 * puts a copy of the session on the friend's day; finishing that copy closes
 * the challenge and tells the challenger how it went. Each step pushes a
 * notification to the other side.
 */

const c = s.challenges;
const source = alias(s.sessions, "source");
const response = alias(s.sessions, "response");
const studyTypes: SessionType[] = ["deep", "intervals", "tempo", "recovery"];
const INBOX = "/community?tab=challenges";

const minutesOf = (row: { actualMinutes: number | null; plannedMinutes: number }) =>
  row.actualMinutes ?? row.plannedMinutes;

const effort = (row: { actualMinutes: number | null; plannedMinutes: number; focus: number | null }) => ({
  minutes: minutesOf(row),
  focus: row.focus,
});

/**
 * Challenge friends with the user's own completed session. Friends who already
 * have an open challenge on it are skipped. Returns how many were sent, or null
 * if any of `friendIds` isn't a friend.
 */
export async function sendChallenges(
  user: SessionUser,
  sessionId: string,
  friendIds: string[],
  message: string | null,
): Promise<number | null> {
  const ids = [...new Set(friendIds)];
  if ((await filterFriends(user.id, ids)).length !== ids.length) return null;
  if (ids.length === 0) return 0;

  const [session] = await db.select().from(s.sessions).where(eq(s.sessions.id, sessionId));
  const created = await db
    .insert(c)
    .values(ids.map((challengeeId) => ({ challengerId: user.id, challengeeId, sourceSessionId: sessionId, message })))
    .onConflictDoNothing()
    .returning({ challengeeId: c.challengeeId });

  const what = `"${session.title}" — ${formatEffort(effort(session))}${session.subject ? ` of ${session.subject}` : ""}`;
  after(() =>
    Promise.all(
      created.map(({ challengeeId }) =>
        notify(challengeeId, {
          kind: "challenge",
          title: `${user.name} challenged you ⚔️`,
          body: message ? `"${message}"\n${what}` : `Think you can match ${what}?`,
          url: INBOX,
        }),
      ),
    ),
  );
  return created.length;
}

/** Challenges the user received and sent, newest first. */
export async function listChallenges(userId: string): Promise<{ received: Challenge[]; sent: Challenge[] }> {
  const rows = await db
    .select({
      challenge: c,
      source: {
        title: source.title,
        type: source.type,
        subject: source.subject,
        plannedMinutes: source.plannedMinutes,
        actualMinutes: source.actualMinutes,
        focus: source.focus,
      },
      response: { actualMinutes: response.actualMinutes, plannedMinutes: response.plannedMinutes, focus: response.focus },
      other: { id: s.users.id, name: s.users.name, hue: s.users.hue },
    })
    .from(c)
    .innerJoin(source, eq(source.id, c.sourceSessionId))
    .leftJoin(response, eq(response.id, c.responseSessionId))
    // The person on the other side of the challenge.
    .innerJoin(
      s.users,
      or(
        and(eq(c.challengeeId, userId), eq(s.users.id, c.challengerId)),
        and(eq(c.challengerId, userId), eq(s.users.id, c.challengeeId)),
      ),
    )
    .where(or(eq(c.challengeeId, userId), eq(c.challengerId, userId)))
    .orderBy(desc(c.createdAt))
    .limit(100);

  const toChallenge = (r: (typeof rows)[number]): Challenge => ({
    id: r.challenge.id,
    status: r.challenge.status,
    message: r.challenge.message,
    sentAgo: timeAgo(r.challenge.createdAt),
    other: { ...r.other, initials: initials(r.other.name) },
    source: {
      title: r.source.title,
      type: r.source.type as SessionType,
      subject: r.source.subject,
      minutes: minutesOf(r.source),
      focus: r.source.focus,
    },
    result:
      r.challenge.status === "completed" && r.response
        ? effort(r.response)
        : null,
  });

  return {
    received: rows.filter((r) => r.challenge.challengeeId === userId).map(toChallenge),
    sent: rows.filter((r) => r.challenge.challengerId === userId).map(toChallenge),
  };
}

/**
 * Accept or decline a pending challenge sent to the user. Accepting adds the
 * session to their day. False if there's no such pending challenge.
 */
export async function respondToChallenge(user: SessionUser, id: string, accept: boolean): Promise<boolean> {
  const [row] = await db
    .select({ challenge: c, source })
    .from(c)
    .innerJoin(source, eq(source.id, c.sourceSessionId))
    .where(and(eq(c.id, id), eq(c.challengeeId, user.id), eq(c.status, "pending")));
  if (!row) return false;
  const { challenge, source: src } = row;

  const updated = await db.transaction(async (tx) => {
    // Guarded on status, so a double tap can't accept twice.
    const [claimed] = await tx
      .update(c)
      .set({ status: accept ? "accepted" : "declined", respondedAt: new Date() })
      .where(and(eq(c.id, id), eq(c.status, "pending")))
      .returning({ id: c.id });
    if (!claimed || !accept) return !!claimed;

    const challenger = await tx.query.users.findFirst({
      where: eq(s.users.id, challenge.challengerId),
      columns: { name: true },
    });
    const [copy] = await tx
      .insert(s.sessions)
      .values({
        userId: user.id,
        type: studyTypes.includes(src.type as SessionType) ? src.type : "deep",
        subject: src.subject,
        title: src.title,
        detail: `⚔️ Challenge from ${challenger?.name ?? "a friend"}: beat ${formatEffort(effort(src))}`,
        scheduledAt: new Date(),
        plannedMinutes: minutesOf(src),
      })
      .returning({ id: s.sessions.id });
    await tx.update(c).set({ responseSessionId: copy.id }).where(eq(c.id, id));
    return true;
  });
  if (!updated) return false;

  after(() =>
    notify(challenge.challengerId, {
      kind: "challenge_reply",
      ...(accept
        ? { title: `${user.name} accepted your challenge 👀`, body: `"${src.title}" is on their list for today. Game on.` }
        : { title: `${user.name} chickened out 🐔`, body: `"${src.title}" was apparently too much for them.` }),
      url: INBOX,
    }),
  );
  return true;
}

/** The challenger takes back a challenge that hasn't been answered yet. */
export async function withdrawChallenge(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(c)
    .where(and(eq(c.id, id), eq(c.challengerId, userId), eq(c.status, "pending")))
    .returning({ id: c.id });
  return rows.length > 0;
}

/**
 * Called when a task is marked done or undone: if it's the copy of an accepted
 * challenge, complete (or reopen) the challenge and tell the challenger.
 */
export async function syncChallengeCompletion(user: SessionUser, sessionId: string, done: boolean) {
  const [row] = await db
    .update(c)
    .set({ status: done ? "completed" : "accepted", completedAt: done ? new Date() : null })
    .where(and(eq(c.responseSessionId, sessionId), eq(c.status, done ? "accepted" : "completed")))
    .returning();
  if (!row || !done) return;

  const sessions = await db
    .select()
    .from(s.sessions)
    .where(inArray(s.sessions.id, [row.sourceSessionId, sessionId]));
  const src = sessions.find((x) => x.id === row.sourceSessionId)!;
  const res = sessions.find((x) => x.id === sessionId)!;

  const won = beatChallenge(effort(res), effort(src));
  after(() =>
    notify(row.challengerId, {
      kind: "challenge_reply",
      title: won ? `${user.name} beat your challenge 😤` : `${user.name} took your challenge… and lost 💀`,
      body: `"${src.title}": they did ${formatEffort(effort(res))}, you did ${formatEffort(effort(src))}.`,
      url: INBOX,
    }),
  );
}
