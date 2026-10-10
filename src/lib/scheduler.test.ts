import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dailyBufferMinutes,
  dailyWindowMinutes,
  generateStudyPlan,
  mockReviewMinutes,
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
const isStudy = (s: ScheduledSession) => s.type !== "exam" && s.type !== "buffer";

function byDay(sessions: ScheduledSession[]) {
  const map = new Map<string, ScheduledSession[]>();
  for (const s of sessions) {
    if (s.type === "exam") continue;
    const key = dateKey(s.scheduledAt);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return map;
}

/** The hard constraints every generated plan must satisfy. */
function assertWithinAvailability(cfg: PlanConfig, sessions: ScheduledSession[]) {
  const window = dailyWindowMinutes(cfg);
  const buffer = dailyBufferMinutes(window);
  const startHour = cfg.preferredStartHour ?? 9;
  const examKeys = new Set(cfg.subjects.map((s) => s.examDate));

  for (const [key, list] of byDay(sessions)) {
    const day = list[0].scheduledAt;
    assert.ok(cfg.studyDays.includes(DAY_NAMES[day.getDay()]), `${key} is not a study day`);
    assert.ok(!examKeys.has(key), `${key} is an exam day`);
    for (const r of cfg.vacationRanges) {
      assert.ok(key < r.start || key > r.end, `${key} is in a vacation`);
    }

    const study = list.filter(isStudy).reduce((sum, s) => sum + s.plannedMinutes, 0);
    assert.ok(study <= window - buffer, `${key}: ${study} min of study exceeds ${window - buffer}`);

    const windowStart = new Date(day);
    windowStart.setHours(startHour, 0, 0, 0);
    for (const s of list) {
      assert.ok(s.scheduledAt >= windowStart, `${key}: ${s.title} starts before the window`);
      assert.ok(end(s) <= windowStart.getTime() + window * 60_000, `${key}: ${s.title} ends after the window`);
    }

    // No overlaps.
    const sorted = [...list].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].scheduledAt.getTime() >= end(sorted[i - 1]), `${key}: overlap at ${sorted[i].title}`);
    }
  }
}

describe("daily study hours", () => {
  it("reserves a 1.5 h buffer inside a 10 h day, leaving 8.5 h of study", () => {
    const cfg = config(); // 60 h over 6 days = 10 h/day
    assert.equal(dailyWindowMinutes(cfg), 600);
    assert.equal(dailyBufferMinutes(600), 90);

    const { sessions } = generateStudyPlan(cfg, NOW);
    assertWithinAvailability(cfg, sessions);

    for (const [key, list] of byDay(sessions)) {
      const buffers = list.filter((s) => s.type === "buffer");
      assert.equal(buffers.length, 1, `${key} should have one buffer`);
      assert.equal(buffers[0].title, "Buffer / Catch-up Time");
      assert.equal(buffers[0].plannedMinutes, 90);
    }
  });

  it("fills a 10 h day with exactly 8.5 h of activities and 1.5 h of buffer", () => {
    // Little confidence + a big grade gap: more work than time, so every day should be full.
    const cfg = config({
      weeklyHours: 70,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      subjects: [subject({ confidence: "little", currentGrade: "3", targetGrade: "6", examDuration: "178", mockCount: "5" })],
    });
    const { sessions } = generateStudyPlan(cfg, NOW);
    const days = [...byDay(sessions)];
    assert.ok(days.length > 50);
    for (const [key, list] of days) {
      const sorted = [...list].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      const first = sorted[0].scheduledAt;
      const buffer = sorted[sorted.length - 1];
      assert.equal(buffer.type, "buffer", `${key} ends with the buffer`);
      assert.equal(buffer.plannedMinutes, 90);
      // Blocks + breaks run 09:00 → buffer, buffer runs to 19:00.
      assert.equal(first.getHours() * 60 + first.getMinutes(), 9 * 60, key);
      assert.equal(buffer.scheduledAt.getTime() - first.getTime(), 510 * 60_000, `${key}: 8.5 h before the buffer`);
      assert.equal(end(buffer) - first.getTime(), 600 * 60_000, `${key}: 10 h in total`);
      const breaks = sorted.slice(1).reduce((t, s, i) => t + (s.scheduledAt.getTime() - end(sorted[i])) / 60_000, 0);
      const study = sorted.filter(isStudy).reduce((t, s) => t + s.plannedMinutes, 0);
      assert.equal(study + breaks, 510, key);
      assert.ok(breaks === 0 || breaks === 15, `${key}: only the mock→review break, got ${breaks}`);
    }
  });

  it("runs blocks back to back at exact minutes", () => {
    const cfg = config({ subjects: [subject({ examDuration: "118", confidence: "little" })] });
    const { sessions } = generateStudyPlan(cfg, NOW);
    let oddStarts = 0;
    for (const list of byDay(sessions).values()) {
      const sorted = [...list].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      for (let i = 1; i < sorted.length; i++) {
        const gap = (sorted[i].scheduledAt.getTime() - end(sorted[i - 1])) / 60_000;
        const isReviewAfterMock = sorted[i].title.includes("Mock Exam Review") && /Mock exam \d/.test(sorted[i - 1].title);
        assert.equal(gap, isReviewAfterMock ? 15 : 0, `${sorted[i].title}`);
        if (sorted[i].scheduledAt.getMinutes() % 15 !== 0) oddStarts++;
      }
    }
    assert.ok(oddStarts > 0, "118-minute mocks should produce starts off the quarter hour");
  });

  it("starts today's sessions from the current time", () => {
    const at1445 = new Date(2026, 9, 12, 14, 45);
    const cfg = config({ weeklyHours: 60 });
    const { sessions } = generateStudyPlan(cfg, at1445);
    const today = sessions.filter((s) => dateKey(s.scheduledAt) === "2026-10-12");
    assert.ok(today.length > 0);
    assert.equal(today[0].scheduledAt.getHours(), 14);
    assert.equal(today[0].scheduledAt.getMinutes(), 45);
    for (const s of today) assert.ok(end(s) <= new Date(2026, 9, 12, 19, 0).getTime());
  });

  it("keeps the buffer out of the per-subject breakdown", () => {
    const { breakdown } = generateStudyPlan(config(), NOW);
    assert.deepEqual(Object.keys(breakdown), ["Analysis"]);
  });

  it("scales the buffer down on short days", () => {
    assert.equal(dailyBufferMinutes(240), 60);
    assert.equal(dailyBufferMinutes(120), 30);
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

  it("last as long as the real exam", () => {
    const { sessions } = generateStudyPlan(config({ subjects: [subject({ examDuration: "150" })] }), NOW);
    assert.equal(mocks(sessions).length, 3);
    for (const m of mocks(sessions)) assert.equal(m.plannedMinutes, 150);
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
      // With room in the day, the review follows after a short break.
      assert.equal(r.scheduledAt.getTime() - end(m), 15 * 60_000);
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
