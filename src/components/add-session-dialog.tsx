"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { XIcon } from "@/components/icons";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { sessionTypes } from "@/lib/session-types";
import type { SessionType, SubjectChoice, TaskRecord } from "@/lib/types";

/** "plan": a session ahead, to run with the timer later. "log": one already done. */
export type AddSessionMode = "plan" | "log";

const OTHER = "__other__";
const input =
  "w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-accent tabular-nums";

const pad = (n: number) => String(n).padStart(2, "0");
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a: Date, b: Date) => dateValue(a) === dateValue(b);

/**
 * Where the form starts: planning on today, the next quarter hour; logging on
 * today, the hour that just ended; any other day, 09:00.
 */
function defaultStart(mode: AddSessionMode, day: Date | undefined) {
  const now = new Date();
  if (day && !sameDay(day, now)) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
  const start = new Date(now);
  if (mode === "plan") {
    start.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  } else {
    start.setMinutes(Math.floor(now.getMinutes() / 5) * 5 - 60, 0, 0);
    // Don't reach back into yesterday.
    if (!sameDay(start, now)) start.setHours(0, 0, 0, 0);
  }
  return start;
}

/**
 * Modal for adding a study session by hand — planned ahead (then started with
 * the focus timer on its day) or logged after the fact (posted to the feed).
 */
export function AddSessionDialog({
  subjects,
  initialMode,
  day,
  defaultShared = true,
  onClose,
  onCreated,
}: {
  subjects: SubjectChoice[];
  initialMode: AddSessionMode;
  /** Day to start on, e.g. the one selected in the calendar; today by default. */
  day?: Date;
  /** The user's preferred privacy for new posts, from their profile settings. */
  defaultShared?: boolean;
  onClose: () => void;
  onCreated: (task: TaskRecord) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is the backdrop.
      onClick={(e) => e.target === ref.current && ref.current.close()}
      aria-labelledby={titleId}
      className="m-auto max-h-[90dvh] w-[min(94vw,28rem)] overflow-y-auto rounded-[1.75rem] border-2 border-foreground bg-surface p-0 text-foreground shadow-[0_5px_0_0_var(--foreground)] backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="font-display text-lg font-bold">
            Add session
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full hover:bg-surface-2"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="mt-3 inline-flex rounded-full border-2 border-border bg-surface-2 p-1" role="group" aria-label="When">
          {(
            [
              ["plan", "Plan ahead"],
              ["log", "Already done"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-full px-4 py-1.5 text-sm font-bold ${mode === value ? "border-2 border-foreground bg-surface" : "border-2 border-transparent text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {mode === "plan"
            ? "It shows up on Today on its day, ready for the focus timer."
            : "Record study you did without the timer. It counts toward your stats and streak."}
        </p>

        {/* Remounts per mode, so the times start from that mode's defaults. */}
        <SessionForm
          key={mode}
          mode={mode}
          subjects={subjects}
          day={day}
          defaultShared={defaultShared}
          onCreated={(task) => {
            onCreated(task);
            ref.current?.close();
          }}
        />
      </div>
    </dialog>
  );
}

function SessionForm({
  mode,
  subjects,
  day,
  defaultShared,
  onCreated,
}: {
  mode: AddSessionMode;
  subjects: SubjectChoice[];
  day?: Date;
  defaultShared: boolean;
  onCreated: (task: TaskRecord) => void;
}) {
  const [start] = useState(() => defaultStart(mode, day));
  const [subject, setSubject] = useState(subjects[0]?.name ?? OTHER);
  const [otherSubject, setOtherSubject] = useState("");
  const [type, setType] = useState<SessionType>("theory");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dateValue(start));
  const [time, setTime] = useState(timeValue(start));
  const [minutes, setMinutes] = useState(60);
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(defaultShared);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const choice = subjects.find((s) => s.name === subject);
  const subjectName = (choice ? choice.name : otherSubject).trim();
  const fallbackTitle = subjectName ? `${subjectName} — ${sessionTypes[type].label}` : sessionTypes[type].label;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const scheduledAt = new Date(`${date}T${time}`);
    if (!subjectName) return setError("Pick or enter a subject.");
    if (Number.isNaN(scheduledAt.getTime())) return setError("Enter a valid date and time.");
    const end = scheduledAt.getTime() + minutes * 60_000;
    if (mode === "plan" && end <= Date.now()) {
      return setError("That time is already over. Switch to “Already done” to log it.");
    }
    if (mode === "log" && scheduledAt.getTime() > Date.now()) {
      return setError("That's still ahead. Switch to “Plan ahead” to schedule it.");
    }
    setSaving(true);
    setError(null);
    try {
      const task = await api.createTask({
        type,
        subject: subjectName,
        title: title.trim() || fallbackTitle,
        scheduledAt: scheduledAt.toISOString(),
        plannedMinutes: minutes,
        userPlanId: choice?.planId ?? null,
        ...(mode === "log" ? { done: true, note: note.trim() || null, shared } : {}),
      });
      onCreated(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the session.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Subject</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className={input}>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as SessionType)} className={input}>
            {(Object.keys(sessionTypes) as SessionType[]).map((t) => (
              <option key={t} value={t}>
                {sessionTypes[t].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!choice && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Subject name</span>
          <input value={otherSubject} onChange={(e) => setOtherSubject(e.target.value)} maxLength={100} required className={input} />
        </label>
      )}
      {choice && <p className="text-xs text-muted">Counts toward your plan “{choice.planTitle}”.</p>}

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={fallbackTitle} maxLength={200} className={input} />
      </label>

      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Start</span>
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={input} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Minutes</span>
          <input
            type="number"
            required
            min={1}
            max={24 * 60}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className={input}
          />
        </label>
      </div>

      {mode === "log" && (
        <>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Caption (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={input} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Post to my friends&apos; feed
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-tempo/10 px-3 py-2 text-sm font-medium text-tempo">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving…" : mode === "plan" ? "Add to my schedule" : "Log session"}
      </Button>
    </form>
  );
}
