/**
 * Whether a study plan is current, finished or archived — derived, never
 * stored (apart from the student's explicit archive). Safe for client code.
 *
 * A plan stays current up to and including the day of its last exam, and is
 * finished from the next calendar day on — whether or not every session was
 * completed. Exam dates are plain calendar dates ("YYYY-MM-DD"), and "today"
 * is the date where the student is, so no UTC-midnight shift can finish a plan
 * a day early or late.
 */

export type PlanStatus = "current" | "finished" | "archived";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date ("YYYY-MM-DD") of an instant in a time zone — the runtime's own by default. */
export function localDateKey(at: Date, timeZone?: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The latest of a plan's exam dates; null when none is a valid date. */
export function latestExamDate(examDates: (string | null | undefined)[]): string | null {
  const valid = examDates.filter((d): d is string => !!d && DATE_KEY.test(d));
  return valid.length ? valid.reduce((a, b) => (b > a ? b : a)) : null;
}

/**
 * A plan's status on `today` ("YYYY-MM-DD"). Without any exam date a plan is
 * never finished automatically — only by archiving it.
 */
export function planStatus(
  plan: { latestExamDate: string | null; archivedAt: string | null },
  today: string,
): PlanStatus {
  if (plan.archivedAt) return "archived";
  if (plan.latestExamDate && today > plan.latestExamDate) return "finished";
  return "current";
}

/** Plans split into current ones and past ones (finished or archived), keeping their order. */
export function splitPlans<P extends { latestExamDate: string | null; archivedAt: string | null }>(plans: P[], today: string) {
  const current: P[] = [];
  const past: (P & { status: Exclude<PlanStatus, "current"> })[] = [];
  for (const plan of plans) {
    const status = planStatus(plan, today);
    if (status === "current") current.push(plan);
    else past.push({ ...plan, status });
  }
  return { current, past };
}
