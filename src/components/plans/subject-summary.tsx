"use client";

import { formatPredictedGrade, type SubjectPrediction } from "@/lib/predictions";

export type SubjectProgressRow = {
  subject: string;
  done: number;
  total: number;
  color: string;
  /** From the grade prediction model (lib/predictions.ts); null if it has none for this subject. */
  prediction: SubjectPrediction | null;
};

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });

/*
 * One table-like grid, the same columns on every row so bars and grades line up:
 * name (≈20%) · progress bar (≈40%) · current grade ⋯ exam-day grade (≈40%).
 * On phones the name sits above its bar, with the grades beside both.
 */
const ROW =
  "grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)] sm:gap-x-5";
/** Current grade · connector · exam-day grade, in fixed-width cells so values align across rows. */
const GRADES = "grid grid-cols-[3rem_minmax(0.75rem,1fr)_3rem] items-center";

/**
 * Sessions done per subject, and the model's current grade next to its
 * exam-day forecast. The grades are the same values the detailed prediction
 * model shows.
 */
export function SubjectSummary({
  rows,
  model,
  onOpenModel,
}: {
  rows: SubjectProgressRow[];
  /** The prediction model's state: its grades are only shown once it has answered. */
  model: { status: "loading" } | { status: "error"; message: string } | { status: "ready"; asOf: string };
  onOpenModel: () => void;
}) {
  const fromSelfAssessment = model.status === "ready" && rows.some((r) => r.prediction?.basis === "self-assessment");

  return (
    <div>
      {/* Column headings: only above the grades */}
      <div className={`${ROW} mb-1.5`} aria-hidden>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-2">Subject progress</p>
        <div className={`${GRADES} text-[10px] font-semibold uppercase tracking-wide text-muted`}>
          <span className="text-center">Current</span>
          <span />
          <span className="text-center whitespace-nowrap">Exam day</span>
        </div>
      </div>

      <ul className="space-y-2.5">
        {rows.map((r) => {
          const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
          const p = r.prediction;
          const selfEstimate = p?.basis === "self-assessment";
          return (
            <li key={r.subject} data-subject={r.subject} className={ROW}>
              {/* Name */}
              <p
                className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-sm font-medium"
                title={r.subject}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="line-clamp-2 break-words">{r.subject}</span>
              </p>

              {/* Progress: sessions above the right end of the bar */}
              <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
                <p className="mb-0.5 text-right text-[11px] leading-none text-muted tabular-nums">
                  {r.done}/{r.total}
                </p>
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-2"
                  role="progressbar"
                  aria-label={`${r.subject}: ${r.done} of ${r.total} sessions done`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: r.color }} />
                </div>
              </div>

              {/* Grades */}
              <div className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1" data-grades>
                {model.status === "loading" ? (
                  <p className="text-center text-xs text-muted">Loading forecast…</p>
                ) : model.status === "error" || !p ? (
                  <p className="text-center text-xs text-muted">{model.status === "error" ? "Forecast unavailable" : "No forecast yet"}</p>
                ) : (
                  <div className={`${GRADES} tabular-nums`}>
                    <span
                      className={`text-center text-sm font-semibold ${selfEstimate ? "text-muted" : ""}`}
                      title={
                        `${selfEstimate ? "Your own estimate (no results logged yet)" : "Current grade, if the exam were today"}: ` +
                        `${formatPredictedGrade(p.current.grade)}, 90% range ${formatPredictedGrade(p.current.low)}–${formatPredictedGrade(p.current.high)}`
                      }
                    >
                      {formatPredictedGrade(p.current.grade)}
                      {selfEstimate && <sup aria-label="self-estimate">*</sup>}
                    </span>
                    <span aria-hidden className="h-0 border-t-2 border-dotted border-muted/50" />
                    <span
                      className="text-center text-base font-bold"
                      title={`Predicted exam-day grade: ${formatPredictedGrade(p.examDay.grade)}, 90% range ${formatPredictedGrade(p.examDay.low)}–${formatPredictedGrade(p.examDay.high)}`}
                    >
                      {formatPredictedGrade(p.examDay.grade)}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-3">
        <p className="text-[11px] text-muted">
          {model.status === "ready" && (
            <>
              Grades from the prediction model, updated {time.format(new Date(model.asOf))}. They are estimates, not
              guarantees.
              {fromSelfAssessment && " * Your own estimate: no results logged yet, so confidence is low."}
            </>
          )}
          {model.status === "error" && model.message}
        </p>
        <button
          type="button"
          onClick={onOpenModel}
          className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold hover:bg-beige"
        >
          View grade prediction model →
        </button>
      </div>
    </div>
  );
}
