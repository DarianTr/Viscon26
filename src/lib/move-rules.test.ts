import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayRule, mealRule, mockOrderRule, mockPartnerTitle, type DayBlock } from "./move-rules";

const block = (overrides: Partial<DayBlock>): DayBlock => ({
  id: "x",
  type: "deep",
  activity: "study",
  subject: "Analysis",
  title: "Analysis — Theory recap 1",
  start: 8 * 60,
  minutes: 120,
  ...overrides,
});
// 70 h over 7 days = 10 h a day, 1.5 h buffer → 8.5 h of study.
const config = { weeklyHours: 70, studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };

describe("moving blocks by hand", () => {
  it("keeps a day within the plan's daily study capacity", () => {
    const full = [0, 1, 2, 3].map((i) => block({ id: `s${i}`, start: 8 * 60 + i * 150 }));
    assert.equal(dayRule([...full, block({ id: "light", minutes: 30, start: 19 * 60 })], config), null, "8.5 h fits");
    assert.match(dayRule([...full, block({ id: "more", minutes: 60, start: 19 * 60 })], config)!, /9 h of study — your plan allows 8.5 h/);
    // Breaks, meals and buffers don't count as study.
    const pauses = [block({ type: "break", activity: "lunch", subject: null, minutes: 60 }), block({ type: "buffer", activity: "buffer", subject: null, minutes: 90 })];
    assert.equal(dayRule([...full, ...pauses], config), null);
  });

  it("allows at most two subjects a day, and only the focus subject on a focus day", () => {
    const two = [block({ subject: "Analysis" }), block({ subject: "Physics", start: 11 * 60 })];
    assert.equal(dayRule(two, config), null);
    assert.match(dayRule([...two, block({ subject: "Algorithms", start: 14 * 60 })], config)!, /3 subjects/);
    assert.match(dayRule(two, config, "Analysis")!, /focus day for Analysis/);
    assert.equal(dayRule([block({}), block({ start: 11 * 60 })], config, "Analysis"), null);
  });

  it("keeps Exam Eve for the final review only, at most 4 h", () => {
    const eve = block({ type: "recovery", activity: "exam_eve", title: "Analysis — Exam Eve — Final Review", minutes: 150 });
    assert.equal(dayRule([eve], config, undefined, ["Analysis"]), null);
    assert.match(dayRule([eve, block({ start: 14 * 60, title: "Analysis — Theory recap 9" })], config, undefined, ["Analysis"])!, /eve of your Analysis exam/);
    assert.match(dayRule([eve, block({ subject: "Physics", start: 14 * 60 })], config, undefined, ["Analysis"])!, /final review only/);
    assert.match(dayRule([{ ...eve, minutes: 270 }], config, undefined, ["Analysis"])!, /at most 4 h/);
  });

  it("keeps meals within their window", () => {
    const lunch = block({ type: "break", activity: "lunch", subject: null, title: "Lunch", minutes: 60 });
    assert.equal(mealRule({ ...lunch, start: 12 * 60 + 45 }), null);
    assert.match(mealRule({ ...lunch, start: 16 * 60 })!, /Lunch stays between/);
    const dinner = { ...lunch, activity: "dinner" as const, title: "Dinner" };
    assert.match(mealRule({ ...dinner, start: 21 * 60 })!, /Dinner stays between/);
    assert.equal(mealRule(block({})), null, "study blocks have no meal window");
  });

  it("keeps a mock exam before its review", () => {
    const mock = { ...block({ type: "tempo", activity: "mock_exam", title: "Analysis — Mock exam 2", minutes: 150 }), at: Date.UTC(2027, 2, 2, 8) };
    const review = { ...block({ activity: "mock_review", title: "Analysis — Mock Exam Review 2", minutes: 60 }), at: Date.UTC(2027, 2, 2, 11) };
    assert.equal(mockPartnerTitle(mock), "Analysis — Mock Exam Review 2");
    assert.equal(mockPartnerTitle(review), "Analysis — Mock exam 2");
    assert.equal(mockOrderRule(mock, review), null);
    assert.match(mockOrderRule({ ...mock, at: Date.UTC(2027, 2, 2, 10) }, review)!, /must end before its review/);
    assert.match(mockOrderRule({ ...review, at: Date.UTC(2027, 2, 1, 9) }, mock)!, /has to come after its mock exam/);
  });
});
