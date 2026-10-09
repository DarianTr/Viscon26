import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar-view";
import { PageHeader } from "@/components/ui/primitives";
import { getCalendarEvents, getCurrentUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const user = await getCurrentUser();
  const events = await getCalendarEvents(user.id);

  return (
    <>
      <PageHeader eyebrow="Schedule" title="Calendar" />
      <CalendarView events={events} />
    </>
  );
}
