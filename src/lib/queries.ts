import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema as s, TIME_ZONE } from "@/db";
import { latestExamDate } from "./plan-status";
import { requireUser, type SessionUser } from "./auth";
import {
  classifyDay,
  decayMascotHealth,
  mascotStatusFromHealth,
  vacationDaySet,
  type DayOutcome,
  type MascotStatus,
} from "./mascot";
import { initials } from "./session-types";
import { isActiveInWeek, planSpan, plannedMinutes, weekBounds } from "./weekly-goal";
import type {
  ActivePlan,
  Activity,
  BlockActivity,
  CalendarEvent,
  Comment,
  FriendStatus,
  LeaderboardEntry,
  Plan,
  Person,
  Profile,
  SessionType,
  SubjectChoice,
  Task,
  WeeklyGoal,
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

/**
 * Blocks that belong to an academic subject. Breaks and buffers are scheduling
 * time, not subjects: they never count as study time or show up as a subject.
 */
export const academic = and(isNotNull(s.sessions.subject), notInArray(s.sessions.type, ["buffer", "break"]));

const studyTypes: SessionType[] = ["theory", "exercises", "mock_exam", "quiz"];

const f = s.friendships;

/** Subquery: ids of the user's friends (accepted requests, either direction). */
function friendIds(userId: string) {
  return sql`(select case when ${f.requesterId} = ${userId} then ${f.addresseeId} else ${f.requesterId} end
    from ${f} where ${f.acceptedAt} is not null and ${userId} in (${f.requesterId}, ${f.addresseeId}))`;
}

/** Where `otherId` stands with `userId`: friends, a pending request either way, or nothing. */
function friendStatus(userId: string, otherId: unknown) {
  return sql<FriendStatus>`coalesce((
    select case when ${f.acceptedAt} is not null then 'friends'
      when ${f.requesterId} = ${userId} then 'sent' else 'received' end
    from ${f}
    where (${f.requesterId} = ${userId} and ${f.addresseeId} = ${otherId})
      or (${f.requesterId} = ${otherId} and ${f.addresseeId} = ${userId})
  ), 'none')`;
}

/** Which of `ids` are the user's friends. */
export async function filterFriends(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(inArray(s.users.id, ids), sql`${s.users.id} in ${friendIds(userId)}`));
  return rows.map((r) => r.id);
}

export async function getFriendStatus(userId: string, otherId: string): Promise<FriendStatus> {
  const [{ status }] = await db.execute<{ status: FriendStatus }>(
    sql`select ${friendStatus(userId, otherId)} as status`,
  );
  return status;
}

/**
 * The signed-in user; redirects to /signup if there is none. Also marks the
 * calling page as per-request, since it reads live data.
 */
export const getCurrentUser = cache(async () => {
  await connection();
  return requireUser();
});

const zurichTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

/**
 * The plan and subject today's study is about, to preselect them when logging a
 * data point: the latest session that has started today, else today's first one.
 */
export async function getTodaysLogContext(userId: string): Promise<{ planId: string; subject: string } | null> {
  const rows = await db
    .select({ planId: s.sessions.userPlanId, subject: s.sessions.subject, scheduledAt: s.sessions.scheduledAt })
    .from(s.sessions)
    .where(
      and(
        eq(s.sessions.userId, userId),
        isNotNull(s.sessions.userPlanId),
        isNotNull(s.sessions.subject),
        inArray(s.sessions.type, studyTypes),
        sql`${localDate(s.sessions.scheduledAt)} = ${today}`,
      ),
    )
    .orderBy(asc(s.sessions.scheduledAt));
  const now = Date.now();
  const row = rows.findLast((r) => r.scheduledAt.getTime() <= now) ?? rows[0];
  return row ? { planId: row.planId!, subject: row.subject! } : null;
}

const zurichDate = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

/** A Date's Zurich-local calendar day, as "YYYY-MM-DD". */
const localDayKey = (at: Date) => zurichDate.format(at);

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
    activity: r.activity as BlockActivity | null,
    userPlanId: r.userPlanId,
    subject: r.subject ?? "",
    title: r.title,
    detail: r.detail,
    minutes: r.plannedMinutes,
    actualMinutes: r.actualMinutes,
    time: zurichTime.format(r.scheduledAt),
    done: r.completedAt !== null,
    skipped: r.skippedAt !== null,
    manual: r.addedManually,
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

