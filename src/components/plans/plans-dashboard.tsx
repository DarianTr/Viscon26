"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { PlusIcon } from "@/components/icons";
import { CustomPlanCard } from "@/components/plans/plan-card";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { localDateKey, splitPlans } from "@/lib/plan-status";
import type { CustomPlan } from "@/lib/queries";

/** Re-render when the date may have changed: every minute, and when the tab comes back. */
function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
  };
}

/**
 * Today's date where the student is ("YYYY-MM-DD") — only known in the
 * browser, so the server renders a placeholder. It updates when the date
 * changes, so a plan moves to Past Plans the day after its last exam.
 */
function useLocalToday(): string | null {
  return useSyncExternalStore(subscribe, () => localDateKey(new Date()), () => null);
}

export function PlansDashboard({ plans: initial }: { plans: CustomPlan[] }) {
  const today = useLocalToday();
  const [plans, setPlans] = useState(initial);
  const [pastOpen, setPastOpen] = useState(false);

  const createButton = (
    <Link
      href="/plans/new"
      className="inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-foreground bg-foreground px-4 py-2 text-sm font-bold text-background shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none"
    >
      <PlusIcon className="size-4" />
      Create new plan
    </Link>
  );

  if (!today) {
    return (
      <>
        <SectionTitle action={createButton}>Current Plans</SectionTitle>
        <div className="space-y-3">
          {plans.slice(0, 2).map((plan) => <Card key={plan.id} className="h-24 animate-pulse" />)}
        </div>
      </>
    );
  }

  const { current, past } = splitPlans(plans, today);
  const archiveChanged = (planId: string, archivedAt: string | null) =>
    setPlans((list) => list.map((p) => (p.id === planId ? { ...p, archivedAt } : p)));

  return (
    <>
      <SectionTitle action={createButton}>Current Plans</SectionTitle>
      {current.length === 0 ? (
        <Card className="py-6 text-center text-sm text-muted">
          No current plans — your past plans are below.
        </Card>
      ) : (
        <div className="space-y-3">
          {current.map((plan) => (
            <CustomPlanCard key={plan.id} plan={plan} onArchiveChange={archiveChanged} />
          ))}
        </div>
      )}

      <div className="mt-8 mb-3">
        <button
          onClick={() => setPastOpen((open) => !open)}
          aria-expanded={pastOpen}
          aria-controls="past-plans"
          className="flex w-full items-center gap-2 text-left"
        >
          <h2 className="font-display text-xl font-bold tracking-tight">Past Plans</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">
            {past.length}
          </span>
          <svg
            viewBox="0 0 16 16"
            className={`ml-auto size-4 text-muted transition-transform duration-200 ${pastOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>
      </div>
      {pastOpen && (
        <div id="past-plans" className="space-y-2">
          {past.length === 0 ? (
            <Card className="py-5 text-center text-sm text-muted">
              Plans move here the day after their last exam, or when you archive them.
            </Card>
          ) : (
            past.map((plan) => (
              <CustomPlanCard key={plan.id} plan={plan} variant="past" status={plan.status} onArchiveChange={archiveChanged} />
            ))
          )}
        </div>
      )}
    </>
  );
}
