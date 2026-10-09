import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader eyebrow="Schedule" title="Calendar" />
      <CalendarView />
    </>
  );
}