const MASCOT_LOOKBACK_DAYS = 21;

export type MascotHealth = { health: number; status: MascotStatus };

/**
 * The mascot's current health: recomputed from the last few weeks of
 * sessions every time, never stored. Decays on days the student's plan
 * scheduled study and none happened, or (with no plan at all) on days
 * nothing was studied; a logged vacation, or a plan day with nothing
 * scheduled, leaves it untouched. See lib/mascot.ts for the day-by-day rules.
 */
export async function getMascotHealth(userId: string): Promise<MascotHealth> {
  const [[user], plans, [earliest]] = await Promise.all([
    db.select({ createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, userId)),
    db
      .select({ createdAt: s.userPlans.createdAt, config: s.userPlans.config })
      .from(s.userPlans)
      .where(eq(s.userPlans.userId, userId)),
    // Drizzle can't attach a type parser to a raw aggregate expression, so this
    // comes back as a string (e.g. "2026-08-26 06:30:00+00") — parsed below.
    db
      .select({ scheduledAt: sql<string | null>`min(${s.sessions.scheduledAt})` })
      .from(s.sessions)
      .where(and(eq(s.sessions.userId, userId), inArray(s.sessions.type, studyTypes))),
  ]);

  const vacationDays = vacationDaySet(plans.flatMap((p) => p.config?.vacationRanges ?? []));
  const earliestPlan = plans.length
    ? plans.reduce((min, p) => (p.createdAt < min ? p.createdAt : min), plans[0].createdAt)
    : null;
  const planStartKey = earliestPlan ? localDayKey(earliestPlan) : null;
  const earliestSession = earliest?.scheduledAt ? new Date(earliest.scheduledAt) : null;

  const todayKey = localDayKey(new Date());
  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - MASCOT_LOOKBACK_DAYS);
  // Never look further back than the earliest trace of the account (its creation, its
  // first plan or its first scheduled session) — a brand-new user starts at full health.
  const accountFloor = [user.createdAt, earliestPlan, earliestSession]
    .filter((d): d is Date => d != null)
    .reduce((min, d) => (d < min ? d : min), user.createdAt);
  const startKey = [localDayKey(windowStart), localDayKey(accountFloor)].sort().pop()!;

  const rows = await db
    .select({
      day: sql<string>`${localDate(s.sessions.scheduledAt)}::text`,
      scheduled: sql<number>`count(*) filter (where ${inArray(s.sessions.type, studyTypes)})::int`,
      completed: sql<number>`count(*) filter (where ${inArray(s.sessions.type, studyTypes)} and ${s.sessions.completedAt} is not null)::int`,
    })
    .from(s.sessions)
    .where(
      and(
        eq(s.sessions.userId, userId),
        sql`${localDate(s.sessions.scheduledAt)} >= ${startKey}::date`,
        sql`${localDate(s.sessions.scheduledAt)} < ${todayKey}::date`,
      ),
    )
    .groupBy(sql`1`);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const days: DayOutcome[] = [];
  const cursor = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${todayKey}T00:00:00Z`);
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    const row = byDay.get(key);
    days.push(
      classifyDay({
        vacation: vacationDays.has(key),
        hasPlan: planStartKey !== null && key >= planStartKey,
        scheduledStudyBlocks: row?.scheduled ?? 0,
        completedStudyBlocks: row?.completed ?? 0,
      }),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const health = decayMascotHealth(days);
  return { health, status: mascotStatusFromHealth(health) };
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
  return rows.map(({ plan, enrolled }) => ({ ...plan, enrolled }));
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type CustomPlan = {
  id: string;
  title: string;
  createdAt: string;
  totalSessions: number;
  doneSessions: number;
  subjects: string[];
  firstDate: string | null;
  lastDate: string | null;
  /** Where "Continue plan" goes: the ongoing or next uncompleted study block. */
  next: { title: string; start: string; ongoing: boolean } | null;
  /** The plan's last exam, "YYYY-MM-DD" — whether it is current or finished follows from it (lib/plan-status.ts). */
  latestExamDate: string | null;
  /** When the student archived the plan, if they did. */
  archivedAt: string | null;
};

export async function getUserCustomPlans(userId: string): Promise<CustomPlan[]> {
  const plans = await db
    .select({
      id: s.userPlans.id,
      title: s.userPlans.title,
      createdAt: s.userPlans.createdAt,
      config: s.userPlans.config,
      archivedAt: s.userPlans.archivedAt,
    })
    .from(s.userPlans)
    .where(eq(s.userPlans.userId, userId))
    .orderBy(desc(s.userPlans.createdAt));

  if (plans.length === 0) return [];

  const planIds = plans.map((p) => p.id);

  const stats = await db
    .select({
      userPlanId: s.sessions.userPlanId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(${s.sessions.completedAt})::int`,
      subjects: sql<string[]>`array_agg(distinct ${s.sessions.subject})`,
      firstDate: sql<string | null>`min(${s.sessions.scheduledAt})::text`,
      lastDate: sql<string | null>`max(${s.sessions.scheduledAt})::text`,
    })
    .from(s.sessions)
    .where(and(inArray(s.sessions.userPlanId, planIds), academic, ne(s.sessions.type, "exam")))
    .groupBy(s.sessions.userPlanId);

  const statsByPlanId = new Map(stats.map((r) => [r.userPlanId, r]));

  // Each plan's ongoing or next study block that isn't done yet.
  const upcoming = await db
    .selectDistinctOn([s.sessions.userPlanId], {
      userPlanId: s.sessions.userPlanId,
      title: s.sessions.title,
      start: s.sessions.scheduledAt,
    })
    .from(s.sessions)
    .where(and(
      inArray(s.sessions.userPlanId, planIds),
      isNull(s.sessions.completedAt),
      isNull(s.sessions.skippedAt),
      academic,
      notInArray(s.sessions.type, ["exam", "lecture"]),
      sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > now()`,
    ))
    .orderBy(s.sessions.userPlanId, asc(s.sessions.scheduledAt));
  const nextByPlanId = new Map(upcoming.map((r) => [r.userPlanId, r]));

  // Plans that never stored their subjects' exam dates fall back to their exam
  // sessions, as calendar dates where the student is.
  const examDays = await db
    .select({
      userPlanId: s.sessions.userPlanId,
      latest: sql<string | null>`max((${s.sessions.scheduledAt} at time zone ${tz})::date)::text`,
    })
    .from(s.sessions)
    .where(and(inArray(s.sessions.userPlanId, planIds), eq(s.sessions.type, "exam")))
    .groupBy(s.sessions.userPlanId);
  const examDayByPlanId = new Map(examDays.map((r) => [r.userPlanId, r.latest]));
  const now = Date.now();

  return plans.map((p) => {
    const st = statsByPlanId.get(p.id);
    const next = nextByPlanId.get(p.id);
    return {
      id: p.id,
      title: p.title,
      createdAt: p.createdAt.toISOString(),
      totalSessions: st?.total ?? 0,
      doneSessions: st?.done ?? 0,
      subjects: st?.subjects ?? [],
      firstDate: st?.firstDate ?? null,
      lastDate: st?.lastDate ?? null,
      next: next ? { title: next.title, start: next.start.toISOString(), ongoing: next.start.getTime() <= now } : null,
      latestExamDate: p.config?.subjects?.length
        ? latestExamDate(p.config.subjects.map((sub) => sub.examDate))
        : latestExamDate([examDayByPlanId.get(p.id)]),
      archivedAt: p.archivedAt?.toISOString() ?? null,
    };
  });
}

/** Subjects of the user's unarchived plans, for adding a session by hand. */
export async function getSubjectChoices(userId: string): Promise<SubjectChoice[]> {
  const choices = new Map<string, SubjectChoice>();
  // Newest plan first, so a subject in several plans counts toward the newest.
  for (const plan of await getUserCustomPlans(userId)) {
    if (plan.archivedAt) continue;
    for (const name of plan.subjects) {
      if (name && !choices.has(name)) choices.set(name, { name, planId: plan.id, planTitle: plan.title });
    }
  }
  return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type PlanEnrollment = { planId: string; currentWeek: number; active: boolean };

export async function getUserEnrollments(userId: string): Promise<PlanEnrollment[]> {
  const rows = await db
    .select({
      planId: s.enrollments.planId,
      week: sql<number>`(floor((${today} - ${s.enrollments.startedOn}) / 7) + 1)::int`,
      active: s.enrollments.active,
    })
    .from(s.enrollments)
    .where(eq(s.enrollments.userId, userId));
  return rows.map((r) => ({ planId: r.planId, currentWeek: Math.max(1, r.week), active: r.active }));
}

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
      activity: s.sessions.activity,
      subject: s.sessions.subject,
      planId: s.sessions.userPlanId,
      cheatsheetMinutes: s.sessions.cheatsheetMinutes,
      cheatsheetTarget: s.sessions.cheatsheetTarget,
      prepPhase: s.sessions.prepPhase,
      title: s.sessions.title,
      start: s.sessions.scheduledAt,
      minutes: s.sessions.plannedMinutes,
      calendarOrder: s.sessions.calendarOrder,
      completedAt: s.sessions.completedAt,
      skippedAt: s.sessions.skippedAt,
      manual: s.sessions.addedManually,
    })
    .from(s.sessions)
    .where(
      and(
        eq(s.sessions.userId, userId),
        sql`${s.sessions.type} <> 'vacation'`,
        sql`${s.sessions.scheduledAt} > now() - interval '3 months'`,
        sql`${s.sessions.scheduledAt} < now() + interval '6 months'`,
      ),
    )
    .orderBy(asc(s.sessions.scheduledAt));
  return rows.map(({ completedAt, skippedAt, ...r }) => ({
    ...r,
    start: r.start.toISOString(),
    end: new Date(r.start.getTime() + r.minutes * 60_000).toISOString(),
    done: completedAt !== null,
    skipped: skippedAt !== null,
  }));
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const taggedUser = alias(s.users, "tagged_user");

/** Photo ids on the session in the current row, oldest first. */
const photoIds = sql<string[]>`coalesce((
  select json_agg(${s.sessionPhotos.id} order by ${s.sessionPhotos.createdAt})
  from ${s.sessionPhotos} where ${s.sessionPhotos.sessionId} = ${s.sessions.id}
), '[]')`;

/** Friends tagged on the session in the current row, by name. */
const taggedUsers = sql<{ id: string; name: string; hue: number }[]>`coalesce((
  select json_agg(json_build_object('id', ${taggedUser.id}, 'name', ${taggedUser.name}, 'hue', ${taggedUser.hue}) order by ${taggedUser.name})
  from ${s.sessionTags} inner join ${s.users} as "tagged_user" on ${taggedUser.id} = ${s.sessionTags.userId}
  where ${s.sessionTags.sessionId} = ${s.sessions.id}
), '[]')`;

export function timeAgo(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return relative.format(-Math.round(hours / 24), "day");
}

/**
 * Completed, shared sessions by the user and their friends. With `mineOnly`,
 * just the user's own — private ones included.
 */
export async function getFeed(
  userId: string,
  { limit = 20, mineOnly = false }: { limit?: number; mineOnly?: boolean } = {},
): Promise<Activity[]> {
  const rows = await db
    .select({
      session: s.sessions,
      user: { id: s.users.id, name: s.users.name, hue: s.users.hue },
      kudos: sql<number>`(select count(*) from ${s.kudos} where ${s.kudos.sessionId} = ${s.sessions.id})::int`,
      kudoed: sql<boolean>`exists (select 1 from ${s.kudos} where ${s.kudos.sessionId} = ${s.sessions.id} and ${s.kudos.userId} = ${userId})`,
      comments: sql<number>`(select count(*) from ${s.comments} where ${s.comments.sessionId} = ${s.sessions.id})::int`,
      photos: photoIds,
      tagged: taggedUsers,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(
      and(
        isNotNull(s.sessions.completedAt),
        mineOnly
          ? eq(s.sessions.userId, userId)
          : and(
              eq(s.sessions.shared, true),
              or(eq(s.sessions.userId, userId), sql`${s.sessions.userId} in ${friendIds(userId)}`),
            ),
      ),
    )
    .orderBy(desc(s.sessions.completedAt))
    .limit(limit);

  return rows.map(({ session, user, kudos, kudoed, comments, photos, tagged }) => ({
    id: session.id,
    user: { ...user, initials: initials(user.name) },
    postedAgo: timeAgo(session.completedAt!),
    location: session.location,
    title: session.title,
    type: session.type as SessionType,
    subject: session.subject ?? "",
    minutes: session.actualMinutes ?? session.plannedMinutes,
    focus: session.focus,
    trace: session.trace,
    kudos,
    kudoed,
    comments,
    note: session.note,
    photos: photos.map((id) => ({ id, url: `/api/photos/${id}` })),
    tagged: tagged.map((u) => ({ ...u, name: u.id === userId ? "You" : u.name, initials: initials(u.name) })),
    mine: session.userId === userId,
    shared: session.shared,
  }));
}

/** Study hours this week for the user and their friends. */
export async function getLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
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
    .where(or(eq(s.users.id, userId), sql`${s.users.id} in ${friendIds(userId)}`))
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

/**
 * This week's study target, from the plans active this week (see
 * `./weekly-goal`): the focused time their blocks schedule, each minute counted
 * once. Without an active custom plan, an active template plan's weekly hours.
 */
export async function getWeeklyGoal(userId: string): Promise<WeeklyGoal> {
  const week = weekBounds(new Date(), TIME_ZONE);
  const day = localDate(s.sessions.scheduledAt);
  const plans = await db
    .select({
      id: s.userPlans.id,
      title: s.userPlans.title,
      config: s.userPlans.config,
      firstBlock: sql<string | null>`min(${day})::text`,
      lastBlock: sql<string | null>`max(${day})::text`,
      lastExamBlock: sql<string | null>`(max(${day}) filter (where ${s.sessions.type} = 'exam'))::text`,
    })
    .from(s.userPlans)
    .leftJoin(s.sessions, eq(s.sessions.userPlanId, s.userPlans.id))
    // Archived plans are past plans: they set no goal.
    .where(and(eq(s.userPlans.userId, userId), isNull(s.userPlans.archivedAt)))
    .groupBy(s.userPlans.id)
    .orderBy(asc(s.userPlans.createdAt));

  const spans = plans.map((p) => ({
    ...p,
    span: planSpan({ ...p, planStart: p.config?.planStart, examDates: p.config?.subjects?.map((x) => x.examDate) }),
  }));
  const active = spans.filter((p) => isActiveInWeek(p.span, week));

  if (active.length > 0) {
    const blocks = await db
      .select({
        start: s.sessions.scheduledAt,
        minutes: s.sessions.plannedMinutes,
        dow: sql<number>`extract(isodow from ${s.sessions.scheduledAt} at time zone ${tz})::int`,
      })
      .from(s.sessions)
      .where(
        and(
          eq(s.sessions.userId, userId),
          inArray(s.sessions.userPlanId, active.map((p) => p.id)),
          // Focused study only: no buffers, breaks, meals or the exam itself.
          isNotNull(s.sessions.subject),
          inArray(s.sessions.type, studyTypes),
          sql`${s.sessions.scheduledAt} >= ${weekStart}`,
          sql`${s.sessions.scheduledAt} < ${weekStart} + interval '7 days'`,
        ),
      );
    const { byDay } = plannedMinutes(
      blocks.map((b) => ({ start: b.start.getTime(), end: b.start.getTime() + b.minutes * 60_000, day: b.dow - 1 })),
    );
    const planned = byDay.map((m) => m / 60);
    return { kind: "plan", hours: planned.reduce((a, b) => a + b, 0), planned, plans: active.map((p) => p.title) };
  }

  const [template] = await db
    .select({ title: s.plans.title, hoursPerWeek: s.plans.hoursPerWeek })
    .from(s.enrollments)
    .innerJoin(s.plans, eq(s.plans.id, s.enrollments.planId))
    .where(
      and(
        eq(s.enrollments.userId, userId),
        eq(s.enrollments.active, true),
        sql`${s.enrollments.startedOn} <= ${week.end}::date`,
        sql`(${s.enrollments.examDate} is null or ${s.enrollments.examDate} >= ${week.start}::date)`,
      ),
    )
    .limit(1);
  if (template) return { kind: "plan", hours: template.hoursPerWeek, planned: null, plans: [template.title] };

  const next = spans
    .filter((p) => p.span.start && p.span.start > week.end)
    .sort((a, b) => a.span.start!.localeCompare(b.span.start!))[0];
  return next ? { kind: "upcoming", plan: next.title, start: next.span.start! } : { kind: "none" };
}

export async function getProfile(user: SessionUser): Promise<Profile> {
  const userId = user.id;
  const mine = eq(s.sessions.userId, userId);
  const done = and(mine, isNotNull(s.sessions.completedAt), academic);

  const [[friends], [totals], [kudos], week, subjects, badges, streak, exams, plannedSubjects, weeklyGoal, mascotHealth] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(f)
        .where(and(isNotNull(f.acceptedAt), or(eq(f.requesterId, userId), eq(f.addresseeId, userId)))),
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
        // Logged study time; the exam itself isn't study.
        .where(and(done, ne(s.sessions.type, "exam"), sql`${s.sessions.completedAt} >= ${weekStart}`))
        .groupBy(sql`1`),
      db
        .select({
          name: sql<string>`${s.sessions.subject}`,
          minutes: sql<number>`coalesce(sum(${s.sessions.actualMinutes}), 0)::int`,
        })
        .from(s.sessions)
        .where(done)
        .groupBy(s.sessions.subject)
        .orderBy(desc(sql`2`))
        .limit(6),
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
          name: sql<string>`${s.sessions.subject}`,
          hoursRemaining: sql<number>`ceil(extract(epoch from (${s.sessions.scheduledAt} - now())) / 3600)::int`,
        })
        .from(s.sessions)
        .where(
          and(
            mine,
            eq(s.sessions.type, "exam"),
            isNotNull(s.sessions.subject),
            sql`${s.sessions.scheduledAt} >= now()`,
          ),
        )
        .orderBy(asc(s.sessions.scheduledAt)),
      // Distinct subject names from any planned (not yet completed) sessions —
      // ensures subjects appear in the profile as soon as a plan is created.
      db
        .selectDistinct({ name: sql<string>`${s.sessions.subject}` })
        .from(s.sessions)
        .where(and(mine, isNull(s.sessions.completedAt), academic)),
      getWeeklyGoal(userId),
      getMascotHealth(userId),
    ]);

  const hours = (minutes: number) => Math.round((minutes / 60) * 4) / 4;
  const subjectSummaries = new Map<string, Profile["subjects"][number]>();

  // Subjects with completed study hours (sorted by hours desc already)
  for (const subject of subjects) {
    const { name } = subject;
    const existing = subjectSummaries.get(name);
    subjectSummaries.set(name, {
      name,
      hours: (existing?.hours ?? 0) + Math.round(subject.minutes / 60),
      minutes: (existing?.minutes ?? 0) + subject.minutes,
      examHoursRemaining: null,
    });
  }

  // Subjects from planned sessions — appear with 0 hours until the first
  // session is completed, so new custom plans show up immediately.
  for (const { name } of plannedSubjects) {
    if (!subjectSummaries.has(name)) {
      subjectSummaries.set(name, { name, hours: 0, minutes: 0, examHoursRemaining: null });
    }
  }

  // Attach exam countdowns (from "exam"-type sessions in the future)
  for (const exam of exams) {
    const { name } = exam;
    const subject = subjectSummaries.get(name) ?? { name, hours: 0, minutes: 0, examHoursRemaining: null };
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
    mascotHealth,
    totals: { hours: Math.round(totals.minutes / 60), sessions: totals.sessions, kudos: kudos.n },
    week: weekdays.map((_, i) => hours(week.find((w) => w.dow === i + 1)?.minutes ?? 0)),
    weeklyGoal,
    subjects: [...subjectSummaries.values()],
    badges,
  };
}

export interface HourlyBucket {
  hour: number;
  sessions: number;
  avgFocus: number | null;
}

export interface StudyBehavior {
  hourly: HourlyBucket[];
  peakHour: number | null;
  totalSessions: number;
}

/** Returns per-hour session counts and average focus scores across all plans. */
export async function getStudyBehavior(userId: string): Promise<StudyBehavior> {
  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${s.sessions.completedAt} at time zone ${tz})::int`,
      sessions: count(),
      avgFocus: sql<number | null>`round(avg(${s.sessions.focus}))::int`,
    })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), isNotNull(s.sessions.completedAt)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const hourly: HourlyBucket[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    sessions: 0,
    avgFocus: null,
  }));
  for (const row of rows) {
    hourly[row.hour] = { hour: row.hour, sessions: row.sessions, avgFocus: row.avgFocus };
  }

  const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
  const peakRow = rows.reduce<(typeof rows)[0] | null>((best, cur) => {
    if (!best || cur.sessions > best.sessions) return cur;
    return best;
  }, null);

  return { hourly, peakHour: peakRow?.hour ?? null, totalSessions };
}

