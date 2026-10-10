import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { KnowledgeNav } from "@/components/knowledge/sub-nav";
import { isId } from "@/lib/http";
import { getOwnedPlan } from "@/lib/knowledge";
import { getCurrentUser } from "@/lib/queries";

export default async function PlanKnowledgeLayout({ children, params }: LayoutProps<"/plans/[id]">) {
  const { id } = await params;
  const user = await getCurrentUser();
  const plan = isId(id) ? await getOwnedPlan(user.id, id) : null;
  if (!plan) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Knowledge"
        title={plan.title}
        action={
          <Link href="/plans" className="text-sm font-medium text-muted hover:text-foreground">
            ← Plans
          </Link>
        }
      />
      <KnowledgeNav planId={plan.id} />
      {children}
    </>
  );
}
