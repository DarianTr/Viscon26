import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { latestExamDate, localDateKey, planStatus, splitPlans } from "./plan-status";

const plan = (latest: string | null, extra: Partial<{ archivedAt: string | null; done: number; total: number }> = {}) => ({
  latestExamDate: latest,
  archivedAt: null,
  done: 0,
  total: 10,
  ...extra,
});

describe("plan status", () => {
  it("uses the latest of several exam dates", () => {
    assert.equal(latestExamDate(["2027-02-19", "2027-02-26", "2027-02-05"]), "2027-02-26");
    assert.equal(latestExamDate(["2027-02-19", undefined, null, "", "not a date"]), "2027-02-19");
    assert.equal(latestExamDate([]), null);
  });

  it("stays current through the day of the last exam, finished from the next day", () => {
    const p = plan("2027-02-26");
    assert.equal(planStatus(p, "2027-02-25"), "current");
    assert.equal(planStatus(p, "2027-02-26"), "current", "exam day itself");
    assert.equal(planStatus(p, "2027-02-27"), "finished", "the day after");
    assert.equal(planStatus(p, "2027-03-31"), "finished");
  });

  it("keeps plans that haven't started yet current", () => {
    assert.equal(planStatus(plan("2027-06-30"), "2026-10-10"), "current");
  });

  it("finishes by date, whatever the completion — and leaves the completion alone", () => {
    const partial = plan("2026-12-18", { done: 37, total: 120 });
    const { past } = splitPlans([partial], "2026-12-19");
    assert.equal(past[0].status, "finished");
    assert.equal(past[0].done, 37, "completion untouched");
    assert.equal(planStatus(plan("2026-12-18", { done: 120, total: 120 }), "2026-12-18"), "current", "fully done but exam still today");
  });

  it("never finishes a plan without an exam date on its own", () => {
    assert.equal(planStatus(plan(null), "2099-01-01"), "current");
    assert.equal(planStatus(plan(latestExamDate([undefined, "garbage"])), "2099-01-01"), "current");
  });

  it("puts archived plans in the past, even before their exams", () => {
    assert.equal(planStatus(plan("2027-06-30", { archivedAt: "2026-10-01T09:00:00Z" }), "2026-10-10"), "archived");
    assert.equal(planStatus(plan(null, { archivedAt: "2026-10-01T09:00:00Z" }), "2026-10-10"), "archived");
  });

  it("uses the local calendar date, not UTC midnight", () => {
    // 23:30 UTC on 26 Feb is already 27 Feb in Zurich, but still 26 Feb in New York.
    const late = new Date("2027-02-26T23:30:00Z");
    assert.equal(localDateKey(late, "Europe/Zurich"), "2027-02-27");
    assert.equal(localDateKey(late, "America/New_York"), "2027-02-26");
    assert.equal(localDateKey(late, "UTC"), "2027-02-26");
    const p = plan("2027-02-26");
    assert.equal(planStatus(p, localDateKey(late, "Europe/Zurich")), "finished", "in Zurich the exam was yesterday");
    assert.equal(planStatus(p, localDateKey(late, "America/New_York")), "current", "in New York it is still exam day");
    // Just after local midnight in Tokyo, while UTC is still on the previous day.
    const tokyo = new Date("2027-02-26T15:30:00Z");
    assert.equal(planStatus(p, localDateKey(tokyo, "Asia/Tokyo")), "finished");
    assert.equal(planStatus(p, localDateKey(tokyo, "UTC")), "current");
  });

  it("splits plans into current and past, keeping their order", () => {
    const plans = [
      { id: "a", ...plan("2027-02-26") },
      { id: "b", ...plan("2026-12-18") },
      { id: "c", ...plan(null) },
      { id: "d", ...plan("2027-06-30", { archivedAt: "2026-10-01T09:00:00Z" }) },
      { id: "e", ...plan("2026-11-02") },
    ];
    const { current, past } = splitPlans(plans, "2027-01-10");
    assert.deepEqual(current.map((p) => p.id), ["a", "c"]);
    assert.deepEqual(past.map((p) => [p.id, p.status]), [["b", "finished"], ["d", "archived"], ["e", "finished"]]);
  });
});
