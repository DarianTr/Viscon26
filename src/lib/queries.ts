import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s, TIME_ZONE } from "@/db";
import { initials } from "./session-types";
import type {
  ActivePlan,
  Activity,
  CalendarEvent,
  Club,
  LeaderboardEntry,
  Plan,
  Profile,
  SessionType,
  Task,
} from "./types";

/*
 * Read side of the app. Every function here runs on the server and returns the
 * plain shapes from `./types`, so pages hand the results straight to client
 * components.
 */

const tz = sql.raw(`'${TIME_ZONE}'`);
/** A timestamp column as a local (Zurich) date. */
const localDate = (col: unknown) => sql`(${col} at time zone ${tz})::date`;
const today = sql`(now() at time zone ${tz})::date`;
/** Monday 00:00 of the current week, as a timestamptz. */
const weekStart = sql`(date_trunc('week', now() at time zone ${tz}) at time zone ${tz})`;

const studyTypes: SessionType[] = ["deep", "intervals", "tempo", "recovery"];

function displaySubjectName(name: string) {
  if (name === "Physics") return "EProg";
  if (name === "Analysis II") return "DiskMath";
  return name;
}

/**
 * The signed-in user. There is no auth yet, so this is the seeded demo user
 * named by DEMO_USER_HANDLE — replace with a session lookup when auth lands.
 * Also marks the calling page as per-request, since it reads live data.
 */
export const getCurrentUser = cache(async () => {
  await connection();
  const handle = process.env.DEMO_USER_HANDLE ?? "tprazak";
  const user = await db.query.users.findFirst({ where: eq(s.users.handle, handle) });
  if (!user) {
    throw new Error(`No user @${handle} in the database — run \`npm run db:seed\`.`);
  }
  return user;
});

const zurichTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

export async function getTodaysTasks(userId: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(s.sessions)
    .where(
      and(
        eq(s.sessions.userId, userId),
        inArray(s.sessions.type, studyTypes),
        sql`${localDate(s.sessions.scheduledAt)} = ${today}`,
      ),
    )
    .orderBy(asc(s.sessions.scheduledAt));

  return rows.map((r) => ({
    id: r.id,
    type: r.type as SessionType,
    subject: displaySubjectName(r.subject),
    title: r.title,
    detail: r.detail,
    minutes: r.plannedMinutes,
    time: zurichTime.format(r.scheduledAt),
    done: r.completedAt !== null,
  }));
}

