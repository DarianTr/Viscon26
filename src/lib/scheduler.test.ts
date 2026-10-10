import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findOverlaps, type Interval } from "./intervals";
import {
  cheatsheetMilestones,
  MAX_SUBJECTS_PER_DAY,
  dailyBufferMinutes,
  dailyWindowMinutes,
  dayStartMinutes,
  generateStudyPlan,
  immersionDays,
  mockReviewMinutes,
  mockWorkload,
  planMocks,
  previewDay,
  type PlanConfig,
  type ScheduledSession,
  type SubjectConfig,
} from "./scheduler";

// Monday, 12 Oct 2026.
const NOW = new Date(2026, 9, 12, 8, 0);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function subject(overrides: Partial<SubjectConfig> = {}): SubjectConfig {
  return {
    name: "Analysis",
    examDate: "2026-12-18",
    examDuration: "150",
    targetGrade: "5",
    currentGrade: "4",
    confidence: "some",
    approach: "balanced",
    customPhases: [],
    mockCount: "3",
    allocation: 100,
    materials: [],
    cheatsheet: "none",
    comments: "",
    ...overrides,
  };
}

function config(overrides: Partial<PlanConfig> = {}): PlanConfig {
  return {
    planName: "Test",
    weeklyHours: 60,
    studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    sessionLength: 90,
    vacationRanges: [],
    subjects: [subject()],
    ...overrides,
  };
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const end = (s: ScheduledSession) => s.scheduledAt.getTime() + s.plannedMinutes * 60_000;
const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isStudy = (s: ScheduledSession) => s.type !== "exam" && s.type !== "buffer" && s.type !== "break";
const isPause = (s: ScheduledSession) => s.type === "break";
const sum = (list: ScheduledSession[]) => list.reduce((t, s) => t + s.plannedMinutes, 0);

function byDay(sessions: ScheduledSession[]) {
  const map = new Map<string, ScheduledSession[]>();
  for (const s of [...sessions].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
    if (s.type === "exam") continue;
    const key = dateKey(s.scheduledAt);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return map;
}

/**
 * "HH:MM-HH:MM activity" for every block of a day — easy to compare with a
 * timetable. Study sessions that run back to back form one block.
 */
function timetable(list: ScheduledSession[]) {
  const blocks: { start: number; end: number; activity: string }[] = [];
  for (const s of list) {
    const start = minuteOfDay(s.scheduledAt);
    const last = blocks[blocks.length - 1];
    if (last && isStudy(s) && last.activity === "study" && last.end === start) last.end += s.plannedMinutes;
    else blocks.push({ start, end: start + s.plannedMinutes, activity: isStudy(s) ? "study" : s.activity });
  }
  return blocks.map((b) => `${clock(b.start)}-${clock(b.end)} ${b.activity}`);
}

/** Study days other than Exam Eve (which deliberately looks different). */
const regularDays = (sessions: ScheduledSession[]) =>
  [...byDay(sessions).values()].filter((list) => !list.some((x) => x.activity === "exam_eve"));

/** No two blocks of the whole plan (exams included, across days) share a minute. */
function assertNoOverlaps(sessions: ScheduledSession[], busy: Interval[] = []) {
  const intervals = [
    ...sessions.map((s) => ({ start: s.scheduledAt.getTime(), end: end(s) })),
    ...busy,
  ];
  const clashes = findOverlaps(intervals).map(([a, b]) =>
    [a, b].map((i) => (i < sessions.length ? `${sessions[i].title} @ ${sessions[i].scheduledAt.toISOString()}` : "busy")).join(" × "));
  assert.deepEqual(clashes, []);
}

/** The hard constraints every generated plan must satisfy. */
function assertWithinAvailability(cfg: PlanConfig, sessions: ScheduledSession[], now = NOW) {
  const window = dailyWindowMinutes(cfg);
  const buffer = dailyBufferMinutes(window);
  const start = dayStartMinutes(cfg);
  const examKeys = new Set(cfg.subjects.map((s) => s.examDate));

  assertNoOverlaps(sessions);
  for (const [key, list] of byDay(sessions)) {
    const day = list[0].scheduledAt;
    assert.ok(cfg.studyDays.includes(DAY_NAMES[day.getDay()]), `${key} is not a study day`);
    assert.ok(!examKeys.has(key), `${key} is an exam day`);
    for (const r of cfg.vacationRanges) {
      assert.ok(key < r.start || key > r.end, `${key} is in a vacation`);
    }

    // Study never exceeds the daily hours minus the buffer; breaks don't count.
    const study = sum(list.filter(isStudy));
    assert.ok(study <= window - buffer, `${key}: ${study} min of study exceeds ${window - buffer}`);

    // The day starts at the start time (or later, today), ends with the buffer, and before midnight.
    const dayStart = key === dateKey(now) ? Math.max(start, minuteOfDay(now)) : start;
    assert.ok(minuteOfDay(list[0].scheduledAt) >= dayStart, `${key} starts too early`);
    assert.ok(isStudy(list[0]), `${key} starts with study`);
    const last = list[list.length - 1];
    assert.equal(dateKey(new Date(end(last) - 1)), key, `${key} runs past midnight`);
    if (list.some((x) => x.activity === "exam_eve")) {
      // Exam Eve: only the final review(s), at most 4 h, no buffer to catch up into.
      assert.ok(list.filter(isStudy).every((x) => x.activity === "exam_eve"), `${key}: only Exam Eve`);
      assert.ok(sum(list.filter(isStudy)) <= 240, `${key}: Exam Eve over 4 h`);
      assert.ok(!list.some((x) => x.type === "buffer"), `${key}: no buffer on Exam Eve`);
    } else {
      assert.equal(last.type, "buffer", `${key} ends with the buffer`);
      assert.equal(last.plannedMinutes, buffer);
    }

    // Breaks only sit between study blocks.
    list.forEach((s, i) => {
      if (isPause(s)) assert.ok(isStudy(list[i - 1]) && isStudy(list[i + 1]), `${key}: stray ${s.title}`);
    });
  }
}

describe("daily templates", () => {
  const tenHours = (overrides: Partial<PlanConfig> = {}) => config({
    weeklyHours: 70,
    studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    startTime: "08:00",
    rhythm: "balanced",
    // More work than time, so every day is full.
    subjects: [subject({ confidence: "little", currentGrade: "3", targetGrade: "6", mockCount: "0" })],
    ...overrides,
  });

  it("builds the 10 h Balanced day: 8.5 h study, 1.5 h buffer, 3 h breaks and meals", () => {
    const cfg = tenHours();
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const days = regularDays(sessions);
    assert.ok(days.length > 50);
    for (const list of days) {
      assert.deepEqual(timetable(list), [
        "08:00-10:00 study",
        "10:00-10:30 short_break",
        "10:30-12:30 study",
        "12:30-13:30 lunch",
        "13:30-15:30 study",
        "15:30-16:00 short_break",
        "16:00-18:00 study",
        "18:00-19:00 dinner",
        "19:00-19:30 study",
        "19:30-21:00 buffer",
      ]);
      assert.equal(sum(list.filter(isStudy)), 510);
      assert.equal(sum(list.filter((s) => s.type === "buffer")), 90);
      assert.equal(sum(list.filter(isPause)), 180);
      assert.equal(end(list[list.length - 1]) - list[0].scheduledAt.getTime(), 13 * 60 * 60_000);
    }
  });

  it("matches the onboarding preview", () => {
    const cfg = tenHours();
    const preview = previewDay(cfg).segments.map((s) => `${clock(s.start)}-${clock(s.start + s.minutes)} ${s.activity}`);
    const firstDay = [...byDay(generateStudyPlan(cfg, NOW).sessions).values()][1];
    assert.deepEqual(timetable(firstDay), preview);
  });

  it("gives a 4 h Sprint day short breaks and no meals", () => {
    const cfg = tenHours({ weeklyHours: 28, rhythm: "sprint" });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    for (const list of [...byDay(sessions).values()].slice(1, -1)) {
      assert.deepEqual(timetable(list), [
        "08:00-09:30 study",
        "09:30-09:45 short_break",
        "09:45-11:15 study",
        "11:15-12:15 buffer",
      ]);
    }
  });

  it("gives a 6 h Deep Work day lunch only when it runs through lunchtime", () => {
    const cfg = tenHours({ weeklyHours: 42, rhythm: "deep", startTime: "09:30" });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const list = [...byDay(sessions).values()][1];
    assert.deepEqual(timetable(list), [
      "09:30-12:00 study",
      "12:00-13:00 lunch",
      "13:00-15:00 study",
      "15:00-16:30 buffer",
    ]);
    assert.equal(sum(list.filter(isStudy)), 270);
  });

  it("shifts the whole day with the start time, to the minute", () => {
    for (const startTime of ["07:15", "10:40"]) {
      const cfg = tenHours({ startTime });
      const { sessions } = generateStudyPlan(cfg, NOW);
      assertWithinAvailability(cfg, sessions);
      for (const list of regularDays(sessions).slice(1)) {
        assert.equal(clock(minuteOfDay(list[0].scheduledAt)), startTime);
        assert.equal(sum(list.filter(isStudy)), 510, "a later start doesn't cost study time");
        assert.equal(list.filter((s) => s.activity === "lunch").length, 1);
        // Dinner only when study continues into the evening.
        const studiesInEvening = list.some((s) => isStudy(s) && end(s) > new Date(s.scheduledAt).setHours(18, 30, 0, 0));
        assert.equal(list.filter((s) => s.activity === "dinner").length, studiesInEvening ? 1 : 0, startTime);
      }
    }
  });

  it("warns instead of running past midnight when the day starts late", () => {
    const cfg = tenHours({ startTime: "14:00" });
    const { sessions, warnings } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.ok(warnings.some((w) => w.includes("midnight")));
  });

  it("starts today's sessions from the current time", () => {
    const at1445 = new Date(2026, 9, 12, 14, 45);
    const cfg = tenHours();
    const { sessions } = generateStudyPlan(cfg, at1445);
    assertWithinAvailability(cfg, sessions, at1445);
    const today = sessions.filter((s) => dateKey(s.scheduledAt) === "2026-10-12");
    assert.equal(clock(minuteOfDay(today[0].scheduledAt)), "14:45");
  });

  it("keeps breaks and buffers out of the per-subject breakdown", () => {
    const { breakdown } = generateStudyPlan(config(), NOW);
    assert.deepEqual(Object.keys(breakdown), ["Analysis"]);
  });

  it("scales the buffer down on short days", () => {
    assert.equal(dailyBufferMinutes(600), 90);
    assert.equal(dailyBufferMinutes(240), 60);
    assert.equal(dailyBufferMinutes(120), 30);
  });
});

describe("overlaps", () => {
  it("never overlaps, across days and with odd-length mocks", () => {
    const cfg = config({
      weeklyHours: 70,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      rhythm: "balanced",
      subjects: [
        subject({ name: "Analysis", examDuration: "178", mockCount: "5", confidence: "little", allocation: 60 }),
        subject({ name: "Physics", examDate: "2026-12-30", examDuration: "118", mockCount: "18", allocation: 40 }),
      ],
    });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.ok(sessions.some((s) => s.scheduledAt.getMinutes() % 15 !== 0), "odd lengths give minute-precise starts");
  });

  it("works around entries already on the calendar", () => {
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
    const busy = [
      { start: at(13, 9, 10), end: at(13, 10, 25) },  // another plan's session
      { start: at(14, 12, 0), end: at(14, 15, 0) },   // a long appointment
      { start: at(15, 0, 0), end: at(16, 0, 0) },     // a whole day
    ];
    const cfg = config({ weeklyHours: 60, rhythm: "sprint" });
    const { sessions } = generateStudyPlan(cfg, NOW, { busy });
    assertNoOverlaps(sessions, busy);
    assertWithinAvailability(cfg, sessions);
    assert.ok(!sessions.some((s) => dateKey(s.scheduledAt) === "2026-10-15"), "a fully busy day stays free");
  });
});

describe("available weekdays and vacations", () => {
  it("only schedules on selected weekdays outside vacations", () => {
    const cfg = config({
      weeklyHours: 32,
      studyDays: ["Mon", "Tue", "Thu", "Sat"],
      vacationRanges: [{ start: "2026-11-02", end: "2026-11-08" }],
    });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assert.ok(sessions.some(isStudy));
    assertWithinAvailability(cfg, sessions);
    // The vacation also removes the mocks' and reviews' days.
    assert.ok(!sessions.some((s) => s.type !== "exam" && dateKey(s.scheduledAt) >= "2026-11-02" && dateKey(s.scheduledAt) <= "2026-11-08"));
  });
});

describe("mock exams", () => {
  const mocks = (sessions: ScheduledSession[]) => sessions.filter((s) => /Mock exam \d/.test(s.title));
  const reviews = (sessions: ScheduledSession[]) => sessions.filter((s) => s.title.includes("Mock Exam Review"));

  it("last as long as the real exam, even when longer than a session", () => {
    // Sprint sessions are 90 min; the 150-min mock stays one block.
    const cfg = config({ rhythm: "sprint", subjects: [subject({ examDuration: "150" })] });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.equal(mocks(sessions).length, 3);
    for (const m of mocks(sessions)) {
      assert.equal(m.plannedMinutes, 150);
      assert.equal(m.activity, "mock_exam");
    }
    for (const r of reviews(sessions)) assert.equal(r.activity, "mock_review");
  });

  it("are each followed by a review of the same subject that shrinks over time, minimum 1 h", () => {
    const cfg = config({ subjects: [subject({ examDuration: "180", mockCount: "4" })] });
    const { sessions } = generateStudyPlan(cfg, NOW);
    const ms = mocks(sessions);
    const rs = reviews(sessions);
    assert.equal(rs.length, ms.length);

    ms.forEach((m, i) => {
      const r = rs.find((x) => x.title.endsWith(`Mock Exam Review ${i + 1}`))!;
      assert.equal(r.subject, m.subject);
      assert.ok(r.scheduledAt.getTime() >= end(m), "review starts after its mock");
      assert.ok(r.plannedMinutes >= 60);
      // With room in the day: mock, then a break or meal, then the review.
      const k = sessions.indexOf(m);
      assert.equal(sessions[k + 1].type, "break");
      assert.equal(sessions[k + 2], r);
      assert.equal(r.scheduledAt.getTime(), end(sessions[k + 1]));
    });

    const durations = rs.map((r) => r.plannedMinutes);
    for (let i = 1; i < durations.length; i++) assert.ok(durations[i] <= durations[i - 1], `${durations}`);
    assert.ok(durations[0] > durations[durations.length - 1], `reviews should get shorter: ${durations}`);
  });

  it("move the review to the next study day when it doesn't fit", () => {
    // 4 h/day − 1 h buffer = 3 h: a 3 h mock leaves no room for its review.
    const cfg = config({ weeklyHours: 24, subjects: [subject({ examDuration: "180", mockCount: "2" })] });
    const { sessions, warnings } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.deepEqual(warnings.filter((w) => w.includes("mock")), []);
    for (const [i, m] of mocks(sessions).entries()) {
      const r = reviews(sessions)[i];
      assert.ok(dateKey(r.scheduledAt) > dateKey(m.scheduledAt));
      assert.ok(dateKey(r.scheduledAt) < "2026-12-18", "review lands before the exam");
    }
  });

  it("uses the configured review rule", () => {
    assert.equal(mockReviewMinutes(180, 0.1), 135);
    assert.equal(mockReviewMinutes(180, 0.6), 90);
    assert.equal(mockReviewMinutes(180, 0.95), 60);
    assert.equal(mockReviewMinutes(60, 0.1), 60);
  });
});

describe("conflicts", () => {
  it("warns instead of overscheduling when time runs out", () => {
    const cfg = config({
      weeklyHours: 3,
      studyDays: ["Sat"],
      subjects: [subject({ examDate: "2026-10-30", examDuration: "120", mockCount: "3", confidence: "little" })],
    });
    const { sessions, warnings } = generateStudyPlan(cfg, NOW);
    assert.ok(warnings.length > 0);
    assertWithinAvailability(cfg, sessions);
  });

  it("doesn't warn when the workload fits", () => {
    const cfg = config({
      weeklyHours: 40,
      studyDays: ["Mon", "Tue", "Thu", "Sat"],
      vacationRanges: [{ start: "2026-11-02", end: "2026-11-08" }],
      subjects: [
        subject({ name: "Analysis", confidence: "very", targetGrade: "5", currentGrade: "5", allocation: 60 }),
        subject({ name: "Physics", examDate: "2026-12-11", examDuration: "120", confidence: "very", targetGrade: "5", currentGrade: "5", mockCount: "2", allocation: 40 }),
      ],
    });
    const { sessions, warnings } = generateStudyPlan(cfg, NOW);
    assert.deepEqual(warnings, []);
    assertWithinAvailability(cfg, sessions);
  });

  it("explains unused time instead of inventing tasks", () => {
    const cfg = config({ subjects: [subject({ confidence: "very", currentGrade: "5", targetGrade: "5", mockCount: "1" })] });
    const { feasibility } = generateStudyPlan(cfg, NOW);
    assert.equal(feasibility.shortfallMinutes, 0);
    assert.ok(feasibility.unusedMinutes > 0);
    assert.ok(feasibility.scheduledMinutes <= feasibility.requiredMinutes);
    assert.deepEqual(feasibility.suggestions, []);
  });

  it("reports the shortfall and closes it when the suggested hours are added", () => {
    const cfg = config({
      weeklyHours: 30,
      vacationRanges: [{ start: "2026-11-02", end: "2026-11-08" }],
      subjects: [
        subject({ name: "Analysis", confidence: "little", currentGrade: "3.5", targetGrade: "6", allocation: 60 }),
        subject({ name: "Physics", examDate: "2026-12-11", confidence: "some", allocation: 40 }),
      ],
    });
    const first = generateStudyPlan(cfg, NOW);
    const f = first.feasibility;
    assert.ok(f.shortfallMinutes >= 60);
    assert.equal(f.requiredMinutes, f.scheduledMinutes + f.shortfallMinutes);
    assert.equal(f.subjects[0].name, "Analysis", "largest pressure first");
    assert.ok(f.suggestions.some((s) => s.includes("weekly study time")));
    assert.ok(f.suggestions.some((s) => s.includes("vacation")));

    // "Adjust my plan": raise hours as suggested, keeping the frozen workload.
    const extra = Number(/by (\d+) h/.exec(f.suggestions[0])![1]);
    const adjusted = { ...cfg, weeklyHours: cfg.weeklyHours + extra, workloadBasisWeeklyMinutes: first.workloadBasisWeeklyMinutes };
    const second = generateStudyPlan(adjusted, NOW);
    // Same workload; only review lengths move a little with where the mocks land.
    assert.ok(Math.abs(second.feasibility.requiredMinutes - f.requiredMinutes) <= 120);
    assert.ok(second.feasibility.shortfallMinutes < 60, `still short by ${second.feasibility.shortfallMinutes} min`);
    assertWithinAvailability(adjusted, second.sessions);
  });

  it("puts mock exams first when time is short", () => {
    const cfg = config({
      weeklyHours: 12,
      studyDays: ["Mon", "Wed", "Fri"],
      subjects: [subject({ examDate: "2026-11-06", examDuration: "120", mockCount: "2", confidence: "little" })],
    });
    const { sessions, warnings } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.ok(warnings.some((w) => w.includes("of study doesn't fit")), "regular sessions are what gets dropped");
    assert.equal(sessions.filter((s) => /Mock exam \d/.test(s.title)).length, 2);
    assert.equal(sessions.filter((s) => s.title.includes("Mock Exam Review")).length, 2);
  });

  it("checks every day of a multi-subject plan", () => {
    const cfg = config({
      weeklyHours: 40,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      vacationRanges: [{ start: "2026-12-21", end: "2027-01-03" }],
      subjects: [
        subject({ name: "Analysis", examDate: "2027-01-20", examDuration: "180", mockCount: "3", allocation: 50 }),
        subject({ name: "Physics", examDate: "2027-01-27", examDuration: "120", mockCount: "2", allocation: 30 }),
        subject({ name: "Algorithms", examDate: "2027-02-03", examDuration: "90", mockCount: "4", allocation: 20 }),
      ],
    });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
  });
});

// ─── cheatsheets ─────────────────────────────────────────────────────────────

describe("cheatsheets", () => {
  const plan = (cheatsheet: string, overrides: Partial<SubjectConfig> = {}, cfg: Partial<PlanConfig> = {}) =>
    config({ rhythm: "balanced", lernphaseStart: "mixed", subjects: [subject({ cheatsheet, approach: "foundation", ...overrides })], ...cfg });
  const studyMinutes = (sessions: ScheduledSession[]) => sum(sessions.filter(isStudy));
  const sheetMinutes = (sessions: ScheduledSession[]) => sessions.reduce((t, s) => t + (s.cheatsheetMinutes ?? 0), 0);
  const targets = (sessions: ScheduledSession[]) => sessions.filter((s) => s.cheatsheetTarget !== undefined).map((s) => s.cheatsheetTarget!);
  const prepStart = NOW.getTime();
  const exam = new Date("2026-12-18T00:00:00").getTime();
  const share = (s: ScheduledSession) => (s.scheduledAt.getTime() - prepStart) / (exam - prepStart);

  it("4: no cheatsheet allowed — no cheatsheet activity at all", () => {
    const { sessions } = generateStudyPlan(plan("none"), NOW);
    assert.deepEqual(targets(sessions), []);
    assert.equal(sheetMinutes(sessions), 0);
    assert.ok(!sessions.some((s) => s.activity === "cheatsheet" || /cheatsheet/i.test(s.title)));
  });

  it("1: existing cheatsheet — one early 1–2 h selection & familiarization session, no creation", () => {
    const cfg = plan("existing");
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const sheet = sessions.filter((s) => s.activity === "cheatsheet");
    assert.equal(sheet.length, 1);
    assert.equal(sheet[0].title, "Analysis — Cheatsheet Selection & Familiarization");
    assert.ok(sheet[0].plannedMinutes >= 60 && sheet[0].plannedMinutes <= 120, `${sheet[0].plannedMinutes} min`);
    assert.equal(sheet[0].cheatsheetMinutes, sheet[0].plannedMinutes);
    assert.ok(share(sheet[0]) < 0.35, "early in the preparation");
    assert.match(sheet[0].detail, /select|pick/i);
    assert.match(sheet[0].detail, /missing/);
    assert.ok(!sessions.some((s) => /Creation|Topic/.test(s.title)), "no creation work");
    // Bigger subjects get longer, within 1–2 h.
    const short = generateStudyPlan(plan("existing", { examDate: "2026-11-06" }), NOW).sessions.find((s) => s.activity === "cheatsheet")!;
    assert.ok(short.plannedMinutes >= 60 && short.plannedMinutes <= sheet[0].plannedMinutes);
  });

  it("2: gradual — theory recap + cheatsheet sessions with reserved time and rising milestones, then a finalization", () => {
    const cfg = plan("gradual");
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const combined = sessions.filter((s) => s.title.includes("Theory Recap + Cheatsheet — Topic"));
    assert.ok(combined.length >= 2);
    for (const s of combined) {
      // Both parts are in the data: cheatsheet minutes inside the block, the rest is theory.
      // A whole session reserves at least 15 min; split pieces share it in proportion.
      assert.ok(s.cheatsheetMinutes! > 0 && s.cheatsheetMinutes! <= s.plannedMinutes / 2, `${s.cheatsheetMinutes} of ${s.plannedMinutes}`);
      if (!s.title.endsWith("(cont.)") && s.plannedMinutes === 120) assert.ok(s.cheatsheetMinutes! >= 15);
      assert.equal(s.activity, "study");
      assert.match(s.detail, new RegExp(`Theory \\(~${s.plannedMinutes - s.cheatsheetMinutes!} min\\).*Cheatsheet \\(~${s.cheatsheetMinutes} min\\).*reach ${s.cheatsheetTarget}%`));
    }
    const t = combined.map((s) => s.cheatsheetTarget!);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1], `cumulative: ${t}`);
    assert.ok(t[t.length - 1] < 100, "the finalization takes it to 100%");
    // The final pass is part of Exam Eve, the day before the exam.
    const final = sessions.find((s) => s.title === "Analysis — Exam Eve — Final Review")!;
    assert.equal(final.cheatsheetTarget, 100);
    assert.ok(final.cheatsheetMinutes! >= 30);
    assert.ok(final.scheduledAt > combined[combined.length - 1].scheduledAt);
    assert.equal(dateKey(final.scheduledAt), "2026-12-17");
    assert.ok(!sessions.some((s) => s.title === "Analysis — Cheatsheet Finalization"), "no separate finalization");
    // The cheatsheet time is inside the study time, not on top of it (phases round to whole sessions).
    assert.ok(Math.abs(studyMinutes(sessions) - studyMinutes(generateStudyPlan(plan("none"), NOW).sessions)) <= 120);
  });

  it("2: milestones adapt to the number of combined sessions", () => {
    assert.deepEqual(cheatsheetMilestones([30, 30, 30, 30, 30]), [20, 40, 60, 80, 100]);
    assert.deepEqual(cheatsheetMilestones([20, 20, 20]), [33, 67, 100]);
    assert.deepEqual(cheatsheetMilestones([15, 15], 40), [70, 100]);
    assert.deepEqual(cheatsheetMilestones([20, 60, 20]), [20, 80, 100], "a longer session moves it further");
    // Distinct topics: a session split across days is still one topic.
    // At 20 h a week, cheatsheet time stays below its cap, so it scales with the preparation.
    const count = (examDate: string) => new Set(generateStudyPlan(plan("gradual", { examDate }, { weeklyHours: 20 }), NOW).sessions
      .filter((s) => s.title.includes("+ Cheatsheet")).map((s) => s.title.replace(" (cont.)", ""))).size;
    assert.ok(count("2026-10-30") < count("2026-12-18"));
  });

  it("3: towards the end — dedicated creation sessions late and spread out, then a finalization", () => {
    const cfg = plan("end");
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const creation = sessions.filter((s) => /Cheatsheet Creation \d/.test(s.title));
    const final = sessions.find((s) => s.title === "Analysis — Exam Eve — Final Review")!;
    assert.ok(creation.length >= 2);
    assert.ok(creation.every((s) => s.activity === "cheatsheet" && s.cheatsheetMinutes === s.plannedMinutes));
    for (const s of creation) {
      assert.ok(share(s) > 0.5, `${s.title} is too early`);
      assert.ok(dateKey(s.scheduledAt) < "2026-12-18", "before the exam");
    }
    assert.ok(new Set(creation.map((s) => dateKey(s.scheduledAt))).size >= 2, "not all on one day");
    assert.ok(!creation.some((s) => dateKey(s.scheduledAt) === "2026-12-17"), "none on Exam Eve");
    assert.ok(creation.every((s) => s.scheduledAt < final.scheduledAt));
    const t = creation.map((s) => s.cheatsheetTarget!);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1], `${t}`);
    assert.equal(final.cheatsheetTarget, 100);
    assert.ok(Math.abs(studyMinutes(sessions) - studyMinutes(generateStudyPlan(plan("none"), NOW).sessions)) <= 120, "no extra time (phases round to whole sessions)");
  });

  it("counts cheatsheet work as study within the daily limit, and never as buffer", () => {
    for (const mode of ["none", "existing", "gradual", "end"]) {
      const cfg = plan(mode, { confidence: "little", currentGrade: "3", targetGrade: "6" }, { weeklyHours: 70, studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] });
      const { sessions } = generateStudyPlan(cfg, NOW);
      assertWithinAvailability(cfg, sessions); // ≤ 8.5 h of study a day, the buffer intact
      for (const list of regularDays(sessions)) {
        assert.equal(sum(list.filter((s) => s.type === "buffer")), 90, `${mode}: buffer stays 1.5 h`);
        assert.ok(!list.some((s) => s.type === "buffer" && s.cheatsheetMinutes), "buffers carry no cheatsheet work");
      }
      // Cheatsheet sessions are study for their subject.
      for (const s of sessions.filter((x) => x.activity === "cheatsheet")) assert.ok(isStudy(s) && s.subject === "Analysis");
    }
  });

  it("keeps cheatsheet sessions when the plan is short of time — regular study gives way", () => {
    // Four subjects, little time: about a fifth of the study doesn't fit.
    const tight = config({
      weeklyHours: 30,
      rhythm: "balanced",
      lernphaseStart: "mixed",
      subjects: [
        subject({ name: "A", examDate: "2026-12-14", cheatsheet: "end", confidence: "little", allocation: 25 }),
        subject({ name: "B", examDate: "2026-12-15", cheatsheet: "gradual", confidence: "little", allocation: 25 }),
        subject({ name: "C", examDate: "2026-12-16", cheatsheet: "existing", confidence: "little", allocation: 25 }),
        subject({ name: "D", examDate: "2026-12-17", cheatsheet: "none", confidence: "little", allocation: 25 }),
      ],
    });
    const { sessions, feasibility } = generateStudyPlan(tight, NOW);
    assertWithinAvailability(tight, sessions);
    assert.ok(feasibility.shortfallMinutes > 0, "the plan is short");
    assert.ok(sessions.filter((s) => s.subject === "A" && /Cheatsheet Creation \d/.test(s.title)).length >= 2, "A keeps its creation sessions");
    // Their exams are on consecutive days, so all four share one Exam Eve: too short to also
    // hold the cheatsheet's final pass, which then stays a session of its own before it.
    for (const name of ["A", "B"]) {
      assert.ok(sessions.some((s) => s.subject === name && s.cheatsheetTarget === 100), `${name} keeps its finalization`);
    }
    assert.ok(sessions.some((s) => s.title === "C — Cheatsheet Selection & Familiarization"), "C keeps its familiarization");
    // Every theory + cheatsheet session comes before the finalization, which takes it to 100%.
    for (const name of ["A", "B"]) {
      const sheet = sessions.filter((s) => s.subject === name && s.cheatsheetTarget !== undefined);
      const final = sheet[sheet.length - 1];
      assert.match(final.title, /Exam Eve — Final Review|Cheatsheet Finalization/, `${name}: the finalization is the last cheatsheet session`);
      assert.equal(final.cheatsheetTarget, 100);
    }
    assert.ok(!feasibility.subjects.some((s) => s.shortfallMinutes > 0 && sessions.every((x) => x.subject !== s.name)));
  });

  it("continues from actual progress, and catches up when behind", () => {
    const behind = generateStudyPlan(plan("gradual"), NOW, { progress: { Analysis: { studyMinutes: 0, mocksDone: 0, cheatsheet: 40 } } });
    const t = targets(behind.sessions);
    assert.ok(t[0] > 40 && t[t.length - 1] === 100, `${t}`);
    const done = generateStudyPlan(plan("gradual"), NOW, { progress: { Analysis: { studyMinutes: 0, mocksDone: 0, cheatsheet: 100 } } });
    assert.deepEqual(targets(done.sessions), [], "a finished cheatsheet needs no more time");

    // The theory phase (and the spaced reviews spread through it) is over, but the
    // cheatsheet only at 10%: there are no theory sessions left to hold it, so
    // additional catch-up sessions are planned.
    const cfg = plan("gradual");
    const theory = generateStudyPlan(cfg, NOW).sessions
      .filter((s) => /Theory Recap \+ Cheatsheet|Theory recap|Spaced review/.test(s.title))
      .reduce((t, s) => t + s.plannedMinutes, 0);
    const progress = { Analysis: { studyMinutes: theory, mocksDone: 0, cheatsheet: 10 } };
    const late = generateStudyPlan(cfg, NOW, { progress });
    const catchUp = late.sessions.filter((s) => /Cheatsheet Catch-up \d/.test(s.title));
    assert.ok(catchUp.length > 0, "catch-up sessions when the remaining sessions can't hold the rest");
    assert.ok(catchUp.every((s) => s.activity === "cheatsheet" && s.cheatsheetMinutes === s.plannedMinutes));
    const onTrack = generateStudyPlan(cfg, NOW, { progress: { Analysis: { ...progress.Analysis, cheatsheet: 95 } } });
    assert.ok(sheetMinutes(late.sessions) > sheetMinutes(onTrack.sessions) + 60, "falling behind adds cheatsheet time");
  });
});

