import { z } from "zod";
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { cheatsheetProgress } from "@/lib/plan-progress";
import { handle, isId, notFound } from "@/lib/http";
import { academic, getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";

type Ctx = RouteContext<"/api/plans/[id]">;

// GET /api/plans/:id — per-subject session breakdown + plan config
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const [plan] = await db
      .select({ id: s.userPlans.id, title: s.userPlans.title, config: s.userPlans.config })
      .from(s.userPlans)
      .where(and(eq(s.userPlans.id, id), eq(s.userPlans.userId, user.id)));

    if (!plan) return notFound("Plan");

    const subjects = await db
      .select({
        subject: sql<string>`${s.sessions.subject}`,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(${s.sessions.completedAt})::int`,
        examDate: sql<string | null>`min(case when ${s.sessions.type} = 'exam' then ${s.sessions.scheduledAt}::text end)`,
      })
      .from(s.sessions)
      .where(and(eq(s.sessions.userPlanId, id), academic, ne(s.sessions.type, "lecture")))
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

    // Cheatsheet progress per subject: what completed sessions confirm vs what was planned by now.
    const milestones = await db
      .select({
        subject: s.sessions.subject,
        cheatsheetTarget: s.sessions.cheatsheetTarget,
        scheduledAt: s.sessions.scheduledAt,
        completedAt: s.sessions.completedAt,
      })
      .from(s.sessions)
      .where(and(eq(s.sessions.userPlanId, id), isNotNull(s.sessions.cheatsheetTarget)));
    const reports = await db
      .select({ subject: s.cheatsheetReports.subject, percent: s.cheatsheetReports.percent })
      .from(s.cheatsheetReports)
      .where(eq(s.cheatsheetReports.userPlanId, id))
      .orderBy(asc(s.cheatsheetReports.createdAt));
    const cheatsheet = cheatsheetProgress(
      milestones.map((m) => ({ ...m, done: m.completedAt !== null })),
      new Date(),
      reports,
    );

    // Mocks per subject: available (from the answers) vs done and still planned (from the schedule).
    const mockRows = await db
      .select({
        subject: sql<string>`${s.sessions.subject}`,
        done: sql<number>`count(${s.sessions.completedAt})::int`,
        planned: sql<number>`(count(*) - count(${s.sessions.completedAt}))::int`,
      })
      .from(s.sessions)
      .where(and(
        eq(s.sessions.userPlanId, id),
        sql`(${s.sessions.activity} = 'mock_exam' or (${s.sessions.activity} is null and ${s.sessions.title} ~ 'Mock exam [0-9]'))`,
      ))
      .groupBy(s.sessions.subject);
    const mocks = Object.fromEntries((plan.config?.subjects ?? []).map((sub) => {
      const row = mockRows.find((r) => r.subject === sub.name);
      const available = Math.max(0, parseInt(sub.mockCount) || 0);
      const done = row?.done ?? 0;
      const planned = row?.planned ?? 0;
      return [sub.name, { available, done, planned, reserve: Math.max(0, available - done - planned) }];
    }));

    // Each subject's current phase: the phase of its next (or ongoing) uncompleted block.
    const upcoming = await db
      .selectDistinctOn([s.sessions.subject], { subject: s.sessions.subject, phase: s.sessions.prepPhase })
      .from(s.sessions)
      .where(and(
        eq(s.sessions.userPlanId, id),
        isNull(s.sessions.completedAt),
        isNull(s.sessions.skippedAt),
        isNotNull(s.sessions.prepPhase),
        sql`${s.sessions.scheduledAt} + ${s.sessions.plannedMinutes} * interval '1 minute' > now()`,
      ))
      .orderBy(s.sessions.subject, asc(s.sessions.scheduledAt));
    const phases = Object.fromEntries(upcoming.map((r) => [r.subject, r.phase]));

    return Response.json({ title: plan.title, subjects, scores, cheatsheet, mocks, phases, config: plan.config ?? null });
  });
}

const patchSchema = z.object({ archived: z.boolean() });

// PATCH /api/plans/:id — { archived } moves your plan to Past Plans or back.
// (Plans also become past on their own once their last exam is over — see lib/plan-status.ts.)
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");
    const { archived } = patchSchema.parse(await request.json());
    const [plan] = await db
      .update(s.userPlans)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(s.userPlans.id, id), eq(s.userPlans.userId, user.id)))
      .returning({ archivedAt: s.userPlans.archivedAt });
    return plan ? Response.json({ archivedAt: plan.archivedAt?.toISOString() ?? null }) : notFound("Plan");
  });
}