/** Consecutive days, ending today or yesterday, with a completed session. */
export async function getStreak(userId: string): Promise<number> {
  const rows = await db
    .selectDistinct({ day: sql<string>`${localDate(s.sessions.completedAt)}::text` })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), isNotNull(s.sessions.completedAt)))
    .orderBy(desc(sql`1`))
    .limit(400);
  const [{ value: todayStr }] = await db.execute<{ value: string }>(sql`select ${today}::text as value`);

  const days = new Set(rows.map((r) => r.day));
  const cursor = new Date(`${todayStr}T00:00:00Z`);
  if (!days.has(todayStr)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function enrolledCount() {
  return db
    .select({ planId: s.enrollments.planId, enrolled: count().as("enrolled") })
    .from(s.enrollments)
    .where(eq(s.enrollments.active, true))
    .groupBy(s.enrollments.planId)
    .as("enrolled_count");
}

export async function listPlans(): Promise<Plan[]> {
  const counts = enrolledCount();
  const rows = await db
    .select({ plan: s.plans, enrolled: sql<number>`coalesce(${counts.enrolled}, 0)::int` })
    .from(s.plans)
    .leftJoin(counts, eq(counts.planId, s.plans.id))
    .orderBy(desc(sql`coalesce(${counts.enrolled}, 0)`));
  return rows.map(({ plan, enrolled }) => ({
    ...plan,
    title: plan.id === "analysis-exam" ? "DiskMath Exam Prep" : plan.title,
    enrolled,
  }));
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function getActivePlan(userId: string): Promise<ActivePlan | null> {
  const [enrollment] = await db
    .select({
      planId: s.enrollments.planId,
      examDate: s.enrollments.examDate,
      week: sql<number>`(floor((${today} - ${s.enrollments.startedOn}) / 7) + 1)::int`,
    })
    .from(s.enrollments)
    .where(and(eq(s.enrollments.userId, userId), eq(s.enrollments.active, true)))
    .limit(1);
  if (!enrollment) return null;

  const plan = (await listPlans()).find((p) => p.id === enrollment.planId)!;

  // One square per weekday: the day's first planned session, and whether
  // everything planned that day is done.
  const rows = await db
    .select({
      dow: sql<number>`extract(isodow from ${s.sessions.scheduledAt} at time zone ${tz})::int`,
      type: sql<SessionType>`(array_agg(${s.sessions.type} order by ${s.sessions.scheduledAt}))[1]`,
      done: sql<boolean>`bool_and(${s.sessions.completedAt} is not null)`,
    })
    .from(s.sessions)
    .where(
      and(
        eq(s.sessions.userId, userId),
        eq(s.sessions.planId, plan.id),
        sql`${s.sessions.scheduledAt} >= ${weekStart}`,
        sql`${s.sessions.scheduledAt} < ${weekStart} + interval '7 days'`,
      ),
    )
    .groupBy(sql`1`);

  return {
    plan,
    currentWeek: Math.min(plan.weeks, Math.max(1, enrollment.week)),
    examDate: enrollment.examDate,
    weekSessions: weekdays.map((day, i) => {
      const row = rows.find((r) => r.dow === i + 1);
      return { day, type: row?.type ?? null, done: row?.done ?? false };
    }),
  };
}

/** Everything on the user's calendar from ~3 months back to ~6 months ahead. */
export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  const rows = await db
    .select({
      id: s.sessions.id,
      type: s.sessions.type,
      title: s.sessions.title,
      start: s.sessions.scheduledAt,
      minutes: s.sessions.plannedMinutes,
    })
    .from(s.sessions)
    .where(
      and(
        eq(s.sessions.userId, userId),
        sql`${s.sessions.scheduledAt} > now() - interval '3 months'`,
        sql`${s.sessions.scheduledAt} < now() + interval '6 months'`,
      ),
    )
    .orderBy(asc(s.sessions.scheduledAt));
  return rows.map((r) => ({ ...r, start: r.start.toISOString() }));
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return relative.format(-Math.round(hours / 24), "day");
}

/** Completed, shared sessions by the user and everyone they follow. */
export async function getFeed(userId: string, limit = 20): Promise<Activity[]> {
  const following = db
    .select({ id: s.follows.followeeId })
    .from(s.follows)
    .where(eq(s.follows.followerId, userId));

  const rows = await db
    .select({
      session: s.sessions,
      user: { id: s.users.id, name: s.users.name, hue: s.users.hue },
      kudos: sql<number>`(select count(*) from ${s.kudos} where ${s.kudos.sessionId} = ${s.sessions.id})::int`,
      kudoed: sql<boolean>`exists (select 1 from ${s.kudos} where ${s.kudos.sessionId} = ${s.sessions.id} and ${s.kudos.userId} = ${userId})`,
      comments: sql<number>`(select count(*) from ${s.comments} where ${s.comments.sessionId} = ${s.sessions.id})::int`,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(
      and(
        isNotNull(s.sessions.completedAt),
        eq(s.sessions.shared, true),
        or(eq(s.sessions.userId, userId), inArray(s.sessions.userId, following)),
      ),
    )
    .orderBy(desc(s.sessions.completedAt))
    .limit(limit);

  return rows.map(({ session, user, kudos, kudoed, comments }) => ({
    id: session.id,
    user: { ...user, initials: initials(user.name) },
    postedAgo: timeAgo(session.completedAt!),
    location: session.location,
    title: session.title,
    type: session.type as SessionType,
    subject: displaySubjectName(session.subject),
    minutes: session.actualMinutes ?? session.plannedMinutes,
    focus: session.focus,
    trace: session.trace,
    kudos,
    kudoed,
    comments,
    note: session.note,
    mine: session.userId === userId,
  }));
}

/** Study hours this week for the user and everyone they follow. */
export async function getLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
  const following = db
    .select({ id: s.follows.followeeId })
    .from(s.follows)
    .where(eq(s.follows.followerId, userId));

  const rows = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      hue: s.users.hue,
      minutes: sql<number>`coalesce(sum(${s.sessions.actualMinutes}), 0)::int`,
    })
    .from(s.users)
    .leftJoin(
      s.sessions,
      and(eq(s.sessions.userId, s.users.id), sql`${s.sessions.completedAt} >= ${weekStart}`),
    )
    .where(or(eq(s.users.id, userId), inArray(s.users.id, following)))
    .groupBy(s.users.id)
    .orderBy(desc(sql`4`));

  return rows.map((r) => ({
    id: r.id,
    name: r.id === userId ? "You" : r.name,
    initials: initials(r.name),
    hue: r.hue,
    hours: r.minutes / 60,
    you: r.id === userId,
  }));
}

