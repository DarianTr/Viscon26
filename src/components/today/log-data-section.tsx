import Link from "next/link";
import { Suspense } from "react";
import { TIME_ZONE } from "@/db";
import { DataPointList, LogDataPointForm } from "@/components/knowledge/log-data-point";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { isId } from "@/lib/http";
import { getOwnedPlan, KnowledgeError, listObservations, type OwnedPlan } from "@/lib/knowledge";
import { localDateKey, splitPlans } from "@/lib/plan-status";
import { getTodaysLogContext, getUserCustomPlans } from "@/lib/queries";
import { LogPlanPicker } from "./log-plan-picker";

/*
 * Optional logging on Today: the plan's "Log data" form and data points, the
 * same components the plan pages used. Closed until the student opens it
 * (`?log=<planId>`); the plan and subject studied today are preselected.
 */
export async function LogDataSection({ userId, open }: { userId: string; open: string | undefined }) {
  const [plans, context] = await Promise.all([getUserCustomPlans(userId), getTodaysLogContext(userId)]);
  // Current plans first, then finished ones — an exam result is logged after the exam.
  const { current, past } = splitPlans(plans, localDateKey(new Date(), TIME_ZONE));
  const choices = [...current, ...past.filter((p) => p.status === "finished")];
  const fallback = choices.find((p) => p.id === context?.planId) ?? choices[0];
  if (!fallback) return null;

  if (open === undefined) {
    return (
      <>
        <SectionTitle>Upload results</SectionTitle>
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p id="log-data" className="max-w-[46ch] text-sm text-muted">
            Optional: log a practice sheet, quiz, mock or exam result to update your grade forecast.
          </p>
          <Link
            href={`/?log=${fallback.id}#log-data`}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
          >
            Upload results
          </Link>
        </Card>
      </>
    );
  }

  const plan = (isId(open) ? await getOwnedPlan(userId, open) : null) ?? (await getOwnedPlan(userId, fallback.id));
  if (!plan) return null;
  const subjectId =
    context?.planId === plan.id ? plan.subjects.find((x) => x.name === context.subject)?.id : undefined;
  const options = choices.some((p) => p.id === plan.id) ? choices : [{ id: plan.id, title: plan.title }, ...choices];

  return (
    <>
      <SectionTitle
        action={
          <Link href="/" scroll={false} className="text-sm font-medium text-muted hover:text-foreground">
            Close
          </Link>
        }
      >
        Upload results
      </SectionTitle>
      <div id="log-data">
        {options.length > 1 && <LogPlanPicker plans={options} value={plan.id} />}
        {plan.subjects.length === 0 ? (
          <Card className="text-sm text-muted">This plan has no subjects yet.</Card>
        ) : (
          <>
            <Card>
              <LogDataPointForm key={plan.id} planId={plan.id} subjects={plan.subjects} initialSubjectId={subjectId} />
            </Card>
            <SectionTitle>Logged data points</SectionTitle>
            <Card>
              <Suspense fallback={<p className="py-6 text-center text-sm text-muted">Loading…</p>}>
                <LoggedDataPoints userId={userId} plan={plan} />
              </Suspense>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

async function LoggedDataPoints({ userId, plan }: { userId: string; plan: OwnedPlan }) {
  const observations = await listObservations(userId, plan.id).catch((e) => {
    if (e instanceof KnowledgeError) return e;
    throw e;
  });
  if (observations instanceof KnowledgeError) {
    return <p className="py-6 text-center text-sm text-muted">Knowledge data isn&apos;t available right now: {observations.message}</p>;
  }
  return <DataPointList planId={plan.id} subjects={plan.subjects} observations={observations} />;
}
