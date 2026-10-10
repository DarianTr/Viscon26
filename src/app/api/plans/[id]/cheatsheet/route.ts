import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";

type Ctx = RouteContext<"/api/plans/[id]/cheatsheet">;

const bodySchema = z.object({
  subject: z.string().trim().min(1).max(100),
  percent: z.number().int().min(0).max(100),
});

// POST /api/plans/:id/cheatsheet — report how far a subject's cheatsheet
// actually is. The latest report is the actual progress; regenerating the
// plan gives the rest the time it needs.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");
    const [plan] = await db
      .select({ config: s.userPlans.config })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, id), eq(s.userPlans.userId, user.id)));
    if (!plan) return notFound("Plan");

    const { subject, percent } = bodySchema.parse(await request.json());
    if (!plan.config?.subjects?.some((sub) => sub.name === subject)) return notFound("Subject");
    await db.insert(s.cheatsheetReports).values({ userId: user.id, userPlanId: id, subject, percent });
    return Response.json({ subject, percent }, { status: 201 });
  });
}
