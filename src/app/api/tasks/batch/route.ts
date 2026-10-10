import { z } from "zod";
import { handle } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTasksBulk } from "@/lib/tasks";
import { createTaskSchema } from "../schemas";
import { db, schema as s } from "@/db";

const planConfigSchema = z.object({
  weeklyHours: z.number().positive(),
  studyDays: z.array(z.string()),
  sessionLength: z.number().positive(),
  vacationRanges: z.array(z.object({ start: z.string(), end: z.string() })),
}).optional();

const batchSchema = z.object({
  planTitle: z.string().trim().min(1).max(200).optional(),
  planConfig: planConfigSchema,
  tasks: z.array(createTaskSchema).min(1).max(1000),
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
