import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, notFound, parseQuery } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTask, listTasks } from "@/lib/tasks";
import { listTasksQuery, manualTaskSchema } from "./schemas";

// GET /api/tasks?userId=&type=&done=&from=&to=&limit=&offset= — oldest first.
export async function GET(request: Request) {
  return handle(async () => {
    const tasks = await listTasks(parseQuery(request, listTasksQuery));
    return Response.json({ tasks });
  });
}

// POST /api/tasks — body: { type, subject, title, scheduledAt, plannedMinutes, userPlanId?, done?, userId?, … }
// A planned session (no `done`) must still be ahead and fit the calendar (409);
// `done: true` logs one you already did, finished `plannedMinutes` after it started.
export async function POST(request: Request) {
  return handle(async () => {
    const { userId, userPlanId, done, ...data } = manualTaskSchema.parse(await request.json());
    const owner = userId ?? (await getCurrentUser()).id;
    if (userPlanId) {
      const [plan] = await db
        .select({ id: s.userPlans.id })
        .from(s.userPlans)
        .where(and(eq(s.userPlans.id, userPlanId), eq(s.userPlans.userId, owner)));
      if (!plan) return notFound("Plan");
    }
    const end = new Date(data.scheduledAt.getTime() + data.plannedMinutes * 60_000);
    const task = done
      ? await createTask({
          ...data,
          userId: owner,
          userPlanId,
          completedAt: end.getTime() < Date.now() ? end : new Date(),
          actualMinutes: data.plannedMinutes,
        })
      : // Placed by hand: regenerating the plan keeps it where feasible.
        await createTask({ ...data, userId: owner, userPlanId, movedManually: true }, { check: true });
    return Response.json({ task }, { status: 201 });
  });
}