export async function getClubs(userId: string): Promise<Club[]> {
  const rows = await db
    .select({
      id: s.clubs.id,
      name: s.clubs.name,
      emoji: s.clubs.emoji,
      members: count(s.clubMembers.userId),
      joined: sql<boolean>`bool_or(${s.clubMembers.userId} = ${userId})`,
    })
    .from(s.clubs)
    .leftJoin(s.clubMembers, eq(s.clubMembers.clubId, s.clubs.id))
    .groupBy(s.clubs.id)
    .orderBy(asc(s.clubs.createdAt), asc(s.clubs.name));
  return rows.map((r) => ({
    ...r,
    name: r.name === "Analysis Survivors" ? "DiskMath Survivors" : r.name,
    joined: r.joined ?? false,
  }));
}

export async function getProfile(user: typeof s.users.$inferSelect): Promise<Profile> {
  const userId = user.id;
  const mine = eq(s.sessions.userId, userId);
  const done = and(mine, isNotNull(s.sessions.completedAt));
  const outgoingFollows = alias(s.follows, "outgoing_follows");
  const incomingFollows = alias(s.follows, "incoming_follows");

  const [[friends], [totals], [kudos], week, subjects, badges, streak, exams] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(outgoingFollows)
        .innerJoin(
          incomingFollows,
          and(
            eq(outgoingFollows.followeeId, incomingFollows.followerId),
            eq(outgoingFollows.followerId, incomingFollows.followeeId),
          ),
        )
        .where(eq(outgoingFollows.followerId, userId)),
      db
        .select({
          minutes: sql<number>`coalesce(sum(${s.sessions.actualMinutes}), 0)::int`,
          sessions: count(),
        })
        .from(s.sessions)
        .where(done),
      db
        .select({ n: count() })
        .from(s.kudos)
        .innerJoin(s.sessions, eq(s.sessions.id, s.kudos.sessionId))
        .where(mine),
      db
        .select({
          dow: sql<number>`extract(isodow from ${s.sessions.completedAt} at time zone ${tz})::int`,
          minutes: sql<number>`sum(${s.sessions.actualMinutes})::int`,
        })
        .from(s.sessions)
        .where(and(done, sql`${s.sessions.completedAt} >= ${weekStart}`))
        .groupBy(sql`1`),
      db
        .select({
          name: s.sessions.subject,
          minutes: sql<number>`sum(${s.sessions.actualMinutes})::int`,
        })
        .from(s.sessions)
        .where(done)
        .groupBy(s.sessions.subject)
        .orderBy(desc(sql`2`))
        .limit(4),
      db
        .select({
          emoji: s.badges.emoji,
          label: s.badges.label,
          earned: sql<boolean>`${s.userBadges.userId} is not null`,
        })
        .from(s.badges)
        .leftJoin(
          s.userBadges,
          and(eq(s.userBadges.badgeId, s.badges.id), eq(s.userBadges.userId, userId)),
        )
        .orderBy(asc(s.badges.position)),
      getStreak(userId),
      db
        .select({
          name: s.sessions.subject,
          hoursRemaining: sql<number>`ceil(extract(epoch from (${s.sessions.scheduledAt} - now())) / 3600)::int`,
        })
        .from(s.sessions)
        .where(
          and(
            mine,
            eq(s.sessions.type, "exam"),
            sql`${s.sessions.scheduledAt} >= now()`,
          ),
        )
        .orderBy(asc(s.sessions.scheduledAt)),
    ]);

  const hours = (minutes: number) => Math.round((minutes / 60) * 4) / 4;
  const subjectSummaries = new Map<string, Profile["subjects"][number]>();
  for (const subject of subjects) {
    const name = displaySubjectName(subject.name);
    const existing = subjectSummaries.get(name);
    subjectSummaries.set(name, {
      name,
      hours: (existing?.hours ?? 0) + Math.round(subject.minutes / 60),
      examHoursRemaining: null,
    });
  }
  for (const exam of exams) {
    const name = displaySubjectName(exam.name);
    const subject = subjectSummaries.get(name) ?? {
      name,
      hours: 0,
      examHoursRemaining: null,
    };
    subject.examHoursRemaining ??= exam.hoursRemaining;
    subjectSummaries.set(name, subject);
  }

  return {
    name: user.name,
    initials: initials(user.name),
    hue: user.hue,
    spiritAnimal: user.spiritAnimal,
    handle: `@${user.handle}`,
    program: user.program,
    friends: friends.n,
    streak,
    totals: { hours: Math.round(totals.minutes / 60), sessions: totals.sessions, kudos: kudos.n },
    week: weekdays.map((_, i) => hours(week.find((w) => w.dow === i + 1)?.minutes ?? 0)),
    weeklyGoal: user.weeklyGoalHours,
    subjects: [...subjectSummaries.values()],
    badges,
  };
}
