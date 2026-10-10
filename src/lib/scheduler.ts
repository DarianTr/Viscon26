/**
 * Deterministic greedy rule-based study scheduler.
 *
 * Learning science principles applied
 * ────────────────────────────────────
 * Retrieval practice — every session's detail field opens with a recall
 *   warm-up and closes with an exit quiz, forcing active memory retrieval
 *   rather than passive re-reading.
 *
 * Spacing — each approach plan budgets a "Spaced review" phase (recovery
 *   sessions) and distributes them throughout the calendar. Session details
 *   explicitly cue students to the 1 → 3 → 7 → 14 day recall intervals.
 *
 * Interleaving — a weighted round-robin rotates subjects across study days.
 *   A day holds at most two subjects (MAX_SUBJECTS_PER_DAY), each subject's
 *   blocks grouped together to keep context switches down. The Lernphase can
 *   open with a few single-subject focus days per subject (lernphaseStart).
 *
 * Cheatsheets — per the subject's cheatsheet answer: built inside theory
 *   sessions with cumulative milestones ("gradual"), written in dedicated
 *   late sessions plus a final review ("end"), or briefly re-read
 *   ("existing"). The time comes out of the subject's study, never on top.
 *
 * Exam practice — the student says how many past/mock exams are available;
 *   planMocks decides how many to plan (grade gap, confidence, strategy, time
 *   left, latest mock result) and keeps the rest in reserve. Planned mocks are
 *   spread over the final stretch before the exam, last exactly as long as
 *   the real exam, and are each followed by a "Mock Exam Review" whose length
 *   shrinks as the exam nears (REVIEW_DURATION_RULE). Only planned mocks and
 *   their reviews count towards the workload.
 *
 * Hard constraints — sessions only land on the selected weekdays, never on
 *   vacation or exam days, and never exceed the daily window
 *   (weeklyHours ÷ study days). The end of each study day is a
 *   "Buffer / Catch-up Time" block (DAILY_BUFFER) that is not focused study.
 *   Work that does not fit is reported in `warnings` and `feasibility`,
 *   never squeezed in.
 *
 * Daily template — each day starts at the user's start time (or now, today)
 *   and follows their rhythm (RHYTHMS): focused blocks separated by short
 *   breaks, with lunch and dinner at the block boundaries that fall in meal
 *   time (MEALS). Breaks extend the day; they never use study or buffer time.
 *   Blocks start at exact minutes and never overlap each other or the
 *   user's other calendar entries (`busy`).
 *
 * Hour formula
 * ─────────────
 *   required_hours = est_hours × (1.25 − 0.5 × confidence)
 *   confidence ∈ [0 (little) … 1 (very)] → multiplier ∈ [0.75 … 1.25]
 *   est_hours comes from a frozen weekly basis (workloadBasisWeeklyMinutes),
 *   so giving the plan more time later closes a shortfall instead of growing it.
 */

import { nextFreeStart, type Interval } from "./intervals";
import type { BlockActivity } from "./types";

export type SchedulerSessionType = "deep" | "intervals" | "tempo" | "recovery" | "exam" | "buffer" | "break";


export interface ScheduledSession {
  type: SchedulerSessionType;
  activity: BlockActivity;
  /** The academic subject; null for breaks and buffers, which belong to no subject. */
  subject: string | null;
  /** Cheatsheet milestone (cumulative %) this session should reach. */
  cheatsheetTarget?: number;
  /** Minutes of this session reserved for the cheatsheet — all of it for cheatsheet sessions, part of it in combined ones. */
  cheatsheetMinutes?: number;
  title: string;
  detail: string;
  scheduledAt: Date;
  plannedMinutes: number;
}

export interface SubjectConfig {
  name: string;
  examDate: string;
  examDuration: string;
  targetGrade: string;
  currentGrade: string;
  confidence: string;
  approach: string;
  customPhases: string[];
  /** Past/mock exams available — an upper bound, not a workload (see planMocks). */
  mockCount: string;
  allocation: number;
  materials: string[];
  cheatsheet: string;
  comments: string;
}

export interface PlanConfig {
  planName: string;
  weeklyHours: number;
  studyDays: string[];
  sessionLength: number;
  vacationRanges: { start: string; end: string }[];
  subjects: SubjectConfig[];
  /** First session start hour, 0–23. Set by the strategy agent; `startTime` wins when set. */
  preferredStartHour?: number;
  /** Daily start, "HH:MM". Defaults to 08:00. */
  startTime?: string;
  /** Daily structure. Older plans without one use `sessionLength` blocks with balanced breaks. */
  rhythm?: StudyRhythm;
  /** How the Lernphase begins. Defaults to "recommended". */
  lernphaseStart?: LernphaseStart;
  /** Focus days per subject when the Lernphase starts with focus days. Defaults to 3. */
  focusDays?: number;
  /** First day of the plan, "YYYY-MM-DD"; the workload and focus days count from here. Defaults to today. */
  planStart?: string;
  /** Focused weekly minutes the workload is sized from; frozen at first generation. */
  workloadBasisWeeklyMinutes?: number;
}

// ─── constants ───────────────────────────────────────────────────────────────

export type StudyRhythm = "balanced" | "sprint" | "deep";

/** "recommended": focus days for subjects needing theory revision; "focus": for all; "mixed": none. */
export type LernphaseStart = "recommended" | "focus" | "mixed";
export const DEFAULT_FOCUS_DAYS = 3;
/** The focus phase may use at most this share of any subject's study days. */
const FOCUS_MAX_SHARE = 0.4;
/** Distinct academic subjects allowed on one normal study day. */
export const MAX_SUBJECTS_PER_DAY = 2;

/**
 * Cheatsheet time per subject (a share of its study, within bounds), the
 * smallest useful slice of it, how long selecting and getting to know an
 * existing cheatsheet takes, and the final pass over a self-made one.
 */
const CHEATSHEET = {
  share: 0.08, minMinutes: 180, maxMinutes: 600,
  /** Preferred cheatsheet part of a combined session, and the least worth scheduling. */
  slot: 30, minSlot: 15,
  familiarize: { min: 60, max: 120 },
  finalize: { min: 30, max: 60 },
};

/** Default focused-block and short-break lengths per rhythm. Special blocks (mocks) keep their own length. */
export const RHYTHMS: Record<StudyRhythm, { label: string; blurb: string; block: number; shortBreak: number }> = {
  balanced: { label: "Balanced", blurb: "2-hour sessions with 30-minute breaks.", block: 120, shortBreak: 30 },
  sprint: { label: "Sprint", blurb: "90-minute sessions with 15-minute breaks.", block: 90, shortBreak: 15 },
  deep: { label: "Deep Work", blurb: "2.5-hour sessions with 30-minute breaks.", block: 150, shortBreak: 30 },
};

/**
 * Meals replace the short break at the first block boundary inside their
 * window. A boundary up to an hour before the window also counts when the
 * next block would run well into it, so long blocks don't skip the meal.
 */
export const MEALS = [
  { activity: "lunch", title: "Lunch", earliest: 12 * 60, latest: 14 * 60 + 30, minutes: 60 },
  { activity: "dinner", title: "Dinner", earliest: 18 * 60, latest: 20 * 60 + 30, minutes: 60 },
] as const;

export const DEFAULT_START_TIME = "08:00";
const DAY_END = 24 * 60;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const CONFIDENCE_SCORE: Record<string, number> = {
  very: 1.0,
  mostly: 0.67,
  some: 0.33,
  little: 0.0,
};

/** Reserved at the end of every study day; capped so short days keep most of their time. */
export const DAILY_BUFFER = { minutes: 90, maxShare: 0.25 };

/**
 * Mock exam review length as a share of the mock's duration, by how far into
 * the preparation period (0 = today, 1 = exam day) the mock takes place.
 * Shares must not increase from stage to stage.
 */
export const REVIEW_DURATION_RULE = {
  minMinutes: 60,
  roundTo: 15,
  stages: [
    { until: 0.5, share: 0.75 },      // early: long, thorough review
    { until: 0.8, share: 0.5 },       // middle
    { until: Infinity, share: 0.33 }, // late: short, targeted review
  ],
};

/** Mock exams are spread over this final share of each subject's study days. */
const MOCK_WINDOW_SHARE = 0.6;

/**
 * How many mocks are worth planning. A subject starts from its strategy's
 * base and adds practice for a larger grade gap or low confidence; mocks and
 * their reviews may take at most `maxTimeShare` of the subject's study time,
 * and need `daysPerMock` study days each so there is time to act on a review.
 */
