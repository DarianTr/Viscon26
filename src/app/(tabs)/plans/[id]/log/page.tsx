import type { Metadata } from "next";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { DataPointList, LogDataPointForm } from "@/components/knowledge/log-data-point";
import { Unavailable } from "@/components/knowledge/unavailable";
import { loadKnowledge } from "../load";

export const metadata: Metadata = { title: "Log data" };

export default async function LogPage({ params }: PageProps<"/plans/[id]/log">) {
  const { id } = await params;
  const { plan, observations, error } = await loadKnowledge(id);
  if (error !== null) return <Unavailable message={error} />;

  return (
    <>
      <Card>
        <LogDataPointForm planId={plan.id} subjects={plan.subjects} />
      </Card>
      <SectionTitle>Logged data points</SectionTitle>
      <Card>
        <DataPointList planId={plan.id} subjects={plan.subjects} observations={observations} />
      </Card>
    </>
  );
}
