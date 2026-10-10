import { z } from "zod";
import { and, asc, eq, gt, isNull, notInArray, sql } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTasksBulk } from "@/lib/tasks";
import { generateStudyPlan, CONFIDENCE_SCORE } from "@/lib/scheduler";
import { db, schema as s } from "@/db";
import type { StoredSubjectConfig } from "@/db/schema";

type Ctx = { params: Promise<{ id: string }> };

const recommendationSchema = z.object({
  subject: z.string(),
  suggestedApproach: z.enum(["foundation", "balanced", "exam"]).optional(),
  confidenceDelta: z.number().min(-1).max(1),
  priorityTopics: z.array(z.string()),
});

const bodySchema = z.object({
  recommendations: z.array(recommendationSchema),
  preferredStartHour: z.number().min(5).max(12).optional(),
});

// Maps a numeric confidence score back to the nearest confidence label.
function scoreToConfidence(score: number): string {
  let best = "some";
  let bestDist = Infinity;
  for (const [label, val] of Object.entries(CONFIDENCE_SCORE)) {
    const dist = Math.abs(val - score);
    if (dist < bestDist) { bestDist = dist; best = label; }
  }
  return best;
}

function applyConfidenceDelta(current: string, delta: number): string {
  const base = CONFIDENCE_SCORE[current] ?? 0.5;
  return scoreToConfidence(Math.max(0, Math.min(1, base + delta)));
}

// POST /api/plans/:id/reschedule
// Applies the strategy agent's recommendations to stored subject configs,
// drops all future incomplete sessions, and regenerates the schedule.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const [plan] = await db
      .select({ id: s.userPlans.id, title: s.userPlans.title, config: s.userPlans.config })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, id), eq(s.userPlans.userId, user.id)));
    if (!plan) return notFound("Plan");

    const { recommendations, preferredStartHour } = bodySchema.parse(await request.json());

    // For legacy plans without stored subject configs, reconstruct from session data.
    let storedSubjects = plan.config?.subjects;
    if (!storedSubjects?.length) {
      const sessionData = await db
        .select({
          subject: s.sessions.subject,
          examDate: sql<string | null>`min(case when ${s.sessions.type} = 'exam' then ${s.sessions.scheduledAt}::text end)`,
          examMinutes: sql<number | null>`max(case when ${s.sessions.type} = 'exam' then ${s.sessions.plannedMinutes} end)`,
        })
        .from(s.sessions)
        .where(and(eq(s.sessions.userPlanId, id), notInArray(s.sessions.type, ["lecture", "buffer"])))
        .groupBy(s.sessions.subject)
        .orderBy(asc(s.sessions.subject));

      if (!sessionData.length) {
        return Response.json({ error: "No sessions found for this plan." }, { status: 422 });
      }

      const equalAlloc = Math.floor(100 / sessionData.length);
      storedSubjects = sessionData.map((sub, i) => ({
        name: sub.subject,
        examDate: sub.examDate ? sub.examDate.slice(0, 10) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        examDuration: String(sub.examMinutes ?? 180),
        targetGrade: "5",
        currentGrade: "4",
        confidence: "some",
        approach: "balanced",
        customPhases: [],
        mockCount: "0",
        // last subject absorbs any rounding remainder so allocations sum to 100
        allocation: i === sessionData.length - 1
          ? 100 - equalAlloc * (sessionData.length - 1)
          : equalAlloc,
        materials: [],
        cheatsheet: "none",
        comments: "",
      }));
    }

    // Build a lookup map from the incoming recommendations
    const recBySubject = new Map(recommendations.map((r) => [r.subject, r]));

    // Apply deltas to stored subject configs
    const updatedSubjects: StoredSubjectConfig[] = storedSubjects.map((sub) => {
      const rec = recBySubject.get(sub.name);
      if (!rec) return sub;
      return {
        ...sub,
        confidence: applyConfidenceDelta(sub.confidence, rec.confidenceDelta),
        approach: rec.suggestedApproach ?? sub.approach,
      };
    });

    const baseCfg = plan.config ?? { weeklyHours: 20, studyDays: ["Mon","Tue","Wed","Thu","Fri"], sessionLength: 90, vacationRanges: [] };

    // Build updated plan config
    const updatedConfig = {
      ...baseCfg,
      subjects: updatedSubjects,
      ...(preferredStartHour !== undefined ? { preferredStartHour } : {}),
    };

    // Drop all future incomplete sessions for this plan
    await db
      .delete(s.sessions)
      .where(
        and(
          eq(s.sessions.userPlanId, id),
          isNull(s.sessions.completedAt),
          gt(s.sessions.scheduledAt, new Date()),
        ),
      );

    // Regenerate sessions using the updated config.
    // Allocations are re-normalised to sum to 100 across active subjects.
    const totalAlloc = updatedSubjects.reduce((sum, sub) => sum + sub.allocation, 0) || 100;
    const result = generateStudyPlan({
      planName: plan.title,
      weeklyHours: baseCfg.weeklyHours,
      studyDays: baseCfg.studyDays,
      sessionLength: baseCfg.sessionLength,
      vacationRanges: baseCfg.vacationRanges,
      preferredStartHour: updatedConfig.preferredStartHour,
      workloadBasisWeeklyMinutes: baseCfg.workloadBasisWeeklyMinutes,
      subjects: updatedSubjects.map((sub) => ({
        ...sub,
        allocation: Math.round((sub.allocation / totalAlloc) * 100),
      })),
    });

    const tasks = result.sessions.map((sess) => ({
      type: sess.type,
      subject: sess.subject,
      title: sess.title,
      detail: sess.detail ?? null,
      scheduledAt: sess.scheduledAt,
      plannedMinutes: sess.plannedMinutes,
      userId: user.id,
      userPlanId: id,
      shared: false as const,
    }));

    const [count] = await Promise.all([
      createTasksBulk(tasks),
      db.update(s.userPlans).set({ config: updatedConfig }).where(eq(s.userPlans.id, id)),
    ]);

    return Response.json({ count, breakdown: result.breakdown, warnings: result.warnings }, { status: 200 });
  });
}
