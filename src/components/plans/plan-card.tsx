"use client";

import Link from "next/link";
import { useState, useTransition, useRef } from "react";
import { Card } from "@/components/ui/primitives";
import { AddSubjectWizard } from "@/components/plans/add-subject-wizard";
import type { CustomPlan } from "@/lib/queries";

type ExamScore = {
  id: string;
  subject: string;
  score: number;
  examType: "mock" | "past";
  takenAt: string;
  notes: string | null;
};

type SubjectStat = {
  subject: string;
  total: number;
  done: number;
  examDate: string | null;
};

type StoredConfig = {
  weeklyHours: number;
  studyDays: string[];
  sessionLength: number;
  vacationRanges: { start: string; end: string }[];
} | null;

type SubjectRecommendation = {
  subject: string;
  insight: string;
  urgency: "low" | "medium" | "high";
  suggestedApproach?: "foundation" | "balanced" | "exam";
  confidenceDelta: number;
  priorityTopics: string[];
};

type StrategyResult = {
  recommendations: SubjectRecommendation[];
  overallInsight: string | null;
  preferredStartHour: number | null;
};

type PlanDetails = {
  subjects: SubjectStat[];
  scores: ExamScore[];
  config: StoredConfig;
};

const PALETTE = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#3b82f6",
  "#ec4899",
  "#06b6d4",
];

function subjectColor(subjects: string[], subject: string) {
  const i = subjects.indexOf(subject);
  return PALETTE[i % PALETTE.length];
}

// ─── Score chart ────────────────────────────────────────────────────────────

