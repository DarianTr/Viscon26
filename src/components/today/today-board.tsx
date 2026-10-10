"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, ClockIcon, FlameIcon, PlayIcon } from "@/components/icons";
import { ExpressionMascot } from "@/components/mascot/expression-mascot";
import { LightningBolt, Sparkle, SpeechBubble, StickerLabel } from "@/components/mascot/doodles";
import { Button, Card, Ring, SectionTitle } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { emptyStateLines } from "@/lib/mascot";
import { formatMinutes, sessionTypes, subjectColor } from "@/lib/session-types";
import type { Task } from "@/lib/types";
import { FocusTimer } from "./focus-timer";

const PROGRESS_KEY = "focus-timer-progress";

function parseProgress(raw: string | null): Map<string, number> {
  if (!raw) return new Map();
  try {
    return new Map(JSON.parse(raw) as [string, number][]);
  } catch {
    return new Map();
  }
}

/** Same-tab listeners; other tabs are covered by the native `storage` event. */
const progressListeners = new Set<() => void>();

function subscribeProgress(listener: () => void) {
  progressListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    progressListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readProgressSnapshot() {
  try {
    return localStorage.getItem(PROGRESS_KEY);
  } catch {
    return null;
  }
}

function persistProgress(map: Map<string, number>) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...map.entries()]));
  } catch {}
  progressListeners.forEach((listener) => listener());
}

