import { activityOf } from "./plan-progress";
import { dailyBufferMinutes, dailyWindowMinutes, MAX_SUBJECTS_PER_DAY } from "./scheduler";
import type { BlockActivity, EventType } from "./types";

/**
 * Rules for moving a block by hand, beyond "no overlaps" and "only on study
 * days": the same limits the scheduler plans with. Pure, so the task API and
 * tests share them. Each returns an explanation when a move breaks the rule.
 */

export type DayBlock = {
  id: string;
  type: EventType;
  activity: BlockActivity | null;
  subject: string | null;
  title: string;
  /** Minutes after local midnight. */
  start: number;
  minutes: number;
};

/** Meals can move, but only within a sensible window, so they stay meals. */
export const MEAL_WINDOWS: Partial<Record<BlockActivity, { from: number; to: number; label: string }>> = {
  lunch: { from: 11 * 60, to: 15 * 60, label: "Lunch stays between 11:00 and 15:00." },
  dinner: { from: 17 * 60, to: 21 * 60 + 30, label: "Dinner stays between 17:00 and 21:30." },
};

export function mealRule(block: DayBlock): string | null {
  const window = block.activity ? MEAL_WINDOWS[block.activity] : undefined;
  if (!window) return null;
  return block.start < window.from || block.start + block.minutes > window.to ? window.label : null;
}

/** Academic work: has a subject and isn't a break, buffer, exam or lecture. */
const isStudyWork = (b: DayBlock) =>
  b.subject !== null && !["break", "buffer", "exam", "lecture"].includes(b.type);

/**
 * A plan's blocks on one day, after the move: at most the plan's daily study
 * capacity, at most two subjects, and only the focus subject on a focus day.
 */
export function dayRule(
  blocks: DayBlock[],
  config: { weeklyHours: number; studyDays: string[] },
  focusSubject?: string,
): string | null {
  const work = blocks.filter(isStudyWork);
  const capacity = dailyWindowMinutes(config) - dailyBufferMinutes(dailyWindowMinutes(config));
  const minutes = work.reduce((t, b) => t + b.minutes, 0);
  if (minutes > capacity) {
    return `That day would have ${hours(minutes)} of study — your plan allows ${hours(capacity)} a day.`;
  }
  const subjects = [...new Set(work.map((b) => b.subject))];
  if (focusSubject && subjects.some((s) => s !== focusSubject)) {
    return `That day is a focus day for ${focusSubject} — only ${focusSubject} goes there.`;
  }
  if (subjects.length > MAX_SUBJECTS_PER_DAY) {
    return `That day would have ${subjects.length} subjects (${subjects.join(", ")}) — at most ${MAX_SUBJECTS_PER_DAY} a day.`;
  }
  return null;
}

/** "Mock exam 3" ↔ "Mock Exam Review 3": a mock must end before its review starts. */
export function mockOrderRule(moved: DayBlock & { at: number }, partner: (DayBlock & { at: number }) | undefined): string | null {
  if (!partner) return null;
  const kind = activityOf(moved);
  const [mock, review] = kind === "mock_exam" ? [moved, partner] : [partner, moved];
  if (mock.at + mock.minutes * 60_000 <= review.at) return null;
  return kind === "mock_exam"
    ? `“${moved.title}” must end before its review (“${partner.title}”) starts — move the review later first.`
    : `“${moved.title}” has to come after its mock exam (“${partner.title}”).`;
}

/** The title of the mock exam or review that belongs with this one, if it is either. */
export function mockPartnerTitle(block: Pick<DayBlock, "type" | "activity" | "title">): string | null {
  const kind = activityOf(block);
  if (kind === "mock_exam") return block.title.replace(/Mock exam (\d+)/, "Mock Exam Review $1");
  if (kind === "mock_review") return block.title.replace(/Mock Exam Review (\d+)/, "Mock exam $1");
  return null;
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;
