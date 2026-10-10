import "server-only";
import { sql } from "drizzle-orm";
import { db, TIME_ZONE } from "@/db";
import { notify } from "./push";
import { getStreak } from "./queries";
import { formatMinutes } from "./session-types";
import type { NudgeStyle } from "./types";

/*
 * The daily "go study" push, Duolingo-style. In the evening, everyone with push
 * enabled who hasn't finished a session today gets one line, built from what
 * their friends actually did. At most one per slot per day (`dedupeKey`).
 */

/** Local (Zurich) hour each nudge goes out at. */
const SLOTS = { evening: 18, late: 21 } as const;
type Slot = keyof typeof SLOTS;

type Target = {
  id: string;
  style: NudgeStyle;
  /** The friend who did the most today, if anyone did anything. */
  rival: { name: string; sessions: number; minutes: number } | null;
  /** Who sent the oldest challenge still waiting for an answer. */
  pendingFrom: string | null;
};

const tz = sql.raw(`'${TIME_ZONE}'`);
const today = sql`(now() at time zone ${tz})::date`;
/** Session `x` was finished today. */
const doneToday = sql`x.completed_at is not null and (x.completed_at at time zone ${tz})::date = ${today}`;
/** The nudge's `dedupeKey` is this plus the user's id. */
const keyPrefix = (slot: Slot, date: string) => `nudge:${slot}:${date}:`;

/**
 * Users due the slot's nudge: push enabled, nothing finished today, not nudged
 * yet. With `onlyUserId`, just that user, whatever they did.
 */
async function findTargets(due: { slot: Slot; date: string } | { onlyUserId: string }): Promise<Target[]> {
  const who =
    "onlyUserId" in due
      ? sql`u.id = ${due.onlyUserId}`
      : sql`u.nudge_style <> 'off'
        and exists (select 1 from push_subscriptions p where p.user_id = u.id)
        and not exists (select 1 from sessions x where x.user_id = u.id and ${doneToday})
        and not exists (select 1 from notifications n where n.dedupe_key = ${keyPrefix(due.slot, due.date)} || u.id)`;

  const rows = await db.execute<{
    id: string;
    style: NudgeStyle;
    rival: Target["rival"];
    pending_from: string | null;
  }>(sql`
    select u.id, u.nudge_style as style,
      (select json_build_object('name', split_part(fu.name, ' ', 1), 'sessions', count(*),
          'minutes', sum(coalesce(x.actual_minutes, x.planned_minutes)))
        from sessions x join users fu on fu.id = x.user_id
        where ${doneToday}
          and x.user_id in (select case when f.requester_id = u.id then f.addressee_id else f.requester_id end
            from friendships f where f.accepted_at is not null and u.id in (f.requester_id, f.addressee_id))
        group by fu.id, fu.name
        order by count(*) desc, sum(coalesce(x.actual_minutes, x.planned_minutes)) desc
        limit 1) as rival,
      (select split_part(cu.name, ' ', 1) from challenges c join users cu on cu.id = c.challenger_id
        where c.challengee_id = u.id and c.status = 'pending'
        order by c.created_at limit 1) as pending_from
    from users u
    where ${who}
  `);
  return rows.map((r) => ({ id: r.id, style: r.style, rival: r.rival, pendingFrom: r.pending_from }));
}

const pick = <T>(options: T[]) => options[Math.floor(Math.random() * options.length)];

/** One line for the user, worst news first: a dying streak, a dodged challenge, a busy friend. */
export function nudgeMessage(t: Target, streak: number, slot: Slot): { title: string; body: string } {
  const { rival, pendingFrom } = t;
  const did = rival && (rival.sessions === 1 ? "a session" : `${rival.sessions} sessions`);

  if (t.style === "gentle") {
    if (slot === "late" && streak > 0)
      return { title: `Keep your ${streak}-day streak alive`, body: "One short session before midnight does it." };
    if (pendingFrom) return { title: `${pendingFrom} challenged you`, body: "Have a look when you've got a moment." };
    if (rival)
      return { title: `${rival.name} studied ${formatMinutes(rival.minutes)} today`, body: "Fancy a quick session to keep up?" };
    return { title: "A little study goes a long way", body: "Even 25 minutes counts today." };
  }

  if (slot === "late" && streak > 0)
    return {
      title: `Your ${streak}-day streak dies at midnight 🔥`,
      body: rival ? `${rival.name} did ${did} today. They'd love to see it go.` : "It was nice knowing it.",
    };
  if (pendingFrom)
    return pick([
      { title: `${pendingFrom}'s challenge is still waiting`, body: "Scared? 🐔" },
      { title: `${pendingFrom} dared you. You're ignoring it.`, body: "Bold strategy. Let's see how it plays out." },
    ]);
  if (rival)
    return pick([
      { title: `${rival.name} did ${did} today.`, body: "Where are you at? 👀" },
      { title: `${rival.name}: ${formatMinutes(rival.minutes)} today. You: 0 min.`, body: "Just saying." },
      { title: `${rival.name} is getting smarter right now.`, body: "You are not." },
      { title: `${rival.name} did ${did} today.`, body: "Your brain cells are filing a complaint." },
    ]);
  return pick([
    { title: "0 minutes today.", body: "The exam doesn't care that you were tired." },
    { title: "Your brain called.", body: "It's bored. Feed it something." },
    { title: "Still nothing today?", body: "Your future self is watching. Disappointed." },
  ]);
}

/** Send the slot's nudge to everyone who's due one. Safe to call repeatedly. */
export async function sendNudges(slot: Slot): Promise<number> {
  const [{ date }] = await db.execute<{ date: string }>(sql`select ${today}::text as date`);
  let sent = 0;
  for (const target of await findTargets({ slot, date })) {
    const message = nudgeMessage(target, await getStreak(target.id), slot);
    const ok = await notify(target.id, {
      kind: "nudge",
      ...message,
      url: "/",
      dedupeKey: keyPrefix(slot, date) + target.id,
    });
    if (ok) sent++;
  }
  return sent;
}

/** A sample nudge for the user, sent right away — for trying push out in settings. */
export async function sendTestNudge(userId: string): Promise<void> {
  const [target] = await findTargets({ onlyUserId: userId });
  if (!target) return;
  const style = target.style === "off" ? "savage" : target.style;
  const message = nudgeMessage({ ...target, style }, await getStreak(userId), "evening");
  await notify(userId, { kind: "test", ...message, url: "/" });
}

const zurichHour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIME_ZONE });

/**
 * Check every 10 minutes whether a slot's hour has come. Started once per
 * server from `src/instrumentation.ts`; several servers are fine, since each
 * nudge is deduplicated in the database.
 */
export function startNudgeScheduler() {
  const g = globalThis as unknown as { __nudgeTimer?: NodeJS.Timeout };
  if (g.__nudgeTimer) return;
  const tick = () => {
    const hour = Number(zurichHour.format(new Date()));
    const slot = (Object.keys(SLOTS) as Slot[]).find((k) => SLOTS[k] === hour);
    if (slot) sendNudges(slot).catch((err) => console.error("nudges failed", err));
  };
  g.__nudgeTimer = setInterval(tick, 10 * 60 * 1000);
  g.__nudgeTimer.unref();
  tick();
}
