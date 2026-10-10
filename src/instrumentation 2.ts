/** Runs once when a server starts: kicks off the daily study nudges (see `src/lib/nudges.ts`). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.VAPID_PRIVATE_KEY || process.env.NUDGES === "off") return;
  const { startNudgeScheduler } = await import("./lib/nudges");
  startNudgeScheduler();
}
