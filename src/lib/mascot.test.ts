import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDay, decayMascotHealth, mascotStatusFromHealth, vacationDaySet, type DayOutcome } from "./mascot";

describe("classifyDay", () => {
  it("is a vacation day regardless of anything else", () => {
    assert.equal(
      classifyDay({ vacation: true, hasPlan: true, scheduledStudyBlocks: 2, completedStudyBlocks: 0 }),
      "vacation",
    );
  });

  it("counts a completed study block as good, with or without a plan", () => {
    assert.equal(
      classifyDay({ vacation: false, hasPlan: true, scheduledStudyBlocks: 1, completedStudyBlocks: 1 }),
      "good",
    );
    assert.equal(
      classifyDay({ vacation: false, hasPlan: false, scheduledStudyBlocks: 0, completedStudyBlocks: 1 }),
      "good",
    );
  });

  it("is missed when the plan scheduled study and none happened", () => {
    assert.equal(
      classifyDay({ vacation: false, hasPlan: true, scheduledStudyBlocks: 2, completedStudyBlocks: 0 }),
      "missed",
    );
  });

  it("is a neutral rest day when the plan scheduled nothing", () => {
    assert.equal(
      classifyDay({ vacation: false, hasPlan: true, scheduledStudyBlocks: 0, completedStudyBlocks: 0 }),
      "rest",
    );
  });

  it("is idle when there's no plan and nothing was studied", () => {
    assert.equal(
      classifyDay({ vacation: false, hasPlan: false, scheduledStudyBlocks: 0, completedStudyBlocks: 0 }),
      "idle",
    );
  });
});

describe("decayMascotHealth", () => {
  it("starts and stays at 100 for a perfect run", () => {
    const days: DayOutcome[] = ["good", "good", "rest", "good"];
    assert.equal(decayMascotHealth(days), 100);
  });

  it("drops for missed or idle days and never goes below 0", () => {
    const days: DayOutcome[] = Array.from({ length: 20 }, () => "missed" as DayOutcome);
    assert.equal(decayMascotHealth(days), 0);
  });

  it("leaves health untouched on vacation and rest days", () => {
    const base = decayMascotHealth(["missed", "missed"]);
    const withVacation = decayMascotHealth(["missed", "missed", "vacation", "vacation", "vacation"]);
    const withRest = decayMascotHealth(["missed", "missed", "rest", "rest"]);
    assert.equal(withVacation, base);
    assert.equal(withRest, base);
  });

  it("a logged vacation preserves standing across a gap that would otherwise decay it", () => {
    // Student is thriving, then goes quiet for a week — but it's a logged vacation.
    const health = decayMascotHealth(["good", "good", "good", "vacation", "vacation", "vacation", "vacation"]);
    assert.equal(health, 100);
  });

  it("takes more good days to recover than it took missed days to fall", () => {
    const fallen = decayMascotHealth(["missed", "missed", "missed"]);
    const recovered = decayMascotHealth(["good", "good", "good"], fallen);
    assert.ok(recovered < 100, "three good days shouldn't fully undo three missed days");
  });
});

describe("mascotStatusFromHealth", () => {
  it("maps health bands to a status", () => {
    assert.equal(mascotStatusFromHealth(100), "thriving");
    assert.equal(mascotStatusFromHealth(75), "thriving");
    assert.equal(mascotStatusFromHealth(60), "steady");
    assert.equal(mascotStatusFromHealth(45), "steady");
    assert.equal(mascotStatusFromHealth(30), "slipping");
    assert.equal(mascotStatusFromHealth(20), "slipping");
    assert.equal(mascotStatusFromHealth(10), "neglected");
    assert.equal(mascotStatusFromHealth(0), "neglected");
  });
});

describe("vacationDaySet", () => {
  it("includes both endpoints and every day between them", () => {
    const set = vacationDaySet([{ start: "2026-01-10", end: "2026-01-12" }]);
    assert.deepEqual([...set].sort(), ["2026-01-10", "2026-01-11", "2026-01-12"]);
  });

  it("merges multiple ranges and skips malformed ones", () => {
    const set = vacationDaySet([
      { start: "2026-01-01", end: "2026-01-01" },
      { start: "", end: "2026-02-01" },
      { start: "2026-03-05", end: "2026-03-06" },
    ]);
    assert.deepEqual([...set].sort(), ["2026-01-01", "2026-03-05", "2026-03-06"]);
  });
});
