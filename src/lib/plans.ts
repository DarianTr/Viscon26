import "server-only";
import { and, asc, eq, gt, gte, isNotNull, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { StoredPlanConfig } from "@/db/schema";
import { toGrade } from "./grades";
import { deleteObservation, getOwnedPlan, KnowledgeError, listObservations } from "./knowledge";
import { describeChanges, duplicateNames, mergePending } from "./plan-changes";
import { latestMockGrades, progressFromRows, type MockResult } from "./plan-progress";
import { subjectOfDataPoint } from "./predictions";
import { generateStudyPlan, type ScheduleResult } from "./scheduler";
import { listBusyIntervals, localDay } from "./tasks";

/**
 * Regenerating ("recalibrating") a plan: the one place that decides what is
 * replaced and what stays. Only the future changes: every block that starts
 * before now stays as it was, done or missed, and completed blocks (and logged
 * exam scores, which live elsewhere) are never touched; their work is
 * subtracted from what gets scheduled, so nothing is duplicated. Blocks the
 * student moved by hand stay too, where the new settings still allow them.
 * Every other upcoming, uncompleted block of the plan is replaced.
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

/** Which of a plan's blocks a regeneration replaces: uncompleted ones from `now` on, but `keep`. */
const replaceable = (planId: string, keep: string[], now: Date) =>
  and(
    eq(s.sessions.userPlanId, planId),
    isNull(s.sessions.completedAt),
    gte(s.sessions.scheduledAt, now),
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

  // The latest logged mock/past-exam grade per subject re-plans how many mocks are needed:
  // from the exam scores and from mock and exam results logged for the prediction model.
  const scores = await db
    .select({ subject: s.examScores.subject, score: s.examScores.score, takenAt: s.examScores.takenAt })
    .from(s.examScores)
    .where(and(eq(s.examScores.userId, userId), eq(s.examScores.userPlanId, planId)))
    .orderBy(asc(s.examScores.takenAt), asc(s.examScores.createdAt));
  const mockResults: MockResult[] = scores.map((r) => ({ subject: r.subject, takenOn: r.takenAt, grade: r.score }));
  mockResults.push(...(await loggedMockResults(userId, planId)));
  for (const [subject, grade] of Object.entries(latestMockGrades(mockResults))) {
    (progress[subject] ??= { studyMinutes: 0, mocksDone: 0, cheatsheet: 0 }).latestMockGrade = grade;
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
  // The schedule now reflects every saved edit.
  const { pendingChanges: _pending, ...current } = config;
  const savedConfig: StoredPlanConfig = {
    ...current,
    workloadBasisWeeklyMinutes: result.workloadBasisWeeklyMinutes,
    planStart: result.planStart,
    focusDates: result.focusDates,
    eveDates: result.eveDates,
  };

  const replaced = await db.$count(s.sessions, replaceable(planId, keepIds, now));

  if (apply) {
    await db.transaction(async (tx) => {
      await tx.delete(s.sessions).where(replaceable(planId, keepIds, now));
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

/** Settings the student edits; the rest of the config is the scheduler's and stays. */
export type EditableConfig = Omit<
  StoredPlanConfig,
  "planStart" | "workloadBasisWeeklyMinutes" | "focusDates" | "eveDates" | "pendingChanges"
>;

export class PlanSettingsError extends Error {}

/**
 * "Manage plan": save a plan's name and settings without touching its
 * schedule. Renaming a subject relabels everything stored under its name;
 * edits the scheduler depends on are recorded as pending until the student
 * recalibrates (see lib/plan-changes.ts).
 */
export async function savePlanSettings(
  userId: string,
  planId: string,
  { title, config }: { title?: string; config: EditableConfig },
): Promise<{ title: string; config: StoredPlanConfig; renamed: [string, string][] } | null> {
  const [plan] = await db
    .select({ title: s.userPlans.title, config: s.userPlans.config })
    .from(s.userPlans)
    .where(and(eq(s.userPlans.id, planId), eq(s.userPlans.userId, userId)));
  if (!plan) return null;
  if (!plan.config) {
    throw new PlanSettingsError("This plan was created before plans stored their settings, so it can't be edited.");
  }

  const subjects = (config.subjects ?? []).map((sub) => ({ ...sub, name: sub.name.trim() }));
  if (subjects.length < (plan.config.subjects?.length ?? 0)) throw new PlanSettingsError("Subjects can't be removed here.");
  if (subjects.some((sub) => !sub.name)) throw new PlanSettingsError("Every subject needs a name.");
  const clashes = duplicateNames(subjects);
  if (clashes.length) throw new PlanSettingsError(`Two subjects can't share a name: ${clashes.join(", ")}`);

  const next: StoredPlanConfig = {
    ...plan.config,
    ...config,
    subjects,
    // The scheduler's own state stays until the next recalibration.
    planStart: plan.config.planStart,
    workloadBasisWeeklyMinutes: plan.config.workloadBasisWeeklyMinutes,
    focusDates: plan.config.focusDates,
    eveDates: plan.config.eveDates,
  };
  const changes = describeChanges(plan.config, next);
  const rename = (name: string) => changes.renames.find(([from]) => from === name)?.[1] ?? name;
  next.pendingChanges = mergePending(plan.config.pendingChanges, changes);
  if (next.focusDates) {
    next.focusDates = Object.fromEntries(Object.entries(next.focusDates).map(([day, sub]) => [day, rename(sub)]));
  }
  if (next.eveDates) {
    next.eveDates = Object.fromEntries(Object.entries(next.eveDates).map(([day, subs]) => [day, subs.map(rename)]));
  }
  const newTitle = title?.trim() || plan.title;

  await db.transaction(async (tx) => {
    // Renamed subjects: their blocks, results, reports and materials follow the new name.
    for (const [from, to] of changes.renames) {
      await tx
        .update(s.sessions)
        .set({
          subject: to,
          title: sql`case when starts_with(${s.sessions.title}, ${from + " — "}) then ${to + " — "} || substr(${s.sessions.title}, ${from.length + 4}) else ${s.sessions.title} end`,
        })
        .where(and(eq(s.sessions.userPlanId, planId), eq(s.sessions.subject, from)));
      await tx
        .update(s.examScores)
        .set({ subject: to })
        .where(and(eq(s.examScores.userPlanId, planId), eq(s.examScores.subject, from)));
      await tx
        .update(s.cheatsheetReports)
        .set({ subject: to })
        .where(and(eq(s.cheatsheetReports.userPlanId, planId), eq(s.cheatsheetReports.subject, from)));
      await tx
        .update(s.userCourseMaterials)
        .set({ subject: to })
        .where(and(eq(s.userCourseMaterials.userPlanId, planId), eq(s.userCourseMaterials.subject, from)));
    }
    await tx.update(s.userPlans).set({ title: newTitle, config: next }).where(eq(s.userPlans.id, planId));
  });
  return { title: newTitle, config: next, renamed: changes.renames };
}

/** What deleting a plan removes and what stays — shown before the student confirms. */
export async function planDeletionImpact(planId: string) {
  const now = new Date();
  const ofPlan = eq(s.sessions.userPlanId, planId);
  const [upcoming, missed, completed, materials, scores, cheatsheetReports] = await Promise.all([
    db.$count(s.sessions, and(ofPlan, isNull(s.sessions.completedAt), gte(s.sessions.scheduledAt, now))),
    db.$count(s.sessions, and(ofPlan, isNull(s.sessions.completedAt), lt(s.sessions.scheduledAt, now))),
    db.$count(s.sessions, and(ofPlan, isNotNull(s.sessions.completedAt))),
    db.$count(s.userCourseMaterials, eq(s.userCourseMaterials.userPlanId, planId)),
    db.$count(s.examScores, eq(s.examScores.userPlanId, planId)),
    db.$count(s.cheatsheetReports, eq(s.cheatsheetReports.userPlanId, planId)),
  ]);
  return { upcoming, missed, completed, materials, scores, cheatsheetReports };
}

/**
 * Deletes a plan. Its schedule goes: every block not completed. Completed
 * sessions stay as study history (hours, streak, feed), no longer part of a
 * plan, and so do logged exam scores — the database detaches both. Uploaded
 * materials and cheatsheet reports belong to the plan and go with it
 * (cascade), as do its grade-forecast data points in the knowledge service.
 */
export async function deletePlan(userId: string, planId: string): Promise<{ dataPointsDeleted: number } | null> {
  const [plan] = await db
    .select({ id: s.userPlans.id })
    .from(s.userPlans)
    .where(and(eq(s.userPlans.id, planId), eq(s.userPlans.userId, userId)));
  if (!plan) return null;

  // Data points first: if the knowledge service is down, nothing is deleted yet.
  let dataPointsDeleted = 0;
  for (const o of await listObservations(userId, planId)) {
    if (await deleteObservation(userId, planId, o.id)) dataPointsDeleted++;
  }

  await db.transaction(async (tx) => {
    await tx.delete(s.sessions).where(and(eq(s.sessions.userPlanId, planId), isNull(s.sessions.completedAt)));
    await tx.delete(s.userPlans).where(eq(s.userPlans.id, planId));
  });
  return { dataPointsDeleted };
}

/**
 * Mock and exam results logged through "Log data" (the prediction model's data
 * points). If the knowledge service is down, recalibrating goes on without them.
 */
async function loggedMockResults(userId: string, planId: string): Promise<MockResult[]> {
  const plan = await getOwnedPlan(userId, planId);
  if (!plan) return [];
  try {
    const observations = await listObservations(userId, planId);
    return observations.flatMap((o) => {
      const subject = o.type === "mock" || o.type === "exam" ? subjectOfDataPoint(o.weights, plan.subjects) : null;
      return subject ? [{ subject, takenOn: o.observedAt.slice(0, 10), grade: Math.round(toGrade(o.score) * 100) / 100 }] : [];
    });
  } catch (e) {
    if (e instanceof KnowledgeError) return [];
    throw e;
  }
}
