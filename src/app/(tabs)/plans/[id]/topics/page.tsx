import type { Metadata } from "next";
import { Card } from "@/components/ui/primitives";
import { TopicProfile } from "@/components/knowledge/topic-profile";
import { Unavailable } from "@/components/knowledge/unavailable";
import { loadKnowledge } from "../load";

export const metadata: Metadata = { title: "Subjects" };

export default async function TopicsPage({ params }: PageProps<"/plans/[id]/topics">) {
  const { id } = await params;
  const { plan, timeline, error } = await loadKnowledge(id);
  if (error !== null) return <Unavailable message={error} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        How your knowledge differs between subjects. A wide band means the model is still unsure about a subject: a
        quick quiz there tells it the most.
      </p>
      <Card>
        <TopicProfile timeline={timeline} subjects={plan.subjects} />
      </Card>
    </div>
  );
}