function ScoreChart({ scores, subjects }: { scores: ExamScore[]; subjects: string[] }) {
  if (scores.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted">
        No scores yet — log one to start tracking your progress.
      </p>
    );
  }

  const W = 320, H = 130;
  const pad = { top: 10, right: 16, bottom: 26, left: 28 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const allTs = scores.map((s) => new Date(s.takenAt).getTime());
  const minT = Math.min(...allTs);
  const maxT = Math.max(...allTs);
  const tRange = maxT === minT ? 1 : maxT - minT;

  const toX = (date: string) =>
    pad.left + ((new Date(date).getTime() - minT) / tRange) * iW;
  const toY = (score: number) =>
    pad.top + iH - ((score - 1) / 5) * iH;

  const bySubject = new Map<string, ExamScore[]>();
  for (const s of scores) {
    if (!bySubject.has(s.subject)) bySubject.set(s.subject, []);
    bySubject.get(s.subject)!.push(s);
  }

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const yTicks = [2, 3, 4, 5, 6];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
        {/* grid + y-axis */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={pad.left} y1={toY(v)}
              x2={pad.left + iW} y2={toY(v)}
              stroke={v === 4 ? "var(--recovery)" : "currentColor"}
              strokeOpacity={v === 4 ? 0.6 : 0.1}
              strokeWidth={v === 4 ? 1.5 : 1}
              strokeDasharray={v === 4 ? undefined : "3 3"}
            />
            <text
              x={pad.left - 5} y={toY(v)}
              textAnchor="end" dominantBaseline="middle"
              fontSize={10} fill="var(--muted)"
            >
              {v}
            </text>
          </g>
        ))}
        {/* y=1 tick */}
        <text x={pad.left - 5} y={toY(1)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted)">1</text>

        {/* x-axis dates */}
        <text x={pad.left} y={H - 4} fontSize={10} fill="var(--muted)">{fmtDate(minT)}</text>
        {maxT !== minT && (
          <text x={pad.left + iW} y={H - 4} textAnchor="end" fontSize={10} fill="var(--muted)">
            {fmtDate(maxT)}
          </text>
        )}

        {/* lines and dots per subject */}
        {[...bySubject.entries()].map(([subject, pts]) => {
          const sorted = [...pts].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
          const color = subjectColor(subjects, subject);
          const d = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.takenAt).toFixed(1)},${toY(p.score).toFixed(1)}`).join(" ");

          return (
            <g key={subject}>
              {sorted.length > 1 && (
                <path
                  d={d} fill="none"
                  stroke={color} strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity={0.8}
                />
              )}
              {sorted.map((p, i) => (
                <circle
                  key={i}
                  cx={toX(p.takenAt)} cy={toY(p.score)} r={4}
                  fill={color} stroke="var(--surface)" strokeWidth={1.5}
                >
                  <title>{`${p.subject}: ${p.score} (${p.examType === "mock" ? "Mock" : "Past"})`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {subjects.filter((s) => bySubject.has(s)).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="size-2 rounded-full" style={{ background: subjectColor(subjects, s) }} />
            {s}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted" style={{ color: "var(--recovery)" }}>
          — passing (4.0)
        </span>
      </div>
    </div>
  );
}

// ─── Log score form ──────────────────────────────────────────────────────────

function LogScoreForm({
  planId,
  subjects,
  onSaved,
  onCancel,
}: {
  planId: string;
  subjects: string[];
  onSaved: (score: ExamScore) => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      userPlanId: planId,
      subject: fd.get("subject") as string,
      score: parseFloat(fd.get("score") as string),
      examType: fd.get("examType") as "mock" | "past",
      takenAt: fd.get("takenAt") as string,
      notes: (fd.get("notes") as string) || undefined,
    };

    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/exam-scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to save score");
          return;
        }
        const saved: ExamScore = await res.json();
        onSaved(saved);
        formRef.current?.reset();
      } catch {
        setError("Network error — please try again");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3 rounded-2xl bg-surface-2 p-4">
      <p className="text-sm font-semibold">Log exam score</p>

      <div className="grid grid-cols-2 gap-2">
        {/* Subject */}
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-muted">Subject</label>
          <select
            name="subject"
            required
            className="w-full rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-accent"
          >
            {subjects.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Score */}
        <div>
          <label className="mb-1 block text-xs text-muted">Score (1–6)</label>
          <input
            name="score"
            type="number"
            min={1} max={6} step={0.25}
            required
            placeholder="4.5"
            className="w-full rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-accent"
          />
        </div>

        {/* Date */}
        <div>
          <label className="mb-1 block text-xs text-muted">Date</label>
          <input
            name="takenAt"
            type="date"
            defaultValue={today}
            required
            className="w-full rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-accent"
          />
        </div>

        {/* Exam type */}
        <div className="col-span-2 flex gap-4">
          {(["mock", "past"] as const).map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio" name="examType" value={t}
                defaultChecked={t === "mock"}
                className="accent-accent"
              />
              {t === "mock" ? "Mock exam" : "Past paper"}
            </label>
          ))}
        </div>

        {/* Notes */}
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-muted">Notes (optional)</label>
          <input
            name="notes"
            type="text"
            maxLength={500}
            placeholder="e.g. finished with 10 min to spare"
            className="w-full rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-accent"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ─── Changes summary ─────────────────────────────────────────────────────────

function ChangesSummary({
  recommendations,
  preferredStartHour,
}: {
  recommendations: SubjectRecommendation[];
  preferredStartHour: number | null;
}) {
  const changes: { label: string; detail: string }[] = [];

  for (const rec of recommendations) {
    if (rec.confidenceDelta <= -0.15) {
      changes.push({ label: rec.subject, detail: "more sessions scheduled — scores indicate knowledge gaps" });
    } else if (rec.confidenceDelta >= 0.15) {
      changes.push({ label: rec.subject, detail: "fewer sessions scheduled — performing above expectation" });
    }
    if (rec.suggestedApproach) {
      changes.push({ label: rec.subject, detail: `approach → ${rec.suggestedApproach}` });
    }
  }

  if (preferredStartHour !== null) {
    changes.push({
      label: "Session timing",
      detail: `start time → ${String(preferredStartHour).padStart(2, "0")}:00 (your most productive hour)`,
    });
  }

  if (changes.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-2xl bg-surface-2 p-3">
      <p className="text-xs font-semibold text-muted">What will change</p>
      <ul className="space-y-1">
        {changes.map((c, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span className="shrink-0 text-accent">→</span>
            <span>
              <span className="font-medium text-foreground">{c.label}:</span>
              {" "}{c.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Strategy section ────────────────────────────────────────────────────────

const URGENCY_STYLE: Record<
  "low" | "medium" | "high",
  { bg: string; color: string; label: string }
> = {
  high:   { bg: "color-mix(in srgb, var(--intervals) 15%, transparent)", color: "var(--intervals)", label: "High" },
  medium: { bg: "color-mix(in srgb, #f59e0b 15%, transparent)",          color: "#d97706",           label: "Medium" },
  low:    { bg: "color-mix(in srgb, var(--recovery) 15%, transparent)",  color: "var(--recovery)",   label: "Low" },
};

function StrategySection({
  planId,
  subjectNames,
  hasScores,
  strategy,
  loading,
  error,
  onAnalyse,
  onReschedule,
}: {
  planId: string;
  subjectNames: string[];
  hasScores: boolean;
  strategy: StrategyResult | null;
  loading: boolean;
  error: string | null;
  onAnalyse: () => void;
  onReschedule: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ count: number; breakdown: Record<string, number>; warnings?: string[] } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function applyToSchedule() {
    if (!strategy?.recommendations.length) return;
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/plans/${planId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendations: strategy.recommendations.map((r) => ({
            subject: r.subject,
            suggestedApproach: r.suggestedApproach,
            confidenceDelta: r.confidenceDelta,
            priorityTopics: r.priorityTopics,
          })),
          ...(strategy.preferredStartHour !== null ? { preferredStartHour: strategy.preferredStartHour } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setApplyError(data.error ?? "Failed to apply changes.");
        return;
      }
      setApplyResult(await res.json());
      onReschedule();
    } catch {
      setApplyError("Network error — please try again.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">AI Strategy</p>
        <button
          onClick={onAnalyse}
          disabled={loading || !hasScores}
          className="text-xs font-semibold text-accent hover:opacity-80 disabled:opacity-40"
        >
          {loading ? "Analysing…" : strategy ? "Refresh" : "Analyse"}
        </button>
      </div>

      {!hasScores && !strategy && (
        <p className="text-xs text-muted">Log exam scores first to unlock AI strategy insights.</p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {loading && (
        <p className="py-4 text-center text-sm text-muted">Analysing your results…</p>
      )}

      {strategy && !loading && (
        <div className="space-y-3">
          {strategy.overallInsight && (
            <p className="text-sm italic text-muted">{strategy.overallInsight}</p>
          )}

          {strategy.recommendations.map((rec) => {
            const style = URGENCY_STYLE[rec.urgency];
            return (
              <div key={rec.subject} className="space-y-2 rounded-2xl bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: subjectColor(subjectNames, rec.subject) }}
                    />
                    <span className="text-sm font-medium">{rec.subject}</span>
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-muted">{rec.insight}</p>

                {rec.priorityTopics.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {rec.priorityTopics.map((topic) => (
                      <span
                        key={topic}
                        className="rounded-full bg-surface px-2 py-0.5 text-xs text-foreground"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                )}

                {rec.suggestedApproach && (
                  <p className="text-xs text-muted">
                    Suggested approach:{" "}
                    <span className="font-medium capitalize text-foreground">
                      {rec.suggestedApproach}
                    </span>
                  </p>
                )}
              </div>
            );
          })}

          {/* What will change */}
          <ChangesSummary recommendations={strategy.recommendations} preferredStartHour={strategy.preferredStartHour} />

          {/* Apply to schedule */}
          {applyResult ? (
            <div className="space-y-1.5 rounded-2xl p-3" style={{ background: "color-mix(in srgb, var(--recovery) 12%, transparent)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--recovery)" }}>
                Schedule updated — {applyResult.count} new sessions generated
              </p>
              {Object.entries(applyResult.breakdown)
                .filter(([subj]) => subj !== "exam")
                .map(([subj, count]) => (
                  <p key={subj} className="flex justify-between text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full" style={{ background: subjectColor(subjectNames, subj) }} />
                      {subj}
                    </span>
                    <span>{count} sessions</span>
                  </p>
                ))}
              {applyResult.warnings?.map((w) => (
                <p key={w} className="text-xs text-red-600">{w}</p>
              ))}
            </div>
          ) : (
            <button
              onClick={applyToSchedule}
              disabled={applying}
              className="mt-1 w-full rounded-full bg-accent py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {applying ? "Applying…" : "Apply to schedule"}
            </button>
          )}

          {applyError && <p className="text-xs text-red-500">{applyError}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main card ───────────────────────────────────────────────────────────────

export function CustomPlanCard({ plan }: { plan: CustomPlan }) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<PlanDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = localStorage.getItem(`strategy-${plan.id}`);
      return cached ? (JSON.parse(cached) as StrategyResult) : null;
    } catch { return null; }
  });
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);

  const progress = plan.totalSessions > 0 ? plan.doneSessions / plan.totalSessions : 0;
  const progressPct = Math.round(progress * 100);

  async function fetchDetails() {
    setLoading(true);
    try {
      const res = await fetch(`/api/plans/${plan.id}`);
      if (res.ok) setDetails(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !details) await fetchDetails();
  }

  function handleScoreSaved(score: ExamScore) {
    setDetails((prev) =>
      prev ? { ...prev, scores: [...prev.scores, score].sort((a, b) => a.takenAt.localeCompare(b.takenAt)) } : prev
    );
    setShowForm(false);
    // Invalidate cached strategy so the user is prompted to refresh
    setStrategy(null);
    localStorage.removeItem(`strategy-${plan.id}`);
  }

  async function fetchStrategy() {
    setStrategyLoading(true);
    setStrategyError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/strategy`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStrategyError(data.error ?? "Analysis failed — please try again.");
        return;
      }
      const data: StrategyResult = await res.json();
      setStrategy(data);
      localStorage.setItem(`strategy-${plan.id}`, JSON.stringify(data));
    } catch {
      setStrategyError("Network error — please try again.");
    } finally {
      setStrategyLoading(false);
    }
  }

  const subjectNames = details?.subjects.map((s) => s.subject) ?? plan.subjects;

  return (
    <>
    {showWizard && (
      <AddSubjectWizard
        planId={plan.id}
        storedConfig={details?.config ?? null}
        onClose={() => setShowWizard(false)}
        onDone={async () => {
          setShowWizard(false);
          setDetails(null);
          await fetchDetails();
        }}
      />
    )}

    <Card className="overflow-hidden p-0">
      {/* Header — always visible, click to expand */}
      <button
        onClick={handleToggle}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="font-semibold">{plan.title}</p>
          {plan.subjects.length > 0 && (
            <p className="mt-0.5 text-xs text-muted">{plan.subjects.join(" · ")}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-muted">{progressPct}%</span>
          <svg
            viewBox="0 0 16 16" className={`size-4 text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </div>
      </button>

      {/* Overall progress bar */}
      <div className="mx-4 h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Knowledge pages: always visible, no need to expand the card */}
      <div className="flex flex-wrap gap-2 px-4 pt-3 pb-4">
        <Link
          href={`/plans/${plan.id}/forecast`}
          className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background"
        >
          Grade forecast
        </Link>
        <Link href={`/plans/${plan.id}/topics`} className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold">
          Subjects
        </Link>
        <Link href={`/plans/${plan.id}/log`} className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold">
          Log data
        </Link>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-5 border-t border-border px-4 pt-4 pb-4">
          {loading ? (
            <p className="py-4 text-center text-sm text-muted">Loading…</p>
          ) : details ? (
            <>
              {/* Per-subject progress */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Subject progress</p>
                  <button
                    onClick={() => setShowWizard(true)}
                    className="text-xs font-semibold text-accent hover:opacity-80"
                  >
                    + Add subject
                  </button>
                </div>
                <ul className="space-y-2.5">
                  {details.subjects.map((s) => {
                    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
                    const color = subjectColor(subjectNames, s.subject);
                    return (
                      <li key={s.subject}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                            {s.subject}
                          </span>
                          <span className="text-xs text-muted tabular-nums">
                            {s.done}/{s.total} sessions
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${pct}%`, background: color }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Exam scores section */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Exam scores</p>
                  {!showForm && (
                    <button
                      onClick={() => setShowForm(true)}
                      className="text-xs font-semibold text-accent hover:opacity-80"
                    >
                      + Log score
                    </button>
                  )}
                </div>

                {showForm && (
                  <LogScoreForm
                    planId={plan.id}
                    subjects={subjectNames}
                    onSaved={handleScoreSaved}
                    onCancel={() => setShowForm(false)}
                  />
                )}

                <ScoreChart scores={details.scores} subjects={subjectNames} />

                {/* Recent scores list */}
                {details.scores.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {[...details.scores].reverse().slice(0, 5).map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: subjectColor(subjectNames, s.subject) }}
                          />
                          <span className="font-medium">{s.subject}</span>
                          <span className="text-muted">
                            {s.examType === "mock" ? "Mock" : "Past"} ·{" "}
                            {new Date(s.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        </span>
                        <span
                          className="font-semibold tabular-nums"
                          style={{ color: s.score >= 4 ? "var(--recovery)" : "var(--intervals)" }}
                        >
                          {s.score.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* AI Strategy section */}
              <StrategySection
                planId={plan.id}
                subjectNames={subjectNames}
                hasScores={details.scores.length > 0}
                strategy={strategy}
                loading={strategyLoading}
                error={strategyError}
                onAnalyse={fetchStrategy}
                onReschedule={async () => {
                  setDetails(null);
                  await fetchDetails();
                }}
              />
            </>
          ) : (
            <p className="py-4 text-center text-sm text-muted">Failed to load plan details.</p>
          )}
        </div>
      )}
    </Card>
    </>
  );
}
