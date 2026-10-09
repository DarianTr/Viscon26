import { TodayBoard } from "@/components/today/today-board";
import { PageHeader } from "@/components/ui/primitives";
import { profile } from "@/lib/study-data";
import { connection } from "next/server";

export default async function TodayPage() {
  // The greeting depends on the current time, so render per request.
  await connection();
  // Rendered on the server, so pin the time zone to the users' (Zurich).
  const now = new Date();
  const timeZone = "Europe/Zurich";
  const hour = Number(now.toLocaleString("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });

  return (
    <>
      <PageHeader eyebrow={date} title={`${greeting}, ${profile.name.split(" ")[0]}`} />
      <TodayBoard streak={profile.streak} />
    </>
  );
}
