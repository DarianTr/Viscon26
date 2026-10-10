import { TIME_ZONE } from "@/db";
import { findFeedOwner, publicOrigin } from "@/lib/calendar-feed";
import { calendarFeed } from "@/lib/ical";
import { getCalendarEvents } from "@/lib/queries";

/**
 * GET /api/calendar/[token].ics — the user's calendar as a read-only iCalendar
 * feed for Apple Calendar, Google Calendar, Outlook, …
 *
 * No session: calendar clients can't log in, so the secret token in the URL
 * is the credential. Unknown tokens get a bare 404.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const user = await findFeedOwner((await ctx.params).token);
  if (!user) return new Response("Not found", { status: 404 });

  const events = await getCalendarEvents(user.id);
  const body = calendarFeed(events, {
    name: `Braina — ${user.name}`,
    appUrl: publicOrigin(request.headers),
    timeZone: TIME_ZONE,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="braina.ics"',
      // Always fresh: the schedule changes whenever the user moves a block.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
