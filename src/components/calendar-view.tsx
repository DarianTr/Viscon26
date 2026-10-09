"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "@/components/icons";
import { Card } from "@/components/ui/primitives";
import {
  calendarTemplate,
  formatMinutes,
  sessionTypes,
  type CalendarEvent,
} from "@/lib/study-data";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const eventStyles: Record<CalendarEvent["type"], { label: string; color: string; soft: string }> = {
  ...sessionTypes,
  exam: { label: "Exam", color: "bg-foreground", soft: "bg-foreground text-background" },
  lecture: { label: "Lecture", color: "bg-muted", soft: "bg-surface-2 text-muted" },
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const noop = () => () => {};

/**
 * "Today" is only known in the browser — the page itself is prerendered at
 * build time — so render a placeholder on the server and fill in on hydrate.
 */
export function CalendarView() {
  const todayIso = useSyncExternalStore(
    noop,
    () => startOfDay(new Date()).toISOString(),
    () => null,
  );
  if (!todayIso) return <Card className="h-96 animate-pulse" />;
  return <Calendar key={todayIso} today={new Date(todayIso)} />;
}

function Calendar({ today }: { today: Date }) {
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);

  // Expand the offset-based template into real dates around today.
  const events = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const [offset, list] of Object.entries(calendarTemplate)) {
      const date = new Date(today);
      date.setDate(date.getDate() + Number(offset));
      map.set(
        dayKey(date),
        list
          .map((e, i) => ({ ...e, id: `${offset}-${i}` }))
          .sort((a, b) => a.start.localeCompare(b.start)),
      );
    }
    return map;
  }, [today]);

  // Grid cells for the month, Monday first, padded with nulls.
  const cells = useMemo(() => {
    const first = (month.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array<null>(first).fill(null),
      ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ];
  }, [month]);

  const dayEvents = events.get(dayKey(selected)) ?? [];
  const totalMinutes = dayEvents
    .filter((e) => e.type !== "lecture" && e.type !== "exam")
    .reduce((s, e) => s + e.minutes, 0);

  function shiftMonth(delta: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">
            {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </h2>
          <div className="flex gap-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid size-9 place-items-center rounded-full hover:bg-surface-2">
              <ChevronLeftIcon className="size-5" />
            </button>
            <button onClick={() => shiftMonth(1)} aria-label="Next month" className="grid size-9 place-items-center rounded-full hover:bg-surface-2">
              <ChevronRightIcon className="size-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted">
          {weekdays.map((d) => (
            <span key={d} className="py-1">
              {d.slice(0, 1)}
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-y-1">
          {cells.map((date, i) => {
            if (!date) return <span key={`pad-${i}`} />;
            const key = dayKey(date);
            const isToday = key === dayKey(today);
            const isSelected = key === dayKey(selected);
            const dots = events.get(key) ?? [];
            return (
              <button
                key={key}
                onClick={() => setSelected(date)}
                className="flex flex-col items-center gap-1 py-1"
              >
                <span
                  className={`grid size-9 place-items-center rounded-full text-sm transition-colors ${
                    isSelected
                      ? "bg-accent font-semibold text-white"
                      : isToday
                        ? "font-semibold text-accent ring-1 ring-accent"
                        : "hover:bg-surface-2"
                  }`}
                >
                  {date.getDate()}
                </span>
                <span className="flex h-1.5 gap-0.5">
                  {dots.slice(0, 3).map((e) => (
                    <span key={e.id} className={`size-1.5 rounded-full ${eventStyles[e.type].color}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {selected.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
          </h2>
          {totalMinutes > 0 && (
            <span className="text-sm text-muted">{formatMinutes(totalMinutes)} of study</span>
          )}
        </div>
        {dayEvents.length === 0 ? (
          <Card className="py-10 text-center text-sm text-muted">Rest day — nothing scheduled.</Card>
        ) : (
          <ol className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[3.5rem] before:w-px before:bg-border">
            {dayEvents.map((e) => {
              const style = eventStyles[e.type];
              return (
                <li key={e.id} className="flex gap-4">
                  <span className="w-12 shrink-0 pt-3.5 text-right font-mono text-xs text-muted tabular-nums">{e.start}</span>
                  <Card className="relative flex-1 p-4">
                    <span className={`absolute top-5 -left-[0.8125rem] size-2.5 rounded-full ring-4 ring-background ${style.color}`} />
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.soft}`}>{style.label}</span>
                    <p className="mt-1.5 font-semibold">{e.title}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <ClockIcon className="size-3.5" />
                      {formatMinutes(e.minutes)}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
