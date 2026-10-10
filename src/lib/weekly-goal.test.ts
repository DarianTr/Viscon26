import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateStudyPlan, type PlanConfig } from "./scheduler";
import { isActiveInWeek, planSpan, plannedMinutes, standardWeeklyMinutes, weekBounds } from "./weekly-goal";

const ZURICH = "Europe/Zurich";
// Week of Monday 12 Oct 2026.
const WEEK = { start: "2026-10-12", end: "2026-10-18" };
const at = (iso: string, minutes: number, day: number) => {
  const start = new Date(iso).getTime();
  return { start, end: start + minutes * 60_000, day };
};

describe("weekly goal", () => {
  it("10 h a day with a 1.5 h buffer on five days is 42.5 focused hours", () => {
    const config = { weeklyHours: 50, studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] };
    assert.equal(standardWeeklyMinutes(config), 42.5 * 60);
    assert.equal(standardWeeklyMinutes({ weeklyHours: 30, studyDays: [] }), 0);
  });

  it("a regular scheduled week adds up to the plan's focused target, without breaks or buffers", () => {
    const config: PlanConfig = {
      planName: "Test",
      weeklyHours: 50,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      sessionLength: 120,
      vacationRanges: [],
      subjects: [{
        name: "Analysis", examDate: "2026-12-18", examDuration: "150", targetGrade: "5", currentGrade: "4",
        confidence: "some", approach: "balanced", customPhases: [], mockCount: "3", allocation: 100,
        materials: [], cheatsheet: "none", comments: "",
      }],
    };
    const { sessions } = generateStudyPlan(config, new Date(2026, 9, 12, 8, 0), { suggest: false });
    const focused = sessions
      .filter((s) => s.subject && !["buffer", "break", "exam"].includes(s.type))
      .filter((s) => new Date(s.scheduledAt) < new Date(2026, 9, 19))
      .map((s) => {
        const start = new Date(s.scheduledAt).getTime();
        return { start, end: start + s.plannedMinutes * 60_000, day: (new Date(s.scheduledAt).getDay() + 6) % 7 };
      });
    const { total, byDay } = plannedMinutes(focused);
    assert.equal(total, standardWeeklyMinutes(config));
    assert.deepEqual(byDay, [510, 510, 510, 510, 510, 0, 0]);
  });

  it("counts time two plans both schedule only once", () => {
    const { total, byDay } = plannedMinutes([
      at("2026-10-12T08:00:00+02:00", 120, 0),
      at("2026-10-12T09:00:00+02:00", 120, 0), // overlaps the first by an hour
      at("2026-10-12T11:00:00+02:00", 60, 0), // touches: no overlap
      at("2026-10-14T08:00:00+02:00", 90, 2),
      at("2026-10-14T08:00:00+02:00", 90, 2), // the same block twice
    ]);
    assert.equal(total, 240 + 90);
    assert.deepEqual(byDay, [240, 0, 90, 0, 0, 0, 0]);
    assert.equal(plannedMinutes([]).total, 0);
  });

  it("weeks run Monday to Sunday in the app's time zone", () => {
    assert.deepEqual(weekBounds(new Date("2026-10-14T12:00:00Z"), ZURICH), WEEK);
    // Sunday 23:30 UTC is already Monday in Zurich.
    assert.deepEqual(weekBounds(new Date("2026-10-18T23:30:00Z"), ZURICH), { start: "2026-10-19", end: "2026-10-25" });
    assert.deepEqual(weekBounds(new Date("2026-10-18T23:30:00Z"), "UTC"), WEEK);
  });

  it("a plan's period runs from its start to its latest exam", () => {
    const span = planSpan({
      planStart: "2026-10-01",
      examDates: ["2026-12-18", "2027-01-20", "", null],
      firstBlock: "2026-10-02",
      lastExamBlock: "2026-12-18",
      lastBlock: "2027-01-19",
    });
    assert.deepEqual(span, { start: "2026-10-01", end: "2027-01-20" });
    // Older plans without settings fall back to their blocks.
    assert.deepEqual(
      planSpan({ firstBlock: "2026-10-05", lastExamBlock: "2026-10-30", lastBlock: "2026-10-30" }),
      { start: "2026-10-05", end: "2026-10-30" },
    );
    assert.deepEqual(planSpan({ firstBlock: null, lastExamBlock: null, lastBlock: null }), { start: null, end: null });
  });

  it("only plans whose period overlaps the week are active", () => {
    // Running through the week, starting in it, ending in it (exam on Wednesday).
    assert.ok(isActiveInWeek({ start: "2026-09-01", end: "2026-12-18" }, WEEK));
    assert.ok(isActiveInWeek({ start: "2026-10-17", end: "2026-12-18" }, WEEK));
    assert.ok(isActiveInWeek({ start: "2026-09-01", end: "2026-10-14" }, WEEK));
    // Completed before the week, or not started yet.
    assert.ok(!isActiveInWeek({ start: "2026-09-01", end: "2026-10-11" }, WEEK));
    assert.ok(!isActiveInWeek({ start: "2026-10-19", end: "2026-12-18" }, WEEK));
    // No dates at all.
    assert.ok(!isActiveInWeek({ start: null, end: null }, WEEK));
  });
});
