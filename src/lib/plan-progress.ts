import type { SubjectProgress } from "./scheduler";
import type { BlockActivity, EventType } from "./types";

/** A stored block, as far as plan progress is concerned. */
export type ProgressRow = {
  subject: string | null;
  type: EventType;
  activity: BlockActivity | null;
  title: string;
  plannedMinutes: number;
  cheatsheetTarget: number | null;
  done: boolean;
};

const STUDY_TYPES: EventType[] = ["theory", "exercises", "mock_exam", "quiz"];

/** What a block is for; blocks saved before activities existed are recognised by type and title. */
export function activityOf(row: Pick<ProgressRow, "type" | "activity" | "title">): BlockActivity | null {
  if (row.activity) return row.activity;
  if (row.type === "buffer") return "buffer";
  if (row.type === "exam") return "exam";
  if (/Mock Exam Review/i.test(row.title)) return "mock_review";
  if (/Mock exam \d/i.test(row.title)) return "mock_exam";
  return STUDY_TYPES.includes(row.type) ? "study" : null;
}

/**
 * What each subject has already done in a plan, from its completed blocks —
 * so regenerating schedules only the rest. Only completion counts: a block
 * whose time has passed but wasn't marked done hasn't made progress.
 */
export function progressFromRows(rows: ProgressRow[]): Record<string, SubjectProgress> {
  const progress: Record<string, SubjectProgress> = {};
  for (const row of rows) {
    if (!row.done || !row.subject) continue;
    const p = (progress[row.subject] ??= { studyMinutes: 0, mocksDone: 0, cheatsheet: 0 });
    const activity = activityOf(row);
    if (activity === "study") p.studyMinutes += row.plannedMinutes;
    if (activity === "mock_exam") p.mocksDone += 1;
    if (row.cheatsheetTarget !== null) p.cheatsheet = Math.max(p.cheatsheet, row.cheatsheetTarget);
  }
  return progress;
}

/** A subject's cheatsheet: what the plan expects by now vs where the student actually is. */
export type CheatsheetStatus = {
  /** Planned milestone: the highest target of sessions scheduled up to now. */
  planned: number;
  /** Actual progress: the student's latest report, else the targets of sessions they completed. */
  actual: number;
  /** Whether `actual` comes from a report (rather than completed sessions). */
  reported: boolean;
};

/**
 * Cheatsheet progress per subject. Only the student moves `actual`: by
 * reporting it, or by completing a session. A session that is merely
 * scheduled, or whose time has passed, changes nothing.
 * `reports` are in the order they were made; the latest counts.
 */
export function cheatsheetProgress(
  rows: (Pick<ProgressRow, "subject" | "cheatsheetTarget" | "done"> & { scheduledAt: Date })[],
  now: Date,
  reports: { subject: string; percent: number }[] = [],
): Record<string, CheatsheetStatus> {
  const out: Record<string, CheatsheetStatus> = {};
  for (const row of rows) {
    if (!row.subject || row.cheatsheetTarget === null) continue;
    const p = (out[row.subject] ??= { planned: 0, actual: 0, reported: false });
    if (row.done) p.actual = Math.max(p.actual, row.cheatsheetTarget);
    if (row.scheduledAt <= now) p.planned = Math.max(p.planned, row.cheatsheetTarget);
  }
  for (const { subject, percent } of reports) {
    const p = (out[subject] ??= { planned: 0, actual: 0, reported: false });
    p.actual = percent;
    p.reported = true;
  }
  return out;
}

/** A logged mock or real exam result, from the exam scores or the prediction model's data points. */
export type MockResult = { subject: string; takenOn: string; grade: number };

/** The latest mock/exam grade per subject, whichever source logged it; a later log wins a tie. */
export function latestMockGrades(results: MockResult[]): Record<string, number> {
  const latest: Record<string, number> = {};
  const ordered = results.map((r, i) => ({ ...r, i })).sort((a, b) => a.takenOn.localeCompare(b.takenOn) || a.i - b.i);
  for (const r of ordered) latest[r.subject] = r.grade;
  return latest;
}
