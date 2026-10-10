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
 * Interleaving — a weighted round-robin assigns sessions to study days so
 *   that subjects alternate within each day; no two consecutive slots go to
 *   the same subject when an alternative exists.
 *
 * Exam practice — mock exams are spread over the final stretch before each
 *   subject's exam, last exactly as long as the real exam, and are each
 *   followed by a "Mock Exam Review" whose length shrinks as the exam nears
 *   (see REVIEW_DURATION_RULE). Mocks and reviews are placed before any
 *   regular session, so they win when time is short.
 *
 * Hard constraints — sessions only land on the selected weekdays, never on
 *   vacation or exam days, and never exceed the daily window
 *   (weeklyHours ÷ study days). The end of each study day is a
 *   "Buffer / Catch-up Time" block (DAILY_BUFFER) that is not focused study.
 *   Work that does not fit is reported in `warnings` and `feasibility`,
 *   never squeezed in.
 *
 * Exact times — a day is filled minute by minute: blocks run back to back
 *   from the start hour (or from now, today), the last session of a full day
 *   is shortened to fit, and the rest continues on a later day.
 *
 * Hour formula
 * ─────────────
 *   required_hours = est_hours × (1.25 − 0.5 × confidence)
 *   confidence ∈ [0 (little) … 1 (very)] → multiplier ∈ [0.75 … 1.25]
 *   est_hours comes from a frozen weekly basis (workloadBasisWeeklyMinutes),
 *   so giving the plan more time later closes a shortfall instead of growing it.
 */

export type SchedulerSessionType = "deep" | "intervals" | "tempo" | "recovery" | "exam" | "buffer";

export interface ScheduledSession {
  type: SchedulerSessionType;
  subject: string;
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
  /** First session start hour, 0–23. Defaults to 9 (09:00). Set by the strategy agent. */
  preferredStartHour?: number;
  /** Focused weekly minutes the workload is sized from; frozen at first generation. */
  workloadBasisWeeklyMinutes?: number;
}

// ─── constants ───────────────────────────────────────────────────────────────

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
const MOCK_REVIEW_BREAK_MIN = 15;
/** Only used for legacy configs without an exam duration. */
const FALLBACK_EXAM_MINUTES = 180;
const BUFFER_SUBJECT = "Buffer";
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

