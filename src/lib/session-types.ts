import type { SessionType } from "./types";

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
  const canonical = subject === "Physics" ? "EProg" : subject === "Analysis II" ? "DiskMath" : subject;
  const known = namedSubjectColors[canonical as keyof typeof namedSubjectColors];
  if (known) return known;

  let hash = 0;
  for (const character of canonical) hash = (hash * 31 + character.charCodeAt(0)) | 0;
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
