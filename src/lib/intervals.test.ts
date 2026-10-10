import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findOverlaps, nextFreeStart, overlaps } from "./intervals";

describe("intervals", () => {
  it("treats touching blocks as not overlapping", () => {
    assert.equal(overlaps({ start: 540, end: 630 }, { start: 630, end: 720 }), false);
    // 09:00–10:30 and 10:00–11:30 overlap.
    assert.equal(overlaps({ start: 540, end: 630 }, { start: 600, end: 690 }), true);
  });

  it("finds the next free minute after busy time", () => {
    const busy = [{ start: 600, end: 645 }, { start: 640, end: 700 }, { start: 800, end: 900 }];
    assert.equal(nextFreeStart(540, 60, busy), 540);
    assert.equal(nextFreeStart(560, 60, busy), 700);
    assert.equal(nextFreeStart(700, 120, busy), 900);
    assert.equal(nextFreeStart(700, 100, busy), 700);
  });

  it("reports every overlapping pair", () => {
    const list = [{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 5, end: 25 }];
    assert.deepEqual(findOverlaps(list).map((p) => p.sort()), [[0, 2], [1, 2]]);
  });
});
