"use client";

import type { Adjustments, Recommendation } from "@/lib/plan-adjustments";

export type SmartAdjustmentState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Adjustments; model?: "forecast" | "unavailable" };

const h = (minutes: number) => `${Math.round(minutes / 60)} h`;
const days = (list: string[]) => list.join(", ");

const primary =
  "rounded-full border-[2.5px] border-foreground bg-accent px-5 py-2.5 text-sm font-display font-bold text-surface shadow-[0_3px_0_0_var(--foreground)] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none";
const secondary =
  "rounded-full border-2 border-foreground/70 bg-surface px-5 py-2.5 text-sm font-display font-bold shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none";

/**
 * "Let's make your plan achievable": the plan's shortfall and concrete ways to
 * close it (lib/plan-adjustments.ts). Applying one fills the editable draft;
 * nothing is saved here.
 */
export function SmartAdjustment({
  state,
  onApply,
  onManual,
  onBack,
  backLabel,
}: {
  state: SmartAdjustmentState;
  onApply: (recommendation: Recommendation) => void;
  onManual: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <div className="space-y-6 rounded-[1.75rem] border-2 border-border bg-surface p-6 shadow-[0_3px_0_0_var(--border)]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Adjust plan</p>
        <h2 className="mt-2 text-2xl font-bold">Let&apos;s make your plan achievable</h2>
        <p className="mt-2 text-sm text-muted">
          Based on your exam dates, target grades, current performance, and available study time, your current plan
          may be too ambitious. Here are some ways to improve it.
        </p>
      </div>

      {state.status === "loading" && (
        <div className="flex items-center gap-3 py-6 text-sm text-muted">
          <div className="size-6 animate-spin rounded-full border-4 border-border border-t-foreground" />
          Working out options with your schedule…
        </div>
      )}
      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}

      {state.status === "ready" && (
        <>
          <Summary data={state.data} />
          <div className="grid gap-4" data-options>
            <Option
              title="Adjust target grades"
              description="Keep your current study schedule and adjust your target grades to something more achievable."
              recommendation={state.data.targets}
              button="Use these targets"
              onApply={onApply}
              unchanged={["Study hours", "Study days", "Vacations", "Exam dates"]}
              floorNote={
                state.model === "unavailable"
                  ? "Grade forecasts weren't available, so targets aren't lowered below your current grade."
                  : undefined
              }
            />
            <Option
              title="Make more time to study"
              description="Keep your target grades and increase your available study time."
              recommendation={state.data.time}
              button="Use this schedule"
              onApply={onApply}
              unchanged={["Target grades", "Vacations", "Exam dates"]}
            />
            <Option
              title="Meet in the middle"
              description="Make a smaller adjustment to both your study hours and target grades."
              recommendation={state.data.balanced}
              button="Use balanced approach"
              onApply={onApply}
              unchanged={["Study days", "Vacations", "Exam dates"]}
            />
            <section className="space-y-3 rounded-2xl border-2 border-border p-4">
              <h3 className="font-bold">I&apos;ll adjust it myself</h3>
              <p className="text-sm text-muted">
                Edit your study availability, target grades, or subject priorities manually.
              </p>
              <button type="button" onClick={onManual} className={secondary}>
                Edit manually
              </button>
            </section>
          </div>
          <p className="text-xs text-muted">
            Each option was checked by the scheduler with your breaks, buffers, vacations, exam dates and the
            two-subjects-a-day limit. Hours needed are estimates from the planning formula — approximate, and no
            option guarantees a grade.
          </p>
        </>
      )}

      <button type="button" onClick={onBack} className={`${secondary} w-full`}>
        {backLabel}
      </button>
    </div>
  );
}

function Summary({ data }: { data: Adjustments }) {
  const { current } = data;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        {(
          [
            ["Available", h(current.availableMinutes)],
            ["Needed (approx.)", h(current.requiredMinutes)],
            ["Short", h(current.shortfallMinutes)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface-2 p-3">
            <p className="text-xl font-bold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Focused study hours before your last exam, without buffer time.</p>
      {current.subjects.length > 0 && (
        <p className="text-sm">
          <span className="font-semibold">Most of the gap: </span>
          {current.subjects
            .slice(0, 3)
            .map((s) => `${s.name} (${h(s.shortfallMinutes)})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

function Option({
  title,
  description,
  recommendation: r,
  button,
  onApply,
  unchanged,
  floorNote,
}: {
  title: string;
  description: string;
  recommendation: Recommendation;
  button: string;
  onApply: (r: Recommendation) => void;
  unchanged: string[];
  floorNote?: string;
}) {
  const hoursChange = r.weeklyHours.to !== r.weeklyHours.from;
  const addedDays = r.studyDays.to.filter((d) => !r.studyDays.from.includes(d));
  return (
    <section className="space-y-3 rounded-2xl border-2 border-border p-4" data-option={r.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            r.resolved ? "bg-recovery/15 text-recovery" : "bg-accent-soft text-accent"
          }`}
        >
          {r.resolved ? "Plan fits" : `Still ${h(r.feasibility.shortfallMinutes)} short`}
        </span>
      </div>
      <p className="text-sm text-muted">{description}</p>

      {r.changes && (
        <ul className="space-y-1 rounded-xl bg-surface-2 p-3 text-sm tabular-nums">
          {hoursChange && (
            <li>
              Weekly study hours: {r.weeklyHours.from} h → <strong>{r.weeklyHours.to} h</strong>
              <span className="text-muted">
                {" "}
                ({r.dailyHours.from} h → {r.dailyHours.to} h per study day on {days(r.studyDays.to)})
              </span>
            </li>
          )}
          {addedDays.length > 0 && (
            <li>
              New study day{addedDays.length > 1 ? "s" : ""}: <strong>{days(addedDays)}</strong>
            </li>
          )}
          {r.targets.map((t) => (
            <li key={t.subject}>
              {t.subject} target: {t.from} → <strong>{t.to}</strong>
              {t.to === t.floor.grade && <span className="text-muted"> (your {t.floor.source})</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">{r.explanation}</p>
      {r.changes && <p className="text-xs text-muted">Stays the same: {unchanged.join(", ")}.</p>}
      {floorNote && <p className="text-xs text-muted">{floorNote}</p>}
      <button type="button" disabled={!r.changes} onClick={() => onApply(r)} className={primary}>
        {button}
      </button>
    </section>
  );
}
