import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_DAY_WINDOW_MINUTES, dayFits, floorsFromPredictions, recommendAdjustments } from "./plan-adjustments";
import { dailyWindowMinutes, generateStudyPlan, type PlanConfig, type SubjectConfig } from "./scheduler";

// Monday, 12 Oct 2026.
const NOW = new Date(2026, 9, 12, 8, 0);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function subject(overrides: Partial<SubjectConfig> = {}): SubjectConfig {
  return {
    name: "Analysis",
    examDate: "2026-12-18",
    examDuration: "150",
    targetGrade: "5.5",
    currentGrade: "4",
    confidence: "little",
    approach: "foundation",
    customPhases: [],
    mockCount: "6",
    allocation: 100,
    materials: [],
    cheatsheet: "gradual",
    comments: "",
    ...overrides,
  };
}

/** A plan as the wizard generates it: the workload basis frozen at its first generation. */
function plan(overrides: Partial<PlanConfig> = {}): PlanConfig {
  const config: PlanConfig = {
    planName: "Test",
    weeklyHours: 20,
    studyDays: WEEKDAYS,
    sessionLength: 120,
    vacationRanges: [],
    subjects: [subject()],
    ...overrides,
  };
  const first = generateStudyPlan(config, NOW, { suggest: false });
  return { ...config, workloadBasisWeeklyMinutes: first.workloadBasisWeeklyMinutes };
}

const short = (c: PlanConfig) => generateStudyPlan(c, NOW, { suggest: false }).feasibility;
/** Apply a recommendation the way the UI does. */
const applied = (c: PlanConfig, r: ReturnType<typeof recommendAdjustments>["time"]): PlanConfig => ({
  ...c,
  weeklyHours: r.weeklyHours.to,
  studyDays: r.studyDays.to,
  subjects: c.subjects.map((s) => {
    const t = r.targets.find((x) => x.subject === s.name);
    return t ? { ...s, targetGrade: String(t.to) } : s;
  }),
});

const three = [
  subject({ name: "Analysis", examDate: "2026-11-20", allocation: 34 }),
  subject({ name: "Physics", examDate: "2026-11-24", targetGrade: "5.25", allocation: 33 }),
  subject({ name: "Chemistry", examDate: "2026-11-27", targetGrade: "5", currentGrade: "3.75", allocation: 33 }),
];

