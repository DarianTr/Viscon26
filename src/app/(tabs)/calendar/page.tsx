import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar-view";
import { PageHeader } from "@/components/ui/primitives";
import { getCalendarEvents, getCurrentUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await getCurrentUser();
  const events = await getCalendarEvents(user.id);
  // ?date=YYYY-MM-DD opens that day, e.g. from "Continue plan".
  const { date } = await searchParams;
  const initialDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  return (
    <>
      <PageHeader eyebrow="Schedule" title="Calendar" />
      <CalendarView events={events} initialDate={initialDate} />
    </>
  );
}
