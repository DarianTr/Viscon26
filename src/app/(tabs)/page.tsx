import { LogDataSection } from "@/components/today/log-data-section";
import { TodayBoard } from "@/components/today/today-board";
import { TIME_ZONE } from "@/db";
import { getCurrentUser, getStreak, getSubjectChoices, getTodaysTasks } from "@/lib/queries";

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const user = await getCurrentUser();
  const { log } = await searchParams;
  const [tasks, streak, subjects] = await Promise.all([
    getTodaysTasks(user.id),
    getStreak(user.id),
    getSubjectChoices(user.id),
  ]);

  // Rendered on the server, so pin the time zone to the users' (Zurich).
  const now = new Date();
  const timeZone = TIME_ZONE;
  const hour = Number(now.toLocaleString("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });

  return (
    <>
      <TodayBoard
        initialTasks={tasks}
        subjects={subjects}
        streak={streak}
        greeting={greeting}
        date={date}
        firstName={user.name.split(" ")[0]}
      />
      <LogDataSection userId={user.id} open={typeof log === "string" ? log : undefined} />
    </>
  );
}
