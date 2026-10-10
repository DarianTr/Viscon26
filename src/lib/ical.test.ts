import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarFeed } from "./ical";
import type { CalendarEvent } from "./types";

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "0b6c1a52-8f4e-4a43-9a4e-2f1b0c8d9e01",
  type: "deep",
  activity: "study",
  subject: "Linear Algebra",
  cheatsheetMinutes: null,
  cheatsheetTarget: null,
  prepPhase: "build",
  title: "Linear Algebra — Build 3",
  start: "2026-10-12T07:00:00.000Z",
  end: "2026-10-12T08:30:00.000Z",
  minutes: 90,
  calendarOrder: null,
  ...over,
});

const options = {
  name: "Braina — Lena",
  appUrl: "https://braina.example",
  timeZone: "Europe/Zurich",
  now: new Date("2026-10-10T12:00:00Z"),
};

/** Undo line folding, then split into content lines. */
const contentLines = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("calendar feed", () => {
  it("writes one VEVENT per event, in UTC, with CRLF line endings", () => {
    const ics = calendarFeed([event(), event({ id: "other", start: "2026-10-12T09:00:00.000Z", end: "2026-10-12T10:00:00.000Z" })], options);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
    assert.doesNotMatch(ics.replace(/\r\n/g, ""), /\n/);
    const lines = contentLines(ics);
    assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 2);
    assert.ok(lines.includes("DTSTART:20261012T070000Z"));
    assert.ok(lines.includes("DTEND:20261012T083000Z"));
    assert.ok(lines.includes("UID:0b6c1a52-8f4e-4a43-9a4e-2f1b0c8d9e01@braina"));
    assert.ok(lines.includes("DTSTAMP:20261010T120000Z"));
    // A newer revision on every fetch, so clients pick up moved blocks.
    assert.ok(lines.includes("LAST-MODIFIED:20261010T120000Z"));
    assert.ok(lines.includes(`SEQUENCE:${Date.parse("2026-10-10T12:00:00Z") / 60_000}`));
  });

  it("labels events like the app and links back to their day there", () => {
    const lines = contentLines(calendarFeed([event({ cheatsheetMinutes: 30, cheatsheetTarget: 40 })], options));
    assert.ok(lines.includes("SUMMARY:Linear Algebra — Build 3"));
    assert.ok(lines.includes("CATEGORIES:Theory + Cheatsheet"));
    const description = lines.find((l) => l.startsWith("DESCRIPTION:"))!;
    assert.match(description, /Theory \+ Cheatsheet · Build phase\\n1 h theory · 30 min cheatsheet · aim: 40%/);
    assert.ok(lines.includes("URL:https://braina.example/calendar?date=2026-10-12"));
  });

  it("uses the app's day, not the UTC day, for links", () => {
    // 00:30 in Zurich on the 13th is still the 12th in UTC.
    const lines = contentLines(calendarFeed([event({ start: "2026-10-12T22:30:00.000Z", end: "2026-10-12T23:00:00.000Z" })], options));
    assert.ok(lines.includes("URL:https://braina.example/calendar?date=2026-10-13"));
  });

  it("escapes text and folds long lines at 75 octets", () => {
    const title = "Algorithms; Data Structures, and \\ more — ".repeat(4);
    const ics = calendarFeed([event({ title })], options);
    for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"))!;
    assert.equal(summary, `SUMMARY:${"Algorithms\\; Data Structures\\, and \\\\ more — ".repeat(4)}`);
  });

  it("keeps breaks from blocking time", () => {
    const lines = contentLines(calendarFeed([event({ type: "break", activity: "lunch", subject: null, prepPhase: null, title: "Lunch" })], options));
    assert.ok(lines.includes("TRANSP:TRANSPARENT"));
    assert.ok(lines.includes("CATEGORIES:Lunch"));
  });
});
