import "server-only";
import { and, asc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { EventType, TaskRecord } from "./types";

/** Data layer for /api/tasks, backed by the sessions table. */

type Row = typeof s.sessions.$inferSelect;

export type NewTask = Pick<Row, "userId" | "type" | "subject" | "title" | "scheduledAt" | "plannedMinutes"> &
  Partial<Pick<Row, "planId" | "userPlanId" | "detail" | "location" | "note" | "shared">>;

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
  const [row] = await db.insert(s.sessions).values(data).returning();
  return toTask(row);
}

export async function createTasksBulk(items: NewTask[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await db.insert(s.sessions).values(items).returning({ id: s.sessions.id });
  return rows.length;
}

export async function updateTask(
  id: string,
  { done, ...patch }: TaskPatch,
): Promise<TaskRecord | undefined> {
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
