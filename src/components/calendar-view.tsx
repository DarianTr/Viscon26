"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "@/components/icons";
import { Card } from "@/components/ui/primitives";
import { eventLabel, formatMinutes, phaseLabels, sessionTypes, subjectColor } from "@/lib/session-types";
import type { CalendarEvent } from "@/lib/types";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const firstCalendarHour = 5;
const calendarHourCount = 19;
/** Drops in the week view snap to this many minutes. */
const dropSnapMinutes = 5;

const eventStyles: Record<CalendarEvent["type"], { color: string; soft: string }> = {
  ...sessionTypes,
  exam: { color: "bg-foreground", soft: "bg-foreground text-background" },
  lecture: { color: "bg-muted", soft: "bg-surface-2 text-muted" },
  buffer: { color: "bg-muted/50", soft: "bg-surface-2 text-muted" },
  break: { color: "bg-border", soft: "border-dashed bg-surface text-muted" },
};

/** Study blocks carry their subject's colour on the left edge, cheatsheet work included. */
const subjectEdge = (e: CalendarEvent) =>
  e.subject && isStudy(e) ? { borderLeft: `3px solid ${subjectColor(e.subject).value}` } : undefined;
/** Breaks, meals, buffers, lectures and exams aren't focused study. */
const isStudy = (e: CalendarEvent) => !["lecture", "exam", "buffer", "break"].includes(e.type);

/** Saves new start times in one request; the server refuses overlaps and unavailable days. */
async function saveTimes(changes: { id: string; scheduledAt: string; calendarOrder: number | null }[]) {
  const response = await fetch("/api/tasks/batch", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "Could not save the new time.");
  }
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const noop = () => () => {};

/**
 * "Today" is only known in the browser — the page itself is prerendered at
 * build time — so render a placeholder on the server and fill in on hydrate.
 */
