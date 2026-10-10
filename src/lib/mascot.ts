import type { BrainStage } from "@/components/mascot/brain";

/**
 * Purely decorative: which illustration to show for a given all-time hour
 * total. This never feeds back into the data model — it's a picture choice,
 * not a game mechanic.
 */
export function mascotStageFromHours(hours: number): BrainStage {
  if (hours >= 200) return 5;
  if (hours >= 125) return 4;
  if (hours >= 75) return 3;
  if (hours >= 30) return 2;
  return 1;
}

// --- Status decay ------------------------------------------------------------
//
// Unlike `mascotStageFromHours` above, this *is* a game mechanic: a day-by-day
// health score that falls when the student neglects their plan (or has none
// and isn't studying), recovers when they show up, and is left untouched by
// vacation or rest days. It's always recomputed from recent sessions — see
// `getMascotHealth` in lib/queries.ts — never stored.

export const MASCOT_HEALTH_MAX = 100;

/**
 * One local day's standing, oldest-first when fed to `decayMascotHealth`.
 * "vacation" (a logged vacation range) and "rest" (a plan with nothing
 * scheduled that day) both freeze the score — neither is a lapse. "missed"
 * (the plan scheduled study and none happened) and "idle" (no plan, and
 * nothing studied either) are the two ways a day counts against it.
 */
export type DayOutcome = "vacation" | "rest" | "good" | "missed" | "idle";

const HEALTH_DELTA: Record<DayOutcome, number> = {
  vacation: 0,
  rest: 0,
  good: 6,
  missed: -9,
  idle: -9,
};

/** Classifies one local day from its scheduled/completed study blocks. */
export function classifyDay(input: {
  vacation: boolean;
  /** Whether the student had a plan as of this day (even with nothing scheduled on it). */
  hasPlan: boolean;
  scheduledStudyBlocks: number;
  completedStudyBlocks: number;
}): DayOutcome {
  if (input.vacation) return "vacation";
  if (input.completedStudyBlocks > 0) return "good";
  if (input.scheduledStudyBlocks > 0) return "missed";
  return input.hasPlan ? "rest" : "idle";
}

/**
 * Walks day outcomes oldest → newest into a single 0–100 health score.
 * Vacation and rest days are frozen, so logging a vacation preserves
 * whatever standing the mascot already had despite the gap in studying.
 * Decay outpaces recovery, so a run of neglect shows within days while
 * climbing back out takes real consistency.
 */
export function decayMascotHealth(days: DayOutcome[], startingHealth = MASCOT_HEALTH_MAX): number {
  let health = startingHealth;
  for (const day of days) {
    health = Math.min(MASCOT_HEALTH_MAX, Math.max(0, health + HEALTH_DELTA[day]));
  }
  return health;
}

export type MascotStatus = "thriving" | "steady" | "slipping" | "neglected";

export function mascotStatusFromHealth(health: number): MascotStatus {
  if (health >= 75) return "thriving";
  if (health >= 45) return "steady";
  if (health >= 20) return "slipping";
  return "neglected";
}

export const MASCOT_STATUS_LABEL: Record<MascotStatus, string> = {
  thriving: "Thriving",
  steady: "Steady",
  slipping: "Slipping",
  neglected: "Neglected",
};

export const MASCOT_STATUS_LINE: Record<MascotStatus, string> = {
  thriving: "Right on track — the brain is glowing.",
  steady: "Keeping pace. Don't let it slide.",
  slipping: "A few days off plan. One good session turns this around.",
  neglected: "It's been a while. Time to check in on the plan.",
};

/** Every local day ("YYYY-MM-DD"), inclusive, covered by any of these ranges. */
export function vacationDaySet(ranges: { start: string; end: string }[]): Set<string> {
  const set = new Set<string>();
  for (const { start, end } of ranges) {
    if (!start || !end) continue;
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (cursor <= last) {
      set.add(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return set;
}

/** A warm, honest line for empty states — never a fabricated achievement. */
export const emptyStateLines = {
  noSessionsToday: "Nothing on the books today. The brain approves of rest.",
  noPlan: "No plan yet — the brain works best with a little structure. Make one below.",
  noPosts: "Finish a session and it'll show up here, proof and all.",
  noFriends: "Quiet in here — search for classmates above and say hello.",
  noFriendResults: "No one matches that search. Try a different spelling?",
  restDay: "Rest day. Even a growing brain needs the couch sometimes.",
};