function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} h`;
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

/** Review length for a mock of `mockMinutes` held at `progress` (0–1) through preparation. */
export function mockReviewMinutes(mockMinutes: number, progress: number): number {
  const { stages, roundTo, minMinutes } = REVIEW_DURATION_RULE;
  const stage = stages.find((st) => progress < st.until) ?? stages[stages.length - 1];
  const minutes = Math.round((mockMinutes * stage.share) / roundTo) * roundTo;
  return Math.max(minMinutes, minutes);
}

// ─── session-queue builder ────────────────────────────────────────────────────

type QueueItem = Omit<ScheduledSession, "scheduledAt">;

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
      queue.push({ type, subject: subjectName, title: `${subjectName} — ${name} ${n}`, detail, plannedMinutes: sessionLength });
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

// ─── main export ─────────────────────────────────────────────────────────────

export interface SubjectFeasibility {
  name: string;
  /** Approximate study time the plan aims for (hours formula + mocks + reviews). */
  requiredMinutes: number;
  scheduledMinutes: number;
  shortfallMinutes: number;
}

/** How the plan's workload compares with the time the user made available. */
export interface PlanFeasibility {
  dailyWindowMinutes: number;
  dailyBufferMinutes: number;
  /** Focused study minutes before the last exam (buffers excluded). */
  availableMinutes: number;
  requiredMinutes: number;
  scheduledMinutes: number;
  /** Required work that didn't fit. */
  shortfallMinutes: number;
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
}

export interface ScheduleResult {
  sessions: ScheduledSession[];
  /** Sessions per subject name (buffers excluded). */
  breakdown: Record<string, number>;
  firstDate: Date | null;
  lastDate: Date | null;
  /** Work that could not be placed without breaking the user's availability. */
  warnings: string[];
  feasibility: PlanFeasibility;
  /** Store as PlanConfig.workloadBasisWeeklyMinutes so later adjustments keep the same workload. */
  workloadBasisWeeklyMinutes: number;
}

type DayBlock = { item: QueueItem; /** Fixed break before this block, already counted in `used`. */ breakBefore?: number };
type DayPlan = {
  date: Date;
  key: string;
  /** Minute of the day the first block starts. */
  start: number;
  /** Focused minutes available on this day. */
  capacity: number;
  blocks: DayBlock[];
  /** Minutes taken by blocks and fixed breaks. */
  used: number;
  breaks: number;
};

export function generateStudyPlan(
  config: PlanConfig,
  now: Date = new Date(),
  { suggest = true }: { suggest?: boolean } = {},
): ScheduleResult {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const warnings: string[] = [];
  const sessionLength = config.sessionLength;
  const startHour = config.preferredStartHour ?? 9;

  // ── 1. Daily window: weekly hours spread over the study days ─────────────

  const requestedWindow = dailyWindowMinutes(config);
  const windowMin = Math.min(requestedWindow, 24 * 60 - startHour * 60);
  if (windowMin < requestedWindow) {
    warnings.push(
      `${formatHours(requestedWindow)} per study day doesn't fit between ${startHour}:00 and midnight — ` +
      `days are capped at ${formatHours(windowMin)}.`,
    );
  }
  const bufferMin = dailyBufferMinutes(windowMin);
  /** Focused study minutes available on a full study day. */
  const capacity = Math.max(0, windowMin - bufferMin);
  const windowStart = startHour * 60;
  const windowEnd = windowStart + windowMin;
  // Workload is sized from a frozen basis, so adding hours later actually closes a gap.
  const basisWeekly = config.workloadBasisWeeklyMinutes ?? capacity * config.studyDays.length;

  // ── 2. Process subjects ──────────────────────────────────────────────────

  type Subject = {
    name: string;
    examDate: Date;
    examKey: string;
    mockMinutes: number;
    mockCount: number;
    allocation: number;
    multiplier: number;
    regularQueue: QueueItem[];
    requiredMinutes: number;
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

    return {
      name: s.name,
      examDate,
      examKey: toDateKey(examDate),
      mockMinutes,
      mockCount: Math.max(0, parseInt(s.mockCount) || 0),
      allocation: s.allocation,
      multiplier,
      regularQueue: [],
      requiredMinutes: 0,
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

  const days: DayPlan[] = [];
  /** Selected weekdays before each exam, vacations included — the workload basis. */
  const weekdaysBefore = subjects.map(() => 0);
  const cur = new Date(today);
  while (cur <= maxExamDate) {
    const key = toDateKey(cur);
    if (studyDayNums.has(cur.getDay()) && !examKeys.has(key)) {
      subjects.forEach((s, i) => { if (key < s.examKey) weekdaysBefore[i]++; });
      // Today only has whatever is left of its window.
      const start = key === toDateKey(today) ? Math.max(windowStart, nowMinute) : windowStart;
      const dayCapacity = Math.min(capacity, windowEnd - bufferMin - start);
      if (!vacationSet.has(key) && dayCapacity >= MIN_SESSION_MINUTES) {
        days.push({ date: new Date(cur), key, start, capacity: dayCapacity, blocks: [], used: 0, breaks: 0 });
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

  // Size each subject's workload: its share of the basis over its weekdays, scaled by the hours formula.
  const basisDaily = config.studyDays.length ? basisWeekly / config.studyDays.length : 0;
  config.subjects.forEach((cfg, si) => {
    const s = subjects[si];
    const estMinutes = weekdaysBefore[si] * basisDaily * (s.allocation / 100);
    const mockBudget = s.mockCount * (s.mockMinutes + mockReviewMinutes(s.mockMinutes, 1));
    const regularMin = Math.max(sessionLength, Math.round(estMinutes * s.multiplier) - mockBudget);
    s.regularQueue = buildPhaseQueue(s.name, regularMin, cfg.approach, cfg.customPhases, sessionLength);
  });

  const free = (day: DayPlan) => day.capacity - day.used;
  const progressOf = (day: Date, s: Subject) => {
    const span = s.examDate.getTime() - today.getTime();
    return span > 0 ? Math.min(1, Math.max(0, (day.getTime() - today.getTime()) / span)) : 1;
  };

  // ── 4. Mock exams and their reviews (placed first: they have priority) ───

  subjects.forEach((s, si) => {
    const lastIdx = lastIdxOf[si];
    const available = lastIdx + 1;
    const n = s.mockCount;
    if (n === 0) return;

    const mockWindowStart = Math.max(0, Math.min(Math.floor(available * (1 - MOCK_WINDOW_SHARE)), available - n));
    const span = lastIdx - mockWindowStart;
    let prevIdx = -1;

    for (let m = 0; m < n; m++) {
      const target = n === 1 ? lastIdx : mockWindowStart + Math.round((m * span) / (n - 1));
      // Days after the previous mock, closest to the target first (earlier wins ties).
      const candidates: number[] = [];
      for (let d = prevIdx + 1; d <= lastIdx; d++) candidates.push(d);
      candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);

      const mock: QueueItem = {
        type: "tempo",
        subject: s.name,
        title: `${s.name} — Mock exam ${m + 1}`,
        detail: PHASE_DETAIL["Mock exam"],
        plannedMinutes: s.mockMinutes,
      };

      let placedIdx = -1;
      for (const d of candidates) {
        const day = days[d];
        if (free(day) < s.mockMinutes) continue;

        const review: QueueItem = {
          type: "deep",
          subject: s.name,
          title: `${s.name} — Mock Exam Review ${m + 1}`,
          detail: PHASE_DETAIL["Mock exam review"],
          plannedMinutes: mockReviewMinutes(s.mockMinutes, progressOf(day.date, s)),
        };

        // Ideally straight after the mock, with a short break.
        if (free(day) >= s.mockMinutes + MOCK_REVIEW_BREAK_MIN + review.plannedMinutes) {
          day.blocks.push({ item: mock }, { item: review, breakBefore: MOCK_REVIEW_BREAK_MIN });
          day.used += s.mockMinutes + MOCK_REVIEW_BREAK_MIN + review.plannedMinutes;
          day.breaks += MOCK_REVIEW_BREAK_MIN;
          placedIdx = d;
          break;
        }
        // Otherwise first thing in the next study window before the exam.
        let reviewIdx = -1;
        for (let j = d + 1; j <= lastIdx; j++) {
          if (free(days[j]) >= review.plannedMinutes) { reviewIdx = j; break; }
        }
        if (reviewIdx === -1) continue;
        day.blocks.push({ item: mock });
        day.used += s.mockMinutes;
        days[reviewIdx].blocks.unshift({ item: review });
        days[reviewIdx].used += review.plannedMinutes;
        placedIdx = d;
        break;
      }

      if (placedIdx === -1) {
        s.lostMinutes += s.mockMinutes + mockReviewMinutes(s.mockMinutes, 1);
        warnings.push(
          `${s.name}: mock exam ${m + 1} (${formatHours(s.mockMinutes)}) and its review don't fit ` +
          `into your available study time before the exam.`,
        );
      } else {
        prevIdx = placedIdx;
      }
    }
  });

  // ── 5. Weighted round-robin with interleaving ────────────────────────────
  // Days are filled minute by minute: the last session of a full day is
  // shortened to fit and its remainder continues on a later day.

  // credit[i] accumulates; subject with highest credit is picked next
  const credit = subjects.map(() => 0);
  const totalAlloc = subjects.reduce((sum, s) => sum + s.allocation, 0) || 100;
  const queueMinutes = (s: Subject) => s.regularQueue.reduce((sum, q) => sum + q.plannedMinutes, 0);

  days.forEach((day, di) => {
    const activeIdx = subjects
      .map((_, i) => i)
      .filter((i) => subjects[i].regularQueue.length > 0 && di <= lastIdxOf[i]);
    if (activeIdx.length === 0) return;

    // Pace each subject's remaining work over its remaining days, in whole sessions,
    // but never leave more than the later days (already holding mocks) can take.
    const wanted = activeIdx.reduce((sum, i) => {
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

    while (room >= MIN_SESSION_MINUTES && activeIdx.length > 0) {
      // Accumulate credit per slot for all active subjects
      for (const i of activeIdx) credit[i] += subjects[i].allocation;

      // Pick subject with highest credit (skip prevIdx to interleave if possible)
      let bestIdx = -1, bestCredit = -Infinity;
      for (const i of activeIdx) {
        if (i === prevIdx && activeIdx.length > 1) continue;
        if (credit[i] > bestCredit) { bestCredit = credit[i]; bestIdx = i; }
      }
      // Fallback: allow same subject if it is the only active one
      if (bestIdx === -1) {
        for (const i of activeIdx) {
          if (credit[i] > bestCredit) { bestCredit = credit[i]; bestIdx = i; }
        }
      }
      if (bestIdx === -1) break;

      const s = subjects[bestIdx];
      const next = s.regularQueue[0];
      let minutes = Math.min(next.plannedMinutes, room, free(day));
      // Leave a continuation long enough to be its own session.
      if (minutes < next.plannedMinutes && next.plannedMinutes - minutes < MIN_SESSION_MINUTES) {
        minutes = next.plannedMinutes - MIN_SESSION_MINUTES;
      }
      if (minutes < MIN_SESSION_MINUTES) break;
      const rest = next.plannedMinutes - minutes;
      if (rest > 0) {
        const title = next.title.endsWith(" (cont.)") ? next.title : `${next.title} (cont.)`;
        s.regularQueue[0] = { ...next, title, plannedMinutes: rest };
      } else {
        s.regularQueue.shift();
      }

      const block = { item: { ...next, plannedMinutes: minutes } };
      day.blocks.push(block);
      day.used += minutes;
      room -= minutes;
      lastBlock = { block, subject: bestIdx };

      credit[bestIdx] -= totalAlloc;
      prevIdx = bestIdx;

      if (s.regularQueue.length === 0) {
        activeIdx.splice(activeIdx.indexOf(bestIdx), 1);
      }
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
  // have room. Place it in the latest such days, so nothing is reported short
  // while time is actually free.
  subjects.forEach((s, si) => {
    for (let d = lastIdxOf[si]; d >= 0 && s.regularQueue.length > 0; d--) {
      const day = days[d];
      while (s.regularQueue.length > 0 && free(day) >= MIN_SESSION_MINUTES) {
        const next = s.regularQueue[0];
        let minutes = Math.min(next.plannedMinutes, free(day));
        if (minutes < next.plannedMinutes && next.plannedMinutes - minutes < MIN_SESSION_MINUTES) {
          minutes = next.plannedMinutes - MIN_SESSION_MINUTES;
        }
        if (minutes < MIN_SESSION_MINUTES) break;
        if (minutes < next.plannedMinutes) {
          const title = next.title.endsWith(" (cont.)") ? next.title : `${next.title} (cont.)`;
          s.regularQueue[0] = { ...next, title, plannedMinutes: next.plannedMinutes - minutes };
        } else {
          s.regularQueue.shift();
        }
        day.blocks.push({ item: { ...next, plannedMinutes: minutes } });
        day.used += minutes;
      }
    }
  });

  for (const s of subjects) {
    const left = queueMinutes(s);
    if (left === 0) continue;
    warnings.push(
      `${s.name}: about ${formatHours(left)} of study doesn't fit into your available time before the exam.`,
    );
  }

  // ── 6. Lay out each day back to back, then the buffer ────────────────────

  const result: ScheduledSession[] = [];

  for (const day of days) {
    if (day.blocks.length === 0) continue;

    // Each block starts the minute the previous one (plus any fixed break) ends.
    let t = day.start;
    day.blocks.forEach((b, k) => {
      if (k > 0) t += b.breakBefore ?? 0;
      result.push({ ...b.item, scheduledAt: atMinute(day.date, t) });
      t += b.item.plannedMinutes;
    });

    if (bufferMin > 0) {
      result.push({
        type: "buffer",
        subject: BUFFER_SUBJECT,
        title: "Buffer / Catch-up Time",
        detail: PHASE_DETAIL["Buffer"],
        scheduledAt: atMinute(day.date, t),
        plannedMinutes: bufferMin,
      });
    }
  }

  // ── 7. Add one "exam" marker per subject on their exam date ──────────────
  // This makes the profile's "Exam countdowns" section work for custom subjects.
  for (const s of subjects) {
    const examAt = new Date(s.examDate);
    examAt.setHours(9, 0, 0, 0);
    result.push({
      type: "exam",
      subject: s.name,
      title: `${s.name} — Exam`,
      detail: "Your scheduled exam. Good luck!",
      scheduledAt: examAt,
      plannedMinutes: s.mockMinutes,
    });
  }

  result.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  // ── 8. Build result metadata ──────────────────────────────────────────────

  const breakdown: Record<string, number> = {};
  for (const s of result) {
    if (s.type !== "buffer") breakdown[s.subject] = (breakdown[s.subject] ?? 0) + 1;
  }

  const scheduledBySubject = new Map<string, number>();
  for (const s of result) {
    if (s.type === "buffer" || s.type === "exam") continue;
    scheduledBySubject.set(s.subject, (scheduledBySubject.get(s.subject) ?? 0) + s.plannedMinutes);
  }
  const subjectFeasibility = subjects
    .map((s) => {
      const scheduledMinutes = scheduledBySubject.get(s.name) ?? 0;
      const shortfallMinutes = queueMinutes(s) + s.lostMinutes;
      return { name: s.name, requiredMinutes: scheduledMinutes + shortfallMinutes, scheduledMinutes, shortfallMinutes };
    })
    .sort((a, b) => b.shortfallMinutes - a.shortfallMinutes);

  const sum = (f: (s: SubjectFeasibility) => number) => subjectFeasibility.reduce((t, s) => t + f(s), 0);
  const availableMinutes = days.reduce((t, d) => t + d.capacity, 0);
  const usedMinutes = days.reduce((t, d) => t + d.used, 0);
  const shortfallMinutes = sum((s) => s.shortfallMinutes);
  const weeks = Math.max(1, (maxExamDate.getTime() - today.getTime()) / (7 * 86400000));

  return {
    sessions: result,
    breakdown,
    firstDate: result[0]?.scheduledAt ?? null,
    lastDate: result[result.length - 1]?.scheduledAt ?? null,
    warnings,
    feasibility: {
      dailyWindowMinutes: windowMin,
      dailyBufferMinutes: bufferMin,
      availableMinutes,
      requiredMinutes: sum((s) => s.requiredMinutes),
      scheduledMinutes: sum((s) => s.scheduledMinutes),
      shortfallMinutes,
      needsMoreTime: shortfallMinutes >= SHORTFALL_THRESHOLD_MIN,
      unusedMinutes: availableMinutes - usedMinutes,
      weeks,
      subjects: subjectFeasibility,
      suggestions: suggest && shortfallMinutes >= SHORTFALL_THRESHOLD_MIN
        ? buildSuggestions({ ...config, workloadBasisWeeklyMinutes: basisWeekly }, subjects, subjectFeasibility, now)
        : [],
    },
    workloadBasisWeeklyMinutes: basisWeekly,
  };
}

/** Concrete, checkable changes that would give the plan the time it needs. */
function buildSuggestions(
  config: PlanConfig,
  subjects: { name: string; examKey: string; mockCount: number; mockMinutes: number }[],
  feasibility: SubjectFeasibility[],
  now: Date,
): string[] {
  const suggestions: string[] = [];

  // Re-run the scheduler to find the smallest weekly increase that closes the gap.
  let extra = 0;
  for (let w = config.weeklyHours + 1; w <= MAX_WEEKLY_HOURS; w++) {
    const trial = generateStudyPlan({ ...config, weeklyHours: w }, now, { suggest: false });
    if (trial.feasibility.shortfallMinutes < SHORTFALL_THRESHOLD_MIN) { extra = w - config.weeklyHours; break; }
  }
  if (extra > 0) {
    suggestions.push(`Raise your weekly study time by ${extra} h (from ${config.weeklyHours} h to ${config.weeklyHours + extra} h) — that closes the gap.`);
  } else {
    suggestions.push(`Even ${MAX_WEEKLY_HOURS} h per week isn't enough for these goals — lower a target grade or plan fewer mock exams.`);
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
  const topSubject = subjects.find((s) => s.name === top?.name);
  if (topSubject && topSubject.mockCount > 2) {
    suggestions.push(`Plan fewer mock exams for ${top.name} (currently ${topSubject.mockCount}).`);
  }
  return suggestions;
}