/**
 * Friend search: other users whose name or handle matches `q`. Without a
 * query, everyone the user is connected to — incoming requests, friends, and
 * requests they've sent, in that order.
 */
export async function searchPeople(userId: string, q?: string, limit = q ? 20 : 200): Promise<Person[]> {
  const status = friendStatus(userId, s.users.id);
  const pattern = q && `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const rank = sql`case ${status} when 'received' then 0 when 'friends' then 1 when 'sent' then 2 else 3 end`;

  const rows = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      handle: s.users.handle,
      program: s.users.program,
      hue: s.users.hue,
      status,
    })
    .from(s.users)
    .where(
      and(
        ne(s.users.id, userId),
        pattern ? or(ilike(s.users.name, pattern), ilike(s.users.handle, pattern)) : sql`${status} <> 'none'`,
      ),
    )
    // Connections first, then exact handle matches, then alphabetical.
    .orderBy(asc(rank), desc(sql`${s.users.handle} = ${q?.toLowerCase() ?? ""}`), asc(s.users.name))
    .limit(limit);

  return rows.map((r) => ({ ...r, initials: initials(r.name) }));
}

/**
 * A completed activity the user can see — their own, or a shared one by a
 * friend, i.e. what `getFeed` shows.
 */
function visibleTo(userId: string) {
  return and(
    isNotNull(s.sessions.completedAt),
    or(
      eq(s.sessions.userId, userId),
      and(eq(s.sessions.shared, true), sql`${s.sessions.userId} in ${friendIds(userId)}`),
    ),
  );
}

/** An activity the user can see (see `visibleTo`). Gates kudos and comments. */
export async function getVisibleActivity(userId: string, sessionId: string) {
  const [row] = await db
    .select({ id: s.sessions.id, ownerId: s.sessions.userId })
    .from(s.sessions)
    .where(and(eq(s.sessions.id, sessionId), visibleTo(userId)));
  return row;
}

/** A completed activity the user posted. Gates editing its photos and tags. */
export async function getOwnActivity(userId: string, sessionId: string) {
  const [row] = await db
    .select({ id: s.sessions.id, ownerId: s.sessions.userId })
    .from(s.sessions)
    .where(
      and(eq(s.sessions.id, sessionId), eq(s.sessions.userId, userId), isNotNull(s.sessions.completedAt)),
    );
  return row;
}

/** A photo, if it's on an activity the user can see. */
export async function getVisiblePhoto(userId: string, photoId: string) {
  const [row] = await db
    .select({ contentType: s.sessionPhotos.contentType, data: s.sessionPhotos.data })
    .from(s.sessionPhotos)
    .innerJoin(s.sessions, eq(s.sessions.id, s.sessionPhotos.sessionId))
    .where(and(eq(s.sessionPhotos.id, photoId), visibleTo(userId)));
  return row;
}

/** Comments on an activity, oldest first. `ownerId` is the activity's author. */
export async function listComments(userId: string, sessionId: string, ownerId: string): Promise<Comment[]> {
  const rows = await db
    .select({
      id: s.comments.id,
      body: s.comments.body,
      createdAt: s.comments.createdAt,
      user: { id: s.users.id, name: s.users.name, hue: s.users.hue },
    })
    .from(s.comments)
    .innerJoin(s.users, eq(s.users.id, s.comments.userId))
    .where(eq(s.comments.sessionId, sessionId))
    .orderBy(asc(s.comments.createdAt));

  return rows.map((r) => toComment(r, userId, ownerId));
}

export function toComment(
  r: { id: string; body: string; createdAt: Date; user: { id: string; name: string; hue: number } },
  userId: string,
  ownerId: string,
): Comment {
  const mine = r.user.id === userId;
  return {
    id: r.id,
    body: r.body,
    postedAgo: timeAgo(r.createdAt),
    // Only the public summary — `r.user` may be a full SessionUser.
    user: { id: r.user.id, name: r.user.name, hue: r.user.hue, initials: initials(r.user.name) },
    mine,
    canDelete: mine || ownerId === userId,
  };
}