// ─── focus days and subjects per day ─────────────────────────────────────────

const four = [
  subject({ name: "Analysis II", examDate: "2027-01-25", approach: "foundation", allocation: 25 }),
  subject({ name: "Theoretical CS", examDate: "2027-01-28", approach: "foundation", allocation: 25 }),
  subject({ name: "Systems Programming", examDate: "2027-02-02", approach: "balanced", confidence: "little", allocation: 25 }),
  subject({ name: "Numerical Methods", examDate: "2027-02-05", approach: "exam", confidence: "mostly", allocation: 25 }),
];
const subjectsPerDay = (sessions: ScheduledSession[]) =>
  [...byDay(sessions)].map(([key, list]) => [key, [...new Set(list.filter(isStudy).map((s) => s.subject))]] as const);

describe("initial focus days", () => {
  it("opens with one subject per study day, skipping days off and vacations", () => {
    const cfg = config({
      weeklyHours: 40,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      vacationRanges: [{ start: "2026-10-14", end: "2026-10-15" }],
      lernphaseStart: "focus",
      focusDays: 3,
      subjects: four,
    });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const days = subjectsPerDay(sessions);
    // Study days: Mon 12, Tue 13, (vacation Wed–Thu), Fri 16, Mon 19, …
    assert.deepEqual(days.slice(0, 3).map(([key]) => key), ["2026-10-12", "2026-10-13", "2026-10-16"]);
    const opening = days.slice(0, 12).map(([, list]) => list);
    assert.ok(opening.every((list) => list.length === 1), JSON.stringify(opening));
    assert.deepEqual(opening.map((list) => list[0]), [
      ...Array(3).fill("Analysis II"),
      ...Array(3).fill("Theoretical CS"),
      ...Array(3).fill("Systems Programming"),
      ...Array(3).fill("Numerical Methods"),
    ], "one subject at a time, by exam date");
    // Focus days follow the subject's own strategy: a foundation subject starts with theory.
    assert.ok(sessions.filter((s) => dateKey(s.scheduledAt) === "2026-10-12" && isStudy(s)).every((s) => /Theory recap/.test(s.title)));
    // Afterwards the plan mixes subjects again.
    assert.ok(days.slice(12).some(([, list]) => list.length === 2));
  });

  it("recommended: foundation subjects get immersion, revise & practice a short refresher, exam-focused none", () => {
    const cfg = config({ weeklyHours: 40, studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lernphaseStart: "recommended", subjects: four });
    const { sessions } = generateStudyPlan(cfg, NOW);
    const days = subjectsPerDay(sessions);
    // Analysis II and TCS: 3 days each (gaps, plenty of time); Systems Programming (revise & practice,
    // little confidence): a 1-day refresher; Numerical Methods (exam-focused): none.
    assert.deepEqual(days.slice(0, 7).map(([, list]) => list), [
      ...Array(3).fill(["Analysis II"]),
      ...Array(3).fill(["Theoretical CS"]),
      ["Systems Programming"],
    ]);
    assert.ok(days[7][1].length === 2, "then mixed days");
    assert.ok(!days.slice(0, 7).flat(2).includes("Numerical Methods"), "exam-focused subject has no forced immersion");
    // Without focus days it goes straight to past-exam style work, not a run of theory days.
    const firstNumerical = sessions.find((s) => s.subject === "Numerical Methods" && isStudy(s))!;
    assert.doesNotMatch(firstNumerical.title, /Theory/);
  });

  it("mixed: rotates subjects from day one", () => {
    const cfg = config({ weeklyHours: 40, lernphaseStart: "mixed", subjects: four });
    const days = subjectsPerDay(generateStudyPlan(cfg, NOW).sessions);
    assert.equal(days[0][1].length, 2);
  });

  it("shortens focus days when exams are close, and says so", () => {
    const cfg = config({
      weeklyHours: 40,
      lernphaseStart: "focus",
      focusDays: 5,
      subjects: four.slice(0, 3).map((s, i) => ({ ...s, examDate: ["2026-11-04", "2026-11-05", "2026-11-06"][i] })),
    });
    const { sessions, feasibility } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.ok(feasibility.adjustments.some((a) => /immersion day/.test(a)), JSON.stringify(feasibility.adjustments));
  });
});

