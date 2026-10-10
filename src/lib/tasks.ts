import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema as s, TIME_ZONE } from "@/db";
import { ConflictError } from "./http";
import { findOverlaps, overlaps, type Interval } from "./intervals";
import { dayRule, mealRule, mockOrderRule, mockPartnerTitle, type DayBlock } from "./move-rules";
import type { EventType, TaskRecord } from "./types";

/** Data layer for /api/tasks, backed by the sessions table. */

type Row = typeof s.sessions.$inferSelect;

export type NewTask = Pick<Row, "userId" | "type" | "subject" | "title" | "scheduledAt" | "plannedMinutes"> &
  Partial<Pick<Row, "planId" | "userPlanId" | "activity" | "cheatsheetTarget" | "cheatsheetMinutes" | "prepPhase" | "detail" | "location" | "note" | "shared" | "movedManually" | "completedAt" | "actualMinutes" | "focus">>;

export type TaskPatch = Partial<Omit<NewTask, "userId" | "completedAt">> & {
    /** true stamps completion (actual minutes default to planned); false clears it. */
    done?: boolean;
    /** true marks a planned session skipped; false un-skips it. */
    skipped?: boolean;
  };

export type TaskFilter = {
  userId?: string;
  type?: EventType;
  done?: boolean;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

function toTask(row: Row): TaskRecord {
  return {
    ...row,
    done: row.completedAt !== null,
    scheduledAt: row.scheduledAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    skipped: row.skippedAt !== null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTasks(f: TaskFilter): Promise<TaskRecord[]> {
  const where: SQL[] = [];
  if (f.userId) where.push(eq(s.sessions.userId, f.userId));
  if (f.type) where.push(eq(s.sessions.type, f.type));
  if (f.done !== undefined) {
    where.push(f.done ? isNotNull(s.sessions.completedAt) : isNull(s.sessions.completedAt));
  }
  if (f.from) where.push(gte(s.sessions.scheduledAt, f.from));
  if (f.to) where.push(lt(s.sessions.scheduledAt, f.to));

  const rows = await db
    .select()
    .from(s.sessions)
    .where(and(...where))
    .orderBy(asc(s.sessions.scheduledAt), asc(s.sessions.id))
    .limit(f.limit)
    .offset(f.offset);
  return rows.map(toTask);
}

export async function getTask(id: string): Promise<TaskRecord | undefined> {
  const [row] = await db.select().from(s.sessions).where(eq(s.sessions.id, id));
  return row && toTask(row);
}

/**
 * Adds one block. With `check`, it must fit the calendar the way a moved block
 * does (no overlap, no running past midnight, a study day of its plan).
 */
export async function createTask(data: NewTask, { check = false } = {}): Promise<TaskRecord> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.sessions).values(data).returning();
    // Throwing rolls the insert back.
    if (check) await assertSchedulable(tx, row.userId, [{ id: row.id, start: row.scheduledAt, minutes: row.plannedMinutes }]);
    return toTask(row);
  });
}

export async function createTasksBulk(items: NewTask[]): Promise<number> {
  if (items.length === 0) return 0;
  // Postgres caps a statement at 65k parameters, and a plan with breaks can have thousands of rows.
  let count = 0;
  for (let i = 0; i < items.length; i += 1000) {
    const rows = await db.insert(s.sessions).values(items.slice(i, i + 1000)).returning({ id: s.sessions.id });
    count += rows.length;
  }
  return count;
}

export async function updateTask(
  id: string,
  { done, skipped, ...patch }: TaskPatch,
): Promise<TaskRecord | undefined> {
  const skip =
    skipped === true ? { skippedAt: sql`coalesce(${s.sessions.skippedAt}, now())` }
      : skipped === false ? { skippedAt: null }
        : {};
  const completion =
    done === true
      ? {
          // Doing a skipped session after all un-skips it.
          skippedAt: null,
          completedAt: sql`coalesce(${s.sessions.completedAt}, now())`,
          actualMinutes: patch.actualMinutes ?? sql`coalesce(${s.sessions.actualMinutes}, ${s.sessions.plannedMinutes})`,
        }
      : done === false
        ? { completedAt: null, actualMinutes: null, focus: null, trace: null }
        : {};

  const [row] = await db
    .update(s.sessions)
    .set({ ...patch, ...skip, ...completion })
    .where(eq(s.sessions.id, id))
    .returning();
  return row && toTask(row);
}

