import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoredPlanConfig, StoredSubjectConfig } from "@/db/schema";
import { describeChanges, duplicateNames, mergePending } from "./plan-changes";

const subject = (overrides: Partial<StoredSubjectConfig> = {}): StoredSubjectConfig => ({
  name: "Analysis", examDate: "2027-02-12", examDuration: "120", targetGrade: "5", currentGrade: "4",
  confidence: "some", approach: "balanced", customPhases: [], mockCount: "3", allocation: 100,
  materials: [], cheatsheet: "none", comments: "",
  ...overrides,
});
const config = (overrides: Partial<StoredPlanConfig> = {}): StoredPlanConfig => ({
  weeklyHours: 30, studyDays: ["Mon", "Tue", "Wed"], sessionLength: 120, vacationRanges: [],
  subjects: [subject()], startTime: "08:00", rhythm: "balanced",
  ...overrides,
});

describe("plan changes", () => {
  it("label-only edits need no recalibration", () => {
    const next = config({
      subjects: [subject({ name: "Analysis II", materials: ["Past exams"], comments: "Focus on series" })],
    });
    assert.deepEqual(describeChanges(config(), next), { pending: [], renames: [["Analysis", "Analysis II"]] });
  });

  it("availability, exam dates and new subjects call for a recalibration", () => {
    const next = config({
      weeklyHours: 40,
      subjects: [subject({ examDate: "2027-02-19", mockCount: "5", allocation: 60 }), subject({ name: "Physics", allocation: 40 })],
    });
    assert.deepEqual(describeChanges(config(), next).pending, [
      "Study availability",
      "Analysis: exam date, past exams",
      "New subject: Physics",
      "Subject distribution",
    ]);
  });

  it("the Lernphase start is its own change", () => {
    assert.deepEqual(describeChanges(config(), config({ lernphaseStart: "focus" })).pending, ["Lernphase start"]);
  });

  it("an unchanged save changes nothing", () => {
    assert.deepEqual(describeChanges(config(), config()), { pending: [], renames: [] });
  });

  it("pending changes add up across saves and follow renames", () => {
    const first = describeChanges(config(), config({ subjects: [subject({ examDate: "2027-03-01" })] }));
    const pending = mergePending(undefined, first);
    assert.deepEqual(pending, ["Analysis: exam date"]);
    const second = describeChanges(
      config({ subjects: [subject({ examDate: "2027-03-01" })] }),
      config({ weeklyHours: 20, subjects: [subject({ name: "Analysis II", examDate: "2027-03-01" })] }),
    );
    assert.deepEqual(mergePending(pending, second), ["Analysis II: exam date", "Study availability"]);
    // Saving the same thing twice doesn't list it twice.
    assert.deepEqual(mergePending(["Study availability"], second), ["Study availability"]);
  });

  it("finds names that would clash", () => {
    assert.deepEqual(duplicateNames([{ name: "Physics" }, { name: " physics" }, { name: "Analysis" }]), ["physics"]);
    assert.deepEqual(duplicateNames([{ name: "A" }, { name: "B" }]), []);
  });
});
