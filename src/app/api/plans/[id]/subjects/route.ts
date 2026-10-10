import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { createTasksBulk } from "@/lib/tasks";
import { generateStudyPlan } from "@/lib/scheduler";
import { db, schema as s } from "@/db";
import { ensureCourseProfile } from "@/lib/course-profiles";

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

    const cfg = scheduleConfig ?? plan.config;
    if (!cfg) {
      return Response.json(
        { error: "No schedule config found. Please provide weeklyHours, studyDays, sessionLength." },
        { status: 422 },
      );
    }

    // Persist config and append new subject to the stored subjects list
    const updatedConfig = {
      ...cfg,
      subjects: [
        ...(plan.config?.subjects ?? []),
        { ...subject, allocation: 100 },
      ],
    };
    await db
      .update(s.userPlans)
      .set({ config: updatedConfig })
      .where(eq(s.userPlans.id, id));

    const result = generateStudyPlan({
      planName: plan.title,
      weeklyHours: cfg.weeklyHours,
      studyDays: cfg.studyDays,
      sessionLength: cfg.sessionLength,
      vacationRanges: cfg.vacationRanges,
      subjects: [{ ...subject, allocation: 100 }],
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

    // Run session creation and VVZ profile fetch in parallel — the profile
    // fetch must not block or break the response if VVZ is unreachable.
    const [count] = await Promise.all([
      createTasksBulk(tasks),
      ensureCourseProfile(subject.name).catch(() => {}),
    ]);

    return Response.json({ count, breakdown: result.breakdown }, { status: 201 });
  });
}