export async function deleteTask(id: string): Promise<boolean> {
  const rows = await db
    .delete(s.sessions)
    .where(eq(s.sessions.id, id))
    .returning({ id: s.sessions.id });
  return rows.length > 0;
}

// --- Moving blocks -------------------------------------------------------------

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ScheduleChange = { id: string; scheduledAt: Date; plannedMinutes?: number; calendarOrder?: number | null };

const localParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** The user's local calendar day: "YYYY-MM-DD", "Mon"…"Sun", and the minute of that day. */
export function localDay(at: Date) {
  const p = Object.fromEntries(localParts.formatToParts(at).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Throws ConflictError when the changed blocks would overlap each other or
 * any other entry on the user's calendar, run past midnight, or land on a day
 * their plan has no study time (unselected weekday or vacation).
 */
async function assertSchedulable(
  tx: Executor,
  userId: string,
  changes: { id: string; start: Date; minutes: number }[],
) {
  const ids = changes.map((c) => c.id);
  const rows = await tx
    .select({
      id: s.sessions.id,
      type: s.sessions.type,
      activity: s.sessions.activity,
      subject: s.sessions.subject,
      title: s.sessions.title,
      userPlanId: s.sessions.userPlanId,
      scheduledAt: s.sessions.scheduledAt,
    })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), inArray(s.sessions.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const proposed = changes.map((c) => ({ start: c.start.getTime(), end: c.start.getTime() + c.minutes * 60_000 }));
  const span = (i: Interval) => `${localTime.format(i.start)}–${localTime.format(i.end)}`;

  const [clash] = findOverlaps(proposed);
  if (clash) {
    const [a, b] = clash.map((i) => byId.get(changes[i].id)?.title);
    throw new ConflictError(`“${a}” and “${b}” would overlap.`);
  }

  const from = Math.min(...proposed.map((p) => p.start));
  const to = Math.max(...proposed.map((p) => p.end));
  const others = await tx
    .select({ title: s.sessions.title, start: s.sessions.scheduledAt, minutes: s.sessions.plannedMinutes })
    .from(s.sessions)
    .where(and(
      eq(s.sessions.userId, userId),
      notInArray(s.sessions.id, ids),
      sql`${s.sessions.type} <> 'vacation'`,
      // A skipped session frees its slot.
      isNull(s.sessions.skippedAt),
      lt(s.sessions.scheduledAt, new Date(to)),
      sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > ${new Date(from).toISOString()}`,
    ));
  for (const [i, p] of proposed.entries()) {
    for (const o of others) {
      const other = { start: o.start.getTime(), end: o.start.getTime() + o.minutes * 60_000 };
      if (overlaps(p, other)) {
        throw new ConflictError(`“${byId.get(changes[i].id)?.title}” would overlap “${o.title}” (${span(other)}).`);
      }
    }
  }

  const planIds = [...new Set(rows.map((r) => r.userPlanId).filter((x): x is string => x !== null))];
  const plans = planIds.length
    ? await tx.select({ id: s.userPlans.id, config: s.userPlans.config }).from(s.userPlans).where(inArray(s.userPlans.id, planIds))
    : [];
  const configOf = new Map(plans.map((p) => [p.id, p.config]));

  for (const [i, change] of changes.entries()) {
    const row = byId.get(change.id);
    const day = localDay(change.start);
    if (localDay(new Date(proposed[i].end - 1)).key !== day.key) {
      throw new ConflictError(`“${row?.title}” can't run past midnight.`);
    }
    // Exams and lectures are fixed events; only planned study time follows the availability.
    const config = row?.userPlanId ? configOf.get(row.userPlanId) : null;
    if (!config || row?.type === "exam" || row?.type === "lecture") continue;
    if (!config.studyDays.includes(day.weekday)) {
      throw new ConflictError(`${day.weekday} isn't one of your study days.`);
    }
    if (config.vacationRanges.some((r) => r.start <= day.key && day.key <= r.end)) {
      throw new ConflictError(`${day.key} is during one of your vacations.`);
    }
  }

  // The rules the scheduler plans with hold for moves too.
  const changeById = new Map(changes.map((c) => [c.id, c]));
  const asBlock = (r: (typeof rows)[number], start: Date, minutes: number): DayBlock & { at: number } => ({
    id: r.id, type: r.type, activity: r.activity, subject: r.subject, title: r.title,
    start: localDay(start).minute, minutes, at: start.getTime(),
  });
  /** Plan days that gain a block from another day: their capacity and subjects are checked. */
  const gaining = new Map<string, { planId: string; dayKey: string }>();

  for (const change of changes) {
    const row = byId.get(change.id);
    if (!row) continue;
    const block = asBlock(row, change.start, change.minutes);
    const meal = mealRule(block);
    if (meal) throw new ConflictError(meal);

    // A mock exam stays before its review.
    const partnerTitle = mockPartnerTitle(row);
    if (partnerTitle && row.userPlanId) {
      const [partner] = await tx
        .select({
          id: s.sessions.id, type: s.sessions.type, activity: s.sessions.activity, subject: s.sessions.subject,
          title: s.sessions.title, userPlanId: s.sessions.userPlanId, scheduledAt: s.sessions.scheduledAt,
          minutes: s.sessions.plannedMinutes,
        })
        .from(s.sessions)
        .where(and(eq(s.sessions.userPlanId, row.userPlanId), eq(s.sessions.title, partnerTitle)));
      if (partner) {
        const moved = changeById.get(partner.id);
        const order = mockOrderRule(block, asBlock(partner, moved?.start ?? partner.scheduledAt, moved?.minutes ?? partner.minutes));
        if (order) throw new ConflictError(order);
      }
    }

    const dayKey = localDay(change.start).key;
    if (row.userPlanId && dayKey !== localDay(row.scheduledAt).key) {
      gaining.set(`${row.userPlanId}|${dayKey}`, { planId: row.userPlanId, dayKey });
    }
  }

  for (const { planId, dayKey } of gaining.values()) {
    const config = configOf.get(planId);
    if (!config) continue;
    const dayRows = await tx
      .select({
        id: s.sessions.id, type: s.sessions.type, activity: s.sessions.activity, subject: s.sessions.subject,
        title: s.sessions.title, userPlanId: s.sessions.userPlanId, scheduledAt: s.sessions.scheduledAt,
        minutes: s.sessions.plannedMinutes,
      })
      .from(s.sessions)
      .where(and(
        eq(s.sessions.userPlanId, planId),
        sql`(${s.sessions.scheduledAt} at time zone ${TIME_ZONE})::date = ${dayKey}::date`,
      ));
    // The day as it would be: blocks moved away leave, blocks moved here arrive.
    const blocks = [
      ...dayRows.filter((r) => !changeById.has(r.id)).map((r) => asBlock(r, r.scheduledAt, r.minutes)),
      ...changes
        .filter((c) => byId.get(c.id)?.userPlanId === planId && localDay(c.start).key === dayKey)
        .map((c) => asBlock(byId.get(c.id)!, c.start, c.minutes)),
    ];
    const problem = dayRule(blocks, config, config.focusDates?.[dayKey], config.eveDates?.[dayKey]);
    if (problem) throw new ConflictError(problem);
  }
}

/** Validates a single block's new time or length before `updateTask` saves it. */
export async function assertTaskSchedulable(id: string, patch: { scheduledAt?: Date; plannedMinutes?: number }) {
  if (!patch.scheduledAt && !patch.plannedMinutes) return;
  const [row] = await db
    .select({ userId: s.sessions.userId, start: s.sessions.scheduledAt, minutes: s.sessions.plannedMinutes })
    .from(s.sessions)
    .where(eq(s.sessions.id, id));
  if (!row) return;
  await assertSchedulable(db, row.userId, [
    { id, start: patch.scheduledAt ?? row.start, minutes: patch.plannedMinutes ?? row.minutes },
  ]);
}

/**
 * Moves several of the user's blocks at once (e.g. reordering a day), so the
 * result is checked as a whole instead of failing on intermediate states.
 * Returns how many blocks moved; 0 when some don't belong to the user.
 */
export async function rescheduleTasks(userId: string, changes: ScheduleChange[]): Promise<number> {
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: s.sessions.id, minutes: s.sessions.plannedMinutes })
      .from(s.sessions)
      .where(and(eq(s.sessions.userId, userId), inArray(s.sessions.id, changes.map((c) => c.id))));
    if (current.length !== changes.length) return 0;
    const minutes = new Map(current.map((r) => [r.id, r.minutes]));

    await assertSchedulable(tx, userId, changes.map((c) => ({
      id: c.id, start: c.scheduledAt, minutes: c.plannedMinutes ?? minutes.get(c.id)!,
    })));
    for (const c of changes) {
      await tx
        .update(s.sessions)
        .set({
          scheduledAt: c.scheduledAt,
          // Placed by hand: regenerating keeps it where feasible.
          movedManually: true,
          ...(c.plannedMinutes !== undefined ? { plannedMinutes: c.plannedMinutes } : {}),
          ...(c.calendarOrder !== undefined ? { calendarOrder: c.calendarOrder } : {}),
        })
        .where(eq(s.sessions.id, c.id));
    }
    return changes.length;
  });
}

