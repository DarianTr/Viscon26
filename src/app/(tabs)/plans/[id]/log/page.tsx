import { redirect } from "next/navigation";

// Logging data points moved to Today; old links open it there for this plan.
export default async function LogPage({ params }: PageProps<"/plans/[id]/log">) {
  redirect(`/?log=${(await params).id}#log-data`);
}
