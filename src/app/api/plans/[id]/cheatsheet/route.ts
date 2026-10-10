import { z } from "zod";
import { and, eq, gt, isNull, lte, max, sum } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { regeneratePlan } from "@/lib/plans";
import { getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";

type Ctx = RouteContext<"/api/plans/[id]/cheatsheet">;

const bodySchema = z.object({
  subject: z.string().trim().min(1).max(100),
  percent: z.number().int().min(0).max(100),
});

// POST /api/plans/:id/cheatsheet — report how far a subject's cheatsheet
// actually is. The latest report is the actual progress. When it is behind
// what the plan expected by now, the remaining schedule is rebuilt right away
// so the cheatsheet gets the time it still needs (completed sessions, logged
// results and blocks moved by hand stay — see regeneratePlan).
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

    const now = new Date();
    const ofSubject = and(eq(s.sessions.userPlanId, id), eq(s.sessions.subject, subject));
    const [{ planned }] = await db
      .select({ planned: max(s.sessions.cheatsheetTarget) })
      .from(s.sessions)
      .where(and(ofSubject, lte(s.sessions.scheduledAt, now)));
    const behind = percent < (planned ?? 0);
    if (!behind) return Response.json({ subject, percent, planned: planned ?? 0, caughtUp: false }, { status: 201 });

    // Behind: catch up automatically.
    const upcomingSheetMinutes = async () => {
      const [{ minutes }] = await db
        .select({ minutes: sum(s.sessions.cheatsheetMinutes).mapWith(Number) })
        .from(s.sessions)
        .where(and(ofSubject, isNull(s.sessions.completedAt), gt(s.sessions.scheduledAt, now)));
      return minutes ?? 0;
    };
    const before = await upcomingSheetMinutes();
    await regeneratePlan(user.id, id, {}, { apply: true, now });
    const after = await upcomingSheetMinutes();
    return Response.json(
      { subject, percent, planned, caughtUp: true, addedMinutes: Math.max(0, after - before) },
      { status: 201 },
    );
  });
}
