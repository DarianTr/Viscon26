"use client";

import { useId, useRef } from "react";

/*
 * "How your study plan and predictions work": what the scheduler
 * (lib/scheduler.ts) and the grade prediction model (services/knowledge) do —
 * two separate systems. Opened from the ⓘ next to the Grade prediction model.
 */

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: "Study methods",
    items: [
      ["Retrieval practice", "Every session opens with a recall warm-up and closes with an exit quiz."],
      ["Spacing", "Recovery sessions revisit topics at growing intervals: 1 → 3 → 7 → 14 days."],
      ["Interleaving", "Subjects rotate across days — at most two a day, each grouped together."],
    ],
  },
  {
    title: "Phases and focus days",
    items: [
      ["Phases", "Each subject moves through Foundation (immersion), Build, Peak (exam practice) and Taper on its own timeline."],
      ["Focus days", "Your Lernphase can open with focus days on one subject at a time."],
      ["Exam Eve", "The day before each exam is a short final review of that subject only: weak topics, past mistakes, key formulas — no new material, no mocks."],
    ],
  },
  {
    title: "Mock exams and review",
    items: [
      ["Mocks", "Mock exams last as long as the real exam and are spread over the final stretch before it."],
      ["Reviews", "Each mock is followed by a review that gets shorter as the exam approaches (at least 1 h)."],
      ["Reserve", "Only the mocks your strategy, grade gap and confidence call for are planned; the rest stay in reserve and can be added later if your results show you need more practice."],
    ],
  },
  {
    title: "Cheatsheet",
    items: [
      ["Your choice", "Cheatsheet time comes out of each subject's study as you chose: built gradually inside theory sessions with milestones, written in dedicated sessions near the exam, or a short re-read of an existing one."],
    ],
  },
  {
    title: "Availability and buffer time",
    items: [
      ["Your days", "Sessions only fall on your selected study days, never during vacations, and never beyond your daily hours."],
      ["Buffer", "Each study day ends with buffer / catch-up time; breaks and meals come on top of your study hours."],
      ["Hours needed", "Each subject's study time is its share of your weekly hours before its exam, scaled by your confidence (from 0.75× when very confident to 1.25× when not comfortable) and slightly by the gap between your current and target grade. It's an estimate, not a guarantee."],
    ],
  },
  {
    title: "Grade prediction (a separate model)",
    items: [
      ["What it estimates", "Your level on each topic, and how it's changing, from the results you log: practice sheets, quizzes, mock exams and exams."],
      ["Starting point", "Until you log results, the prediction is your own estimate of your current grade, with wide uncertainty."],
      ["Evidence", "Results on more points count more than short ones. Mocks and exams anchor the scale; practice sheets done with notes may run high, and the model learns that offset."],
      ["Exam day", "The forecast continues your recent progress to the exam date, with a learning trend that levels off over time. Uncertainty grows the further away the exam is — the 90% range shows how wide."],
      ["Subjects", "Topics within a subject move together; subjects influence each other only slightly."],
    ],
  },
];

export function PlanMethodInfo() {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="How your study plan and predictions work"
        title="How your study plan and predictions work"
        className="grid size-5 place-items-center rounded-full border border-muted/60 text-[11px] font-bold text-muted hover:border-foreground hover:text-foreground"
      >
        i
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === ref.current) ref.current.close();
        }}
        className="m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.75rem] border-2 border-border bg-surface p-6 text-foreground shadow-[0_3px_0_0_var(--border)] backdrop:bg-foreground/40"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-xl font-bold">
            How your study plan and predictions work
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold hover:bg-beige"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Your schedule comes from the study planner; your grades come from a separate prediction model.
        </p>
        <div className="mt-5 space-y-5">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                {section.items.map(([term, text]) => (
                  <div key={term}>
                    <dt className="inline font-semibold">{term}</dt>
                    <dd className="inline text-muted"> — {text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
