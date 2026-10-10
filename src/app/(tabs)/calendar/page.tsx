import type { Metadata } from "next";
import Link from "next/link";
import { CalendarView } from "@/components/calendar-view";
import { PageHeader } from "@/components/ui/primitives";
import { getCalendarEvents, getCurrentUser, getSubjectChoices } from "@/lib/queries";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await getCurrentUser();
  const [events, subjects] = await Promise.all([getCalendarEvents(user.id), getSubjectChoices(user.id)]);
  // ?date=YYYY-MM-DD opens that day, e.g. from "Continue plan".
  const { date } = await searchParams;
  const initialDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        action={
          <Link href="/profile/settings#calendar-feed" className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium">
            Subscribe
          </Link>
        }
      />
      <CalendarView
        events={events}
        subjects={subjects}
        initialDate={initialDate}
        defaultShared={user.shareSessionsByDefault}
      />
    </>
  );
}
