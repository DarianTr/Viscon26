"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Card } from "@/components/ui/primitives";
import { subjectColor } from "@/lib/session-types";

const initialAllocation = [25, 25, 25, 25];

/** Same-tab listeners; other tabs are covered by the `storage` event. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function SubjectInvestment({
  subjects,
  userKey,
}: {
  subjects: string[];
  userKey: string;
}) {
  const storageKey = `stride-subject-investment:${userKey}`;
  // The saved split lives in localStorage; the server render (null) shows the default.
  const saved = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(storageKey),
    () => null,
  );
  const allocation = useMemo(() => parseAllocation(saved, subjects.length) ?? initialAllocation, [saved, subjects.length]);

  function changeAllocation(index: number, value: number) {
    localStorage.setItem(storageKey, JSON.stringify(rebalance(allocation, index, value)));
    listeners.forEach((listener) => listener());
  }

  return (
    <Card className="flex flex-col gap-5">
      {subjects.map((subject, index) => (
        <div key={subject}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor={`investment-${index}`} className={`text-sm font-medium ${subjectColor(subject).text}`}>{subject}</label>
            <span className={`text-sm font-semibold tabular-nums ${subjectColor(subject).text}`}>{allocation[index]}%</span>
          </div>
          <input
            id={`investment-${index}`}
            type="range"
            min="0"
            max="100"
            step="1"
            value={allocation[index]}
            onChange={(event) => changeAllocation(index, Number(event.currentTarget.value))}
            aria-valuetext={`${allocation[index]}% of study time`}
            className="w-full cursor-pointer"
            style={{ accentColor: subjectColor(subject).value }}
          />
        </div>
      ))}
      <p className="border-t border-border pt-3 text-right text-xs font-semibold text-muted">
        Total <span className="tabular-nums">{allocation.reduce((sum, value) => sum + value, 0)}%</span>
      </p>
    </Card>
  );
}

/** The saved split, or null if there is none or it doesn't fit these subjects. */
function parseAllocation(saved: string | null, length: number): number[] | null {
  if (!saved) return null;
  try {
    const parsed: unknown = JSON.parse(saved);
    return isAllocation(parsed, length) ? parsed : null;
  } catch {
    return null;
  }
}

function isAllocation(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 100) &&
    value.reduce((sum, item) => sum + item, 0) === 100
  );
}

function rebalance(current: number[], selectedIndex: number, selectedValue: number) {
  const next = Array(current.length).fill(0) as number[];
  next[selectedIndex] = selectedValue;
  const others = current.map((_, index) => index).filter((index) => index !== selectedIndex);
  const remaining = 100 - selectedValue;
  const previousTotal = others.reduce((sum, index) => sum + current[index], 0);

  if (previousTotal === 0) {
    const evenShare = Math.floor(remaining / others.length);
    others.forEach((index, position) => {
      next[index] = evenShare + (position < remaining % others.length ? 1 : 0);
    });
    return next;
  }

  const shares = others.map((index) => {
    const exactShare = (remaining * current[index]) / previousTotal;
    next[index] = Math.floor(exactShare);
    return { index, remainder: exactShare - next[index] };
  });
  const unassigned = remaining - others.reduce((sum, index) => sum + next[index], 0);
  shares.sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < unassigned; index++) next[shares[index].index]++;

  return next;
}
