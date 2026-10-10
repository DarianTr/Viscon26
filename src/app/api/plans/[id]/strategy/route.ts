import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { academic, getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";
import { toGrade } from "@/lib/grades";
import { getOwnedPlan, getTimeline, KnowledgeError, listObservations, syncTopics } from "@/lib/knowledge";
import { subjectOfDataPoint, subjectPredictions, type SubjectPrediction } from "@/lib/predictions";
import { runStrategyAgent, type DataPointEntry, type HourlyActivity } from "@/lib/strategy-agent";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/plans/:id/strategy
// Runs the AI strategy agent over the plan's grade predictions (the same model
// output the plan shows, lib/predictions.ts), its logged results and session
// timing, and returns per-subject recommendations plus a preferred start hour.
// Returns empty recommendations if no results have been logged yet.
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

    const [subjects, scores, completedSessions] = await Promise.all([
      db
        .select({
          subject: sql<string>`${s.sessions.subject}`,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(${s.sessions.completedAt})::int`,
          examDate: sql<string | null>`min(case when ${s.sessions.type} = 'exam' then ${s.sessions.scheduledAt}::text end)`,
        })
        .from(s.sessions)
        .where(and(eq(s.sessions.userPlanId, id), academic, ne(s.sessions.type, "lecture")))
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

      // Fetch completed sessions to derive time-of-day behaviour
      db
        .select({ completedAt: s.sessions.completedAt, focus: s.sessions.focus })
        .from(s.sessions)
        .where(and(eq(s.sessions.userPlanId, id), isNotNull(s.sessions.completedAt))),
    ]);

    // The prediction model's view of each subject, and the results it's based on.
    let predictions: SubjectPrediction[] = [];
    let dataPoints: DataPointEntry[] = [];
    const owned = await getOwnedPlan(user.id, id);
    if (owned && owned.subjects.length > 0) {
      try {
        await syncTopics(owned);
        const [timeline, observations] = await Promise.all([getTimeline(user.id, id), listObservations(user.id, id)]);
        predictions = subjectPredictions(timeline, owned.subjects);
        dataPoints = observations.flatMap((o) => {
          const subject = subjectOfDataPoint(o.weights, owned.subjects);
          return subject
            ? [{ subject, type: o.type, takenOn: o.observedAt.slice(0, 10), grade: toGrade(o.score), points: o.nPoints }]
            : [];
        });
      } catch (e) {
        // Without the model the agent still has the exam scores; it never guesses grades.
        if (!(e instanceof KnowledgeError)) throw e;
      }
    }

    if (scores.length === 0 && dataPoints.length === 0) {
      return Response.json({ recommendations: [], overallInsight: null, preferredStartHour: null });
    }

    // Build hourly activity distribution
    const hourMap = new Map<number, { count: number; totalFocus: number; focusCount: number }>();
    for (const sess of completedSessions) {
      if (!sess.completedAt) continue;
      const hour = new Date(sess.completedAt).getHours();
      const entry = hourMap.get(hour) ?? { count: 0, totalFocus: 0, focusCount: 0 };
      entry.count++;
      if (sess.focus !== null) { entry.totalFocus += sess.focus; entry.focusCount++; }
      hourMap.set(hour, entry);
    }
    const hourlyActivity: HourlyActivity[] = [...hourMap.entries()]
      .map(([hour, data]) => ({
        hour,
        sessions: data.count,
        avgFocus: data.focusCount > 0 ? Math.round(data.totalFocus / data.focusCount) : null,
      }))
      .sort((a, b) => a.hour - b.hour);

    const result = await runStrategyAgent(scores, subjects, hourlyActivity, { predictions, dataPoints });
    return Response.json(result);
  });
}
