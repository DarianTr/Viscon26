import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";

type Ctx = RouteContext<"/api/plans/[id]">;

// GET /api/plans/:id — per-subject session breakdown + plan config
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const [plan] = await db
      .select({ id: s.userPlans.id, config: s.userPlans.config })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, id), eq(s.userPlans.userId, user.id)));

    if (!plan) return notFound("Plan");

    const subjects = await db
      .select({
        subject: s.sessions.subject,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(${s.sessions.completedAt})::int`,
        examDate: sql<string | null>`min(case when ${s.sessions.type} = 'exam' then ${s.sessions.scheduledAt}::text end)`,
      })
      .from(s.sessions)
      .where(and(eq(s.sessions.userPlanId, id), notInArray(s.sessions.type, ["lecture", "buffer"])))
      .groupBy(s.sessions.subject)
      .orderBy(asc(s.sessions.subject));

    const scores = await db
      .select({
        id: s.examScores.id,
        subject: s.examScores.subject,
        score: s.examScores.score,
        examType: s.examScores.examType,
        takenAt: s.examScores.takenAt,
        notes: s.examScores.notes,
      })
      .from(s.examScores)
      .where(and(eq(s.examScores.userId, user.id), eq(s.examScores.userPlanId, id)))
      .orderBy(asc(s.examScores.takenAt));

    return Response.json({ subjects, scores, config: plan.config ?? null });
  });
}
