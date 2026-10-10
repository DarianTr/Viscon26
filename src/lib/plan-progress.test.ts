import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityOf, cheatsheetProgress, progressFromRows, type ProgressRow } from "./plan-progress";

const row = (overrides: Partial<ProgressRow>): ProgressRow => ({
  subject: "Analysis",
  type: "deep",
  activity: "study",
  title: "Analysis — Theory recap 1",
  plannedMinutes: 120,
  cheatsheetTarget: null,
  done: true,
  ...overrides,
});

describe("plan progress", () => {
  it("counts only completed work", () => {
    const progress = progressFromRows([
      row({}),
      row({ done: false }),
      row({ activity: "mock_exam", title: "Analysis — Mock exam 1", plannedMinutes: 180 }),
      row({ activity: "mock_exam", title: "Analysis — Mock exam 2", done: false }),
      row({ activity: "study", cheatsheetTarget: 40 }),
      row({ activity: "study", cheatsheetTarget: 60, done: false }),
    ]);
    assert.deepEqual(progress, { Analysis: { studyMinutes: 240, mocksDone: 1, cheatsheet: 40 } });
  });

  it("ignores breaks and buffers, and recognises blocks saved before activities existed", () => {
    const progress = progressFromRows([
      row({ subject: null, type: "buffer", activity: "buffer", title: "Buffer / Catch-up Time", plannedMinutes: 90 }),
      row({ subject: null, type: "break", activity: "lunch", title: "Lunch", plannedMinutes: 60 }),
      row({ activity: null, type: "tempo", title: "Analysis — Mock exam 3" }),
      row({ activity: null, type: "deep", title: "Analysis — Mock Exam Review 3", plannedMinutes: 60 }),
      row({ activity: null, type: "recovery", title: "Analysis — Spaced review 2", plannedMinutes: 90 }),
    ]);
    assert.deepEqual(progress, { Analysis: { studyMinutes: 90, mocksDone: 1, cheatsheet: 0 } });
    assert.equal(activityOf({ type: "buffer", activity: null, title: "Buffer / Catch-up Time" }), "buffer");
  });

  it("counts study logged during buffer time once, for its subject", () => {
    // What /api/tasks/:id/catch-up stores: a completed study block; the buffer shrinks.
    const progress = progressFromRows([
      row({ subject: null, type: "buffer", activity: "buffer", title: "Buffer / Catch-up Time", plannedMinutes: 45, done: false }),
      row({ title: "Analysis — Catch-up study", plannedMinutes: 45 }),
    ]);
    assert.deepEqual(progress, { Analysis: { studyMinutes: 45, mocksDone: 0, cheatsheet: 0 } });
  });

  it("separates planned cheatsheet milestones from actual progress", () => {
    const now = new Date(2026, 10, 1);
    const rows = [
      { subject: "Analysis", cheatsheetTarget: 20, done: true, scheduledAt: new Date(2026, 9, 20) },
      { subject: "Analysis", cheatsheetTarget: 40, done: false, scheduledAt: new Date(2026, 9, 27) },
      { subject: "Analysis", cheatsheetTarget: 60, done: false, scheduledAt: new Date(2026, 10, 3) },
    ];
    // Time passing doesn't complete a cheatsheet: only the completed 20% counts.
    assert.deepEqual(cheatsheetProgress(rows, now), { Analysis: { planned: 40, actual: 20, reported: false } });
    // What the student reports is the actual progress — the latest report wins, even if lower.
    assert.deepEqual(
      cheatsheetProgress(rows, now, [{ subject: "Analysis", percent: 35 }, { subject: "Analysis", percent: 15 }]),
      { Analysis: { planned: 40, actual: 15, reported: true } },
    );
  });
});
