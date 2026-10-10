import { z } from "zod";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { academic, getCurrentUser } from "@/lib/queries";
import { regeneratePlan } from "@/lib/plans";
import { CONFIDENCE_SCORE } from "@/lib/scheduler";
import { db, schema as s } from "@/db";
import type { StoredSubjectConfig } from "@/db/schema";
import { getOwnedPlan, getRecommendedTopics } from "@/lib/knowledge";

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
// Applies the strategy agent's recommendations to stored subject configs and
// regenerates the uncompleted schedule (see regeneratePlan).
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
          subject: sql<string>`${s.sessions.subject}`,
          examDate: sql<string | null>`min(case when ${s.sessions.type} = 'exam' then ${s.sessions.scheduledAt}::text end)`,
          examMinutes: sql<number | null>`max(case when ${s.sessions.type} = 'exam' then ${s.sessions.plannedMinutes} end)`,
        })
        .from(s.sessions)
        .where(and(eq(s.sessions.userPlanId, id), academic, ne(s.sessions.type, "lecture")))
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

    const baseCfg = plan.config ?? { weeklyHours: 20, studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], sessionLength: 90, vacationRanges: [] };

    // Build updated plan config
    const updatedConfig = {
      ...baseCfg,
      subjects: updatedSubjects,
      // The agent's start hour also moves the day template's start.
      ...(preferredStartHour !== undefined
        ? { preferredStartHour, startTime: `${String(preferredStartHour).padStart(2, "0")}:00` }
        : {}),
    };

    // Fetch per-subject knowledge gaps from the Kalman filter to drive quiz scheduling.
    let quizGaps: Record<string, number> = {};
    try {
      const ownedPlan = await getOwnedPlan(user.id, id);
      if (ownedPlan) {
        const focus = await getRecommendedTopics(user.id, ownedPlan);
        // Map subjectId → subject name using the plan's subject list.
        const subjectById = new Map(ownedPlan.subjects.map((sub) => [sub.id, sub.name]));
        const gapsByName: Record<string, { sum: number; count: number }> = {};
        for (const topic of focus.topics) {
          const name = topic.subjectId ? subjectById.get(topic.subjectId) : undefined;
          if (!name) continue;
          if (!gapsByName[name]) gapsByName[name] = { sum: 0, count: 0 };
          gapsByName[name].sum += topic.gap;
          gapsByName[name].count += 1;
        }
        quizGaps = Object.fromEntries(
          Object.entries(gapsByName).map(([name, { sum, count }]) => [name, sum / count]),
        );
      }
    } catch {
      // Knowledge service unavailable — schedule without quiz blocks.
    }

    // Allocations are re-normalised to sum to 100; completed work stays and isn't scheduled again.
    const totalAlloc = updatedSubjects.reduce((sum, sub) => sum + sub.allocation, 0) || 100;
    const outcome = await regeneratePlan(user.id, id, {
      ...updatedConfig,
      subjects: updatedSubjects.map((sub) => ({ ...sub, allocation: Math.round((sub.allocation / totalAlloc) * 100) })),
    }, { apply: true, quizGaps });
    if (!outcome) return notFound("Plan");
    const { result } = outcome;

    return Response.json({ count: result.sessions.length, breakdown: result.breakdown, warnings: result.warnings }, { status: 200 });
  });
}