describe("at most two subjects a day", () => {
  it("never puts a third subject on a day, mocks, reviews and cheatsheets included", () => {
    const cfg = config({
      weeklyHours: 60,
      lernphaseStart: "mixed",
      subjects: four.map((s) => ({ ...s, mockCount: "4", cheatsheet: "end" })),
    });
    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    for (const [key, list] of subjectsPerDay(sessions)) assert.ok(list.length <= MAX_SUBJECTS_PER_DAY, `${key}: ${list}`);
  });

  it("keeps each subject's blocks together", () => {
    const cfg = config({ weeklyHours: 60, lernphaseStart: "mixed", subjects: four });
    for (const [key, list] of byDay(generateStudyPlan(cfg, NOW).sessions)) {
      const order = list.filter(isStudy).map((s) => s.subject);
      const switches = order.filter((s, i) => i > 0 && s !== order[i - 1]).length;
      assert.ok(switches <= 1, `${key}: ${order}`);
    }
  });
});

// ─── regenerating a plan ─────────────────────────────────────────────────────

describe("regenerating a plan", () => {
  it("schedules only the work that isn't done yet, numbering on from it", () => {
    const cfg = config({ rhythm: "balanced", lernphaseStart: "mixed", subjects: [subject({ mockCount: "3", cheatsheet: "gradual" })] });
    const first = generateStudyPlan(cfg, NOW);
    // Two weeks later: the first 12 study sessions and one mock are done.
    const later = new Date(2026, 9, 26, 8, 0);
    const studied = first.sessions.filter((s) => s.activity === "study").slice(0, 12);
    const progress = {
      Analysis: {
        studyMinutes: studied.reduce((t, s) => t + s.plannedMinutes, 0),
        mocksDone: 1,
        cheatsheet: Math.max(0, ...studied.map((s) => s.cheatsheetTarget ?? 0)),
      },
    };
    const again = generateStudyPlan(
      { ...cfg, planStart: first.planStart, workloadBasisWeeklyMinutes: first.workloadBasisWeeklyMinutes },
      later,
      { progress },
    );

    assert.ok(again.sessions.every((s) => s.type === "exam" || s.scheduledAt >= later), "nothing in the past");
    const doneTitles = new Set(studied.map((s) => s.title.replace(" (cont.)", "")));
    const repeated = again.sessions.filter((s) => doneTitles.has(s.title));
    assert.deepEqual(repeated.map((s) => s.title), [], "completed sessions aren't scheduled again");
    const mocks = again.sessions.filter((s) => s.activity === "mock_exam").map((s) => s.title);
    assert.deepEqual(mocks, ["Analysis — Mock exam 2", "Analysis — Mock exam 3"]);
    const t = again.sessions.filter((s) => s.cheatsheetTarget !== undefined).map((s) => s.cheatsheetTarget!);
    assert.ok(t.length > 0 && t.every((x) => x > progress.Analysis.cheatsheet), `${progress.Analysis.cheatsheet} → ${t}`);
  });
});

