import type { Metadata } from "next";
import { PracticeSection } from "@/components/knowledge/practice-section";
import { Unavailable } from "@/components/knowledge/unavailable";
import { loadKnowledge } from "../load";

export const metadata: Metadata = { title: "Practice" };

export default async function PracticePage({ params }: PageProps<"/plans/[id]/practice">) {
  const { id } = await params;
  const { plan, focus, error } = await loadKnowledge(id);
  if (error !== null) return <Unavailable message={error} />;

  return <PracticeSection planId={plan.id} focus={focus} />;
}
