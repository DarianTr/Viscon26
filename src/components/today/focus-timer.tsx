"use client";

import { useEffect, useState } from "react";
import { PauseIcon, PlayIcon, XIcon } from "@/components/icons";
import { Ring } from "@/components/ui/primitives";
import { sessionTypes, subjectColor } from "@/lib/session-types";
import type { Task } from "@/lib/types";

/** Full-screen session recorder — the study version of hitting "Start run". */
export function FocusTimer({
  task,
  onClose,
  onFinish,
}: {
  task: Task;
  onClose: () => void;
  /** Called with the minutes actually studied (at least 1). */
  onFinish: (minutes: number) => void;
}) {
  // Intervals run as 25-minute reps; everything else as one block.
  const blockSeconds = (task.type === "intervals" ? 25 : task.minutes) * 60;
  const [elapsed, setElapsed] = useState(0);
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${type.soft}`}>
          {type.label}
          {task.type === "intervals" && ` · Rep ${rep}`}
        </span>
        <button onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-surface-2">
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className={`text-sm font-medium ${subjectColor(task.subject).text}`}>{task.subject}</p>
        <h2 className="mt-1 max-w-sm text-xl font-bold">{task.title}</h2>
        <div className="mt-10">
          <Ring value={inBlock / blockSeconds} size={260} stroke={14}>
            <div>
              <p className="font-mono text-6xl font-semibold tabular-nums tracking-tight">
                {mm}:{ss}
              </p>
              <p className="mt-2 text-sm text-muted">{paused ? "Paused" : "Stay focused"}</p>
            </div>
          </Ring>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Resume" : "Pause"}
          className="grid size-16 place-items-center rounded-full bg-surface-2 transition-transform active:scale-95"
        >
          {paused ? <PlayIcon className="size-6" /> : <PauseIcon className="size-6" />}
        </button>
        <button
          onClick={() => onFinish(Math.max(1, Math.round(elapsed / 60)))}
          className="h-16 rounded-full bg-accent px-8 text-base font-semibold text-white shadow-lg shadow-accent/30 transition-transform active:scale-95"
        >
          Finish &amp; save
        </button>
      </div>
    </div>
  );
}
