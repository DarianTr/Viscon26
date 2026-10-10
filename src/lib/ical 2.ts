import { eventLabel, formatMinutes, phaseLabels } from "./session-types";
import type { CalendarEvent } from "./types";
import { localDateKey } from "./weekly-goal";

/*
 * The calendar as an iCalendar (RFC 5545) feed that Apple Calendar, Google
 * Calendar, Outlook, … can subscribe to. Subscriptions are read-only in those
 * clients; the schedule is only edited in the app.
 */

type FeedOptions = {
  name: string;
  /** Origin the app runs at, e.g. "https://braina.example", for links back. */
  appUrl: string;
  /** Zone the app's calendar uses for days, so links open the right one. */
  timeZone: string;
  now?: Date;
};

/** "20261012T080000Z" — UTC, so clients show it in their own time zone. */
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** TEXT values escape backslashes, semicolons, commas and newlines. */
const escapeText = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line after a space. */
function fold(line: string) {
  const bytes = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = bytes.encode(ch).length;
    // Continuation lines start with a space, which counts toward their 75.
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The app's calendar, opened on the event's day. */
const dayLink = (e: CalendarEvent, { appUrl, timeZone }: FeedOptions) =>
  `${appUrl}/calendar?date=${localDateKey(new Date(e.start), timeZone)}`;

/** What the app's day view shows under the title, as plain text. */
function describe(e: CalendarEvent, options: FeedOptions) {
  const lines = [e.prepPhase ? `${eventLabel(e)} · ${phaseLabels[e.prepPhase]} phase` : eventLabel(e)];
  if (e.cheatsheetMinutes) {
    const theory = e.cheatsheetMinutes < e.minutes ? `${formatMinutes(e.minutes - e.cheatsheetMinutes)} theory · ` : "";
    const aim = e.cheatsheetTarget !== null ? ` · aim: ${e.cheatsheetTarget}%` : "";
    lines.push(`${theory}${formatMinutes(e.cheatsheetMinutes)} cheatsheet${aim}`);
  }
  lines.push("", `Change this block in Braina: ${dayLink(e, options)}`);
  return lines.join("\n");
}

export function calendarFeed(events: CalendarEvent[], options: FeedOptions) {
  const stamp = icsDate((options.now ?? new Date()).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Braina//Study calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name)}`,
    // Hints for how often clients re-fetch; most honour one or the other.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@braina`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(describe(e, options))}`,
      `CATEGORIES:${escapeText(eventLabel(e))}`,
      `URL:${dayLink(e, options)}`,
      // Breaks shouldn't make the user look busy to others.
      `TRANSP:${e.type === "break" ? "TRANSPARENT" : "OPAQUE"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
