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

/** Bar colours for the profile's subject breakdown, by rank. */
export const subjectColors = ["bg-deep", "bg-intervals", "bg-tempo", "bg-recovery"];

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
