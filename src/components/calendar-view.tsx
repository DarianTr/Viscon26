"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "@/components/icons";
import { Card } from "@/components/ui/primitives";
import { formatMinutes, sessionTypes } from "@/lib/session-types";
import type { CalendarEvent } from "@/lib/types";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const firstCalendarHour = 5;
const calendarHourCount = 19;

const eventStyles: Record<CalendarEvent["type"], { label: string; color: string; soft: string }> = {
  ...sessionTypes,
  exam: { label: "Exam", color: "bg-foreground", soft: "bg-foreground text-background" },
  lecture: { label: "Lecture", color: "bg-muted", soft: "bg-surface-2 text-muted" },
  buffer: { label: "Buffer / Catch-up Time", color: "bg-muted/50", soft: "bg-surface-2 text-muted" },
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const noop = () => () => {};

/**
 * "Today" is only known in the browser — the page itself is prerendered at
 * build time — so render a placeholder on the server and fill in on hydrate.
 */
export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const todayIso = useSyncExternalStore(
    noop,
    () => startOfDay(new Date()).toISOString(),
    () => null,
  );
  if (!todayIso) return <Card className="h-96 animate-pulse" />;
  return <Calendar key={todayIso} today={new Date(todayIso)} events={events} />;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function Calendar({ today, events: list }: { today: Date; events: CalendarEvent[] }) {
  const [calendarEvents, setCalendarEvents] = useState(list);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<"month" | "week">("month");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");

  // Group events by local day; they arrive sorted by start time.
  const events = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of calendarEvents) {
      const key = dayKey(new Date(event.start));
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    for (const day of map.values()) {
      day.sort((a, b) => a.start.localeCompare(b.start));
    }
    return map;
  }, [calendarEvents]);

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
    .filter((e) => e.type !== "lecture" && e.type !== "exam" && e.type !== "buffer")
    .reduce((s, e) => s + e.minutes, 0);

  function shiftMonth(delta: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  const weekStart = new Date(selected);
  weekStart.setDate(selected.getDate() - ((selected.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });

  async function placeEvent(eventId: string, date: Date, hour: number) {
    if (savingOrder) return;
    const original = calendarEvents;
    const previous = original.find((event) => event.id === eventId);
    if (!previous) return;
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    const updated = { ...previous, start: start.toISOString(), calendarOrder: null };
    setCalendarEvents(original.map((event) => event.id === eventId ? updated : event));
    setSavingOrder(true);
    setOrderMessage("");
    try {
      const response = await fetch(`/api/tasks/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: updated.start, calendarOrder: null }),
      });
      if (!response.ok) throw new Error("Could not save the new event time.");
      setSelected(startOfDay(date));
    } catch (error) {
      setCalendarEvents(original);
      setOrderMessage(error instanceof Error ? error.message : "Could not save the new event time.");
    } finally {
      setSavingOrder(false);
      setDraggedId(null);
    }
  }

  async function moveEvent(dragId: string, targetId: string, afterTarget = false) {
    if (dragId === targetId || savingOrder) return;
    const original = calendarEvents;
    const todaysEvents = [...(events.get(dayKey(selected)) ?? [])];
    const from = todaysEvents.findIndex((event) => event.id === dragId);
    if (from < 0 || !todaysEvents.some((event) => event.id === targetId)) return;

    const timeSlots = todaysEvents.map((event) => event.start);
    const [moved] = todaysEvents.splice(from, 1);
    const targetIndex = todaysEvents.findIndex((event) => event.id === targetId);
    const to = targetIndex + (afterTarget ? 1 : 0);
    if (from === to) return;
    todaysEvents.splice(to, 0, moved);
    // Keep the actual event times in sync with the new order. Reassigning the
    // existing time slots also preserves each event's original start time set.
    const reordered = todaysEvents.map((event, index) => ({
      ...event,
      start: timeSlots[index],
      calendarOrder: index,
    }));
    const updates = new Map(reordered.map((event) => [event.id, event]));
    setCalendarEvents(original.map((event) => updates.has(event.id)
      ? updates.get(event.id)!
      : event));
    setSavingOrder(true);
    setOrderMessage("");

    const saved: CalendarEvent[] = [];
    try {
      for (const event of reordered) {
        const response = await fetch(`/api/tasks/${event.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: event.start, calendarOrder: event.calendarOrder }),
        });
        if (!response.ok) throw new Error("Could not save event order.");
        saved.push(event);
      }
    } catch (error) {
      for (const event of saved) {
        const previous = original.find((item) => item.id === event.id);
        if (previous) {
          await fetch(`/api/tasks/${event.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scheduledAt: previous.start, calendarOrder: previous.calendarOrder }),
          });
        }
      }
      setCalendarEvents(original);
      setOrderMessage(error instanceof Error ? error.message : "Could not save event order.");
    } finally {
      setSavingOrder(false);
      setDraggedId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex rounded-full bg-surface-2 p-1" aria-label="Calendar view">
          {(["month", "week"] as const).map((mode) => (
            <button key={mode} onClick={() => setView(mode)} aria-pressed={view === mode}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${view === mode ? "bg-surface shadow-sm" : "text-muted"}`}>
              {mode}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => view === "month" ? shiftMonth(-1) : setSelected((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7))}
            aria-label={view === "month" ? "Previous month" : "Previous week"} className="grid size-9 place-items-center rounded-full hover:bg-surface-2"><ChevronLeftIcon className="size-5" /></button>
          <button onClick={() => view === "month" ? shiftMonth(1) : setSelected((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7))}
            aria-label={view === "month" ? "Next month" : "Next week"} className="grid size-9 place-items-center rounded-full hover:bg-surface-2"><ChevronRightIcon className="size-5" /></button>
        </div>
      </div>
      {view === "week" ? (
        <Card className="overflow-hidden">
          {orderMessage && <p role="status" className="p-3 text-sm text-red-600">{orderMessage}</p>}
          <div className="overflow-x-hidden">
            <div className="w-full">
              <div className="sticky top-0 z-10 grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border bg-surface">
                <span />
                {weekDays.map((date) => <button key={dayKey(date)} onClick={() => setSelected(date)} className={`px-1 py-3 text-center text-xs ${dayKey(date) === dayKey(today) ? "text-accent" : "text-muted"}`}>
                  <span className="block">{weekdays[(date.getDay() + 6) % 7]}</span><span className={`mx-auto mt-1 grid size-7 place-items-center rounded-full text-sm font-semibold ${dayKey(date) === dayKey(selected) ? "bg-accent text-white" : "text-foreground"}`}>{date.getDate()}</span>
                </button>)}
              </div>
              <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
                <div>{Array.from({ length: calendarHourCount }, (_, index) => {
                  const hour = firstCalendarHour + index;
                  return <div key={hour} className="h-16 border-b border-border pr-2 pt-1 text-right font-mono text-[10px] text-muted">{timeFormat.format(new Date(2000, 0, 1, hour))}</div>;
                })}</div>
                {weekDays.map((date) => <div key={dayKey(date)} className="relative border-l border-border">
                  {Array.from({ length: calendarHourCount }, (_, index) => {
                    const hour = firstCalendarHour + index;
                    return <div key={hour} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData("text/plain") || draggedId;
                      if (id) void placeEvent(id, date, hour);
                    }} className="h-16 border-b border-border hover:bg-accent/5" />;
                  })}
                  {/* Events sit at their exact start minute and are as tall as they are long. */}
                  {(events.get(dayKey(date)) ?? []).map((event) => {
                    const start = new Date(event.start);
                    const offset = start.getHours() * 60 + start.getMinutes() - firstCalendarHour * 60;
                    const top = Math.max(0, offset);
                    const height = Math.min(event.minutes - (top - offset), calendarHourCount * 60 - top);
                    if (height <= 0) return null;
                    const range = `${timeFormat.format(start)}–${timeFormat.format(new Date(start.getTime() + event.minutes * 60_000))}`;
                    return <div key={event.id} draggable={!savingOrder} onDragStart={(e) => { setDraggedId(event.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", event.id); }} onDragEnd={() => setDraggedId(null)}
                      title={`${range} · ${event.title} · drag to move`}
                      style={{ top: `${(top / 60) * 4}rem`, height: `${(height / 60) * 4}rem` }}
                      className={`absolute inset-x-0.5 overflow-hidden rounded-md border border-background px-1.5 py-1 text-[10px] leading-tight ${eventStyles[event.type].soft} ${draggedId ? "pointer-events-none" : ""} ${draggedId === event.id ? "opacity-40" : "cursor-grab active:cursor-grabbing"}`}>
                      <span className="block font-semibold">{range}</span><span className="line-clamp-2">{event.title}</span>
                    </div>;
                  })}
                </div>)}
              </div>
            </div>
          </div>
        </Card>
      ) : <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">
            {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </h2>
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
          <>
          {orderMessage && <p role="status" className="mb-2 text-sm text-red-600">{orderMessage}</p>}
          <ol
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
              if (!sourceId || dayEvents.length === 0) return;
              const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-calendar-event-id]"));
              const before = rows.find((row) => {
                const bounds = row.getBoundingClientRect();
                return event.clientY < bounds.top + bounds.height / 2;
              });
              const beforeId = before?.dataset.calendarEventId;
              const last = dayEvents[dayEvents.length - 1];
              if (beforeId) void moveEvent(sourceId, beforeId);
              else if (last) void moveEvent(sourceId, last.id, true);
            }}
            className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[3.5rem] before:w-px before:bg-border"
          >
            {dayEvents.map((e) => {
              const style = eventStyles[e.type];
              return (
                <li
                  key={e.id}
                  data-calendar-event-id={e.id}
                  draggable={!savingOrder}
                  onDragStart={(event) => {
                    setDraggedId(e.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", e.id);
                  }}
                  onDragEnd={() => setDraggedId(null)}
                  className={`flex gap-4 ${savingOrder ? "opacity-60" : "cursor-grab active:cursor-grabbing"} ${draggedId === e.id ? "opacity-40" : ""}`}
                >
                  <span className="w-12 shrink-0 pt-3.5 text-right font-mono text-xs text-muted tabular-nums">{timeFormat.format(new Date(e.start))}</span>
                  <Card className="relative flex-1 p-4">
                    <span className={`absolute top-5 -left-[0.8125rem] size-2.5 rounded-full ring-4 ring-background ${style.color}`} />
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.soft}`}>{style.label}</span>
                    <p className="mt-1.5 font-semibold">{e.title}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <ClockIcon className="size-3.5" />
                      {formatMinutes(e.minutes)} · until {timeFormat.format(new Date(new Date(e.start).getTime() + e.minutes * 60_000))}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ol>
          </>
        )}
      </div>
      </div>}
    </div>
  );
}