export const MOCK_PLANNING = {
  base: { exam: 3, balanced: 2, foundation: 2, custom: 1 } as Record<string, number>,
  /** Custom plans that include the "Mock exams" phase. */
  customWithMocks: 3,
  /** Grade gap (target − current estimate, Swiss 1–6 scale) → extra mocks. */
  gapSteps: [{ gap: 1.5, extra: 2 }, { gap: 0.75, extra: 1 }],
  confidence: { little: 1, some: 0, mostly: 0, very: -1 } as Record<string, number>,
  maxTimeShare: 0.3,
  daysPerMock: 3,
};
/** Only used for legacy configs without an exam duration. */
const FALLBACK_EXAM_MINUTES = 180;
/** Shortest block worth scheduling; shorter leftovers extend the previous session. */
const MIN_SESSION_MINUTES = 30;
/** Shortfalls below this are rounding noise, not a reason to warn. */
const SHORTFALL_THRESHOLD_MIN = 60;
/** Upper end of the onboarding's weekly-hours slider. */
const MAX_WEEKLY_HOURS = 70;

// ─── phase definitions ───────────────────────────────────────────────────────

type PhaseSpec = { name: string; fraction: number; type: SchedulerSessionType };

const APPROACH_PHASES: Record<string, PhaseSpec[]> = {
  foundation: [
    { name: "Theory recap",       fraction: 0.28, type: "deep"      },
    { name: "Exercises",          fraction: 0.24, type: "intervals" },
    { name: "Spaced review",      fraction: 0.12, type: "recovery"  },
    { name: "Past-exam practice", fraction: 0.22, type: "tempo"     },
    { name: "Final revision",     fraction: 0.14, type: "recovery"  },
  ],
  balanced: [
    { name: "Theory recap",       fraction: 0.18, type: "deep"      },
    { name: "Exercises",          fraction: 0.20, type: "intervals" },
    { name: "Spaced review",      fraction: 0.12, type: "recovery"  },
    { name: "Past-exam practice", fraction: 0.36, type: "tempo"     },
    { name: "Final revision",     fraction: 0.14, type: "recovery"  },
  ],
  exam: [
    { name: "Spaced review",      fraction: 0.10, type: "recovery"  },
    { name: "Past-exam practice", fraction: 0.50, type: "tempo"     },
    { name: "Timed practice",     fraction: 0.25, type: "tempo"     },
    { name: "Final revision",     fraction: 0.15, type: "recovery"  },
  ],
};

const CUSTOM_PHASE_TYPE: Record<string, SchedulerSessionType> = {
  "Theory recap":           "deep",
  "Semester exercises":     "intervals",
  "Iterative exam solving": "tempo",
  "Full exam solving":      "tempo",
  "Timed exam solving":     "tempo",
  "Final revision":         "recovery",
};

