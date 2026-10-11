import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { syncChallengeCompletion } from "@/lib/challenges";
import { ConflictError, handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { assertTaskSchedulable, deleteTask, getTask, updateTask } from "@/lib/tasks";
import type { TaskRecord } from "@/lib/types";
import { manualOnlyFields, updateTaskSchema } from "../schemas";

type Ctx = RouteContext<"/api/tasks/[id]">;

// GET /api/tasks/:id — your own task.
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const task = isId(id) ? await getTask(id) : undefined;
    return task && task.userId === user.id ? Response.json({ task }) : notFound("Task");
  });
}

// PATCH /api/tasks/:id — any task field, plus { done, skipped, actualMinutes, focus, userPlanId }, on your own task.
// What the session is (type, subject, length, plan, …) only changes on sessions added by hand (409);
// plan-generated ones can still be moved, skipped, finished, renamed and captioned.
// `done: true` marks it complete (actualMinutes defaults to plannedMinutes);
// `done: false` clears the completion. `skipped: true` skips a planned session
// (not a finished one or an exam), freeing its slot; `false` un-skips. A new time or length must not overlap
// other calendar blocks or fall outside the plan's study days (409).
// Finishing an accepted challenge's session completes the challenge.
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Task");
    // Only your own tasks; a new time must still fit the calendar and the plan.
    const user = await getCurrentUser();
    const existing = await getTask(id);
    if (!existing || existing.userId !== user.id) return notFound("Task");
    const patch = updateTaskSchema.parse(await request.json());
    if (!existing.addedManually && manualOnlyFields.some((field) => patch[field] !== undefined)) {
      throw new ConflictError("Only sessions you added yourself can be edited.");
    }
    if (patch.userPlanId) {
      const [plan] = await db
        .select({ id: s.userPlans.id })
        .from(s.userPlans)
        .where(and(eq(s.userPlans.id, patch.userPlanId), eq(s.userPlans.userId, user.id)));
      if (!plan) return notFound("Plan");
    }
    if (patch.skipped) {
      if (existing.done || patch.done) throw new ConflictError("A finished session can't be skipped.");
      if (existing.type === "exam") throw new ConflictError("Exams can't be skipped.");
    }
    // Un-skipping takes the slot back, which another block may have taken since.
    const unskip = patch.skipped === false && existing.skipped;
    // A finished session is history, not a slot on the calendar: logging one never checked for overlaps either.
    const finished = patch.done ?? existing.done;
    if (!finished) await assertTaskSchedulable(id, unskip ? { ...patch, scheduledAt: patch.scheduledAt ?? new Date(existing.scheduledAt) } : patch);
    const task = await updateTask(id, {
      ...patch,
      ...(patch.scheduledAt ? { movedManually: true } : {}),
      ...(existing.addedManually && existing.done && patch.done === undefined ? loggedTimes(existing, patch) : {}),
    });
    if (task && patch.done !== undefined) await syncChallengeCompletion(user, id, patch.done);
    return task ? Response.json({ task }) : notFound("Task");
  });
}

// DELETE /api/tasks/:id — your own task, if you added it by hand (409 for plan-generated ones).
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Task");
    const user = await getCurrentUser();
    const existing = await getTask(id);
    if (!existing || existing.userId !== user.id) return notFound("Task");
    if (!existing.addedManually) throw new ConflictError("Only sessions you added yourself can be deleted.");
    const deleted = await deleteTask(id);
    return deleted ? new Response(null, { status: 204 }) : notFound("Task");
  });
}

/** A session logged by hand finished when its new time says it did, and lasted as long. */
function loggedTimes(existing: TaskRecord, patch: { scheduledAt?: Date; plannedMinutes?: number }) {
  if (!patch.scheduledAt && !patch.plannedMinutes) return {};
  const start = patch.scheduledAt ?? new Date(existing.scheduledAt);
  const minutes = patch.plannedMinutes ?? existing.plannedMinutes;
  const end = new Date(start.getTime() + minutes * 60_000);
  return { completedAt: end.getTime() < Date.now() ? end : new Date(), actualMinutes: minutes };
}