// ─── mock planning ───────────────────────────────────────────────────────────

describe("planning mock exams", () => {
  const base = {
    available: 5, completed: 0, currentGrade: 4, targetGrade: 5, confidence: "some",
    approach: "balanced", customPhases: [], studyMinutes: 120 * 60, studyDays: 40, mockMinutes: 150,
  };

  it("treats available mocks as an upper bound and keeps the rest in reserve", () => {
    const plan = planMocks(base);
    assert.deepEqual([plan.available, plan.planned, plan.reserve], [5, 3, 2]);
    assert.match(plan.reason, /3 of 5 planned/);
  });

  it("plans more for a bigger gap, low confidence or an exam-focused strategy — never more than available", () => {
    assert.ok(planMocks({ ...base, currentGrade: 3.5, targetGrade: 5.5, confidence: "little" }).planned > planMocks(base).planned);
    assert.ok(planMocks({ ...base, approach: "exam" }).planned > planMocks(base).planned);
    assert.equal(planMocks({ ...base, available: 2, approach: "exam", confidence: "little", targetGrade: 6 }).planned, 2);
    assert.equal(planMocks({ ...base, confidence: "very", targetGrade: 4 }).planned, 1, "at least one mock when there's any");
    assert.equal(planMocks({ ...base, available: 0 }).planned, 0);
  });

  it("plans fewer when time before the exam is short, and says why", () => {
    const tight = planMocks({ ...base, approach: "exam", studyMinutes: 15 * 60, studyDays: 5 });
    assert.ok(tight.planned < planMocks({ ...base, approach: "exam" }).planned);
    assert.match(tight.reason, /limited by the time left/);
    assert.equal(tight.planned + tight.reserve, 5);
  });

  it("reassesses with logged results and completed mocks", () => {
    // A weak mock result raises the estimate of the gap: more practice from the reserve.
    const weak = planMocks({ ...base, completed: 1, latestMockGrade: 3.5 });
    const asPlanned = planMocks({ ...base, completed: 1 });
    assert.ok(weak.planned > asPlanned.planned, `${weak.planned} vs ${asPlanned.planned}`);
    // Already at the target: one final check, the rest stays in reserve.
    const onTrack = planMocks({ ...base, completed: 2, latestMockGrade: 5.25 });
    assert.deepEqual([onTrack.planned, onTrack.reserve], [1, 2]);
    // Completed mocks come off what's left.
    const allDone = planMocks({ ...base, completed: 5 });
    assert.deepEqual([allDone.planned, allDone.reserve], [0, 0]);
  });

  it("only counts planned mocks in the workload: more available mocks don't inflate it", () => {
    const withMocks = (mockCount: string) => config({ lernphaseStart: "mixed", subjects: [subject({ mockCount })] });
    const five = generateStudyPlan(withMocks("5"), NOW);
    const eighteen = generateStudyPlan(withMocks("18"), NOW);
    assert.equal(five.sessions.filter((s) => s.activity === "mock_exam").length, five.feasibility.subjects[0].mocks.planned);
    assert.equal(five.feasibility.subjects[0].mocks.planned, eighteen.feasibility.subjects[0].mocks.planned);
    assert.equal(five.feasibility.requiredMinutes, eighteen.feasibility.requiredMinutes);
    assert.equal(eighteen.feasibility.subjects[0].mocks.reserve, 18 - eighteen.feasibility.subjects[0].mocks.planned);
    // Workload = planned mocks with realistic reviews + regular study; the reserve costs nothing.
    const planned = five.feasibility.subjects[0].mocks.planned;
    const mockMinutes = five.sessions.filter((s) => s.activity === "mock_exam" || s.activity === "mock_review").reduce((t, s) => t + s.plannedMinutes, 0);
    assert.ok(Math.abs(mockMinutes - mockWorkload(150, planned)) <= 60, `${mockMinutes} vs ${mockWorkload(150, planned)}`);
  });

  it("never suggests reducing the number of available mocks", () => {
    const cfg = config({
      weeklyHours: 20,
      subjects: [subject({ mockCount: "18", confidence: "little", currentGrade: "3", targetGrade: "6" })],
    });
    const { feasibility } = generateStudyPlan(cfg, NOW);
    assert.ok(feasibility.suggestions.length > 0);
    assert.ok(!feasibility.suggestions.some((s) => /mock/i.test(s)), feasibility.suggestions.join(" | "));
  });
});

