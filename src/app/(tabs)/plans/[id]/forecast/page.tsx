import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { ForecastChart } from "@/components/knowledge/forecast-chart";
import { StudyFocusCard } from "@/components/knowledge/study-focus";
import { Unavailable } from "@/components/knowledge/unavailable";
import { loadKnowledge } from "../load";

export const metadata: Metadata = { title: "Grade forecast" };

export default async function ForecastPage({ params }: PageProps<"/plans/[id]/forecast">) {
  const { id } = await params;
  const { plan, timeline, observations, focus, error } = await loadKnowledge(id);
  if (error !== null) return <Unavailable message={error} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        The predicted grade is a distribution, not a single number: the shading is darker where your grade is more
        likely to land. Every logged score moves it and makes it narrower.
      </p>
      <Card>
        <ForecastChart timeline={timeline} subjects={plan.subjects} />
      </Card>
      {observations.length === 0 && (
        <p className="text-sm text-muted">
          No data points yet, so this is only the starting guess from your plan.{" "}
          <Link href={`/plans/${plan.id}/log`} className="font-medium text-accent">
            Log a result
          </Link>{" "}
          to make it yours.
        </p>
      )}
      {focus.topics.length > 0 && (
        <Card>
          <h2 className="mb-4 text-base font-semibold">Study focus</h2>
          <StudyFocusCard focus={focus} subjects={plan.subjects} />
        </Card>
      )}
    </div>
  );
}
