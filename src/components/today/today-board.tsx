"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ClockIcon, FlameIcon, PlayIcon } from "@/components/icons";
import { Brain, type BrainExpression } from "@/components/mascot/brain";
import { Button, Card, Ring, SectionTitle } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { emptyStateLines } from "@/lib/mascot";
import { formatMinutes, sessionTypes, subjectColor } from "@/lib/session-types";
import type { Task } from "@/lib/types";
import { FocusTimer } from "./focus-timer";

export function TodayBoard({ initialTasks, streak }: { initialTasks: Task[]; streak: number }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [running, setRunning] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const done = tasks.filter((t) => t.done).reduce((sum, t) => sum + t.minutes, 0);
  const progress = total ? done / total : 0;
  const next = tasks.find((t) => !t.done);

  // Purely decorative — which face the mascot pulls today. Doesn't touch
  // any streak, XP or progress calculation, just which picture shows.
  const mood: BrainExpression =
    total > 0 && progress === 1
      ? "celebrating"
      : streak >= 7
        ? "proud"
        : next
          ? "excited"
          : total === 0
            ? "sleepy"
            : "happy";

  /** Optimistically flip a task, then save; roll back if the save fails. */
  function setDone(id: string, value: boolean, minutes?: number) {
    const markAs = (v: boolean) =>
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: v } : t)));
    markAs(value);
    setError(null);
    api
      .setTaskDone(id, value, minutes)
      // Refresh server data that depends on it (streak, sidebar, other tabs).
      .then(() => router.refresh())
      .catch((err: Error) => {
        markAs(!value);
        setError(err.message);
      });
  }

  return (
    <>
      <Card className="flex items-center gap-4">
        <Brain expression={mood} size={64} />
        <div className="h-12 w-px shrink-0 bg-border" />
        <Ring value={progress} size={76} stroke={8}>
          <div className="text-center leading-none">
            <p className="font-display text-lg font-bold">{Math.round(progress * 100)}%</p>
            <p className="mt-1 text-[10px] text-muted">of today</p>
          </div>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Studied" value={formatMinutes(done)} />
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
        <div className="relative mt-4 overflow-hidden rounded-[1.75rem] border-[2.5px] border-foreground bg-accent p-5 text-surface shadow-[0_4px_0_0_var(--foreground)]">
          <p className="font-display text-xs font-bold tracking-wide uppercase opacity-85">
            Next mission · {next.time}
          </p>
          <h3 className="mt-1.5 font-display text-2xl leading-snug font-extrabold">{next.title}</h3>
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
            Start session
          </Button>
          <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -right-2 -bottom-14 size-28 rounded-full bg-white/10" />
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
          <Brain expression="sleepy" size={72} />
          <p className="max-w-[22ch] text-sm text-muted">{emptyStateLines.noSessionsToday}</p>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {tasks.map((task) => {
          const type = sessionTypes[task.type];
          return (
            <li key={task.id}>
              <Card className={`flex gap-4 p-4 transition-opacity ${task.done ? "opacity-60" : ""}`}>
                <div className={`w-1.5 shrink-0 rounded-full ${type.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${type.soft}`}>
                      {type.label}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 ${subjectColor(task.subject).text}`}>
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: subjectColor(task.subject).value }} />
                      {task.subject}
                    </span>
                  </div>
                  <p className={`mt-1.5 font-display font-bold ${task.done ? "line-through" : ""}`}>
                    {task.title}
                  </p>
                  {task.detail && <p className="mt-0.5 text-sm text-muted">{task.detail}</p>}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                    <ClockIcon className="size-3.5" />
                    {task.time} · {formatMinutes(task.minutes)}
                  </p>
                </div>
                <div className="flex flex-col items-center justify-between gap-2">
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
                      aria-label={`Start ${task.title}`}
                      className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent"
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
          onClose={() => setRunning(null)}
          onFinish={(minutes) => {
            setDone(running.id, true, minutes);
            setRunning(null);
          }}
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
