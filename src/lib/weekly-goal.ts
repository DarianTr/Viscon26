import type { Interval } from "./intervals";
import { dailyBufferMinutes, dailyWindowMinutes } from "./scheduler";

/*
 * The Profile's "This week" target comes from the student's active study
 * plans, never from a profile setting. A plan is active while its study period
 * — first day to last exam — overlaps the displayed week, so finished plans
 * drop out on their own and the next plan (or the empty state) takes over.
 *
 * The target is the focused study the active plans schedule for that week:
 * study, mocks, reviews and cheatsheet work. Buffers, breaks, meals and the
 * exam itself never count. On a regular week that's the plan's daily hours
 * minus the buffer, times its study days (`standardWeeklyMinutes`); exam weeks,
 * vacations and partial first weeks come out lower, as scheduled.
 */

/** A plan's study period as local "YYYY-MM-DD" days; null where unknown. */
export type PlanSpan = { start: string | null; end: string | null };

/** "YYYY-MM-DD" for `at` in `timeZone`. */
export function localDateKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday and Sunday of the week containing `at`, in `timeZone`. */
export function weekBounds(at: Date, timeZone: string): { start: string; end: string } {
  const today = localDateKey(at, timeZone);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -weekday);
  return { start, end: addDays(start, 6) };
}

const isDateKey = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * A plan's study period. It starts on the configured first day, else its first
 * block; it ends on the latest exam date in its settings, else its last exam
 * block, else its last block.
 */
export function planSpan(plan: {
  planStart?: string | null;
  examDates?: (string | null | undefined)[];
  firstBlock: string | null;
  lastExamBlock: string | null;
  lastBlock: string | null;
}): PlanSpan {
  const exams = (plan.examDates ?? []).filter(isDateKey).sort();
  const start = isDateKey(plan.planStart) ? plan.planStart : plan.firstBlock;
  const end = exams.at(-1) ?? plan.lastExamBlock ?? plan.lastBlock;
  return { start: start ?? null, end: end ?? null };
}

/** Whether a plan's study period overlaps the week. A plan with no dates at all isn't active. */
export function isActiveInWeek(span: PlanSpan, week: { start: string; end: string }): boolean {
  if (!span.start && !span.end) return false;
  return (!span.start || span.start <= week.end) && (!span.end || span.end >= week.start);
}

/** Focused minutes of a regular study week: daily hours minus the buffer, on every study day. */
export function standardWeeklyMinutes(config: { weeklyHours: number; studyDays: string[] }): number {
  const window = dailyWindowMinutes(config);
  return Math.max(0, window - dailyBufferMinutes(window)) * config.studyDays.length;
}

/**
 * Minutes covered by the blocks, each minute counted once — two plans can't
 * double-count time they both claim. Also split by weekday (Monday = 0), by
 * the day each merged stretch starts on.
 */
export function plannedMinutes(blocks: (Interval & { day: number })[]): { total: number; byDay: number[] } {
  const byDay = Array<number>(7).fill(0);
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  let run: (Interval & { day: number }) | null = null;
  const close = () => {
    if (run) byDay[run.day] += (run.end - run.start) / 60_000;
  };
  for (const b of sorted) {
    if (run && b.start < run.end) {
      run.end = Math.max(run.end, b.end);
    } else {
      close();
      run = { ...b };
    }
  }
  close();
  return { total: byDay.reduce((a, b) => a + b, 0), byDay };
}
