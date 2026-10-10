"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, ClockIcon, FlameIcon, PlayIcon } from "@/components/icons";
import { Card, Ring, SectionTitle } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatMinutes, sessionTypes, subjectColor } from "@/lib/session-types";
import type { Task } from "@/lib/types";
import { FocusTimer } from "./focus-timer";

const PROGRESS_KEY = "focus-timer-progress";

function loadProgress(): Map<string, number> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return new Map(JSON.parse(raw) as [string, number][]);
  } catch {}
  return new Map();
}

function persistProgress(map: Map<string, number>) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...map.entries()]));
  } catch {}
}

export function TodayBoard({ initialTasks, streak }: { initialTasks: Task[]; streak: number }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [running, setRunning] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Seconds accumulated per task ID from earlier, paused runs.
  const [inProgress, setInProgress] = useState<Map<string, number>>(new Map());

  // Load saved progress after hydration (localStorage is client-only).
  useEffect(() => {
    setInProgress(loadProgress());
  }, []);

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
      const updated = new Map(inProgress).set(running.id, elapsed);
      setInProgress(updated);
      persistProgress(updated);
    }
    setRunning(null);
  }

  /** "Finish & save" pressed — record actual time and clear saved progress. */
  function handleTimerFinish(minutes: number) {
    if (!running) return;
    const updated = new Map(inProgress);
    updated.delete(running.id);
    setInProgress(updated);
    persistProgress(updated);
    setDone(running.id, true, minutes);
    setRunning(null);
  }

  return (
    <>
      <Card className="flex items-center gap-5">
        <Ring value={progress} size={88} stroke={9}>
          <div className="text-center leading-none">
            <p className="text-lg font-bold">{Math.round(progress * 100)}%</p>
            <p className="mt-1 text-[10px] text-muted">of today</p>
          </div>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
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
      </Card>

      {next && (
        <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#fc4c02] to-[#e11d74] p-5 text-white shadow-lg shadow-accent/20">
          <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
            Up next · {next.time}
          </p>
          <h3 className="mt-1.5 text-xl leading-snug font-bold">{next.title}</h3>
          <p className="mt-1 text-sm opacity-85">
            {sessionTypes[next.type].label} ·{" "}
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: subjectColor(next.subject).value }} />
              {next.subject}
            </span>{" "}
            · {formatMinutes(next.minutes)}
          </p>
          <button
            onClick={() => setRunning(next)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#e0430a] transition-transform active:scale-95"
          >
            <PlayIcon className="size-4" />
            {(inProgress.get(next.id) ?? 0) > 0 ? "Resume session" : "Start session"}
          </button>
          <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -right-4 -bottom-16 size-32 rounded-full bg-white/10" />
        </div>
      )}

      <SectionTitle>Today&apos;s sessions</SectionTitle>
      {error && (
        <p role="alert" className="mb-3 rounded-2xl bg-tempo/10 px-4 py-3 text-sm text-tempo">
          Couldn&apos;t save: {error}
        </p>
      )}
      {tasks.length === 0 && (
        <Card className="py-10 text-center text-sm text-muted">
          Nothing planned today — a rest day counts too.
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {tasks.map((task) => {
          const type = sessionTypes[task.type];
          const savedSecs = inProgress.get(task.id) ?? 0;
          const isPaused = !task.done && savedSecs > 0;
          const isExpanded = expanded.has(task.id);
          return (
            <li key={task.id}>
              <Card className={`flex gap-4 p-4 transition-opacity ${task.done ? "opacity-60" : ""}`}>
                <div className={`w-1.5 shrink-0 rounded-full ${isPaused ? "bg-amber-400" : type.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${type.soft}`}>
                      {type.label}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 ${subjectColor(task.subject).text}`}>
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: subjectColor(task.subject).value }} />
                      {task.subject}
                    </span>
                    {isPaused && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                        Paused · {formatMinutes(Math.round(savedSecs / 60))} done
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <p className={`font-semibold ${task.done ? "line-through" : ""}`}>
                      {task.title}
                    </p>
                    {task.detail && (
                      <button
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            next.has(task.id) ? next.delete(task.id) : next.add(task.id);
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
                <div className="flex flex-col items-center justify-between gap-2">
                  <button
                    onClick={() => setDone(task.id, !task.done)}
                    aria-label={task.done ? "Mark as not done" : "Mark as done"}
                    className={`grid size-8 place-items-center rounded-full ring-2 transition-colors ${
                      task.done
                        ? "bg-recovery text-white ring-recovery"
                        : "text-transparent ring-border hover:ring-muted"
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
                          ? "bg-amber-100 text-amber-600"
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
    <div>
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold">{value}</p>
    </div>
  );
}
