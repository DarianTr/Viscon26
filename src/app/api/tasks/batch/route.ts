import { z } from "zod";
import { handle, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTasksBulk, rescheduleTasks } from "@/lib/tasks";
import { planConfigSchema } from "../../plans/schemas";
import { newTaskSchema } from "../schemas";
import { db, schema as s } from "@/db";

const batchSchema = z.object({
  planTitle: z.string().trim().min(1).max(200).optional(),
  planConfig: planConfigSchema.optional(),
  // A long plan with breaks and buffers runs to a few thousand blocks.
  tasks: z.array(newTaskSchema).min(1).max(5000),
});

// POST /api/tasks/batch — create many sessions in one request
export async function POST(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { planTitle, planConfig, tasks } = batchSchema.parse(await request.json());

    let userPlanId: string | undefined;
    if (planTitle) {
      const [plan] = await db
        .insert(s.userPlans)
        .values({ userId: user.id, title: planTitle, config: planConfig })
        .returning({ id: s.userPlans.id });
      userPlanId = plan.id;
    }

    const items = tasks.map(({ userId, ...data }) => ({
      ...data,
      userId: userId ?? user.id,
      ...(userPlanId ? { userPlanId } : {}),
    }));

    const count = await createTasksBulk(items);
    return Response.json({ count, userPlanId }, { status: 201 });
  });
}

const rescheduleSchema = z.object({
  changes: z.array(z.object({
    id: z.uuid(),
    scheduledAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    plannedMinutes: z.number().int().min(1).max(24 * 60).optional(),
    calendarOrder: z.number().int().min(0).nullable().optional(),
  })).min(1).max(200),
});

// PATCH /api/tasks/batch — move several of your blocks at once (e.g. reorder a
// day). All or nothing: 409 if the result would overlap or hit an unavailable day.
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { changes } = rescheduleSchema.parse(await request.json());
    const count = await rescheduleTasks(user.id, changes);
    return count ? Response.json({ count }) : notFound("Task");
  });
}
