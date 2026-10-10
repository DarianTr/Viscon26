import { ProfileBubble, SideNav, TabBar } from "@/components/tab-bar";
import { DarkModeToggle } from "@/components/theme-toggle";
import { getActivePlan, getCurrentUser } from "@/lib/queries";

export default async function TabsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const active = await getActivePlan(user.id);
  const plan = active && {
    title: active.plan.title,
    week: active.currentWeek,
    weeks: active.plan.weeks,
    phase: currentPhase(active.plan.phases, active.currentWeek),
  };

  return (
    <div className="flex min-h-dvh">
      <SideNav plan={plan} />
      <main className="pb-tabbar mx-auto w-full max-w-3xl px-4 sm:px-6 md:pb-12">
        {children}
      </main>
      <TabBar />
      <ProfileBubble />
      <DarkModeToggle />
    </div>
  );
}

function currentPhase(phases: { name: string; weeks: number }[], week: number) {
  let end = 0;
  return phases.find((p) => week <= (end += p.weeks))?.name ?? null;
}
