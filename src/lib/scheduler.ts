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
 * Exam practice — mock-exam sessions are reserved in the last N study days
 *   before each subject's exam date and scheduled as tempo (timed) sessions.
 *
 * Sustainability — the daily session count is capped, sessions start no
 *   earlier than 09:00 and no later than 19:00, and roughly 1-in-10 study
 *   days are left open as catch-up buffers.
 *
 * Hour formula
 * ─────────────
 *   required_hours = est_hours × (1.25 − 0.5 × confidence)
 *   confidence ∈ [0 (little) … 1 (very)] → multiplier ∈ [0.75 … 1.25]
 */

export type SchedulerSessionType = "deep" | "intervals" | "tempo" | "recovery" | "exam";

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
}

// ─── constants ───────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const CONFIDENCE_SCORE: Record<string, number> = {
  very: 1.0,
  mostly: 0.67,
  some: 0.33,
  little: 0.0,
};

const MAX_SLOTS_PER_DAY = 4;
const BUFFER_EVERY = 10;
const LATEST_START_MIN = 19 * 60; // 19:00

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

/**
 * Returns up to `count` start-time Date objects on `day`, spaced so that
 * sessions + breaks fit within startHour–19:00.
 */
function computeSlotTimes(day: Date, count: number, sessionLengthMin: number, startHour = 9): Date[] {
  const breakMin = sessionLengthMin >= 90 ? 30 : 20;
  const stride = sessionLengthMin + breakMin;
  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const minutes = startHour * 60 + i * stride;
    if (minutes > LATEST_START_MIN) break;
    const d = new Date(day);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    times.push(d);
  }
  return times;
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

export interface ScheduleResult {
  sessions: ScheduledSession[];
  /** Sessions per subject name. */
  breakdown: Record<string, number>;
  firstDate: Date | null;
  lastDate: Date | null;
}

