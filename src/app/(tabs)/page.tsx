import { TodayBoard } from "@/components/today/today-board";
import { PageHeader } from "@/components/ui/primitives";
import { TIME_ZONE } from "@/db";
import { getCurrentUser, getStreak, getTodaysTasks } from "@/lib/queries";

export default async function TodayPage() {
  const user = await getCurrentUser();
  const [tasks, streak] = await Promise.all([getTodaysTasks(user.id), getStreak(user.id)]);

  // Rendered on the server, so pin the time zone to the users' (Zurich).
  const now = new Date();
  const timeZone = TIME_ZONE;
  const hour = Number(now.toLocaleString("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });

  return (
    <>
      <PageHeader eyebrow={date} title={`${greeting}, ${user.name.split(" ")[0]}`} />
      <TodayBoard initialTasks={tasks} streak={streak} />
    </>
  );
}
