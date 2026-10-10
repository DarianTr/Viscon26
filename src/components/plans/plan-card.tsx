"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/primitives";
import { AddSubjectWizard } from "@/components/plans/add-subject-wizard";
import { ForecastChart } from "@/components/knowledge/forecast-chart";
import { TopicProfile } from "@/components/knowledge/topic-profile";
import type { CustomPlan } from "@/lib/queries";
import type { KnowledgeSubject, Timeline } from "@/lib/knowledge";

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
  /** Per subject: cheatsheet % the plan expects by now, and actual progress (reported, else completed sessions). */
  cheatsheet: Record<string, { planned: number; actual: number; reported: boolean }>;
  /** Per subject: the preparation phase it is in now. */
  phases?: Record<string, "foundation" | "build" | "peak" | "taper">;
  /** Per subject: past/mock exams available, done, still planned, and held in reserve. */
  mocks: Record<string, { available: number; done: number; planned: number; reserve: number }>;
  config: StoredConfig;
};

/** A change to how many mocks a subject should do, after a new result. */
type MockChange = { subject: string; from: number; to: number; reason: string };

/** Where "Continue plan" leads: today's board for today's work, else the calendar on that day. */
function continueHref(start: string) {
  const at = new Date(start);
  const today = new Date();
  if (at.toDateString() === today.toDateString()) return "/";
  const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `/calendar?date=${key}`;
}

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
  const [showWizard, setShowWizard] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = localStorage.getItem(`strategy-${plan.id}`);
      return cached ? (JSON.parse(cached) as StrategyResult) : null;
    } catch { return null; }
  });
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [mockChanges, setMockChanges] = useState<MockChange[] | null>(null);
  const [updatingMocks, setUpdatingMocks] = useState(false);
  // Reporting cheatsheet progress: which subject's form is open, and the catch-up it triggered.
  const [reporting, setReporting] = useState<{ subject: string; percent: number } | null>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [caughtUp, setCaughtUp] = useState<{ subject: string; actual: number; planned: number; addedMinutes: number } | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [tab, setTab] = useState<"forecast" | "subjects">("forecast");
  const [knowledge, setKnowledge] = useState<{ timeline: Timeline; subjects: KnowledgeSubject[] } | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

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

  async function fetchKnowledge() {
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/knowledge`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setKnowledgeError(data.error ?? "Could not load knowledge data.");
        return;
      }
      setKnowledge(await res.json());
    } catch {
      setKnowledgeError("Network error — please try again.");
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      if (!details) fetchDetails();
      if (!knowledge) fetchKnowledge();
    }
  }

  // A new result can change how many mocks are worth doing: preview the plan, and
  // offer to update the schedule if the mock plan would change.
  async function reassessMocks() {
    if (!details?.config) return;
    const res = await fetch(`/api/plans/${plan.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: details.config, apply: false }),
    });
    if (!res.ok) return;
    const preview: { feasibility: { subjects: { name: string; mocks: { planned: number; reason: string } }[] } } = await res.json();
    const changes = preview.feasibility.subjects
      .map((s) => ({ subject: s.name, from: details.mocks?.[s.name]?.planned ?? 0, to: s.mocks.planned, reason: s.mocks.reason }))
      .filter((c) => c.from !== c.to);
    setMockChanges(changes.length ? changes : null);
  }

  async function applyMockChanges() {
    if (!details?.config) return;
    setUpdatingMocks(true);
    try {
      const res = await fetch(`/api/plans/${plan.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: details.config, apply: true }),
      });
      if (res.ok) {
        setMockChanges(null);
        setDetails(null);
        await fetchDetails();
      }
    } finally {
      setUpdatingMocks(false);
    }
  }

  // The student says how far a cheatsheet actually is. Behind the plan, the
  // server rebuilds the remaining schedule right away with more cheatsheet time.
  async function reportCheatsheet() {
    if (!reporting) return;
    setSavingReport(true);
    try {
      const res = await fetch(`/api/plans/${plan.id}/cheatsheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reporting),
      });
      if (!res.ok) return;
      const data: { caughtUp: boolean; planned: number; addedMinutes?: number } = await res.json();
      setCaughtUp(data.caughtUp
        ? { subject: reporting.subject, actual: reporting.percent, planned: data.planned, addedMinutes: data.addedMinutes ?? 0 }
        : null);
      setReporting(null);
      await fetchDetails();
    } finally {
      setSavingReport(false);
    }
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

  useEffect(() => {
    if (details && details.scores.length > 0 && !strategy && !strategyLoading) {
      fetchStrategy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details]);

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

      {/* Continue / manage */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {plan.next ? (
          <Link
            href={continueHref(plan.next.start)}
            title={plan.next.title}
            className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white"
          >
            {plan.next.ongoing ? "Continue plan · now" : `Continue plan · ${new Date(plan.next.start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`}
          </Link>
        ) : (
          <span className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold text-muted">Nothing left to do</span>
        )}
        <Link
          href={`/plans/new?edit=${plan.id}`}
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold"
        >
          Manage plan
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
                            {details.phases?.[s.subject] && (
                              <span className="mr-2 font-medium capitalize text-foreground">{details.phases[s.subject]}</span>
                            )}
                            {s.done}/{s.total} sessions
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${pct}%`, background: color }}
                          />
                        </div>
                        {(details.mocks?.[s.subject]?.available ?? 0) > 0 && (
                          <p className="mt-1 text-[11px] text-muted">
                            Mocks: {details.mocks[s.subject].done} done · {details.mocks[s.subject].planned} planned
                            {details.mocks[s.subject].reserve > 0 && ` · ${details.mocks[s.subject].reserve} in reserve`}
                          </p>
                        )}
                        {details.cheatsheet?.[s.subject] && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                            <span>
                              Cheatsheet: {details.cheatsheet[s.subject].actual}% {details.cheatsheet[s.subject].reported ? "reported" : "done"}
                              {" · "}{details.cheatsheet[s.subject].planned}% planned by now
                            </span>
                            {reporting?.subject === s.subject ? (
                              <span className="flex items-center gap-1">
                                <input
                                  aria-label={`${s.subject} cheatsheet progress in percent`}
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={reporting.percent}
                                  onChange={(e) => setReporting({ subject: s.subject, percent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                                  className="w-14 rounded-md border border-border bg-background px-1.5 py-0.5"
                                />
                                %
                                <button onClick={() => void reportCheatsheet()} disabled={savingReport} className="font-semibold text-accent disabled:opacity-50">
                                  {savingReport ? "Saving…" : "Save"}
                                </button>
                                <button onClick={() => setReporting(null)}>Cancel</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setReporting({ subject: s.subject, percent: details.cheatsheet[s.subject].actual })}
                                className="font-semibold text-accent"
                              >
                                Update progress
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
          {/* Tab bar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTab("forecast")}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${tab === "forecast" ? "bg-foreground text-background" : "bg-surface-2 text-foreground"}`}
            >
              Grade forecast
            </button>
            <button
              onClick={() => setTab("subjects")}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${tab === "subjects" ? "bg-foreground text-background" : "bg-surface-2 text-foreground"}`}
            >
              Subjects
            </button>
            <Link href={`/plans/${plan.id}/log`} className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold">
              Log data
            </Link>
            <button
              onClick={() => setShowWizard(true)}
              className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold hover:opacity-80"
            >
              + Add subject
            </button>
          </div>

          {/* Tab content */}
          {knowledgeLoading ? (
            <p className="py-4 text-center text-sm text-muted">Loading…</p>
          ) : knowledgeError ? (
            <p className="text-xs text-red-500">{knowledgeError}</p>
          ) : knowledge ? (
            tab === "forecast"
              ? <ForecastChart timeline={knowledge.timeline} subjects={knowledge.subjects} />
              : <TopicProfile timeline={knowledge.timeline} subjects={knowledge.subjects} />
          ) : null}

          {/* AI Strategy */}
          {details && (
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
          )}
        </div>
      )}
    </Card>
    </>
  );
}
