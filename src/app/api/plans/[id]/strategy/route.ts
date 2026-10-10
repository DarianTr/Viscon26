import { and, asc, eq, ne, sql } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";
import { runStrategyAgent } from "@/lib/strategy-agent";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/plans/:id/strategy
// Runs the AI strategy agent over the plan's exam scores and returns
// per-subject recommendations. Returns empty recommendations if no scores
// have been logged yet (avoids a pointless LLM call).
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const [plan] = await db
      .select({ id: s.userPlans.id })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, id), eq(s.userPlans.userId, user.id)));
    if (!plan) return notFound("Plan");

    const [subjects, scores] = await Promise.all([
      db
        .select({
          subject: s.sessions.subject,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(${s.sessions.completedAt})::int`,
          examDate: sql<string | null>`min(case when ${s.sessions.type} = 'exam' then ${s.sessions.scheduledAt}::text end)`,
        })
        .from(s.sessions)
        .where(and(eq(s.sessions.userPlanId, id), ne(s.sessions.type, "lecture")))
        .groupBy(s.sessions.subject)
        .orderBy(asc(s.sessions.subject)),

      db
        .select({
          subject: s.examScores.subject,
          score: s.examScores.score,
          examType: s.examScores.examType,
          takenAt: s.examScores.takenAt,
          notes: s.examScores.notes,
        })
        .from(s.examScores)
        .where(and(eq(s.examScores.userId, user.id), eq(s.examScores.userPlanId, id)))
        .orderBy(asc(s.examScores.takenAt)),
    ]);

    if (scores.length === 0) {
      return Response.json({ recommendations: [], overallInsight: null });
    }

    const result = await runStrategyAgent(scores, subjects);
    return Response.json(result);
  });
}