describe("feasibility report", () => {
  const check = (f: ReturnType<typeof generateStudyPlan>["feasibility"]) => {
    assert.equal(f.overallShortfallMinutes, Math.max(0, f.requiredMinutes - f.availableMinutes));
    assert.equal(f.overallShortfallMinutes + f.deadlineShortfallMinutes, f.shortfallMinutes);
    assert.equal(f.requiredMinutes, f.scheduledMinutes + f.shortfallMinutes);
  };

  it("reports a deadline shortage, not an overall one, when total hours suffice", () => {
    const cfg = config({
      weeklyHours: 30,
      lernphaseStart: "mixed",
      subjects: [
        subject({ name: "Early", examDate: "2026-10-27", confidence: "little", currentGrade: "3", targetGrade: "6", allocation: 50, mockCount: "0" }),
        subject({ name: "Late", examDate: "2027-02-26", confidence: "very", currentGrade: "5", targetGrade: "5", allocation: 50, mockCount: "0" }),
      ],
    });
    const { feasibility: f } = generateStudyPlan(cfg, NOW);
    check(f);
    assert.ok(f.availableMinutes > f.requiredMinutes, "enough hours in total");
    assert.equal(f.overallShortfallMinutes, 0);
    assert.ok(f.deadlineShortfallMinutes >= 60);
    const early = f.subjects.find((s) => s.name === "Early")!;
    assert.ok(early.shortfallMinutes > 0 && early.availableBeforeExamMinutes < f.availableMinutes);
  });

  it("reports an overall shortage when the hours really don't suffice", () => {
    const cfg = config({ weeklyHours: 10, subjects: [subject({ confidence: "little", currentGrade: "3", targetGrade: "6" })] });
    const { feasibility: f } = generateStudyPlan(cfg, NOW);
    check(f);
    assert.ok(f.overallShortfallMinutes > 0);
  });

  it("stays consistent for every plan in this file's scenarios", () => {
    for (const cfg of [config(), config({ subjects: four }), config({ weeklyHours: 12, subjects: four })]) {
      check(generateStudyPlan(cfg, NOW).feasibility);
    }
  });
});

