import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { regeneratePlan } from "@/lib/plans";
import { db, schema as s } from "@/db";

type Ctx = RouteContext<"/api/plans/[id]/subjects">;

const scheduleConfigSchema = z.object({
  weeklyHours: z.number().positive(),
  studyDays: z.array(z.string()).min(1),
  sessionLength: z.number().positive(),
  vacationRanges: z.array(z.object({ start: z.string(), end: z.string() })),
});

const subjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  examDuration: z.string(),
  targetGrade: z.string(),
  currentGrade: z.string(),
  confidence: z.enum(["very", "mostly", "some", "little"]),
  materials: z.array(z.string()),
  mockCount: z.string(),
  approach: z.enum(["foundation", "balanced", "exam", "custom"]),
  customPhases: z.array(z.string()),
  cheatsheet: z.string(),
  comments: z.string(),
});

const bodySchema = z.object({
  subject: subjectSchema,
  scheduleConfig: scheduleConfigSchema.optional(),
});

// POST /api/plans/:id/subjects — add a new subject to an existing custom plan
// and regenerate its uncompleted schedule (completed work stays).
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

    const { subject, scheduleConfig } = bodySchema.parse(await request.json());

    if (!scheduleConfig && !plan.config) {
      return Response.json(
        { error: "No schedule config found. Please provide weeklyHours, studyDays, sessionLength." },
        { status: 422 },
      );
    }

    // The new subject gets an even share; the others keep their proportions.
    // Then the whole uncompleted schedule is regenerated, so the two-subjects-a-day
    // rule and every other constraint holds across all subjects.
    const existing = plan.config?.subjects ?? [];
    const share = Math.round(100 / (existing.length + 1));
    const subjects = [
      ...existing.map((sub) => ({ ...sub, allocation: Math.round((sub.allocation * (100 - share)) / 100) })),
      { ...subject, allocation: share },
    ];
    const outcome = await regeneratePlan(user.id, id, { ...scheduleConfig, subjects }, { apply: true });
    if (!outcome) return notFound("Plan");
    const { result } = outcome;
    const count = result.sessions.length;

    return Response.json({ count, breakdown: result.breakdown, warnings: result.warnings }, { status: 201 });
  });
}
