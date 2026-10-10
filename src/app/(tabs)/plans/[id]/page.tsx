import { redirect } from "next/navigation";

export default async function PlanKnowledgePage({ params }: PageProps<"/plans/[id]">) {
  redirect(`/plans/${(await params).id}/forecast`);
}