// ─── Exam Eve ────────────────────────────────────────────────────────────────

describe("Exam Eve", () => {
  const eves = (sessions: ScheduledSession[]) => sessions.filter((s) => s.activity === "exam_eve");
  const two = [
    subject({ name: "Analysis", examDate: "2026-12-10", cheatsheet: "gradual", allocation: 50 }),
    subject({ name: "Physics", examDate: "2026-12-18", allocation: 50 }),
  ];

  it("reserves the day before each exam for one 2–4 h final review of that subject only", () => {
    const cfg = config({ weeklyHours: 60, lernphaseStart: "mixed", subjects: two });
    const { sessions, eveDates } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    for (const [name, eveDay] of [["Analysis", "2026-12-09"], ["Physics", "2026-12-17"]]) {
      const eve = eves(sessions).filter((s) => s.subject === name);
      assert.equal(eve.length, 1, `${name}: one Exam Eve`);
      assert.equal(eve[0].title, `${name} — Exam Eve — Final Review`);
      assert.equal(dateKey(eve[0].scheduledAt), eveDay, `${name}: the day before the exam`);
      assert.ok(eve[0].plannedMinutes >= 120 && eve[0].plannedMinutes <= 240, `${eve[0].plannedMinutes} min`);
      assert.equal(eve[0].prepPhase, "taper");
      assert.match(eve[0].detail, /no new topics, no full mocks/);
      const day = byDay(sessions).get(eveDay)!;
      assert.deepEqual([...new Set(day.filter(isStudy).map((s) => s.subject))], [name], "only that subject");
      assert.ok(!day.some((s) => s.activity === "mock_exam" || s.activity === "mock_review"), "no mocks");
      assert.ok(!day.some((s) => s.type === "buffer"), "no catch-up buffer");
      assert.deepEqual(eveDates[eveDay], [name]);
    }
    // Analysis builds its cheatsheet gradually: the final pass is part of its eve.
    const analysisEve = eves(sessions).find((s) => s.subject === "Analysis")!;
    assert.equal(analysisEve.cheatsheetTarget, 100);
    assert.match(analysisEve.detail, /Cheatsheet \(~\d+ min\): final check/);
  });

  it("uses the last study day when the day before is a day off, and says so", () => {
    // Exam on Monday 14 Dec; Sundays are days off → eve on Saturday 12 Dec.
    const cfg = config({ lernphaseStart: "mixed", subjects: [subject({ examDate: "2026-12-14" })] });
    const { sessions, feasibility } = generateStudyPlan(cfg, NOW);
    assert.equal(dateKey(eves(sessions)[0].scheduledAt), "2026-12-12");
    assert.ok(feasibility.adjustments.some((a) => /Exam Eve is 2026-12-12/.test(a)));
  });

  it("lets consecutive exams share an eve, explicitly, within 4 h", () => {
    const cfg = config({
      weeklyHours: 60,
      lernphaseStart: "mixed",
      subjects: [
        subject({ name: "Analysis", examDate: "2026-12-14", allocation: 50 }),
        subject({ name: "Physics", examDate: "2026-12-15", allocation: 50 }),
      ],
    });
    const { sessions, feasibility } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const shared = eves(sessions);
    assert.equal(new Set(shared.map((s) => dateKey(s.scheduledAt))).size, 1, "one shared eve");
    assert.ok(sum(shared) <= 240);
    assert.ok(feasibility.adjustments.some((a) => /share their Exam Eve/.test(a)));
  });

  it("is reserved first: a tight plan gives up regular study, never the eve", () => {
    const cfg = config({ weeklyHours: 12, subjects: [subject({ confidence: "little", currentGrade: "3", targetGrade: "6" })] });
    const { sessions, feasibility } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    assert.ok(feasibility.shortfallMinutes > 0, "the plan is short");
    assert.equal(eves(sessions).length, 1);
    assert.ok(eves(sessions)[0].plannedMinutes >= 60);
  });
});