/**
 * The user's calendar entries between `from` and `to`, as epoch-ms intervals
 * for the scheduler — leaving out the blocks a plan regeneration will replace.
 */
export async function listBusyIntervals(
  userId: string,
  from: Date,
  to: Date,
  { replacingPlan, keep = [] }: { replacingPlan?: string; keep?: string[] } = {},
): Promise<Interval[]> {
  const rows = await db
    .select({ start: s.sessions.scheduledAt, minutes: s.sessions.plannedMinutes })
    .from(s.sessions)
    .where(and(
      eq(s.sessions.userId, userId),
      sql`${s.sessions.type} <> 'vacation'`,
      isNull(s.sessions.skippedAt),
      lt(s.sessions.scheduledAt, to),
      sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > ${from.toISOString()}`,
      // Blocks a regeneration replaces don't count — unless they're kept.
      replacingPlan
        ? or(
            isNull(s.sessions.userPlanId),
            ne(s.sessions.userPlanId, replacingPlan),
            isNotNull(s.sessions.completedAt),
            eq(s.sessions.type, "lecture"),
            keep.length ? inArray(s.sessions.id, keep) : undefined,
          )
        : undefined,
    ));
  return rows.map((r) => ({ start: r.start.getTime(), end: r.start.getTime() + r.minutes * 60_000 }));
}

/**
 * Logs study done during a buffer block: the used part becomes a completed
 * study block for `subject`, and the buffer shrinks by the same amount (or
 * disappears) — so the time counts once, for the subject, never as buffer.
 */
export async function logBufferStudy(userId: string, bufferId: string, subject: string, minutes: number) {
  return db.transaction(async (tx) => {
    const [buffer] = await tx
      .select()
      .from(s.sessions)
      .where(and(eq(s.sessions.id, bufferId), eq(s.sessions.userId, userId), eq(s.sessions.type, "buffer")));
    if (!buffer) return null;
    const used = Math.min(Math.max(1, Math.round(minutes)), buffer.plannedMinutes);

    const [study] = await tx
      .insert(s.sessions)
      .values({
        userId,
        userPlanId: buffer.userPlanId,
        type: "deep",
        activity: "study",
        subject,
        title: `${subject} — Catch-up study`,
        detail: "Study done during buffer / catch-up time.",
        scheduledAt: buffer.scheduledAt,
        plannedMinutes: used,
        actualMinutes: used,
        completedAt: new Date(),
        shared: false,
      })
      .returning();

    let rest: Row | null = null;
    if (used < buffer.plannedMinutes) {
      [rest] = await tx
        .update(s.sessions)
        .set({
          scheduledAt: new Date(buffer.scheduledAt.getTime() + used * 60_000),
          plannedMinutes: buffer.plannedMinutes - used,
        })
        .where(eq(s.sessions.id, bufferId))
        .returning();
    } else {
      await tx.delete(s.sessions).where(eq(s.sessions.id, bufferId));
    }
    return { study: toTask(study), buffer: rest && toTask(rest) };
  });
}