export function generateStudyPlan(config: PlanConfig): ScheduleResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── 1. Process subjects ──────────────────────────────────────────────────

  type Subject = {
    name: string;
    examDate: Date;
    allocation: number;
    regularQueue: QueueItem[];
    mockQueue: QueueItem[];
  };

  const subjects: Subject[] = config.subjects.map((s) => {
    const examDate = new Date(s.examDate + "T12:00:00");
    const daysUntil = Math.max(7, Math.ceil((examDate.getTime() - today.getTime()) / 86400000));
    const weeksUntil = daysUntil / 7;

    const confScore = CONFIDENCE_SCORE[s.confidence] ?? 0.5;
    const gradeGap = Math.max(0, (Number(s.targetGrade) || 0) - (Number(s.currentGrade) || 0));
    const multiplier = 1.25 - 0.5 * confScore + 0.05 * gradeGap; // confidence + grade gap

    const estHours = weeksUntil * config.weeklyHours * (s.allocation / 100);
    const mockCount = Math.max(0, parseInt(s.mockCount) || 0);
    const mockMin = mockCount * config.sessionLength;
    const regularMin = Math.max(config.sessionLength, Math.round(estHours * 60 * multiplier) - mockMin);

    const regularQueue = buildPhaseQueue(s.name, regularMin, s.approach, s.customPhases, config.sessionLength);
    const mockQueue: QueueItem[] = Array.from({ length: mockCount }, (_, i) => ({
      type: "tempo" as const,
      subject: s.name,
      title: `${s.name} — Mock exam ${i + 1}`,
      detail: PHASE_DETAIL["Mock exam"],
      plannedMinutes: config.sessionLength,
    }));

    return { name: s.name, examDate, allocation: s.allocation, regularQueue, mockQueue };
  });

  // ── 2. Build calendar of available study days ────────────────────────────

  const studyDayNums = new Set(config.studyDays.map((d) => DAY_NAMES.indexOf(d)));
  const vacationSet = buildVacationSet(config.vacationRanges);
  const maxExamDate = subjects.reduce(
    (max, s) => (s.examDate > max ? s.examDate : max),
    subjects[0]?.examDate ?? today,
  );

  const allStudyDays: Date[] = [];
  const cur = new Date(today);
  while (cur <= maxExamDate) {
    if (studyDayNums.has(cur.getDay()) && !vacationSet.has(toDateKey(cur))) {
      allStudyDays.push(new Date(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }

  const sessionsPerDay = Math.min(
    MAX_SLOTS_PER_DAY,
    Math.max(1, Math.floor((config.weeklyHours * 60) / (config.studyDays.length * config.sessionLength))),
  );

  // ── 3. Reserve days for mock exams ───────────────────────────────────────

  // Key: "YYYY-MM-DD|subjectName" → QueueItem
  const mockReservations = new Map<string, QueueItem>();
  for (const s of subjects) {
    if (s.mockQueue.length === 0) continue;
    const eligibleDays = allStudyDays.filter((d) => d < s.examDate);
    const reservedDays = eligibleDays.slice(-s.mockQueue.length);
    for (const day of reservedDays) {
      if (s.mockQueue.length === 0) break;
      mockReservations.set(`${toDateKey(day)}|${s.name}`, s.mockQueue.shift()!);
    }
  }

  // ── 4. Weighted round-robin with interleaving ────────────────────────────

  const result: ScheduledSession[] = [];
  // credit[i] accumulates; subject with highest credit is picked next
  const credit = subjects.map(() => 0);
  const totalAlloc = subjects.reduce((sum, s) => sum + s.allocation, 0) || 100;

  let bufferCounter = 0;

  for (const day of allStudyDays) {
    bufferCounter++;
    const isBuffer = bufferCounter % BUFFER_EVERY === 0;

    // Collect mock sessions reserved for this day
    const todayMocks: ScheduledSession[] = [];
    for (const s of subjects) {
      const item = mockReservations.get(`${toDateKey(day)}|${s.name}`);
      if (item) todayMocks.push({ ...item, scheduledAt: new Date(day) });
    }

    const activeIdx = subjects
      .map((_, i) => i)
      .filter((i) => subjects[i].regularQueue.length > 0 && subjects[i].examDate > day);

    if (isBuffer || (activeIdx.length === 0 && todayMocks.length === 0)) {
      if (todayMocks.length > 0) {
        const times = computeSlotTimes(day, todayMocks.length, config.sessionLength, config.preferredStartHour);
        todayMocks.forEach((m, i) => {
          m.scheduledAt = times[i] ?? times[times.length - 1];
          result.push(m);
        });
      }
      continue;
    }

    const regularSlots = Math.max(0, sessionsPerDay - todayMocks.length);
    const totalSlots = regularSlots + todayMocks.length;
    const slotTimes = computeSlotTimes(day, totalSlots, config.sessionLength, config.preferredStartHour);

    let prevIdx = -1;

    for (let slot = 0; slot < regularSlots && activeIdx.length > 0; slot++) {
      if (slot >= slotTimes.length) break;

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

      const session = subjects[bestIdx].regularQueue.shift()!;
      result.push({ ...session, scheduledAt: slotTimes[slot] });

      credit[bestIdx] -= totalAlloc;
      prevIdx = bestIdx;

      if (subjects[bestIdx].regularQueue.length === 0) {
        activeIdx.splice(activeIdx.indexOf(bestIdx), 1);
      }
    }

    // Append mock sessions after regular ones
    todayMocks.forEach((m, i) => {
      const slotIdx = regularSlots + i;
      m.scheduledAt = slotTimes[slotIdx] ?? slotTimes[slotTimes.length - 1];
      result.push(m);
    });
  }

  // ── 5. Fallback: place any remaining mock sessions near the exam date ─────

  for (const s of subjects) {
    const fallback = allStudyDays.filter((d) => d < s.examDate).slice(-5).reverse();
    for (const day of fallback) {
      if (s.mockQueue.length === 0) break;
      const [time] = computeSlotTimes(day, 1, config.sessionLength, config.preferredStartHour);
      if (time) result.push({ ...s.mockQueue.shift()!, scheduledAt: time });
    }
  }

  // ── 6. Add one "exam" marker per subject on their exam date ──────────────
  // This makes the profile's "Exam countdowns" section work for custom subjects.
  for (const s of subjects) {
    const examAt = new Date(s.examDate);
    examAt.setHours(9, 0, 0, 0);
    const examSubject = config.subjects.find((cs) => cs.name === s.name);
    const examDuration = parseInt(examSubject?.examDuration ?? "") || 180;
    result.push({
      type: "exam",
      subject: s.name,
      title: `${s.name} — Exam`,
      detail: "Your scheduled exam. Good luck!",
      scheduledAt: examAt,
      plannedMinutes: examDuration,
    });
  }

  result.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  // ── 6. Build result metadata ──────────────────────────────────────────────

  const breakdown: Record<string, number> = {};
  for (const s of result) breakdown[s.subject] = (breakdown[s.subject] ?? 0) + 1;

  return {
    sessions: result,
    breakdown,
    firstDate: result[0]?.scheduledAt ?? null,
    lastDate: result[result.length - 1]?.scheduledAt ?? null,
  };
}