describe("smart plan adjustment", () => {
  it("summarises the scheduler's own feasibility numbers", () => {
    const config = plan({ subjects: three });
    const { current } = recommendAdjustments({ config, now: NOW });
    const f = short(config);
    assert.equal(current.availableMinutes, f.availableMinutes);
    assert.equal(current.requiredMinutes, f.requiredMinutes);
    assert.equal(current.shortfallMinutes, f.shortfallMinutes);
    assert.ok(current.needsMoreTime);
    assert.deepEqual(current.subjects.map((s) => s.name), f.subjects.filter((s) => s.shortfallMinutes > 0).map((s) => s.name));
  });

  it("every recommendation is what the scheduler gives when it's applied", () => {
    const config = plan({ subjects: three });
    const rec = recommendAdjustments({ config, now: NOW });
    for (const r of [rec.targets, rec.time, rec.balanced]) {
      const f = short(applied(config, r));
      assert.equal(r.feasibility.shortfallMinutes, f.shortfallMinutes, r.kind);
      assert.equal(r.resolved, !f.needsMoreTime, r.kind);
    }
  });

  it("more time: the smallest increase that fits, on realistic days only", () => {
    const config = plan({ subjects: three });
    const { time } = recommendAdjustments({ config, now: NOW });
    assert.ok(time.resolved);
    assert.ok(time.weeklyHours.to > config.weeklyHours);
    assert.deepEqual(time.targets, []);
    assert.ok(dailyWindowMinutes({ weeklyHours: time.weeklyHours.to, studyDays: time.studyDays.to }) <= MAX_DAY_WINDOW_MINUTES);
    // One hour less on the same days would still be short.
    const less = { ...applied(config, time), weeklyHours: time.weeklyHours.to - 1 };
    if (time.studyDays.to.join() === config.studyDays.join()) assert.ok(short(less).needsMoreTime);
  });

  it("a slightly insufficient plan needs only a small increase", () => {
    const tight = plan({ weeklyHours: 20, subjects: [subject({ confidence: "some", approach: "balanced" })] });
    const base = short(tight);
    const { time } = recommendAdjustments({ config: tight, now: NOW });
    if (base.needsMoreTime) {
      assert.ok(time.resolved);
      assert.ok(time.weeklyHours.to - time.weeklyHours.from <= 8, `${time.weeklyHours.from} → ${time.weeklyHours.to}`);
    } else {
      assert.ok(!recommendAdjustments({ config: tight, now: NOW }).current.needsMoreTime);
    }
  });

  it("balanced: less extra time than 'more time', targets only lowered as far as needed", () => {
    const config = plan({ subjects: three });
    const { time, balanced } = recommendAdjustments({ config, now: NOW });
    assert.ok(balanced.weeklyHours.to <= time.weeklyHours.to);
    assert.deepEqual(balanced.studyDays.to, config.studyDays);
    // If its hours alone fix the plan, no target changes.
    const hoursOnly = short({ ...config, weeklyHours: balanced.weeklyHours.to });
    if (!hoursOnly.needsMoreTime) assert.deepEqual(balanced.targets, []);
  });

  it("targets: keep availability, never go below the current grade or the model's forecast", () => {
    const config = plan({ subjects: three });
    const floors = floorsFromPredictions([{ subject: "Analysis", examDay: { grade: 4.62 } }]);
    const { targets } = recommendAdjustments({ config, now: NOW, floors });
    assert.equal(targets.weeklyHours.to, config.weeklyHours);
    assert.deepEqual(targets.studyDays.to, config.studyDays);
    for (const t of targets.targets) {
      assert.ok(t.to < t.from && t.to >= t.floor.grade, `${t.subject}: ${t.from} → ${t.to} (floor ${t.floor.grade})`);
      assert.equal((t.to * 4) % 1, 0, "quarter grades");
    }
    const analysis = targets.targets.find((t) => t.subject === "Analysis");
    if (analysis) assert.ok(analysis.to >= 4.75 && analysis.floor.source === "predicted exam grade");
    const chemistry = targets.targets.find((t) => t.subject === "Chemistry");
    if (chemistry) assert.ok(chemistry.to >= 3.75);
  });

  it("says so when lower targets can't free time, instead of lowering them anyway", () => {
    // Targets already at the current grade: nothing to lower.
    const config = plan({ subjects: three.map((s) => ({ ...s, targetGrade: s.currentGrade })) });
    const { targets, current } = recommendAdjustments({ config, now: NOW });
    if (current.needsMoreTime) {
      assert.deepEqual(targets.targets, []);
      assert.equal(targets.changes, false);
      assert.match(targets.explanation, /time is the constraint/);
    }
  });

  it("a severely unrealistic plan: reports what remains instead of an impossible day", () => {
    // Three exams within a week, starting in four days, little time per day.
    const config = plan({
      weeklyHours: 8,
      studyDays: WEEKDAYS,
      subjects: [
        subject({ name: "Analysis", examDate: "2026-10-16", allocation: 34 }),
        subject({ name: "Physics", examDate: "2026-10-19", allocation: 33 }),
        subject({ name: "Chemistry", examDate: "2026-10-21", allocation: 33 }),
      ],
    });
    const rec = recommendAdjustments({ config, now: NOW });
    assert.ok(rec.current.needsMoreTime);
    for (const r of [rec.time, rec.balanced]) {
      assert.ok(dayFits(config, r.weeklyHours.to, r.studyDays.to) || r.weeklyHours.to === config.weeklyHours, r.kind);
      if (!r.resolved) assert.ok(r.feasibility.shortfallMinutes > 0 && /still|doesn't close|can't/.test(r.explanation), r.explanation);
    }
  });

  it("with every weekday taken, more time means longer days, never a day too long", () => {
    const config = plan({ studyDays: [...WEEKDAYS, "Sat", "Sun"], weeklyHours: 20, subjects: three });
    const { time } = recommendAdjustments({ config, now: NOW });
    assert.deepEqual(time.studyDays.to, config.studyDays);
    assert.ok(dailyWindowMinutes({ weeklyHours: time.weeklyHours.to, studyDays: time.studyDays.to }) <= MAX_DAY_WINDOW_MINUTES);
  });

  it("vacations count: the recommendation is checked with them in place", () => {
    const config = plan({ subjects: three, vacationRanges: [{ start: "2026-10-26", end: "2026-11-06" }] });
    const rec = recommendAdjustments({ config, now: NOW });
    const withoutVacation = recommendAdjustments({ config: { ...config, vacationRanges: [] }, now: NOW });
    assert.ok(rec.current.availableMinutes < withoutVacation.current.availableMinutes);
    assert.deepEqual(applied(config, rec.time).vacationRanges, config.vacationRanges);
    assert.equal(rec.time.feasibility.shortfallMinutes, short(applied(config, rec.time)).shortfallMinutes);
  });

  it("a plan that already fits needs no changes", () => {
    const easy = plan({ weeklyHours: 40, subjects: [subject({ confidence: "very", targetGrade: "4.5" })] });
    const rec = recommendAdjustments({ config: easy, now: NOW });
    assert.ok(!rec.current.needsMoreTime);
    for (const r of [rec.targets, rec.time, rec.balanced]) {
      assert.equal(r.changes, false, r.kind);
      assert.equal(r.weeklyHours.to, easy.weeklyHours);
      assert.ok(r.resolved);
    }
  });
});
