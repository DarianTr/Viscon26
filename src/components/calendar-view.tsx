"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "@/components/icons";
import { Card } from "@/components/ui/primitives";
import { formatMinutes, sessionTypes } from "@/lib/session-types";
import type { CalendarEvent } from "@/lib/types";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const eventStyles: Record<CalendarEvent["type"], { label: string; color: string; soft: string }> = {
  ...sessionTypes,
  exam: { label: "Exam", color: "bg-foreground", soft: "bg-foreground text-background" },
  lecture: { label: "Lecture", color: "bg-muted", soft: "bg-surface-2 text-muted" },
  vacation: { label: "Vacation", color: "bg-emerald-500", soft: "bg-emerald-100 text-emerald-800" },
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventStart, setEventStart] = useState("09:00");
  const [eventEnd, setEventEnd] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);

  // Group events by local day; they arrive sorted by start time.
  const events = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of calendarEvents) {
      const key = dayKey(new Date(event.start));
      map.set(key, [...(map.get(key) ?? []), event]);
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
  const vacations = dayEvents.filter((event) => event.type === "vacation");
  const totalMinutes = dayEvents
    .filter((e) => e.type !== "lecture" && e.type !== "exam" && e.type !== "vacation")
    .reduce((s, e) => s + e.minutes, 0);

  function shiftMonth(delta: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = eventTitle.trim();
    if (!title) return;
    const start = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate());
    let minutes = 1440;
    if (!allDay) {
      const [startHour, startMinute] = eventStart.split(":").map(Number);
      const [endHour, endMinute] = eventEnd.split(":").map(Number);
      start.setHours(startHour, startMinute, 0, 0);
      const end = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), endHour, endMinute);
      minutes = (end.getTime() - start.getTime()) / 60_000;
      if (minutes <= 0) {
        setMessage("End time must be after start time.");
        return;
      }
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "vacation",
          subject: "Personal",
          title,
          scheduledAt: start.toISOString(),
          plannedMinutes: minutes,
          shared: false,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save event. Check that the database is running and migrations are applied.");
      const task = result.task;
      setCalendarEvents((current) => [...current, {
        id: task.id,
        type: "vacation",
        title: task.title,
        start: task.scheduledAt,
        minutes: task.plannedMinutes,
      }]);
      setEventTitle("");
      setShowEventForm(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
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
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowEventForm((open) => !open)}
            aria-expanded={showEventForm}
            className="rounded-full border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            {showEventForm ? "Cancel" : "Schedule event"}
          </button>
          {vacations.length > 0 && <span className="text-sm font-medium text-emerald-700">Study time blocked during events</span>}
          {message && <span role="status" className="text-sm text-red-600">{message}</span>}
        </div>
        {showEventForm && <form onSubmit={saveEvent} className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="calendar-event-title" className="sr-only">Event name</label>
          <input id="calendar-event-title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} maxLength={200} placeholder="Event name" className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-accent" />
          <label className="flex items-center gap-1.5 px-2 text-sm text-muted">
            <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
            All day
          </label>
          <label htmlFor="event-start" className="sr-only">Start time</label>
          <input id="event-start" type="time" value={eventStart} onChange={(event) => setEventStart(event.target.value)} disabled={allDay} className="rounded-full border border-border bg-background px-3 py-2 text-sm disabled:opacity-50" />
          <span aria-hidden="true" className="text-muted">to</span>
          <label htmlFor="event-end" className="sr-only">End time</label>
          <input id="event-end" type="time" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} disabled={allDay} className="rounded-full border border-border bg-background px-3 py-2 text-sm disabled:opacity-50" />
          <button
            type="submit"
            disabled={saving || !eventTitle.trim()}
            className="rounded-full border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save event"}
          </button>
        </form>}
        {dayEvents.length === 0 ? (
          <Card className="py-10 text-center text-sm text-muted">Rest day — nothing scheduled.</Card>
        ) : (
          <ol className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[3.5rem] before:w-px before:bg-border">
            {dayEvents.map((e) => {
              const style = eventStyles[e.type];
              return (
                <li key={e.id} className="flex gap-4">
                  <span className="w-12 shrink-0 pt-3.5 text-right font-mono text-xs text-muted tabular-nums">{timeFormat.format(new Date(e.start))}</span>
                  <Card className="relative flex-1 p-4">
                    <span className={`absolute top-5 -left-[0.8125rem] size-2.5 rounded-full ring-4 ring-background ${style.color}`} />
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.soft}`}>{style.label}</span>
                    <p className="mt-1.5 font-semibold">{e.title}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <ClockIcon className="size-3.5" />
                      {e.type === "vacation"
                        ? e.minutes >= 1440
                          ? "All day"
                          : `${timeFormat.format(new Date(e.start))}–${timeFormat.format(new Date(new Date(e.start).getTime() + e.minutes * 60_000))}`
                        : formatMinutes(e.minutes)}
                    </p>
                    {e.type === "vacation" && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          setSaving(true);
                          setMessage("");
                          try {
                            const response = await fetch(`/api/tasks/${e.id}`, { method: "DELETE" });
                            if (!response.ok) throw new Error("Could not remove event.");
                            setCalendarEvents((current) => current.filter((event) => event.id !== e.id));
                          } catch (error) {
                            setMessage(error instanceof Error ? error.message : "Could not remove event.");
                          } finally {
                            setSaving(false);
                          }
                        }}
                        className="mt-3 text-xs font-medium text-muted underline"
                      >
                        Remove event
                      </button>
                    )}
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
