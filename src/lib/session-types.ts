import type { CalendarEvent, EventType, SessionType } from "./types";

/** Display config for each session type. Safe to import from client code. */
export const sessionTypes: Record<
  SessionType,
  { label: string; blurb: string; color: string; soft: string }
> = {
  deep: {
    label: "Deep Focus",
    blurb: "One long, uninterrupted block — your long run.",
    color: "bg-deep",
    soft: "bg-deep/12 text-deep",
  },
  intervals: {
    label: "Intervals",
    blurb: "Pomodoro reps: 25 min on, 5 min off.",
    color: "bg-intervals",
    soft: "bg-intervals/12 text-intervals",
  },
  tempo: {
    label: "Tempo",
    blurb: "Timed past-paper problems at exam pace.",
    color: "bg-tempo",
    soft: "bg-tempo/12 text-tempo",
  },
  recovery: {
    label: "Recovery",
    blurb: "Light review — flashcards, skim notes.",
    color: "bg-recovery",
    soft: "bg-recovery/12 text-recovery",
  },
};

const eventTypeLabels: Record<EventType, string> = {
  deep: sessionTypes.deep.label,
  intervals: sessionTypes.intervals.label,
  tempo: sessionTypes.tempo.label,
  recovery: sessionTypes.recovery.label,
  exam: "Exam",
  lecture: "Lecture",
  buffer: "Buffer / Catch-up Time",
  break: "Break",
};

/** Activities that need a more specific label than their session type. */
const activityLabels: Partial<Record<NonNullable<CalendarEvent["activity"]>, string>> = {
  mock_exam: "Mock exam",
  mock_review: "Mock exam review",
  cheatsheet: "Cheatsheet",
  exam_eve: "Exam Eve — Final Review",
  short_break: "Break",
  lunch: "Lunch",
  dinner: "Dinner",
  quiz: "Practice Quiz",
};

/** The kind of block a calendar event is, as the calendar badges it. */
export const eventLabel = (e: Pick<CalendarEvent, "type" | "activity" | "cheatsheetMinutes">) =>
  (e.activity === "study" && e.cheatsheetMinutes ? "Theory + Cheatsheet" : undefined)
  ?? (e.activity && activityLabels[e.activity])
  ?? eventTypeLabels[e.type];

export const phaseLabels = { foundation: "Foundation", build: "Build", peak: "Peak", taper: "Taper" } as const;

const subjectPalette = [
  { text: "text-deep", value: "var(--deep)" },
  { text: "text-intervals", value: "var(--intervals)" },
  { text: "text-tempo", value: "var(--tempo)" },
  { text: "text-recovery", value: "var(--recovery)" },
];

const namedSubjectColors = {
  DiskMath: subjectPalette[0],
  "Linear Algebra": subjectPalette[1],
  EProg: subjectPalette[2],
  Algorithms: subjectPalette[3],
};

/** Stable colors for a subject name across profile, schedule, and feed views. */
export function subjectColor(subject: string) {
  const known = namedSubjectColors[subject as keyof typeof namedSubjectColors];
  if (known) return known;

  let hash = 0;
  for (const character of subject) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return subjectPalette[((hash % subjectPalette.length) + subjectPalette.length) % subjectPalette.length];
}

export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type Effort = { minutes: number; focus: number | null };

/** Whether `attempt` beat a challenge's `target`: focus decides when both were tracked, else time. */
export function beatChallenge(attempt: Effort, target: Effort) {
  return attempt.focus !== null && target.focus !== null
    ? attempt.focus >= target.focus
    : attempt.minutes >= target.minutes;
}

/** "90 min at 82% focus", or just the time when focus wasn't tracked. */
export function formatEffort({ minutes, focus }: Effort) {
  return focus === null ? formatMinutes(minutes) : `${formatMinutes(minutes)} at ${focus}% focus`;
}