export function CalendarView({ events, initialDate }: { events: CalendarEvent[]; initialDate?: string }) {
  const todayIso = useSyncExternalStore(
    noop,
    () => startOfDay(new Date()).toISOString(),
    () => null,
  );
  if (!todayIso) return <Card className="h-96 animate-pulse" />;
  const today = new Date(todayIso);
  // "YYYY-MM-DD" in local time, e.g. from "Continue plan".
  const initial = initialDate ? new Date(`${initialDate}T00:00:00`) : today;
  return <Calendar key={todayIso} today={today} initial={Number.isNaN(initial.getTime()) ? today : initial} events={events} />;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function Calendar({ today, initial, events: list }: { today: Date; initial: Date; events: CalendarEvent[] }) {
  const [calendarEvents, setCalendarEvents] = useState(list);
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [selected, setSelected] = useState(initial);
  const [catchUp, setCatchUp] = useState<{ id: string; subject: string; minutes: number } | null>(null);
  const subjects = useMemo(
    () => [...new Set(calendarEvents.filter((e) => e.subject && isStudy(e)).map((e) => e.subject!))].sort(),
    [calendarEvents],
  );
  const [view, setView] = useState<"month" | "week">("month");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Where in the block it was grabbed, so it lands where the pointer shows it.
  const grabOffset = useRef(0);
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
    .filter(isStudy)
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

  async function placeEvent(eventId: string, date: Date, minuteOfDay: number) {
    if (savingOrder) return;
    const original = calendarEvents;
    const previous = original.find((event) => event.id === eventId);
    if (!previous) return;
    const start = new Date(date);
    start.setHours(0, minuteOfDay, 0, 0);
    const updated = {
      ...previous,
      start: start.toISOString(),
      end: new Date(start.getTime() + previous.minutes * 60_000).toISOString(),
      calendarOrder: null,
    };
    setCalendarEvents(original.map((event) => event.id === eventId ? updated : event));
    setSavingOrder(true);
    setOrderMessage("");
    try {
      await saveTimes([{ id: eventId, scheduledAt: updated.start, calendarOrder: null }]);
      setSelected(startOfDay(date));
    } catch (error) {
      setCalendarEvents(original);
      setOrderMessage(error instanceof Error ? error.message : "Could not save the new event time.");
    } finally {
      setSavingOrder(false);
      setDraggedId(null);
    }
  }

  /** Study done during a buffer becomes a completed session for that subject; the buffer shrinks. */
  async function logCatchUp() {
    if (!catchUp) return;
    setOrderMessage("");
    const response = await fetch(`/api/tasks/${catchUp.id}/catch-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: catchUp.subject, minutes: catchUp.minutes }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setOrderMessage(data.error ?? "Could not log the study time.");
      return;
    }
    const { study, buffer } = await response.json();
    const toEvent = (t: { id: string; type: CalendarEvent["type"]; activity: CalendarEvent["activity"]; subject: string | null; cheatsheetMinutes: number | null; cheatsheetTarget: number | null; prepPhase: CalendarEvent["prepPhase"]; title: string; scheduledAt: string; plannedMinutes: number; calendarOrder: number | null }): CalendarEvent => ({
      id: t.id,
      type: t.type,
      activity: t.activity,
      subject: t.subject,
      cheatsheetMinutes: t.cheatsheetMinutes,
      cheatsheetTarget: t.cheatsheetTarget,
      prepPhase: t.prepPhase,
      title: t.title,
      start: t.scheduledAt,
      end: new Date(new Date(t.scheduledAt).getTime() + t.plannedMinutes * 60_000).toISOString(),
      minutes: t.plannedMinutes,
      calendarOrder: t.calendarOrder,
    });
    setCalendarEvents((events) => [
      ...events.filter((e) => e.id !== catchUp.id),
      toEvent(study),
      ...(buffer ? [toEvent(buffer)] : []),
    ]);
    setCatchUp(null);
  }

  async function moveEvent(dragId: string, targetId: string, afterTarget = false) {
    if (dragId === targetId || savingOrder) return;
    const original = calendarEvents;
    const todaysEvents = [...(events.get(dayKey(selected)) ?? [])];
    const from = todaysEvents.findIndex((event) => event.id === dragId);
    if (from < 0 || !todaysEvents.some((event) => event.id === targetId)) return;

    const timeSlots = todaysEvents.map((event) => new Date(event.start).getTime());
    const [moved] = todaysEvents.splice(from, 1);
    const targetIndex = todaysEvents.findIndex((event) => event.id === targetId);
    const to = targetIndex + (afterTarget ? 1 : 0);
    if (from === to) return;
    todaysEvents.splice(to, 0, moved);
    // Keep the day's start times where possible, but never let a block start
    // before the previous one ends — durations differ, so slots can't just swap.
    let previousEnd = -Infinity;
    const reordered = todaysEvents.map((event, index) => {
      const start = Math.max(timeSlots[index], previousEnd);
      previousEnd = start + event.minutes * 60_000;
      return {
        ...event,
        start: new Date(start).toISOString(),
        end: new Date(previousEnd).toISOString(),
        calendarOrder: index,
      };
    });
    const updates = new Map(reordered.map((event) => [event.id, event]));
    setCalendarEvents(original.map((event) => updates.has(event.id)
      ? updates.get(event.id)!
      : event));
    setSavingOrder(true);
    setOrderMessage("");

    try {
      await saveTimes(reordered.map((event) => ({
        id: event.id,
        scheduledAt: event.start,
        calendarOrder: event.calendarOrder,
      })));
    } catch (error) {
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
        <div className="inline-flex rounded-full border-2 border-border bg-surface-2 p-1" aria-label="Calendar view">
          {(["month", "week"] as const).map((mode) => (
            <button key={mode} onClick={() => setView(mode)} aria-pressed={view === mode}
              className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${view === mode ? "border-2 border-foreground bg-surface" : "border-2 border-transparent text-muted"}`}>
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
                {weekDays.map((date) => <div key={dayKey(date)} className="relative border-l border-border"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData("text/plain") || draggedId;
                    if (!id) return;
                    // The block's new top edge, from the pointer and where the block was grabbed.
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const y = event.clientY - grabOffset.current - bounds.top;
                    const minute = firstCalendarHour * 60 + (y / bounds.height) * calendarHourCount * 60;
                    const snapped = Math.round(minute / dropSnapMinutes) * dropSnapMinutes;
                    void placeEvent(id, date, Math.min(Math.max(snapped, 0), 24 * 60 - dropSnapMinutes));
                  }}>
                  {Array.from({ length: calendarHourCount }, (_, index) => {
                    const hour = firstCalendarHour + index;
                    return <div key={hour} className="h-16 border-b border-border hover:bg-accent/5" />;
                  })}
                  {/* Events sit at their exact start minute and are as tall as they are long. */}
                  {(events.get(dayKey(date)) ?? []).map((event) => {
                    const start = new Date(event.start);
                    const offset = start.getHours() * 60 + start.getMinutes() - firstCalendarHour * 60;
                    const top = Math.max(0, offset);
                    const height = Math.min(event.minutes - (top - offset), calendarHourCount * 60 - top);
                    if (height <= 0) return null;
                    const range = `${timeFormat.format(start)}–${timeFormat.format(new Date(event.end))}`;
                    return <div key={event.id} draggable={!savingOrder} onDragStart={(e) => {
                      grabOffset.current = e.clientY - e.currentTarget.getBoundingClientRect().top;
                      setDraggedId(event.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", event.id);
                    }} onDragEnd={() => setDraggedId(null)}
                      title={`${range} · ${eventLabel(event)} · ${event.title} · drag to move`}
                      style={{ top: `${(top / 60) * 4}rem`, height: `${(height / 60) * 4}rem`, ...subjectEdge(event) }}
                      className={`absolute inset-x-0.5 overflow-hidden rounded-md border border-background px-1.5 py-1 text-[10px] leading-tight ${eventStyles[event.type].soft} ${draggedId === event.id ? "opacity-40" : "cursor-grab active:cursor-grabbing"}`}>
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
          <h2 className="font-display font-bold">
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
            const dots = (events.get(key) ?? []).filter((e) => e.type !== "break");
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
          <h2 className="font-display text-lg font-bold tracking-tight">
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
                  <Card className="relative flex-1 p-4" style={subjectEdge(e)}>
                    <span className={`absolute top-5 -left-[0.8125rem] size-2.5 rounded-full ring-4 ring-background ${style.color}`} />
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.soft}`}>{eventLabel(e)}</span>
                    {e.prepPhase && (
                      <span className="ml-2 text-[11px] font-medium text-muted">{phaseLabels[e.prepPhase]} phase</span>
                    )}
                    <p className="mt-1.5 font-semibold">{e.title}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <ClockIcon className="size-3.5" />
                      {formatMinutes(e.minutes)} · until {timeFormat.format(new Date(e.end))}
                    </p>
                    {e.cheatsheetMinutes !== null && e.cheatsheetMinutes > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        {e.cheatsheetMinutes < e.minutes && `${formatMinutes(e.minutes - e.cheatsheetMinutes)} theory · `}
                        {formatMinutes(e.cheatsheetMinutes)} cheatsheet
                        {e.cheatsheetTarget !== null && ` · aim: ${e.cheatsheetTarget}%`}
                      </p>
                    )}
                    {e.type === "buffer" && subjects.length > 0 && (catchUp?.id === e.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <select
                          aria-label="Subject studied"
                          value={catchUp.subject}
                          onChange={(event) => setCatchUp({ ...catchUp, subject: event.target.value })}
                          className="rounded-lg border border-border bg-background px-2 py-1"
                        >
                          {subjects.map((subject) => <option key={subject}>{subject}</option>)}
                        </select>
                        <input
                          aria-label="Minutes studied"
                          type="number"
                          min={1}
                          max={e.minutes}
                          value={catchUp.minutes}
                          onChange={(event) => setCatchUp({ ...catchUp, minutes: Number(event.target.value) })}
                          className="w-16 rounded-lg border border-border bg-background px-2 py-1"
                        />
                        <span className="text-muted">min</span>
                        <button type="button" onClick={() => void logCatchUp()} className="rounded-full bg-foreground px-3 py-1 font-semibold text-background">
                          Log
                        </button>
                        <button type="button" onClick={() => setCatchUp(null)} className="text-muted">Cancel</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCatchUp({ id: e.id, subject: subjects[0], minutes: e.minutes })}
                        className="mt-2 text-xs font-semibold text-accent"
                      >
                        Log study done in this time
                      </button>
                    ))}
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
