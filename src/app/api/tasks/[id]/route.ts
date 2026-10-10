import { syncChallengeCompletion } from "@/lib/challenges";
import { ConflictError, handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { assertTaskSchedulable, deleteTask, getTask, updateTask } from "@/lib/tasks";
import { updateTaskSchema } from "../schemas";

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

// PATCH /api/tasks/:id — any task field, plus { done, skipped, actualMinutes, focus }, on your own task.
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
    if (patch.skipped) {
      if (existing.done || patch.done) throw new ConflictError("A finished session can't be skipped.");
      if (existing.type === "exam") throw new ConflictError("Exams can't be skipped.");
    }
    // Un-skipping takes the slot back, which another block may have taken since.
    const unskip = patch.skipped === false && existing.skipped;
    await assertTaskSchedulable(id, unskip ? { ...patch, scheduledAt: patch.scheduledAt ?? new Date(existing.scheduledAt) } : patch);
    const task = await updateTask(id, patch.scheduledAt ? { ...patch, movedManually: true } : patch);
    if (task && patch.done !== undefined) await syncChallengeCompletion(user, id, patch.done);
    return task ? Response.json({ task }) : notFound("Task");
  });
}

// DELETE /api/tasks/:id — your own task.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Task");
    const user = await getCurrentUser();
    const existing = await getTask(id);
    if (!existing || existing.userId !== user.id) return notFound("Task");
    const deleted = await deleteTask(id);
    return deleted ? new Response(null, { status: 204 }) : notFound("Task");
  });
}
