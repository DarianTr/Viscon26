"use client";

import { useEffect, useState } from "react";
import { PauseIcon, PlayIcon, XIcon } from "@/components/icons";
import { ExpressionMascot, type RealExpression } from "@/components/mascot/expression-mascot";
import { Ring } from "@/components/ui/primitives";
import { formatMinutes, sessionTypes, subjectColor } from "@/lib/session-types";
import type { Task } from "@/lib/types";

/** Full-screen session recorder — the study version of hitting "Start run". */
export function FocusTimer({
  task,
  initialElapsed = 0,
  onClose,
  onFinish,
}: {
  task: Task;
  /** Seconds already accumulated in earlier runs of this session. */
  initialElapsed?: number;
  /** Called with seconds elapsed so the parent can persist progress. */
  onClose: (elapsed: number) => void;
  /** Called with the total minutes actually studied (at least 1). */
  onFinish: (minutes: number) => void;
}) {
  // Exercise sheets run as 25-minute Pomodoro reps; everything else as one block.
  const blockSeconds = (task.type === "exercises" ? 25 : task.minutes) * 60;
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const inBlock = elapsed % blockSeconds;
  const remaining = blockSeconds - inBlock;
  const rep = Math.floor(elapsed / blockSeconds) + 1;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const type = sessionTypes[task.type];
  const mood: RealExpression = paused ? "sleepy" : "focused";

  const isResumed = initialElapsed > 0;
  const totalMinutes = Math.max(1, Math.round(elapsed / 60));

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]"
      style={{
        background:
          "radial-gradient(ellipse 85% 55% at 50% 100%, var(--focus-bg-2) 0%, transparent 60%)," +
          "linear-gradient(180deg, var(--teal) 0%, var(--focus-bg) 48%, var(--focus-bg) 100%)",
        color: "var(--focus-ink)",
      }}
    >
      {/* Darkened edges, so the middle reads like a pool of light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 75% 75% at 50% 42%, transparent 55%, rgba(0,0,0,0.4) 100%)" }}
      />
      {/* A tight warm halo right behind the mascot's head. */}
      <div
        aria-hidden
        className="lamp-glow pointer-events-none absolute top-[16%] left-1/2 size-[230px] -translate-x-1/2 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(243,182,96,0.4), rgba(243,182,96,0) 70%)",
          filter: "blur(8px)",
        }}
      />
      {/* A quiet scatter of stars, like studying late at night. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="mascot-sparkle absolute top-[10%] left-[14%] block size-1 rounded-full bg-[var(--focus-ink)] opacity-50" />
        <span className="absolute top-[16%] left-[26%] block size-[3px] rounded-full bg-[var(--focus-ink)] opacity-30" />
        <span className="mascot-sparkle absolute top-[12%] right-[16%] block size-1 rounded-full bg-[var(--gold)] opacity-40" />
        <span className="absolute top-[22%] right-[27%] block size-[3px] rounded-full bg-[var(--focus-ink)] opacity-25" />
        <span className="mascot-float-slow mascot-sparkle absolute top-[30%] left-[9%] block size-1.5 rounded-full bg-[var(--gold)] opacity-40" />
        <span className="mascot-float mascot-sparkle absolute top-[34%] right-[11%] block size-1 rounded-full bg-[var(--focus-ink)] opacity-30" />
        <span className="mascot-float-slow mascot-sparkle absolute bottom-[30%] left-[7%] block size-1 rounded-full bg-[var(--focus-ink)] opacity-20" />
      </div>

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full border px-3 py-1 text-xs font-bold"
            style={{ borderColor: "var(--focus-border)", color: "var(--focus-muted)" }}
          >
            {type.label}
            {task.type === "exercises" && ` · Rep ${rep}`}
          </span>
          {isResumed && (
            <span
              className="rounded-full border px-3 py-1 text-xs font-bold"
              style={{ borderColor: "var(--focus-accent)", color: "var(--focus-accent)" }}
            >
              Resumed
            </span>
          )}
        </div>
        <button
          onClick={() => onClose(elapsed)}
          aria-label="Pause and leave"
          className="grid size-10 place-items-center rounded-full border transition-colors hover:bg-white/5"
          style={{ borderColor: "var(--focus-border)" }}
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center text-center">
        <div className={paused ? "" : "mascot-breathe"}>
          <ExpressionMascot expression={mood} size={148} />
        </div>

        <p className="mt-3 text-sm font-semibold" style={{ color: subjectColor(task.subject).value }}>
          {task.subject}
        </p>
        <h2 className="mt-1 max-w-sm font-display text-xl font-bold">{task.title}</h2>
        <div className="mt-8" style={{ filter: "drop-shadow(0 0 26px rgba(227,87,59,0.35))" }}>
          <Ring
            value={inBlock / blockSeconds}
            size={260}
            stroke={3}
            className="text-[var(--focus-accent)]"
            trackClassName="stroke-[var(--focus-border)]"
          >
            <div>
              <p className="font-display text-6xl font-bold tabular-nums tracking-tight">
                {mm}:{ss}
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--focus-muted)" }}>
                {paused ? "Paused — the brain is resting" : "Stay focused"}
              </p>
            </div>
          </Ring>
        </div>

        {isResumed && (
          <p className="mt-6 text-sm" style={{ color: "var(--focus-muted)" }}>
            Total studied:{" "}
            <span className="font-semibold" style={{ color: "var(--focus-ink)" }}>
              {formatMinutes(totalMinutes)}
            </span>{" "}
            (incl. earlier run)
          </p>
        )}
      </div>

      <div className="relative flex items-center justify-center gap-4">
        <button
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Resume" : "Pause"}
          className="grid size-16 place-items-center rounded-full border-2 transition-transform active:scale-95"
          style={{ borderColor: "var(--focus-border)" }}
        >
          {paused ? <PlayIcon className="size-6" /> : <PauseIcon className="size-6" />}
        </button>
        <button
          onClick={() => onFinish(totalMinutes)}
          className="h-16 rounded-full border-2 px-8 font-display text-base font-bold transition-transform active:scale-95"
          style={{ background: "var(--focus-accent)", borderColor: "var(--focus-accent)", color: "var(--focus-ink)" }}
        >
          Finish &amp; save
        </button>
      </div>
    </div>
  );
}
