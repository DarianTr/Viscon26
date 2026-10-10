import { STAGE_LABEL, type BrainStage } from "@/components/mascot/brain";
import { LockBadge, Sparkle } from "@/components/mascot/doodles";
import { EvolutionMascot } from "@/components/mascot/evolution-mascot";
import { mascotStageFromHours } from "@/lib/mascot";

const STAGES: BrainStage[] = [1, 2, 3, 4, 5];

const STAGE_FLAVOR: Record<BrainStage, string> = {
  1: "Every big brain starts smooth. You're just getting warmed up.",
  2: "The first fold! Something is sticking.",
  3: "Visibly growing — the streaks are paying off.",
  4: "Big brain energy, unlocked fair and square.",
  5: "Peak form. Certified galaxy brain.",
};

/**
 * A purely decorative read-out of existing all-time hours, styled like a
 * collectible companion card — not a new progress system. `hours` is the
 * only input, already computed by the server; nothing here is stored.
 *
 * Uses the official illustrated mascot assets (public/mascots/evolutions/)
 * via `EvolutionMascot`, not the hand-drawn SVG `Brain`.
 */
export function BrainEvolution({ hours }: { hours: number }) {
  const current = mascotStageFromHours(hours);

  return (
    <div
      className="relative overflow-hidden rounded-[2rem] border-[2.5px] border-foreground p-6 text-center shadow-[0_5px_0_0_var(--foreground)]"
      style={{ background: "radial-gradient(ellipse at 50% 0%, var(--beige) 0%, var(--surface) 72%)" }}
    >
      <Sparkle size={14} className="mascot-sparkle absolute top-5 left-6" />
      <Sparkle size={10} color="var(--pink)" className="mascot-float absolute top-8 right-8" />

      <p className="font-display text-xs font-bold tracking-wide text-accent uppercase">Companion level</p>

      <div className="relative mx-auto mt-3 grid size-40 place-items-center">
        <div
          aria-hidden
          className="lamp-glow absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle, var(--gold-soft) 0%, transparent 72%)" }}
        />
        <div
          aria-hidden
          className="absolute inset-3 rounded-full border-2 border-dashed opacity-50"
          style={{ borderColor: "var(--accent)" }}
        />
        <div className="mascot-idle">
          <EvolutionMascot stage={current} size={152} />
        </div>
      </div>

      <h3 className="mt-3 font-display text-2xl font-extrabold">{STAGE_LABEL[current]}</h3>
      <p className="mx-auto mt-1 max-w-[32ch] text-sm text-muted">{STAGE_FLAVOR[current]}</p>
      <p className="mt-2 text-xs font-bold text-muted uppercase">{hours} hours logged all-time</p>

      <div className="relative mt-6 flex items-start justify-between gap-1 border-t-2 border-dashed border-border pt-6">
        {STAGES.map((s) => {
          const unlocked = s <= current;
          const isCurrent = s === current;
          return (
            <div key={s} className="relative flex flex-1 flex-col items-center gap-1.5">
              <div
                className={`relative grid size-14 place-items-center rounded-full border-2 transition-colors sm:size-16 ${
                  isCurrent
                    ? "border-accent bg-accent-soft"
                    : unlocked
                      ? "border-foreground bg-surface-2"
                      : "border-dashed border-border bg-surface"
                }`}
              >
                {unlocked ? (
                  <div className={isCurrent ? "mascot-idle" : ""}>
                    <EvolutionMascot stage={s} size={46} />
                  </div>
                ) : (
                  <LockBadge size={18} className="opacity-60" />
                )}
                {isCurrent && <Sparkle size={13} className="mascot-sparkle absolute -top-1.5 -right-1.5" />}
              </div>
              <span className={`text-[10px] font-bold ${isCurrent ? "text-accent" : "text-muted"}`}>
                {unlocked ? (isCurrent ? "Now" : `Stage ${s}`) : "Locked"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
