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

/** A warm, honest line for empty states — never a fabricated achievement. */
export const emptyStateLines = {
  noSessionsToday: "Nothing on the books today. The brain approves of rest.",
  noPlan: "No plan yet — the brain works best with a little structure. Make one below.",
  noPosts: "Finish a session and it'll show up here, proof and all.",
  noFriends: "Quiet in here — search for classmates above and say hello.",
  noFriendResults: "No one matches that search. Try a different spelling?",
  restDay: "Rest day. Even a growing brain needs the couch sometimes.",
};