// ─── Foundation immersion ────────────────────────────────────────────────────

describe("Foundation immersion", () => {
  it("sizes immersion by strategy, confidence and time left", () => {
    const foundation = { approach: "foundation", confidence: "little", currentGrade: "3.5", targetGrade: "5" };
    assert.equal(immersionDays(foundation, 40), 3, "gaps and plenty of time");
    assert.equal(immersionDays(foundation, 15), 2, "time is tighter");
    assert.equal(immersionDays(foundation, 6), 1, "exam is close: a diagnostic day");
    assert.equal(immersionDays(foundation, 2), 0);
    assert.equal(immersionDays({ ...foundation, confidence: "very", currentGrade: "5" }, 40), 2, "few gaps");
    assert.equal(immersionDays({ ...foundation, approach: "balanced" }, 40), 1, "revise & practice: a refresher when needed");
    assert.equal(immersionDays({ ...foundation, approach: "balanced", confidence: "mostly" }, 40), 0);
    assert.equal(immersionDays({ ...foundation, approach: "exam" }, 40), 0, "exam-focused: none");
  });

  const plan = () => config({
    weeklyHours: 40,
    studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    lernphaseStart: "recommended",
    subjects: [
      subject({ name: "Analysis II", examDate: "2027-01-25", approach: "foundation", confidence: "little", allocation: 50 }),
      subject({ name: "Numerics", examDate: "2027-01-29", approach: "exam", allocation: 50 }),
    ],
  });

  it("gives each immersion day its theme from the subject's own sessions", () => {
    const { sessions } = generateStudyPlan(plan(), NOW);
    const day = (n: number) => sessions.filter((s) => s.title.includes(`Immersion Day ${n}:`));
    assert.ok(day(1).length > 0 && day(1).every((s) => /Core theory & topic map \(Theory recap \d+/.test(s.title)));
    assert.ok(day(2).length > 0 && day(2).every((s) => /Exercises & active recall \(Exercises \d+/.test(s.title)));
    assert.ok(day(3).length > 0 && day(3).every((s) => /Exam-style problems \(Past-exam practice \d+/.test(s.title)));
    assert.ok([1, 2, 3].every((n) => day(n).every((s) => s.subject === "Analysis II" && s.prepPhase === "foundation")));
    // One subject per immersion day.
    for (const n of [1, 2, 3]) {
      const key = dateKey(day(n)[0].scheduledAt);
      assert.deepEqual([...new Set(byDay(sessions).get(key)!.filter(isStudy).map((s) => s.subject))], ["Analysis II"]);
    }
  });

  it("revisits the subject with spaced retrieval after the immersion", () => {
    const { sessions } = generateStudyPlan(plan(), NOW);
    const lastImmersion = sessions.filter((s) => s.title.includes("Immersion Day")).at(-1)!.scheduledAt;
    const retrieval = sessions.filter((s) => /Spaced Retrieval \d \(after immersion\)/.test(s.title));
    assert.equal(retrieval.length, 3);
    assert.ok(retrieval.every((s) => s.subject === "Analysis II" && s.scheduledAt > lastImmersion));
    const daysAfter = retrieval.map((s) => Math.round((s.scheduledAt.getTime() - lastImmersion.getTime()) / 864e5));
    for (let i = 1; i < daysAfter.length; i++) assert.ok(daysAfter[i] > daysAfter[i - 1], `spaced out: ${daysAfter}`);
  });

  it("replaces existing sessions rather than adding workload", () => {
    const cfg = plan();
    const required = (c: PlanConfig) => generateStudyPlan(c, NOW).feasibility.subjects.find((s) => s.name === "Analysis II")!.requiredMinutes;
    assert.ok(Math.abs(required(cfg) - required({ ...cfg, lernphaseStart: "mixed" })) <= 30, "same workload, just arranged differently");
  });

  it("is shortened before essential work when the plan is tight", () => {
    // Analysis II wants 3 immersion days; Numerics' exam is close and needs those days.
    const cfg = config({
      weeklyHours: 20,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      lernphaseStart: "recommended",
      subjects: [
        subject({ name: "Numerics", examDate: "2026-10-30", approach: "exam", confidence: "little", currentGrade: "3", targetGrade: "6", allocation: 70 }),
        subject({ name: "Analysis II", examDate: "2026-12-18", approach: "foundation", confidence: "little", allocation: 30 }),
      ],
    });
    const { sessions, feasibility } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);
    const immersion = new Set(sessions.filter((s) => s.title.includes("Immersion Day")).map((s) => dateKey(s.scheduledAt))).size;
    assert.ok(immersion < 3, `immersion shortened to ${immersion} day(s)`);
    assert.ok(feasibility.adjustments.some((a) => /immersion/i.test(a)), JSON.stringify(feasibility.adjustments));
  });
});

// ─── Phases ──────────────────────────────────────────────────────────────────

describe("subject phases", () => {
  it("moves each subject through Foundation → Build → Peak → Taper on its own timeline", () => {
    const cfg = config({
      weeklyHours: 40,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      lernphaseStart: "recommended",
      subjects: [
        subject({ name: "Analysis II", examDate: "2026-12-11", approach: "foundation", confidence: "little", allocation: 50 }),
        subject({ name: "Numerics", examDate: "2027-01-29", approach: "exam", allocation: 50 }),
      ],
    });
    const { sessions, feasibility } = generateStudyPlan(cfg, NOW);
    const order = ["foundation", "build", "peak", "taper"];
    for (const s of feasibility.subjects) {
      const phases = s.phases.map((p) => p.phase);
      for (let i = 1; i < phases.length; i++) assert.ok(order.indexOf(phases[i]) > order.indexOf(phases[i - 1]), `${s.name}: ${phases}`);
      assert.equal(phases.at(-1), "taper");
    }
    assert.deepEqual(feasibility.subjects.find((s) => s.name === "Analysis II")!.phases.map((p) => p.phase), order);
    assert.ok(!feasibility.subjects.find((s) => s.name === "Numerics")!.phases.some((p) => p.phase === "foundation"), "exam-focused: no foundation");
    // On one day, the subjects can be in different phases.
    const analysisPeak = feasibility.subjects.find((s) => s.name === "Analysis II")!.phases.find((p) => p.phase === "peak")!;
    const numericsThen = sessions.find((s) => s.subject === "Numerics" && dateKey(s.scheduledAt) >= analysisPeak.from && isStudy(s))!;
    assert.equal(numericsThen.prepPhase, "build");
    // Every study block carries its phase.
    assert.ok(sessions.filter(isStudy).every((s) => s.prepPhase));
  });
});

describe("session types", () => {
  it("types every block by what the student does in it", () => {
    const cfg = config({ subjects: [subject({ cheatsheet: "gradual" })] });
    const { sessions } = generateStudyPlan(cfg, NOW, { quizGaps: { Analysis: 0.5 } });
    const expected: Record<string, string> = {
      mock_exam: "mock_exam", mock_review: "mock_exam", quiz: "quiz", cheatsheet: "theory", exam_eve: "theory",
    };
    for (const s of sessions) {
      if (expected[s.activity]) assert.equal(s.type, expected[s.activity], s.title);
    }
    const study = sessions.filter((s) => s.activity === "study" && !s.title.includes("Immersion"));
    const phaseType: [RegExp, string][] = [
      [/Theory recap|Final revision/, "theory"], [/Exercises/, "exercises"],
      [/Spaced review/, "quiz"], [/Past-exam practice/, "mock_exam"],
    ];
    for (const s of study) {
      const match = phaseType.find(([re]) => re.test(s.title));
      if (match) assert.equal(s.type, match[1], s.title);
    }
    assert.ok(sessions.some((s) => s.type === "quiz" && s.activity === "quiz"), "knowledge-gap quizzes are planned");
  });

  it("spreads spaced reviews through the subject's study instead of running them back to back", () => {
    const { sessions } = generateStudyPlan(config(), NOW);
    const study = sessions.filter((s) => s.activity === "study").sort((a, b) => +a.scheduledAt - +b.scheduledAt);
    const reviews = study.flatMap((s, i) => (/Spaced review/.test(s.title) ? [i] : []));
    assert.ok(reviews.length > 1);
    for (let k = 1; k < reviews.length; k++) assert.ok(reviews[k] - reviews[k - 1] > 1, `reviews at ${reviews}`);
    const firstExercise = study.findIndex((s) => /Exercises/.test(s.title));
    assert.ok(reviews[0] < firstExercise, "the first review comes during the theory phase");
  });
});
