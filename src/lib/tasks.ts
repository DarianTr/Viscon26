import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { EventType, TaskRecord } from "./types";

/** Data layer for /api/tasks, backed by the sessions table. */

type Row = typeof s.sessions.$inferSelect;

export type NewTask = Pick<Row, "userId" | "type" | "subject" | "title" | "scheduledAt" | "plannedMinutes"> &
  Partial<Pick<Row, "planId" | "detail" | "location" | "note" | "shared">>;

export type TaskPatch = Partial<Omit<NewTask, "userId">> &
  Partial<Pick<Row, "actualMinutes" | "focus">> & {
    /** true stamps completion (actual minutes default to planned); false clears it. */
    done?: boolean;
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

export async function createTask(data: NewTask): Promise<TaskRecord> {
  const studyTypes = ["deep", "intervals", "tempo", "recovery"] as const;
  const eventEnd = new Date(data.scheduledAt.getTime() + data.plannedMinutes * 60_000);
  const [vacation] = await db.select({ id: s.sessions.id }).from(s.sessions).where(and(
    eq(s.sessions.userId, data.userId),
    eq(s.sessions.type, "vacation"),
    sql`${s.sessions.scheduledAt} < ${eventEnd}`,
    sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > ${data.scheduledAt}`,
  )).limit(1);

  if (data.type !== "vacation" && studyTypes.includes(data.type as typeof studyTypes[number]) && vacation) {
    throw new ScheduleConflictError("This date is marked as vacation. Remove the vacation event to schedule study time.");
  }

  const [row] = await db.transaction(async (tx) => {
    if (data.type === "vacation") {
      await tx.delete(s.sessions).where(and(
        eq(s.sessions.userId, data.userId),
        inArray(s.sessions.type, [...studyTypes]),
        isNull(s.sessions.completedAt),
        sql`${s.sessions.scheduledAt} < ${eventEnd}`,
        sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > ${data.scheduledAt}`,
      ));
    }
    return tx.insert(s.sessions).values(data).returning();
  });
  return toTask(row);
}

export class ScheduleConflictError extends Error {}

export async function updateTask(
  id: string,
  { done, ...patch }: TaskPatch,
): Promise<TaskRecord | undefined> {
  const current = await getTask(id);
  const nextType = patch.type ?? current?.type;
  const nextDate = patch.scheduledAt ?? (current ? new Date(current.scheduledAt) : undefined);
  const nextMinutes = patch.plannedMinutes ?? current?.plannedMinutes;
  if (current && nextDate && nextType && ["deep", "intervals", "tempo", "recovery"].includes(nextType)) {
    const nextEnd = new Date(nextDate.getTime() + (nextMinutes ?? 0) * 60_000);
    const [vacation] = await db.select({ id: s.sessions.id }).from(s.sessions).where(and(
      eq(s.sessions.userId, current.userId),
      eq(s.sessions.type, "vacation"),
      sql`${s.sessions.scheduledAt} < ${nextEnd}`,
      sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > ${nextDate}`,
    )).limit(1);
    if (vacation) throw new ScheduleConflictError("This date is marked as vacation. Remove the vacation event to schedule study time.");
  }

  const completion =
    done === true
      ? {
          completedAt: sql`coalesce(${s.sessions.completedAt}, now())`,
          actualMinutes: patch.actualMinutes ?? sql`coalesce(${s.sessions.actualMinutes}, ${s.sessions.plannedMinutes})`,
        }
      : done === false
        ? { completedAt: null, actualMinutes: null, focus: null, trace: null }
        : {};

  const [row] = await db
    .update(s.sessions)
    .set({ ...patch, ...completion })
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
