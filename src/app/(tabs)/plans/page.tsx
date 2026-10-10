import Link from "next/link";
import type { Metadata } from "next";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { Card, PageHeader, SectionTitle } from "@/components/ui/primitives";
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
      <PageHeader eyebrow="Training plans" title="Plans" />

      {activePlan && <ActivePlanOverview activePlan={activePlan} />}

      <SectionTitle>My plans</SectionTitle>
      {customPlans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-5">
          <p className="text-sm text-muted">No plans yet.</p>
          <Link
            href="/plans/new"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background shadow-lg"
          >
            <PlusIcon className="size-5" />
            Create new plan
          </Link>
        </div>
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
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background"
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
      <div className={`rounded-3xl bg-gradient-to-br ${plan.gradient} p-5 text-white shadow-lg shadow-accent/15`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase opacity-80">Active plan</p>
            <h2 className="mt-1 text-2xl font-bold">{plan.title}</h2>
            <p className="mt-1 text-sm opacity-85">{plan.goal}</p>
          </div>
          <div className="rounded-2xl bg-white/15 px-3 py-2 text-center backdrop-blur">
            <p className="text-2xl leading-none font-bold">{activePlan.currentWeek}</p>
            <p className="mt-1 text-[10px] uppercase opacity-80">of {plan.weeks} wks</p>
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