export function TodayBoard({
  initialTasks,
  streak,
  greeting,
  date,
  firstName,
}: {
  initialTasks: Task[];
  streak: number;
  /** Server-computed display strings, purely for the hero copy — no logic lives here. */
  greeting: string;
  date: string;
  firstName: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [running, setRunning] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Seconds accumulated per task ID from earlier, paused runs. Synced from
  // localStorage: null on the server and on the very first client render
  // (matching the SSR markup), then the real value once hydration settles —
  // including same-tab writes made via `persistProgress` below.
  const savedProgress = useSyncExternalStore(subscribeProgress, readProgressSnapshot, () => null);
  const inProgress = parseProgress(savedProgress);

  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  // Actual minutes studied: use actualMinutes when available, fall back to plannedMinutes.
  const studied = tasks.reduce((sum, t) => sum + (t.done ? (t.actualMinutes ?? t.minutes) : 0), 0);
  const completedCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? completedCount / tasks.length : 0;
  const next = tasks.find((t) => !t.done);

  /** Optimistically flip a task, then save; roll back if the save fails. */
  function setDone(id: string, value: boolean, minutes?: number) {
    const prev = tasks;
    setTasks((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        if (!value) return { ...t, done: false, actualMinutes: null };
        // Use the timer's elapsed minutes if provided; otherwise keep planned.
        return { ...t, done: true, actualMinutes: minutes ?? t.minutes };
      }),
    );
    setError(null);
    api
      .setTaskDone(id, value, minutes)
      // Refresh server data that depends on it (streak, sidebar, other tabs).
      .then(() => router.refresh())
      .catch((err: Error) => {
        setTasks(prev);
        setError(err.message);
      });
  }

  /** X pressed inside the timer — save progress and return to the board. */
  function handleTimerClose(elapsed: number) {
    if (!running) return;
    if (elapsed > 0) {
      persistProgress(new Map(inProgress).set(running.id, elapsed));
    }
    setRunning(null);
  }

  /** "Finish & save" pressed — record actual time and clear saved progress. */
  function handleTimerFinish(minutes: number) {
    if (!running) return;
    const updated = new Map(inProgress);
    updated.delete(running.id);
    persistProgress(updated);
    setDone(running.id, true, minutes);
    setRunning(null);
  }

  return (
    <>
      <div
        className="relative mt-[max(1.25rem,env(safe-area-inset-top))] overflow-hidden rounded-tl-3xl rounded-tr-[2.5rem] rounded-br-3xl rounded-bl-[2.5rem] border-[2.5px] border-foreground p-5 shadow-[0_5px_0_0_var(--foreground)] md:mt-10"
        style={{ background: "linear-gradient(165deg, var(--surface) 0%, var(--beige) 135%)" }}
      >
        <Sparkle size={15} className="mascot-sparkle absolute top-5 right-7" />
        <Sparkle size={9} color="var(--pink)" className="mascot-float absolute top-16 right-16" />

        <p className="font-display text-xs font-bold tracking-wide text-accent uppercase">{date}</p>
        <div className="mt-2 flex items-end gap-3">
          <ExpressionMascot expression="proud" size={132} className="-mb-3 shrink-0" />
          <SpeechBubble className="mb-2">
            <h1 className="font-display text-lg leading-tight font-extrabold md:text-xl">
              {greeting}, {firstName}!
            </h1>
          </SpeechBubble>
        </div>

        <div className="mt-5 flex items-center gap-4 border-t-2 border-dashed border-border pt-4">
          <Ring value={progress} size={80} stroke={9}>
            <div className="text-center leading-none">
              <p className="font-display text-lg font-bold">{Math.round(progress * 100)}%</p>
              <p className="mt-1 text-[10px] text-muted">of today</p>
            </div>
          </Ring>
          <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2.5">
            <Stat label="Studied" value={formatMinutes(studied)} />
            <Stat label="Planned" value={formatMinutes(total)} />
            <Stat
              label="Streak"
              value={
                <span className="inline-flex items-center gap-1">
                  <FlameIcon className="size-4 text-accent" />
                  {streak} days
                </span>
              }
            />
            <Stat label="Sessions" value={`${tasks.filter((t) => t.done).length}/${tasks.length}`} />
          </div>
        </div>
      </div>

      {next && (
        <div className="relative mt-5 overflow-hidden rounded-tl-[2.5rem] rounded-tr-xl rounded-br-[2.5rem] rounded-bl-xl border-[2.5px] border-foreground bg-accent p-5 pr-28 text-surface shadow-[0_5px_0_0_var(--foreground)] sm:pr-36">
          <div className="pointer-events-none absolute -top-10 -right-6 size-36 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute right-10 -bottom-16 size-28 rounded-full bg-white/10" />
          <Sparkle size={16} className="mascot-sparkle absolute top-6 right-24 sm:right-32" color="#fff" />

          <StickerLabel className="sticker-settle -rotate-2 bg-gold text-foreground">
            <LightningBolt size={12} />
            Next mission
          </StickerLabel>
          <p className="mt-2 text-xs font-bold tracking-wide opacity-85">{next.time}</p>
          <h3 className="mt-1 font-display text-2xl leading-snug font-extrabold">{next.title}</h3>
          <p className="mt-1 text-sm opacity-90">
            {sessionTypes[next.type].label} ·{" "}
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full border border-white/40" style={{ backgroundColor: subjectColor(next.subject).value }} />
              {next.subject}
            </span>{" "}
            · {formatMinutes(next.minutes)}
          </p>
          <Button variant="ghost" onClick={() => setRunning(next)} className="mt-4 text-accent!">
            <PlayIcon className="size-4" />
            {(inProgress.get(next.id) ?? 0) > 0 ? "Resume session" : "Start session"}
          </Button>

          <ExpressionMascot
            expression="excited"
            size={150}
            className="mascot-breathe pointer-events-none absolute -right-5 bottom-0 drop-shadow-lg"
          />
        </div>
      )}

      <SectionTitle>Today&apos;s sessions</SectionTitle>
      {error && (
        <p role="alert" className="mb-3 rounded-2xl border-2 border-tempo/30 bg-tempo/10 px-4 py-3 text-sm font-medium text-tempo">
          Couldn&apos;t save: {error}
        </p>
      )}
      {tasks.length === 0 && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <ExpressionMascot expression="sleepy" size={96} />
          <p className="max-w-[22ch] text-sm text-muted">{emptyStateLines.noSessionsToday}</p>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {tasks.map((task, index) => {
          const type = sessionTypes[task.type];
          const savedSecs = inProgress.get(task.id) ?? 0;
          const isPaused = !task.done && savedSecs > 0;
          const isExpanded = expanded.has(task.id);
          const tilt = task.done ? "" : index % 2 === 0 ? "sm:-rotate-[0.4deg]" : "sm:rotate-[0.4deg]";
          return (
            <li key={task.id}>
              <Card className={`flex gap-4 p-4 transition-opacity ${tilt} ${task.done ? "opacity-60" : ""}`}>
                <div className={`w-1.5 shrink-0 rounded-full ${isPaused ? "bg-gold" : type.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${type.soft}`}>
                      {type.label}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 ${subjectColor(task.subject).text}`}>
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: subjectColor(task.subject).value }} />
                      {task.subject}
                    </span>
                    {isPaused && (
                      <span className="rounded-full bg-gold-soft px-2 py-0.5 font-semibold text-foreground">
                        Paused · {formatMinutes(Math.round(savedSecs / 60))} done
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <p className={`font-display font-bold ${task.done ? "line-through" : ""}`}>
                      {task.title}
                    </p>
                    {task.detail && (
                      <button
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(task.id)) next.delete(task.id);
                            else next.add(task.id);
                            return next;
                          })
                        }
                        aria-label={isExpanded ? "Hide details" : "Show details"}
                        className="text-muted transition-transform"
                      >
                        <ChevronDownIcon
                          className={`size-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    )}
                  </div>
                  {task.detail && isExpanded && (
                    <p className="mt-0.5 text-sm text-muted">{task.detail}</p>
                  )}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                    <ClockIcon className="size-3.5" />
                    {task.time} · {formatMinutes(task.minutes)}
                  </p>
                </div>
                <div className="relative flex flex-col items-center justify-between gap-2">
                  {task.done && <Sparkle size={11} className="mascot-pop absolute -top-1 -right-1" />}
                  <button
                    onClick={() => setDone(task.id, !task.done)}
                    aria-label={task.done ? "Mark as not done" : "Mark as done"}
                    className={`grid size-8 place-items-center rounded-full border-2 transition-colors ${
                      task.done
                        ? "border-recovery bg-recovery text-white"
                        : "border-border text-transparent hover:border-muted"
                    }`}
                  >
                    <CheckIcon className="size-4" />
                  </button>
                  {!task.done && (
                    <button
                      onClick={() => setRunning(task)}
                      aria-label={isPaused ? `Resume ${task.title}` : `Start ${task.title}`}
                      className={`grid size-8 place-items-center rounded-full transition-colors ${
                        isPaused
                          ? "bg-gold-soft text-foreground"
                          : "bg-accent-soft text-accent"
                      }`}
                    >
                      <PlayIcon className="size-3.5" />
                    </button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {running && (
        <FocusTimer
          task={running}
          initialElapsed={inProgress.get(running.id) ?? 0}
          onClose={handleTimerClose}
          onFinish={handleTimerFinish}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-border bg-surface-2/60 px-2.5 py-1.5">
      <p className="text-[10px] font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-0.5 font-display text-[15px] font-bold">{value}</p>
    </div>
  );
}
