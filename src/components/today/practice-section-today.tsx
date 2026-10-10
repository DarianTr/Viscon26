import Link from "next/link";
import { PracticeSection } from "@/components/knowledge/practice-section";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { isId } from "@/lib/http";
import {
  getOwnedPlan,
  getRecommendedTopics,
  KnowledgeError,
  syncTopics,
} from "@/lib/knowledge";
import { localDateKey, splitPlans } from "@/lib/plan-status";
import { getTodaysLogContext, getUserCustomPlans } from "@/lib/queries";
import { TIME_ZONE } from "@/db";

export async function PracticeSectionToday({
  userId,
  open,
}: {
  userId: string;
  open: string | undefined;
}) {
  const [plans, context] = await Promise.all([
    getUserCustomPlans(userId),
    getTodaysLogContext(userId),
  ]);
  const { current, past } = splitPlans(plans, localDateKey(new Date(), TIME_ZONE));
  const choices = [...current, ...past.filter((p) => p.status === "finished")];
  const fallback = choices.find((p) => p.id === context?.planId) ?? choices[0];
  if (!fallback) return null;

  if (open === undefined) {
    return (
      <>
        <SectionTitle>Practice</SectionTitle>
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p id="practice" className="max-w-[46ch] text-sm text-muted">
            Quiz yourself on today&apos;s topics to reinforce your understanding and close knowledge gaps.
          </p>
          <Link
            href={`/?practice=${fallback.id}#practice`}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
          >
            Practice
          </Link>
        </Card>
      </>
    );
  }

  const plan =
    (isId(open) ? await getOwnedPlan(userId, open) : null) ??
    (await getOwnedPlan(userId, fallback.id));
  if (!plan) return null;

  if (plan.subjects.length === 0) {
    return (
      <>
        <SectionTitle
          action={
            <Link href="/" scroll={false} className="text-sm font-medium text-muted hover:text-foreground">
              Close
            </Link>
          }
        >
          Practice
        </SectionTitle>
        <Card className="text-sm text-muted">This plan has no subjects yet.</Card>
      </>
    );
  }

  let focus: Awaited<ReturnType<typeof getRecommendedTopics>>;
  try {
    await syncTopics(plan);
    focus = await getRecommendedTopics(userId, plan);
  } catch (e) {
    const msg = e instanceof KnowledgeError ? e.message : "Something went wrong.";
    return <PracticeError message={msg} />;
  }

  return (
    <>
      <SectionTitle
        action={
          <Link href="/" scroll={false} className="text-sm font-medium text-muted hover:text-foreground">
            Close
          </Link>
        }
      >
        Practice
      </SectionTitle>
      <div id="practice">
        <PracticeSection planId={plan.id} focus={focus} />
      </div>
    </>
  );
}

function PracticeError({ message }: { message: string }) {
  return (
    <>
      <SectionTitle>Practice</SectionTitle>
      <Card className="text-sm text-muted">{message}</Card>
    </>
  );
}
