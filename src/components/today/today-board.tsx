"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ClockIcon, FlameIcon, PlayIcon } from "@/components/icons";
import { Card, Ring, SectionTitle } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatMinutes, sessionTypes } from "@/lib/session-types";
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
      <Card className="flex items-center gap-5">
        <Ring value={progress} size={88} stroke={9}>
          <div className="text-center leading-none">
            <p className="text-lg font-bold">{Math.round(progress * 100)}%</p>
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
        <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#fc4c02] to-[#e11d74] p-5 text-white shadow-lg shadow-accent/20">
          <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
            Up next · {next.time}
          </p>
          <h3 className="mt-1.5 text-xl leading-snug font-bold">{next.title}</h3>
          <p className="mt-1 text-sm opacity-85">
            {sessionTypes[next.type].label} · {next.subject} · {formatMinutes(next.minutes)}
          </p>
          <button
            onClick={() => setRunning(next)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#e0430a] transition-transform active:scale-95"
          >
            <PlayIcon className="size-4" />
            Start session
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
          return (
            <li key={task.id}>
              <Card className={`flex gap-4 p-4 transition-opacity ${task.done ? "opacity-60" : ""}`}>
                <div className={`w-1.5 shrink-0 rounded-full ${type.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${type.soft}`}>
                      {type.label}
                    </span>
                    <span className="text-muted">{task.subject}</span>
                  </div>
                  <p className={`mt-1.5 font-semibold ${task.done ? "line-through" : ""}`}>
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
