/**
 * Half-open time intervals [start, end) — minutes of a day or epoch
 * milliseconds, as long as both sides use the same unit. Shared by the
 * scheduler, the task API's overlap checks and the tests. Safe for client code.
 */

export type Interval = { start: number; end: number };

/** True when the intervals share any time; touching ends don't overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The earliest start ≥ `from` where `length` fits without touching `busy`.
 * `busy` may be unsorted and overlapping.
 */
export function nextFreeStart(from: number, length: number, busy: Interval[]): number {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  let t = from;
  for (const b of sorted) {
    if (b.end <= t) continue;
    if (b.start >= t + length) break;
    t = b.end;
  }
  return t;
}

/** Every pair of overlapping intervals, as index pairs into `list`. */
export function findOverlaps(list: Interval[]): [number, number][] {
  const order = list.map((_, i) => i).sort((a, b) => list[a].start - list[b].start);
  const pairs: [number, number][] = [];
  for (let x = 0; x < order.length; x++) {
    for (let y = x + 1; y < order.length && list[order[y]].start < list[order[x]].end; y++) {
      if (overlaps(list[order[x]], list[order[y]])) pairs.push([order[x], order[y]]);
    }
  }
  return pairs;
}