// Detail strings are kept ≤ 500 chars for the API constraint.
const PHASE_DETAIL: Record<string, string> = {
  "Theory recap":
    "Warm-up (5 min): Without notes, write down everything you recall about today's topic. " +
    "Main: Work actively — read a section, cover it, then recall aloud before moving on. " +
    "Exit quiz (5 min): Name 3 key concepts and explain each without looking.",

  "Exercises":
    "Warm-up (5 min): Which problem type from last session felt hardest? Sketch its approach. " +
    "Main: Attempt each problem independently before checking solutions (Pomodoro: 25 min on / 5 min off). " +
    "Exit (5 min): Solve one representative problem entirely from memory.",

  "Spaced review":
    "Spaced recall (target intervals: day 1 → 3 → 7 → 14 after initial study). " +
    "Cover your summary — for each section, recall key points before checking. " +
    "Solve 2–3 problems without aids. Note gaps and update your summary.",

  "Past-exam practice":
    "Warm-up (5 min): Before opening the paper, list the main topics you expect. " +
    "Main: Attempt each question without aids; check solutions only after each one. " +
    "Exit (5 min): Explain your biggest error in plain language — what did you misunderstand?",

  "Timed practice":
    "Recall warm-up (2 min): write key formulas from memory. " +
    "Strict timing, no unapproved aids. Work completely uninterrupted. " +
    "Debrief immediately: score yourself and log weak topics for final revision.",

  "Final revision":
    "Low-intensity recovery session. Read your summary — cover each section and recall before checking. " +
    "Focus on weak spots identified from past-exam work. Finalise your cheatsheet if needed. " +
    "Aim for calm confidence, not new content.",

  "Mock exam":
    "Full exam conditions: strict timing, realistic environment. " +
    "Recall warm-up (2 min): write key formulas/definitions from memory. " +
    "Complete the paper uninterrupted. Mark it immediately after. " +
    "Log every error and its underlying topic gap.",

  "Mock exam review":
    "Go through the marked mock question by question. Classify each error " +
    "(concept gap, careless slip, time pressure) and redo the problem without the solution. " +
    "Add weak topics to your final-revision list and update your cheatsheet.",

  "Buffer":
    "Unplanned time to catch up on anything that ran over, or to rest. " +
    "Not counted as focused study.",

  "Break":
    "Step away from your desk: move, drink water, rest your eyes. No screens if you can.",

  "Meal":
    "Proper meal break away from your study place. Not counted as study time.",

  "Cheatsheet final":
    "Finalize your cheatsheet — reach 100%. Check it against two past exams: is every formula you needed on it? " +
    "Cut what you never used, fix anything unclear, and make the layout quick to scan.",

  "Cheatsheet existing":
    "Compare the available cheatsheets and pick the one that fits this exam. Review its contents and organization, " +
    "note missing information or important sections to add, and learn where everything is — " +
    "then use it on one past-exam problem so you find things fast under time pressure.",
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

function buildVacationSet(ranges: { start: string; end: string }[]): Set<string> {
  const set = new Set<string>();
  for (const { start, end } of ranges) {
    if (!start || !end) continue;
    const from = new Date(start + "T00:00:00");
    const to = new Date(end + "T00:00:00");
    const cur = new Date(from);
    while (cur <= to) {
      set.add(toDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  return set;
}

function atMinute(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

/** "HH:MM" → minutes after midnight, or null when malformed. */
export function parseTime(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null;
}

/** Block and break lengths for a config, including legacy plans without a rhythm. */
export function rhythmOf(config: Pick<PlanConfig, "rhythm" | "sessionLength">) {
  return config.rhythm
    ? RHYTHMS[config.rhythm]
    : { ...RHYTHMS.balanced, block: config.sessionLength };
}

/** First minute of the study day. */
export function dayStartMinutes(config: Pick<PlanConfig, "startTime" | "preferredStartHour">): number {
  return parseTime(config.startTime)
    ?? (config.preferredStartHour !== undefined ? config.preferredStartHour * 60 : parseTime(DEFAULT_START_TIME)!);
}

export interface DaySegment {
  activity: BlockActivity;
  start: number;
  minutes: number;
  /** Index into the laid-out items, for study blocks. */
  item?: number;
}

/** One focused block to lay out; standalone blocks (mocks, reviews) always get breaks around them. */
export type DayItem = { minutes: number; standalone?: boolean };

/**
 * Lays out one day: `items` (focused work, in order) from `start`. Items run
 * back to back while they fit in one rhythm block; between blocks comes a
 * short break or meal, and the buffer follows the last one.
 * Nothing overlaps `busy` (minutes of this day) or runs past midnight; items
 * that don't fit are left out (see `placed`). With `shrinkLast`, the first
 * item that doesn't fit is shortened instead, if at least MIN_SESSION_MINUTES remain.
 */
export function layoutDay(
  start: number,
  items: DayItem[],
  { shortBreak, block }: { shortBreak: number; block: number },
  bufferMin: number,
  busy: Interval[] = [],
  { shrinkLast = false }: { shrinkLast?: boolean } = {},
): { segments: DaySegment[]; placed: number[]; end: number } {
  const segments: DaySegment[] = [];
  const placed: number[] = [];
  const meals = new Set<string>();
  let t = start;
  /** Focused minutes in the current block. */
  let blockUsed = 0;

  for (let k = 0; k < items.length; k++) {
    let at = t;
    const newBlock = items[k].standalone || items[k - 1]?.standalone || blockUsed + items[k].minutes > block;
    if (placed.length > 0 && newBlock) {
      blockUsed = 0;
      // A meal if this boundary falls in (or just before) meal time, else a short break.
      const meal = MEALS.find((m) =>
        !meals.has(m.activity) && at <= m.latest &&
        (at >= m.earliest || (at >= m.earliest - 60 && at + items[k].minutes > m.earliest + 30)));
      const pause = meal
        ? { activity: meal.activity as BlockActivity, minutes: meal.minutes }
        : { activity: "short_break" as BlockActivity, minutes: shortBreak };
      const pauseAt = nextFreeStart(at, pause.minutes, busy);
      if (pauseAt + pause.minutes + items[k].minutes + bufferMin > DAY_END && !shrinkLast) break;
      if (meal) meals.add(meal.activity);
      segments.push({ activity: pause.activity, start: pauseAt, minutes: pause.minutes });
      at = pauseAt + pause.minutes;
    }

    let minutes = items[k].minutes;
    at = nextFreeStart(at, minutes, busy);
    if (at + minutes + bufferMin > DAY_END) {
      minutes = shrinkLast ? DAY_END - bufferMin - at : 0;
      if (minutes < MIN_SESSION_MINUTES) {
        // Don't leave a break dangling after the last block.
        if (segments.length > 0 && segments[segments.length - 1].item === undefined) segments.pop();
        break;
      }
    }
    segments.push({ activity: "study", start: at, minutes, item: k });
    placed.push(minutes);
    blockUsed += minutes;
    t = at + minutes;
    if (minutes < items[k].minutes) break;
  }

  if (placed.length > 0 && bufferMin > 0) {
    const at = nextFreeStart(t, bufferMin, busy);
    if (at + bufferMin <= DAY_END) {
      segments.push({ activity: "buffer", start: at, minutes: bufferMin });
      t = at + bufferMin;
    }
  }
  return { segments, placed, end: t };
}

/** Splits `minutes` of study into rhythm-length blocks, the last one shorter. */
function standardBlocks(minutes: number, block: number): DayItem[] {
  const blocks: number[] = [];
  for (let left = minutes; left > 0; left -= block) blocks.push(Math.min(block, left));
  // A sliver too short to be a block joins the previous one.
  if (blocks.length > 1 && blocks[blocks.length - 1] < MIN_SESSION_MINUTES) {
    blocks[blocks.length - 2] += blocks.pop()!;
  }
  // Each is a block of its own, even where two would fit the rhythm's length.
  return blocks.map((m) => ({ minutes: m, standalone: true }));
}

/** The standard day for a start time, rhythm and daily hours — for previews and tests. */
export function previewDay(config: Pick<PlanConfig, "weeklyHours" | "studyDays" | "startTime" | "preferredStartHour" | "rhythm" | "sessionLength">) {
  const window = dailyWindowMinutes(config);
  const buffer = dailyBufferMinutes(window);
  const rhythm = rhythmOf(config);
  return layoutDay(dayStartMinutes(config), standardBlocks(window - buffer, rhythm.block), rhythm, buffer, [], { shrinkLast: true });
}

/** Length of one study day's window: the weekly hours spread over the study days. */
export function dailyWindowMinutes(config: Pick<PlanConfig, "weeklyHours" | "studyDays">): number {
  return config.studyDays.length ? Math.round((config.weeklyHours * 60) / config.studyDays.length) : 0;
}

/** Buffer reserved inside a daily window of `windowMinutes`. */
export function dailyBufferMinutes(windowMinutes: number): number {
  const cap = Math.floor((windowMinutes * DAILY_BUFFER.maxShare) / 15) * 15;
  return Math.max(0, Math.min(DAILY_BUFFER.minutes, cap));
}

/** A subject's mock exams: what exists, what's done, what's planned, what's held back. */
export interface MockPlan {
  available: number;
  completed: number;
  /** Still to be scheduled. */
  planned: number;
  /** Available but not planned — can be added later if results call for more practice. */
  reserve: number;
  /** Why this many, in plain words. */
  reason: string;
}

/** Expected review length for the `i`-th of `n` mocks spread over the final stretch. */
function expectedReview(mockMinutes: number, i: number, n: number): number {
  const progress = n <= 1 ? 1 : 1 - MOCK_WINDOW_SHARE + (MOCK_WINDOW_SHARE * i) / (n - 1);
  return mockReviewMinutes(mockMinutes, progress);
}

/** Minutes the first `n` remaining mocks take, reviews included. */
export function mockWorkload(mockMinutes: number, n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += mockMinutes + expectedReview(mockMinutes, i, n);
  return total;
}

/**
 * Decides how many of the available mocks to plan. The available number is
 * only an upper bound: practice is planned for what the student needs and can
 * fit, and the rest stays in reserve. Re-run with a newer `latestMockGrade`
 * or more `completed` mocks and the plan adapts.
 */
export function planMocks(input: {
  available: number;
  completed: number;
  currentGrade: number;
  targetGrade: number;
  /** Latest logged mock/past-exam grade, if any — a better estimate than the self-assessment. */
  latestMockGrade?: number;
  confidence: string;
  approach: string;
  customPhases: string[];
  /** Study minutes the subject still has before its exam. */
  studyMinutes: number;
  /** Study days left before the exam. */
  studyDays: number;
  mockMinutes: number;
}): MockPlan {
  const { available, completed, mockMinutes } = input;
  const left = Math.max(0, available - completed);
  const done = (planned: number, reason: string): MockPlan =>
    ({ available, completed, planned, reserve: left - planned, reason });
  if (left === 0) return done(0, available === 0 ? "No past or mock exams available." : "All available mocks are done.");

  const P = MOCK_PLANNING;
  const estimate = input.latestMockGrade ?? input.currentGrade;
  const gap = (input.targetGrade || 0) - (estimate || 0);
  const reasons: string[] = [];

  let wanted: number;
  if (input.latestMockGrade !== undefined && gap <= 0) {
    // Already at the target: one more mock as a final check.
    wanted = 1;
    reasons.push(`your latest mock (${input.latestMockGrade}) already meets your target, so one final check`);
  } else {
    const base = input.approach === "custom"
      ? (input.customPhases.includes("Mock exams") ? P.customWithMocks : P.base.custom)
      : (P.base[input.approach] ?? P.base.balanced);
    const gapExtra = P.gapSteps.find((step) => gap >= step.gap)?.extra ?? (gap <= 0 ? -1 : 0);
    const confidenceExtra = P.confidence[input.confidence] ?? 0;
    const total = Math.max(1, base + gapExtra + confidenceExtra);
    wanted = Math.max(0, total - completed);
    reasons.push(`${total} suits your strategy, a grade gap of ${Math.round(gap * 100) / 100} and your confidence`);
    if (completed > 0) reasons.push(`${completed} already done`);
  }

  // Time: mocks and reviews may take at most a share of the subject's study time,
  // and each needs a few study days to act on its review.
  let byTime = 0;
  while (byTime < left && mockWorkload(mockMinutes, byTime + 1) <= P.maxTimeShare * input.studyMinutes) byTime++;
  const bySpacing = Math.max(input.studyDays > 0 ? 1 : 0, Math.floor(input.studyDays / P.daysPerMock));

  let planned = Math.min(wanted, left);
  if (planned > byTime || planned > bySpacing) {
    planned = Math.min(planned, byTime, bySpacing);
    reasons.push("limited by the time left before the exam");
  }
  return done(planned, `${planned} of ${available} planned: ${reasons.join("; ")}.`);
}

/** Review length for a mock of `mockMinutes` held at `progress` (0–1) through preparation. */
export function mockReviewMinutes(mockMinutes: number, progress: number): number {
  const { stages, roundTo, minMinutes } = REVIEW_DURATION_RULE;
  const stage = stages.find((st) => progress < st.until) ?? stages[stages.length - 1];
  const minutes = Math.round((mockMinutes * stage.share) / roundTo) * roundTo;
  return Math.max(minMinutes, minutes);
}

// ─── session-queue builder ────────────────────────────────────────────────────

/**
 * A block waiting to be placed. Not stored: `phase` is the study phase it
 * belongs to; `cheat` is how many of its minutes go to the cheatsheet and
 * what kind of cheatsheet work it is (milestones are set once placed).
 */
type QueueItem = Omit<ScheduledSession, "scheduledAt"> & {
  phase?: string;
  cheat?: { minutes: number; kind: "combined" | "creation" | "catchup" | "final" | "existing" };
};

function buildPhaseQueue(
  subjectName: string,
  totalMinutes: number,
  approach: string,
  customPhases: string[],
  sessionLength: number,
): QueueItem[] {
  const phases: PhaseSpec[] =
    approach === "custom" && customPhases.length > 0
      ? buildCustomPhases(customPhases)
      : (APPROACH_PHASES[approach] ?? APPROACH_PHASES.balanced);

  const queue: QueueItem[] = [];
  for (const { name, fraction, type } of phases) {
    const count = Math.max(1, Math.round((fraction * totalMinutes) / sessionLength));
    const detail = PHASE_DETAIL[name] ?? PHASE_DETAIL["Theory recap"];
    for (let n = 1; n <= count; n++) {
      queue.push({ type, activity: "study", phase: name, subject: subjectName, title: `${subjectName} — ${name} ${n}`, detail, plannedMinutes: sessionLength });
    }
  }
  return queue;
}

function buildCustomPhases(selected: string[]): PhaseSpec[] {
  const nonMock = selected.filter((p) => p !== "Mock exams");
  const baseFrac = 0.85 / Math.max(1, nonMock.length);
  const phases: PhaseSpec[] = nonMock.map((p) => ({
    name: p,
    fraction: baseFrac,
    type: CUSTOM_PHASE_TYPE[p] ?? "deep",
  }));
  phases.push({ name: "Spaced review", fraction: 0.15, type: "recovery" });
  return phases;
}

// ─── cheatsheet planning ─────────────────────────────────────────────────────

/** "none" | "existing" | "gradual" | "end" — the onboarding's cheatsheet answer. */
export type CheatsheetMode = "none" | "existing" | "gradual" | "end";

/** Cheatsheet time for a subject: a share of its regular study, within sensible bounds. */
export function cheatsheetBudgetMinutes(regularMinutes: number): number {
  const minutes = Math.round((regularMinutes * CHEATSHEET.share) / 15) * 15;
  return Math.min(CHEATSHEET.maxMinutes, Math.max(CHEATSHEET.minMinutes, minutes));
}

/**
 * Cumulative cheatsheet milestones (in %) for sessions that put `minutes` of
 * work into it, in order, taking it from `from`% to 100%:
 * five equal sessions from 0 give 20, 40, 60, 80, 100.
 */
export function cheatsheetMilestones(minutes: number[], from = 0): number[] {
  const total = minutes.reduce((t, m) => t + m, 0);
  let done = 0;
  return minutes.map((m, k) => {
    done += m;
    return k === minutes.length - 1 ? 100 : Math.round(from + ((100 - from) * done) / total);
  });
}

/** Index after which `share` of the queue's minutes have passed. */
function queueIndexAt(queue: QueueItem[], share: number): number {
  const total = queue.reduce((t, q) => t + q.plannedMinutes, 0);
  let acc = 0;
  for (let i = 0; i < queue.length; i++) {
    acc += queue[i].plannedMinutes;
    if (acc >= total * share) return i + 1;
  }
  return queue.length;
}

/** Where late cheatsheet sessions go in a queue: before final revision, else at 80% of the work. */
function lateInsertIndex(queue: QueueItem[]): number {
  const finalRevision = queue.findIndex((q) => q.phase === "Final revision");
  return finalRevision > 0 ? finalRevision : queueIndexAt(queue, 0.8);
}

/** Minutes for selecting and getting to know an existing cheatsheet: 1–2 h, more for bigger subjects. */
export function familiarizeMinutes(budget: number): number {
  const { min, max } = CHEATSHEET.familiarize;
  return Math.min(max, Math.max(min, Math.round(budget / 4 / 15) * 15));
}

/** Minutes for the final pass over a self-made cheatsheet. */
function finalizeMinutes(remaining: number): number {
  const { min, max } = CHEATSHEET.finalize;
  return Math.min(max, Math.max(min, Math.round(remaining / 8 / 15) * 15));
}

/**
 * Minutes of dedicated cheatsheet sessions (beyond what combined sessions
 * hold) — taken out of the regular study before the queue is built, so
 * nothing is counted twice.
 */
export function dedicatedCheatsheetMinutes(mode: CheatsheetMode, budget: number, progress: number): number {
  if (mode === "none" || progress >= 100) return 0;
  const remaining = Math.round((budget * (100 - progress)) / 100);
  if (mode === "existing") return familiarizeMinutes(budget);
  if (mode === "end") return remaining;
  return finalizeMinutes(remaining);
}

const cheatsheetItem = (subject: string, title: string, minutes: number, kind: NonNullable<QueueItem["cheat"]>["kind"]): QueueItem => ({
  type: kind === "creation" || kind === "catchup" ? "deep" : "recovery",
  activity: "cheatsheet",
  subject,
  title: `${subject} — ${title}`,
  detail: "",
  plannedMinutes: minutes,
  cheat: { minutes, kind },
});

/**
 * Adds the subject's cheatsheet work to its queue. Dedicated sessions were
 * already taken out of the study the queue was sized from, and combined
 * sessions only re-label time inside existing ones — so cheatsheet time is
 * never counted twice. `progress` is how far the cheatsheet actually is (0–100).
 */
function planCheatsheet(
  queue: QueueItem[],
  subject: string,
  mode: CheatsheetMode,
  budget: number,
  progress: number,
  sessionLength: number,
  /** Study phases the subject's strategy has (before completed work came off the queue). */
  strategyPhases: Set<string | undefined>,
): QueueItem[] {
  if (mode === "none" || progress >= 100) return queue;
  const remaining = Math.round((budget * (100 - progress)) / 100);

  // Existing: pick one and get to know it, early on — no creation work.
  if (mode === "existing") {
    const item = cheatsheetItem(subject, "Cheatsheet Selection & Familiarization", familiarizeMinutes(budget), "existing");
    queue.splice(queueIndexAt(queue, 0.1), 0, item);
    return queue;
  }

  // End: dedicated creation sessions late in the preparation, then a finalization.
  if (mode === "end") {
    const finalize = finalizeMinutes(remaining);
    const blocks: number[] = [];
    for (let left = remaining - finalize; left >= MIN_SESSION_MINUTES; left -= sessionLength) blocks.push(Math.min(sessionLength, left));
    queue.splice(lateInsertIndex(queue), 0,
      ...blocks.map((minutes, k) => cheatsheetItem(subject, `Cheatsheet Creation ${k + 1}`, minutes, "creation")),
      cheatsheetItem(subject, "Cheatsheet Finalization", finalize, "final"));
    return queue;
  }

  // Gradual: theory recap sessions reserve part of their time for the cheatsheet
  // (at most half), with a finalization before the exam.
  const finalize = finalizeMinutes(remaining);
  let combinedMinutes = remaining - finalize;
  // Strategies with theory build it there; others fall back to their review phases.
  // Once the theory phase is over, what's left becomes catch-up sessions instead.
  const hostPhase = ["Theory recap", "Spaced review", "Final revision"].find((p) => strategyPhases.has(p));
  const hosts = queue.map((q, i) => (q.phase === hostPhase ? i : -1)).filter((i) => i >= 0);
  const capacityOf = (i: number) => Math.floor(queue[i].plannedMinutes / 2);

  if (hosts.length > 0 && combinedMinutes >= CHEATSHEET.minSlot) {
    // About CHEATSHEET.slot minutes per session: fewer, evenly spread sessions rather than many tiny slices.
    const count = Math.max(1, Math.min(hosts.length, Math.floor(combinedMinutes / CHEATSHEET.slot)));
    const chosen = Array.from({ length: count }, (_, k) => hosts[Math.round(((k + 1) * hosts.length) / count) - 1]);
    const slot = Math.round(combinedMinutes / count / 5) * 5;
    const label = hostPhase === "Theory recap" ? "Theory Recap" : hostPhase!;
    for (const index of chosen) {
      const host = queue[index];
      const minutes = Math.min(slot, capacityOf(index));
      combinedMinutes -= minutes;
      // The topic number is the theory session's own, so it stays stable when the plan is regenerated.
      const [, topic = "1", cont = ""] = /(\d+)( \(cont\.\))?$/.exec(host.title) ?? [];
      queue[index] = {
        ...host,
        title: `${subject} — ${label} + Cheatsheet — Topic ${topic}${cont}`,
        cheat: { minutes, kind: "combined" },
      };
    }
  }

  // Behind on the cheatsheet (e.g. after reported progress), with too few theory
  // sessions left to hold it: the rest gets additional catch-up sessions. If the
  // days are full, that shows up as needing more time — it is never dropped.
  const catchUps: QueueItem[] = [];
  for (let left = combinedMinutes; left >= MIN_SESSION_MINUTES; left -= sessionLength) {
    catchUps.push(cheatsheetItem(subject, `Cheatsheet Catch-up ${catchUps.length + 1}`, Math.min(sessionLength, left), "catchup"));
  }

  queue.splice(lateInsertIndex(queue), 0, ...catchUps, cheatsheetItem(subject, "Cheatsheet Finalization", finalize, "final"));
  return queue;
}

/**
 * Sets each cheatsheet session's cumulative milestone once the schedule is
 * laid out — in the order the sessions actually happen, split pieces
 * included — and writes it into the session's description.
 */
function setCheatsheetMilestones(sessions: (ScheduledSession & { cheat?: QueueItem["cheat"] })[], from: Record<string, number>) {
  const bySubject = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (s.cheat && s.subject) bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s]);
  }
  for (const [subject, list] of bySubject) {
    const targets = cheatsheetMilestones(list.map((s) => s.cheat!.minutes), from[subject] ?? 0);
    list.forEach((s, k) => {
      const target = targets[k];
      const { minutes, kind } = s.cheat!;
      s.cheatsheetTarget = target;
      s.cheatsheetMinutes = Math.min(minutes, s.plannedMinutes);
      s.detail =
        kind === "combined"
          ? `Theory (~${s.plannedMinutes - s.cheatsheetMinutes} min): review today's topics actively, recall before you check. ` +
            `Cheatsheet (~${s.cheatsheetMinutes} min): add those topics — reach ${target}% of your cheatsheet (cumulative).`
          : kind === "creation" || kind === "catchup"
            ? `Write your cheatsheet from your summaries and past-exam errors — reach ${target}% (cumulative).`
            : PHASE_DETAIL[kind === "final" ? "Cheatsheet final" : "Cheatsheet existing"];
      delete s.cheat;
    });
  }
}

// ─── main export ─────────────────────────────────────────────────────────────

/** What a subject has already done in this plan — regenerating schedules only the rest. */
export interface SubjectProgress {
  /** Completed regular study minutes (not mocks, reviews or dedicated cheatsheet sessions). */
  studyMinutes: number;
  mocksDone: number;
  /** Highest cheatsheet milestone (%) among completed sessions. */
  cheatsheet: number;
  /** Latest logged mock/past-exam grade — re-plans how many mocks are needed. */
  latestMockGrade?: number;
}

export interface SubjectFeasibility {
  name: string;
  examDate: string;
  /** Approximate study time the plan aims for (hours formula + planned mocks + reviews). */
  requiredMinutes: number;
  scheduledMinutes: number;
  shortfallMinutes: number;
  /** Focused study time on days before this subject's exam — shared with the other subjects. */
  availableBeforeExamMinutes: number;
  mocks: MockPlan;
}

/** How the plan's workload compares with the time the user made available. */
export interface PlanFeasibility {
  dailyWindowMinutes: number;
  dayStartMinutes: number;
  dailyBufferMinutes: number;
  /** Focused study minutes before the last exam (buffers excluded). */
  availableMinutes: number;
  requiredMinutes: number;
  scheduledMinutes: number;
  /** Required work that didn't fit: overall + deadline shortfall. */
  shortfallMinutes: number;
  /** Required minus available, when the plan needs more hours than there are in total. */
  overallShortfallMinutes: number;
  /**
   * Work that doesn't fit although enough hours exist in total: it falls due
   * before its exam, when the days before are already full.
   */
  deadlineShortfallMinutes: number;
  /** The shortfall is big enough to tell the user. */
  needsMoreTime: boolean;
  /** Available time left empty because the workload doesn't need it. */
  unusedMinutes: number;
  /** Weeks from today to the last exam. */
  weeks: number;
  /** Sorted by shortfall, largest first. */
  subjects: SubjectFeasibility[];
  /** Concrete changes that would close the shortfall. */
  suggestions: string[];
  /** Changes the scheduler made to the user's preferences (e.g. fewer focus days), with reasons. */
  adjustments: string[];
}

export interface ScheduleResult {
  sessions: ScheduledSession[];
  /** Sessions per subject name (breaks and buffers excluded). */
  breakdown: Record<string, number>;
  firstDate: Date | null;
  lastDate: Date | null;
  /** Work that could not be placed without breaking the user's availability. */
  warnings: string[];
  feasibility: PlanFeasibility;
  /** Store as PlanConfig.workloadBasisWeeklyMinutes so later adjustments keep the same workload. */
  workloadBasisWeeklyMinutes: number;
  /** Store as PlanConfig.planStart: the day the workload is counted from. */
  planStart: string;
  /** Initial focus days: "YYYY-MM-DD" → subject. Stored so manual moves respect them. */
  focusDates: Record<string, string>;
}

type DayBlock = { item: QueueItem };
type DayPlan = {
  date: Date;
  key: string;
  /** Minute of the day the first block starts. */
  start: number;
  /** Focused minutes that fit on this day, around breaks and `busy`. */
  capacity: number;
  /** The user's other calendar entries on this day, in minutes of the day. */
  busy: Interval[];
  blocks: DayBlock[];
  /** Focused minutes taken by blocks. */
  used: number;
  /** Subjects with academic work on this day (at most MAX_SUBJECTS_PER_DAY). */
  subjects: Set<string>;
  /** Index of the subject this initial focus day belongs to. */
  focus?: number;
};

export type GenerateOptions = {
  suggest?: boolean;
  /** The user's existing calendar entries (epoch ms) — new blocks never overlap them. */
  busy?: Interval[];
  /** Per subject name: what is already done, when regenerating an existing plan. */
  progress?: Record<string, SubjectProgress>;
};

/** Whether a subject starts the Lernphase with focus days. */
export function wantsFocusDays(mode: LernphaseStart, subject: Pick<SubjectConfig, "approach" | "confidence">): boolean {
  if (mode === "mixed") return false;
  if (mode === "focus") return true;
  // Recommended: subjects that need substantial theory revision.
  return subject.approach === "foundation"
    || (subject.approach === "balanced" && (subject.confidence === "little" || subject.confidence === "some"));
}

export function generateStudyPlan(
  config: PlanConfig,
  now: Date = new Date(),
  options: GenerateOptions = {},
): ScheduleResult {
  const { suggest = true, busy = [], progress = {} } = options;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const planStart = config.planStart && config.planStart < toDateKey(today) ? config.planStart : toDateKey(today);
  const planStartDate = new Date(planStart + "T00:00:00");

  const warnings: string[] = [];
  const adjustments: string[] = [];
  const rhythm = rhythmOf(config);
  // Regular sessions are one rhythm block long.
  const sessionLength = rhythm.block;
  const startMin = dayStartMinutes(config);

  // ── 1. Daily hours: weekly hours spread over the study days ──────────────
  // The daily hours are focused study + buffer; breaks and meals come on top.

  const windowMin = dailyWindowMinutes(config);
  const bufferMin = dailyBufferMinutes(windowMin);
  /** Focused study minutes on a full study day. */
  const capacity = Math.max(0, windowMin - bufferMin);
  const fullDayBlocks = standardBlocks(capacity, sessionLength);
  const fits = layoutDay(startMin, fullDayBlocks, rhythm, bufferMin, [], { shrinkLast: true });
  const fitCapacity = fits.placed.reduce((t, m) => t + m, 0);
  if (fitCapacity < capacity) {
    warnings.push(
      `${formatHours(capacity)} of study plus breaks doesn't fit between ${formatClock(startMin)} and midnight — ` +
      `days hold ${formatHours(fitCapacity)}. Start earlier or spread your hours over more days.`,
    );
  }
  // Workload is sized from a frozen basis, so adding hours later actually closes a gap.
  const basisWeekly = config.workloadBasisWeeklyMinutes ?? capacity * config.studyDays.length;

  // ── 2. Process subjects ──────────────────────────────────────────────────

  type Subject = {
    name: string;
    examDate: Date;
    examKey: string;
    mockMinutes: number;
    /** Mocks to schedule (planMocks decides; see `mocks`). */
    mockCount: number;
    /** Mocks already taken; new ones are numbered after them. */
    mocksDone: number;
    mocks: MockPlan;
    allocation: number;
    multiplier: number;
    regularQueue: QueueItem[];
    /** Remainders of sessions cut at a day's end; they fill later days' short last slot. */
    tailQueue: QueueItem[];
    /** Required work that was dropped (unplaced mocks/reviews, trimmed slivers). */
    lostMinutes: number;
  };

  const subjects: Subject[] = config.subjects.map((s) => {
    const examDate = new Date(s.examDate + "T12:00:00");

    const confScore = CONFIDENCE_SCORE[s.confidence] ?? 0.5;
    const gradeGap = Math.max(0, (Number(s.targetGrade) || 0) - (Number(s.currentGrade) || 0));
    const multiplier = 1.25 - 0.5 * confScore + 0.05 * gradeGap; // confidence + grade gap

    // Mock exams last exactly as long as the real exam.
    const mockMinutes = parseInt(s.examDuration) > 0 ? parseInt(s.examDuration) : FALLBACK_EXAM_MINUTES;
    const mocksDone = progress[s.name]?.mocksDone ?? 0;

    return {
      name: s.name,
      examDate,
      examKey: toDateKey(examDate),
      mockMinutes,
      // Decided once the subject's study time is known.
      mockCount: 0,
      mocksDone,
      mocks: { available: 0, completed: 0, planned: 0, reserve: 0, reason: "" },
      allocation: s.allocation,
      multiplier,
      regularQueue: [],
      tailQueue: [],
      lostMinutes: 0,
    };
  });

  // ── 3. Build calendar of available study days ────────────────────────────
  // Selected weekdays only; vacations and exam days are never study days.

  const studyDayNums = new Set(config.studyDays.map((d) => DAY_NAMES.indexOf(d)));
  const vacationSet = buildVacationSet(config.vacationRanges);
  const examKeys = new Set(subjects.map((s) => s.examKey));
  const maxExamDate = subjects.reduce(
    (max, s) => (s.examDate > max ? s.examDate : max),
    subjects[0]?.examDate ?? today,
  );
  const nowMinute = Math.ceil((now.getTime() - today.getTime()) / 60000);
  const todayKey = toDateKey(today);

  /** `busy` entries touching a day, in minutes of that day. */
  const busyOn = (day: Date): Interval[] => {
    const dayStart = day.getTime();
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    return busy
      .filter((b) => b.start < next.getTime() && b.end > dayStart)
      .map((b) => ({ start: Math.floor((b.start - dayStart) / 60000), end: Math.ceil((b.end - dayStart) / 60000) }));
  };

  const days: DayPlan[] = [];
  /** Selected weekdays from the plan start to each exam, vacations included — the workload basis. */
  const weekdaysBefore = subjects.map(() => 0);
  /** Study days of the plan that are already over — focus days count from the plan start. */
  let elapsedStudyDays = 0;
  const cur = new Date(planStartDate);
  while (cur <= maxExamDate) {
    const key = toDateKey(cur);
    if (studyDayNums.has(cur.getDay()) && !examKeys.has(key)) {
      subjects.forEach((s, i) => { if (key < s.examKey) weekdaysBefore[i]++; });
      if (!vacationSet.has(key)) {
        if (key < todayKey) {
          elapsedStudyDays++;
        } else {
          // Today starts now; every day works around the user's other entries.
          const start = key === todayKey ? Math.max(startMin, nowMinute) : startMin;
          const dayBusy = busyOn(cur);
          const { placed } = layoutDay(start, fullDayBlocks, rhythm, bufferMin, dayBusy, { shrinkLast: true });
          const dayCapacity = placed.reduce((t, m) => t + m, 0);
          if (dayCapacity >= MIN_SESSION_MINUTES) {
            days.push({ date: new Date(cur), key, start, capacity: dayCapacity, busy: dayBusy, blocks: [], used: 0, subjects: new Set() });
          }
        }
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (subjects.length > 0 && days.length === 0) {
    warnings.push("There are no available study days before your exams — check your study days and vacations.");
  }

  /** Index of each subject's last study day before its exam (-1 if none). */
  const lastIdxOf = subjects.map((s) => {
    let last = -1;
    days.forEach((d, i) => { if (d.key < s.examKey) last = i; });
    return last;
  });

  // Size each subject's workload: its share of the basis over its weekdays, scaled by
  // the hours formula. Work already done comes off the front of the queue.
  const basisDaily = config.studyDays.length ? basisWeekly / config.studyDays.length : 0;
  config.subjects.forEach((cfg, si) => {
    const s = subjects[si];
    const done = progress[s.name];
    const estMinutes = weekdaysBefore[si] * basisDaily * (s.allocation / 100);
    const subjectMinutes = Math.round(estMinutes * s.multiplier);

    // Available mocks are an upper bound: plan what's worth it and fits; the rest is reserve.
    s.mocks = planMocks({
      available: Math.max(0, parseInt(cfg.mockCount) || 0),
      completed: s.mocksDone,
      currentGrade: Number(cfg.currentGrade) || 0,
      targetGrade: Number(cfg.targetGrade) || 0,
      latestMockGrade: done?.latestMockGrade,
      confidence: cfg.confidence,
      approach: cfg.approach,
      customPhases: cfg.customPhases,
      studyMinutes: Math.max(0, subjectMinutes - (done?.studyMinutes ?? 0)),
      studyDays: lastIdxOf[si] + 1,
      mockMinutes: s.mockMinutes,
    });
    s.mockCount = s.mocks.planned;
    // Only mocks actually done or planned count, with realistic review times — never the reserve.
    const mockBudget = mockWorkload(s.mockMinutes, s.mocksDone + s.mockCount);
    const regularMin = Math.max(sessionLength, subjectMinutes - mockBudget);
    const mode = (cfg.cheatsheet || "none") as CheatsheetMode;
    // Dedicated cheatsheet time comes out of the regular study, never on top of it.
    const budget = mode === "none" ? 0 : cheatsheetBudgetMinutes(regularMin);
    const dedicated = dedicatedCheatsheetMinutes(mode, budget, done?.cheatsheet ?? 0);

    const queue = buildPhaseQueue(s.name, Math.max(sessionLength, regularMin - dedicated), cfg.approach, cfg.customPhases, sessionLength);
    const strategyPhases = new Set(queue.map((q) => q.phase));
    let doneMinutes = done?.studyMinutes ?? 0;
    while (doneMinutes > 0 && queue.length > 0) {
      if (queue[0].plannedMinutes <= doneMinutes) {
        doneMinutes -= queue.shift()!.plannedMinutes;
      } else {
        const rest = queue[0].plannedMinutes - doneMinutes;
        queue[0] = { ...queue[0], title: `${queue[0].title} (cont.)`, plannedMinutes: rest };
        doneMinutes = 0;
      }
    }
    s.regularQueue = planCheatsheet(queue, s.name, mode, budget, done?.cheatsheet ?? 0, sessionLength, strategyPhases);
  });

  const free = (day: DayPlan) => day.capacity - day.used;
  const progressOf = (day: Date, s: Subject) => {
    const span = s.examDate.getTime() - planStartDate.getTime();
    return span > 0 ? Math.min(1, Math.max(0, (day.getTime() - planStartDate.getTime()) / span)) : 1;
  };

  // ── 4. Initial focus days ────────────────────────────────────────────────
  // The Lernphase can open with a few study days per subject on that subject
  // alone. They count study days from the plan start (so skip weekends and
  // vacations), happen once, and never take so long that a subject is left
  // without enough mixed days before its exam.

  const lernphaseStart = config.lernphaseStart ?? "recommended";
  const focusWanted = Math.max(0, Math.round(config.focusDays ?? DEFAULT_FOCUS_DAYS));
  if (focusWanted > 0) {
    const order = subjects
      .map((s, i) => ({ s, i, cfg: config.subjects[i] }))
      .filter(({ cfg }) => wantsFocusDays(lernphaseStart, cfg))
      .sort((a, b) => a.s.examKey.localeCompare(b.s.examKey) || b.s.allocation - a.s.allocation);
    // The whole focus phase may use at most FOCUS_MAX_SHARE of any subject's study days.
    const limit = Math.min(...subjects.map((_, i) => Math.floor(FOCUS_MAX_SHARE * (elapsedStudyDays + lastIdxOf[i] + 1))));
    let cursor = 0;
    for (const { s, i } of order) {
      const granted = Math.max(0, Math.min(focusWanted, limit - cursor));
      if (granted < focusWanted) {
        adjustments.push(granted === 0
          ? `${s.name} starts without focus days — there isn't enough time before the exams for a longer single-subject start.`
          : `${s.name} gets ${granted} focus day${granted === 1 ? "" : "s"} instead of ${focusWanted}, so every subject keeps enough mixed study days before its exam.`);
      }
      for (let k = 0; k < granted; k++) {
        const d = cursor + k - elapsedStudyDays;
        if (d >= 0 && d < days.length) days[d].focus = i;
      }
      cursor += granted;
    }
  }

  /** At most MAX_SUBJECTS_PER_DAY subjects a day, and only the focus subject on a focus day. */
  const canTake = (day: DayPlan, si: number) => {
    if (day.focus !== undefined) return day.focus === si;
    return day.subjects.has(subjects[si].name) || day.subjects.size < MAX_SUBJECTS_PER_DAY;
  };
  const place = (day: DayPlan, item: QueueItem, front = false) => {
    if (front) day.blocks.unshift({ item });
    else day.blocks.push({ item });
    day.used += item.plannedMinutes;
    day.subjects.add(item.subject!);
  };

  // ── 5. Mock exams and their reviews (placed first: they have priority) ───

  subjects.forEach((s, si) => {
    const lastIdx = lastIdxOf[si];
    const available = lastIdx + 1;
    const n = s.mockCount;
    if (n === 0) return;

    const mockWindowStart = Math.max(0, Math.min(Math.floor(available * (1 - MOCK_WINDOW_SHARE)), available - n));
    const span = lastIdx - mockWindowStart;
    let prevIdx = -1;

    for (let m = 0; m < n; m++) {
      const number = s.mocksDone + m + 1;
      const target = n === 1 ? lastIdx : mockWindowStart + Math.round((m * span) / (n - 1));
      // Days after the previous mock, closest to the target first (earlier wins ties).
      const candidates: number[] = [];
      for (let d = prevIdx + 1; d <= lastIdx; d++) candidates.push(d);
      candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);

      const mock: QueueItem = {
        type: "tempo",
        activity: "mock_exam",
        subject: s.name,
        title: `${s.name} — Mock exam ${number}`,
        detail: PHASE_DETAIL["Mock exam"],
        plannedMinutes: s.mockMinutes,
      };

      let placedIdx = -1;
      for (const d of candidates) {
        const day = days[d];
        if (free(day) < s.mockMinutes || !canTake(day, si)) continue;

        const review: QueueItem = {
          type: "deep",
          activity: "mock_review",
          subject: s.name,
          title: `${s.name} — Mock Exam Review ${number}`,
          detail: PHASE_DETAIL["Mock exam review"],
          plannedMinutes: mockReviewMinutes(s.mockMinutes, progressOf(day.date, s)),
        };

        // Ideally straight after the mock (the layout puts a break between them).
        if (free(day) >= s.mockMinutes + review.plannedMinutes) {
          place(day, mock);
          place(day, review);
          placedIdx = d;
          break;
        }
        // Otherwise first thing in the next study window before the exam.
        let reviewIdx = -1;
        for (let j = d + 1; j <= lastIdx; j++) {
          if (free(days[j]) >= review.plannedMinutes && canTake(days[j], si)) { reviewIdx = j; break; }
        }
        if (reviewIdx === -1) continue;
        place(day, mock);
        place(days[reviewIdx], review, true);
        placedIdx = d;
        break;
      }

      if (placedIdx === -1) {
        // Mocks are optional practice: one that can't be placed goes back to the reserve.
        const back = n - m;
        s.mocks = {
          ...s.mocks,
          planned: s.mocks.planned - back,
          reserve: s.mocks.reserve + back,
          reason: `${s.mocks.reason} ${back} moved to the reserve: no room before the exam.`,
        };
        adjustments.push(`${s.name}: ${back} planned mock${back === 1 ? "" : "s"} moved to the reserve — there's no room for ${back === 1 ? "it" : "them"} before the exam.`);
        break;
      }
      prevIdx = placedIdx;
    }
  });

  // ── 6. Weighted round-robin over at most two subjects a day ──────────────
  // Days are filled minute by minute: the last session of a full day is
  // shortened to fit and its remainder continues on a later day.

  // credit[i] accumulates; subject with highest credit is picked next
  const credit = subjects.map(() => 0);
  const totalAlloc = subjects.reduce((sum, s) => sum + s.allocation, 0) || 100;
  const queueMinutes = (s: Subject) =>
    [...s.regularQueue, ...s.tailQueue].reduce((sum, q) => sum + q.plannedMinutes, 0);
  const hasWork = (s: Subject) => s.regularQueue.length > 0 || s.tailQueue.length > 0;

  /** Takes up to `room` minutes of the subject's next work; null if nothing worth a session fits. */
  function takeWork(s: Subject, room: number): QueueItem | null {
    // Whole sessions fill the day's full blocks; leftovers from earlier cuts
    // fill the short slot at its end, so the next day still starts on the template.
    const fromTail = s.tailQueue.length > 0
      && (s.regularQueue.length === 0 || room < s.regularQueue[0].plannedMinutes);
    const queue = fromTail ? s.tailQueue : s.regularQueue;
    const next = queue[0];
    let minutes = Math.min(next.plannedMinutes, room);
    // Leave a continuation long enough to be its own session.
    if (minutes < next.plannedMinutes && next.plannedMinutes - minutes < MIN_SESSION_MINUTES) {
      minutes = next.plannedMinutes - MIN_SESSION_MINUTES;
    }
    if (minutes < MIN_SESSION_MINUTES) return null;
    const rest = next.plannedMinutes - minutes;
    queue.shift();
    // Split pieces share the cheatsheet part in proportion.
    const cheatNow = next.cheat && { ...next.cheat, minutes: Math.round((next.cheat.minutes * minutes) / next.plannedMinutes) };
    if (rest > 0) {
      const title = next.title.endsWith(" (cont.)") ? next.title : `${next.title} (cont.)`;
      const cheatRest = next.cheat && { ...next.cheat, minutes: next.cheat.minutes - cheatNow!.minutes };
      s.tailQueue.unshift({ ...next, title, plannedMinutes: rest, cheat: cheatRest });
    }
    return { ...next, plannedMinutes: minutes, cheat: cheatNow };
  }

  days.forEach((day, di) => {
    const activeIdx = subjects
      .map((_, i) => i)
      .filter((i) => hasWork(subjects[i]) && di <= lastIdxOf[i] && canTake(day, i));
    if (activeIdx.length === 0) return;

    // Pace each subject's remaining work over its remaining days, in whole sessions,
    // but never leave more than the later days (already holding mocks) can take.
    // A focus day is the focus subject's whole day.
    const wanted = day.focus !== undefined ? free(day) : activeIdx.reduce((sum, i) => {
      const left = queueMinutes(subjects[i]);
      let laterFree = 0;
      for (let d = di + 1; d <= lastIdxOf[i]; d++) laterFree += free(days[d]);
      const perDay = Math.ceil(left / (lastIdxOf[i] - di + 1) / sessionLength) * sessionLength;
      return sum + Math.max(perDay, left - laterFree);
    }, 0);
    const fillsDay = wanted >= free(day);
    // On a full day the last session is cut to fit; otherwise `wanted` is only a target.
    let room = fillsDay ? free(day) : wanted;

    let prevIdx = -1;
    let lastBlock: { block: DayBlock; subject: number } | null = null;

    while (room >= MIN_SESSION_MINUTES) {
      // Only subjects this day can still take: a third subject never joins.
      const pickable = activeIdx.filter((i) => hasWork(subjects[i]) && canTake(day, i));
      if (pickable.length === 0) break;
      // Accumulate credit per slot for all active subjects
      for (const i of activeIdx) credit[i] += subjects[i].allocation;

      // Pick subject with highest credit (skip prevIdx to alternate if possible)
      let bestIdx = -1, bestCredit = -Infinity;
      for (const i of pickable) {
        if (i === prevIdx && pickable.length > 1) continue;
        if (credit[i] > bestCredit) { bestCredit = credit[i]; bestIdx = i; }
      }
      if (bestIdx === -1) break;

      const s = subjects[bestIdx];
      const item = takeWork(s, Math.min(room, free(day)));
      if (!item) break;
      place(day, item);
      room -= item.plannedMinutes;
      lastBlock = { block: day.blocks[day.blocks.length - 1], subject: bestIdx };

      credit[bestIdx] -= totalAlloc;
      prevIdx = bestIdx;
    }

    // A full day's last few minutes are too short for a session: extend the last one.
    const leftover = free(day);
    if (fillsDay && lastBlock && leftover > 0 && leftover < MIN_SESSION_MINUTES) {
      lastBlock.block.item.plannedMinutes += leftover;
      day.used += leftover;
      const q = subjects[lastBlock.subject].regularQueue;
      if (q.length > 0 && q[0].plannedMinutes - leftover >= MIN_SESSION_MINUTES) {
        q[0] = { ...q[0], plannedMinutes: q[0].plannedMinutes - leftover };
      }
    }
  });

  // Backfill: pacing can leave work over at the exam while earlier days still
  // have room. Place it in the latest such days that can take the subject, so
  // nothing is reported short while time is actually free.
  subjects.forEach((s, si) => {
    s.regularQueue.unshift(...s.tailQueue.splice(0));
    for (let d = lastIdxOf[si]; d >= 0 && hasWork(s); d--) {
      const day = days[d];
      while (hasWork(s) && free(day) >= MIN_SESSION_MINUTES && canTake(day, si)) {
        const item = takeWork(s, free(day));
        if (!item) break;
        place(day, item);
      }
      s.regularQueue.unshift(...s.tailQueue.splice(0));
    }
  });

  for (const s of subjects) {
    const left = queueMinutes(s);
    if (left === 0) continue;
    warnings.push(
      `${s.name}: about ${formatHours(left)} of study doesn't fit into your available time before the exam.`,
    );
  }

  // ── 7. Lay out each day on its template ──────────────────────────────────
  // Each subject's blocks stay together, to keep context switches down.

  const result: ScheduledSession[] = [];
  const PAUSE_TITLE: Partial<Record<BlockActivity, string>> = { short_break: "Break", lunch: "Lunch", dinner: "Dinner" };

  for (const day of days) {
    if (day.blocks.length === 0) continue;
    const order = [...new Set(day.blocks.map((b) => b.item.subject))];
    day.blocks = order.flatMap((subject) => day.blocks.filter((b) => b.item.subject === subject));

    const { segments, placed } = layoutDay(
      day.start,
      day.blocks.map((b) => ({ minutes: b.item.plannedMinutes, standalone: b.item.activity !== "study" })),
      rhythm,
      bufferMin,
      day.busy,
    );
    for (const seg of segments) {
      const scheduledAt = atMinute(day.date, seg.start);
      if (seg.item !== undefined) {
        const { phase: _phase, ...item } = day.blocks[seg.item].item;
        // A block extended to fill the day keeps its cheatsheet minutes.
        result.push({ ...item, scheduledAt, plannedMinutes: seg.minutes });
      } else if (seg.activity === "buffer") {
        result.push({
          type: "buffer",
          activity: "buffer",
          subject: null,
          title: "Buffer / Catch-up Time",
          detail: PHASE_DETAIL["Buffer"],
          scheduledAt,
          plannedMinutes: seg.minutes,
        });
      } else {
        result.push({
          type: "break",
          activity: seg.activity,
          subject: null,
          title: PAUSE_TITLE[seg.activity] ?? "Break",
          detail: PHASE_DETAIL[seg.activity === "short_break" ? "Break" : "Meal"],
          scheduledAt,
          plannedMinutes: seg.minutes,
        });
      }
    }

    // Capacity was sized for standard blocks; odd lengths can still run out of day.
    for (const block of day.blocks.slice(placed.length)) {
      const s = subjects.find((x) => x.name === block.item.subject);
      if (s) s.lostMinutes += block.item.plannedMinutes;
      warnings.push(`${block.item.title} (${formatHours(block.item.plannedMinutes)}) didn't fit into its day.`);
    }
  }

  // ── 8. Add one "exam" marker per subject on their exam date ──────────────
  // This makes the profile's "Exam countdowns" section work for custom subjects.
  for (const s of subjects) {
    const examAt = new Date(s.examDate);
    examAt.setHours(9, 0, 0, 0);
    result.push({
      type: "exam",
      activity: "exam",
      subject: s.name,
      title: `${s.name} — Exam`,
      detail: "Your scheduled exam. Good luck!",
      scheduledAt: examAt,
      plannedMinutes: s.mockMinutes,
    });
  }

  result.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  setCheatsheetMilestones(result, Object.fromEntries(subjects.map((s) => [s.name, progress[s.name]?.cheatsheet ?? 0])));

  // ── 9. Build result metadata ──────────────────────────────────────────────

  const breakdown: Record<string, number> = {};
  const scheduledBySubject = new Map<string, number>();
  for (const s of result) {
    if (s.subject === null) continue;
    breakdown[s.subject] = (breakdown[s.subject] ?? 0) + 1;
    if (s.type !== "exam") scheduledBySubject.set(s.subject, (scheduledBySubject.get(s.subject) ?? 0) + s.plannedMinutes);
  }
  const subjectFeasibility: SubjectFeasibility[] = subjects
    .map((s, si) => {
      const scheduledMinutes = scheduledBySubject.get(s.name) ?? 0;
      const shortfallMinutes = queueMinutes(s) + s.lostMinutes;
      return {
        name: s.name,
        examDate: s.examKey,
        requiredMinutes: scheduledMinutes + shortfallMinutes,
        scheduledMinutes,
        shortfallMinutes,
        availableBeforeExamMinutes: days.slice(0, lastIdxOf[si] + 1).reduce((t, d) => t + d.capacity, 0),
        mocks: s.mocks,
      };
    })
    .sort((a, b) => b.shortfallMinutes - a.shortfallMinutes);

  const sum = (f: (s: SubjectFeasibility) => number) => subjectFeasibility.reduce((t, s) => t + f(s), 0);
  const availableMinutes = days.reduce((t, d) => t + d.capacity, 0);
  const usedMinutes = days.reduce((t, d) => t + d.used, 0);
  const shortfallMinutes = sum((s) => s.shortfallMinutes);
  const requiredMinutes = sum((s) => s.requiredMinutes);
  // Overall: more work than hours. The rest of the shortfall is deadline-specific.
  const overallShortfallMinutes = Math.max(0, requiredMinutes - availableMinutes);
  const weeks = Math.max(1, (maxExamDate.getTime() - today.getTime()) / (7 * 86400000));

  return {
    sessions: result,
    breakdown,
    firstDate: result[0]?.scheduledAt ?? null,
    lastDate: result[result.length - 1]?.scheduledAt ?? null,
    warnings,
    feasibility: {
      dailyWindowMinutes: windowMin,
      dayStartMinutes: startMin,
      dailyBufferMinutes: bufferMin,
      availableMinutes,
      requiredMinutes,
      scheduledMinutes: sum((s) => s.scheduledMinutes),
      shortfallMinutes,
      overallShortfallMinutes,
      deadlineShortfallMinutes: Math.max(0, shortfallMinutes - overallShortfallMinutes),
      needsMoreTime: shortfallMinutes >= SHORTFALL_THRESHOLD_MIN,
      unusedMinutes: availableMinutes - usedMinutes,
      weeks,
      subjects: subjectFeasibility,
      suggestions: suggest && shortfallMinutes >= SHORTFALL_THRESHOLD_MIN
        ? buildSuggestions({ ...config, workloadBasisWeeklyMinutes: basisWeekly, planStart }, subjects, subjectFeasibility, now, options)
        : [],
      adjustments,
    },
    workloadBasisWeeklyMinutes: basisWeekly,
    planStart,
    focusDates: Object.fromEntries(days.filter((d) => d.focus !== undefined).map((d) => [d.key, subjects[d.focus!].name])),
  };
}

/** Concrete, checkable changes that would give the plan the time it needs. */
function buildSuggestions(
  config: PlanConfig,
  subjects: { name: string; examKey: string }[],
  feasibility: SubjectFeasibility[],
  now: Date,
  options: GenerateOptions,
): string[] {
  const suggestions: string[] = [];

  // Re-run the scheduler to find the smallest weekly increase that closes the gap.
  let extra = 0;
  for (let w = config.weeklyHours + 1; w <= MAX_WEEKLY_HOURS; w++) {
    const trial = generateStudyPlan({ ...config, weeklyHours: w }, now, { ...options, suggest: false });
    if (trial.feasibility.shortfallMinutes < SHORTFALL_THRESHOLD_MIN) { extra = w - config.weeklyHours; break; }
  }
  if (extra > 0) {
    suggestions.push(`Raise your weekly study time by ${extra} h (from ${config.weeklyHours} h to ${config.weeklyHours + extra} h) — that closes the gap.`);
  } else {
    suggestions.push(`Even ${MAX_WEEKLY_HOURS} h per week isn't enough for these goals — consider a lower target grade.`);
  }
  if (config.studyDays.length < 7) {
    suggestions.push("Add another study weekday together with the extra hours, to keep your days shorter.");
  }

  const lastExam = subjects.reduce((max, s) => (s.examKey > max ? s.examKey : max), "");
  const vacationDays = buildVacationSet(config.vacationRanges);
  const lostToVacation = [...vacationDays].filter((k) => {
    const d = new Date(k + "T00:00:00");
    return k < lastExam && config.studyDays.includes(DAY_NAMES[d.getDay()]);
  }).length;
  if (lostToVacation > 0) {
    suggestions.push(`Shorten your vacations — they remove ${lostToVacation} study day${lostToVacation === 1 ? "" : "s"} before your exams.`);
  }

  const top = feasibility[0];
  const topConfig = config.subjects.find((s) => s.name === top?.name);
  if (top && topConfig && Number(topConfig.targetGrade) > Number(topConfig.currentGrade)) {
    suggestions.push(`Lower your target grade for ${top.name} (currently ${topConfig.targetGrade}) — it has the largest gap.`);
  }
  if (subjects.length > 2) {
    suggestions.push("Each day holds at most two subjects — giving subjects with distant exams a smaller share frees up days for the urgent ones.");
  }
  return suggestions;
}
