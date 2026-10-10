import "server-only";
import { and, asc, eq, gt, isNotNull, isNull, ne, notInArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { StoredPlanConfig } from "@/db/schema";
import { progressFromRows } from "./plan-progress";
import { generateStudyPlan, type ScheduleResult } from "./scheduler";
import { listBusyIntervals, localDay } from "./tasks";

/**
 * Regenerating a plan: the one place that decides what is replaced and what
 * stays. Completed blocks (and logged exam scores, which live elsewhere) are
 * never touched; their work is subtracted from what gets scheduled, so nothing
 * is duplicated. Blocks the student moved by hand stay too, where the new
 * settings still allow them. Every other block of the plan — upcoming, or
 * missed and never done — is replaced by the new schedule.
 */

export type RegenerateOutcome = {
  result: ScheduleResult;
  /** Uncompleted blocks the new schedule replaces. */
  replaced: number;
  /** Completed blocks that stay as they are. */
  kept: number;
  /** Blocks moved by hand that stay where the student put them. */
  manualKept: number;
  /** Blocks moved by hand that no longer fit the settings, and are replaced. */
  manualReplaced: number;
  config: StoredPlanConfig;
};

/** Which of a plan's blocks a regeneration replaces (all uncompleted ones but `keep`). */
const replaceable = (planId: string, keep: string[]) =>
  and(
    eq(s.sessions.userPlanId, planId),
    isNull(s.sessions.completedAt),
    ne(s.sessions.type, "lecture"),
    keep.length ? notInArray(s.sessions.id, keep) : undefined,
  );

export async function regeneratePlan(
  userId: string,
  planId: string,
  changes: Partial<StoredPlanConfig> & { title?: string },
  { apply, now = new Date(), quizGaps }: { apply: boolean; now?: Date; quizGaps?: Record<string, number> },
): Promise<RegenerateOutcome | null> {
  const [plan] = await db
    .select({ title: s.userPlans.title, config: s.userPlans.config, createdAt: s.userPlans.createdAt })
    .from(s.userPlans)
    .where(and(eq(s.userPlans.id, planId), eq(s.userPlans.userId, userId)));
  // Plans from before configs were stored can only be regenerated with a full config.
  if (!plan || (!plan.config && !changes.weeklyHours)) return null;

  const { title, ...configChanges } = changes;
  const merged = { ...plan.config, ...configChanges } as StoredPlanConfig;
  const config: StoredPlanConfig = {
    ...merged,
    // The plan keeps its start and workload basis, so edits don't reset the workload.
    planStart: plan.config?.planStart ?? merged.planStart ?? plan.createdAt.toISOString().slice(0, 10),
  };
  const subjects = config.subjects ?? [];

  const rows = await db
    .select({
      subject: s.sessions.subject,
      type: s.sessions.type,
      activity: s.sessions.activity,
      title: s.sessions.title,
      plannedMinutes: s.sessions.plannedMinutes,
      cheatsheetTarget: s.sessions.cheatsheetTarget,
      completedAt: s.sessions.completedAt,
    })
    .from(s.sessions)
    .where(and(eq(s.sessions.userPlanId, planId), isNotNull(s.sessions.completedAt)));
  const progress = progressFromRows(rows.map((r) => ({ ...r, done: true })));

  // Reported cheatsheet progress is the actual progress: behind means more cheatsheet time.
  const reports = await db
    .select({ subject: s.cheatsheetReports.subject, percent: s.cheatsheetReports.percent })
    .from(s.cheatsheetReports)
    .where(eq(s.cheatsheetReports.userPlanId, planId))
    .orderBy(asc(s.cheatsheetReports.createdAt));
  for (const { subject, percent } of reports) {
    (progress[subject] ??= { studyMinutes: 0, mocksDone: 0, cheatsheet: 0 }).cheatsheet = percent;
  }

  // The latest logged mock/past-exam grade per subject re-plans how many mocks are needed.
  const scores = await db
    .select({ subject: s.examScores.subject, score: s.examScores.score })
    .from(s.examScores)
    .where(and(eq(s.examScores.userId, userId), eq(s.examScores.userPlanId, planId)))
    .orderBy(asc(s.examScores.takenAt), asc(s.examScores.createdAt));
  for (const { subject, score } of scores) {
    (progress[subject] ??= { studyMinutes: 0, mocksDone: 0, cheatsheet: 0 }).latestMockGrade = score;
  }

  // Blocks moved by hand stay where they are if the new settings still allow them
  // there: a study day, not a vacation, before their subject's exam. Their work
  // counts as placed, so it isn't scheduled twice.
  const moved = await db
    .select({
      id: s.sessions.id,
      subject: s.sessions.subject,
      type: s.sessions.type,
      activity: s.sessions.activity,
      title: s.sessions.title,
      plannedMinutes: s.sessions.plannedMinutes,
      cheatsheetTarget: s.sessions.cheatsheetTarget,
      scheduledAt: s.sessions.scheduledAt,
    })
    .from(s.sessions)
    .where(and(
      eq(s.sessions.userPlanId, planId),
      isNull(s.sessions.completedAt),
      // A skipped block is replaced: its work is scheduled again.
      isNull(s.sessions.skippedAt),
      eq(s.sessions.movedManually, true),
      ne(s.sessions.type, "exam"),
      gt(s.sessions.scheduledAt, now),
    ));
  const examOf = new Map(subjects.map((sub) => [sub.name, sub.examDate]));
  const keepIds = moved
    .filter((m) => {
      const day = localDay(m.scheduledAt);
      if (!config.studyDays.includes(day.weekday)) return false;
      if (config.vacationRanges.some((r) => r.start <= day.key && day.key <= r.end)) return false;
      if (m.subject === null) return true;
      const exam = examOf.get(m.subject);
      return exam !== undefined && day.key < exam;
    })
    .map((m) => m.id);
  const keptMoved = moved.filter((m) => keepIds.includes(m.id));
  for (const [subject, p] of Object.entries(progressFromRows(keptMoved.map((m) => ({ ...m, done: true }))))) {
    const total = (progress[subject] ??= { studyMinutes: 0, mocksDone: 0, cheatsheet: 0 });
    total.studyMinutes += p.studyMinutes;
    total.mocksDone += p.mocksDone;
  }

  // Everything else on the calendar stays where it is, this plan's completed and kept blocks included.
  const lastExam = subjects.reduce((max, sub) => (sub.examDate > max ? sub.examDate : max), "");
  const busy = await listBusyIntervals(userId, now, new Date(`${lastExam || "1970-01-01"}T23:59:59`), {
    replacingPlan: planId,
    keep: keepIds,
  });

  const result = generateStudyPlan(
    {
      planName: title ?? plan.title,
      ...config,
      subjects: subjects.map((sub) => ({ ...sub })),
    },
    now,
    { busy, progress, quizGaps },
  );
  const savedConfig: StoredPlanConfig = {
    ...config,
    workloadBasisWeeklyMinutes: result.workloadBasisWeeklyMinutes,
    planStart: result.planStart,
    focusDates: result.focusDates,
    eveDates: result.eveDates,
  };

  const replaced = await db.$count(s.sessions, replaceable(planId, keepIds));

  if (apply) {
    await db.transaction(async (tx) => {
      await tx.delete(s.sessions).where(replaceable(planId, keepIds));
      const items = result.sessions.map((sess) => ({
        userId,
        userPlanId: planId,
        type: sess.type,
        activity: sess.activity,
        subject: sess.subject,
        title: sess.title,
        detail: sess.detail,
        scheduledAt: sess.scheduledAt,
        plannedMinutes: sess.plannedMinutes,
        cheatsheetTarget: sess.cheatsheetTarget ?? null,
        cheatsheetMinutes: sess.cheatsheetMinutes ?? null,
        prepPhase: sess.prepPhase ?? null,
        shared: false,
      }));
      for (let i = 0; i < items.length; i += 1000) {
        await tx.insert(s.sessions).values(items.slice(i, i + 1000));
      }
      await tx
        .update(s.userPlans)
        .set({ config: savedConfig, ...(title ? { title } : {}) })
        .where(eq(s.userPlans.id, planId));
    });
  }

  return {
    result,
    replaced,
    kept: rows.length,
    manualKept: keepIds.length,
    manualReplaced: moved.length - keepIds.length,
    config: savedConfig,
  };
}
