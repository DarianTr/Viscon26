import Link from "next/link";
import type { Metadata } from "next";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { Brain } from "@/components/mascot/brain";
import { Card, PageHeader, SectionTitle } from "@/components/ui/primitives";
import { emptyStateLines } from "@/lib/mascot";
import { getActivePlan, getCurrentUser, getUserCustomPlans } from "@/lib/queries";
import { sessionTypes } from "@/lib/session-types";
import type { ActivePlan } from "@/lib/types";
import { CustomPlanCard } from "@/components/plans/plan-card";

export const metadata: Metadata = { title: "Plans" };

export default async function PlansPage() {
  const user = await getCurrentUser();
  const [activePlan, customPlans] = await Promise.all([
    getActivePlan(user.id),
    getUserCustomPlans(user.id),
  ]);

  return (
    <>
      <PageHeader eyebrow="Quest log" title="Plans" />

      {activePlan && <ActivePlanOverview activePlan={activePlan} />}

      <SectionTitle>My plans</SectionTitle>
      {customPlans.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <Brain expression="confused" size={72} />
          <p className="max-w-[26ch] text-sm text-muted">{emptyStateLines.noPlan}</p>
          <Link
            href="/plans/new"
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-foreground bg-foreground px-5 py-2.5 text-sm font-bold text-background shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none"
          >
            <PlusIcon className="size-4" />
            Create new plan
          </Link>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {customPlans.map((plan) => (
              <CustomPlanCard key={plan.id} plan={plan} />
            ))}
          </div>
          <div className="mt-4 flex justify-center">
            <Link
              href="/plans/new"
              className="inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-foreground bg-foreground px-5 py-2.5 text-sm font-bold text-background shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none"
            >
              <PlusIcon className="size-4" />
              Create new plan
            </Link>
          </div>
        </>
      )}
    </>
  );
}


function ActivePlanOverview({ activePlan }: { activePlan: ActivePlan }) {
  const { plan } = activePlan;

  const phases = plan.phases.map((phase, i) => {
    const start = plan.phases.slice(0, i).reduce((sum, p) => sum + p.weeks, 0);
    const week = activePlan.currentWeek;
    return { ...phase, start, current: week > start && week <= start + phase.weeks };
  });
  const currentPhase = phases.find((p) => p.current);

  return (
    <>
      <div className={`rounded-[1.75rem] border-[2.5px] border-foreground bg-gradient-to-br ${plan.gradient} p-5 text-white shadow-[0_4px_0_0_var(--foreground)]`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xs font-bold tracking-wide uppercase opacity-85">Active quest</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold">{plan.title}</h2>
            <p className="mt-1 text-sm opacity-90">{plan.goal}</p>
          </div>
          <div className="rounded-2xl border border-white/25 bg-white/15 px-3 py-2 text-center backdrop-blur">
            <p className="font-display text-2xl leading-none font-bold">{activePlan.currentWeek}</p>
            <p className="mt-1 text-[10px] uppercase opacity-85">of {plan.weeks} wks</p>
          </div>
        </div>

        <div className="mt-5 flex gap-1">
          {phases.map((phase) => (
            <div key={phase.name} style={{ flex: phase.weeks }}>
              <div className="flex gap-1">
                {Array.from({ length: phase.weeks }, (_, i) => {
                  const week = phase.start + i + 1;
                  return (
                    <div
                      key={week}
                      className={`h-2 flex-1 rounded-full ${
                        week < activePlan.currentWeek
                          ? "bg-white"
                          : week === activePlan.currentWeek
                            ? "bg-white/70"
                            : "bg-white/25"
                      }`}
                    />
                  );
                })}
              </div>
              <p className={`mt-1.5 text-[11px] ${phase.current ? "font-bold" : "opacity-70"}`}>{phase.name}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm opacity-90">
          {currentPhase?.name} phase
          {activePlan.examDate &&
            ` · Exam on ${new Date(activePlan.examDate).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}
        </p>
      </div>

      <SectionTitle>This week</SectionTitle>
      <Card className="p-4">
        <ul className="grid grid-cols-7 gap-1.5">
          {activePlan.weekSessions.map(({ day, type, done }) => (
            <li key={day} className="flex flex-col items-center gap-2">
              <span className="text-[11px] font-medium text-muted">{day}</span>
              <span
                className={`grid aspect-square w-full max-w-11 place-items-center rounded-xl text-white ${
                  type ? sessionTypes[type].color : "bg-surface-2"
                } ${type && !done ? "opacity-35" : ""}`}
              >
                {done && <CheckIcon className="size-4" />}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3">
          {Object.entries(sessionTypes).map(([key, t]) => (
            <span key={key} className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className={`size-2.5 rounded-full ${t.color}`} />
              {t.label}
            </span>
          ))}
        </div>
      </Card>
    </>
  );
}
