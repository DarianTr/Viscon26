import Image from "next/image";
import { STAGE_LABEL, type BrainStage } from "./brain";

/**
 * The official illustrated Braina assets for each evolution stage
 * (public/mascots/evolutions/evolution1.png … evolution5.png), 1254×1254
 * transparent PNGs. Kept separate from the hand-drawn SVG `Brain` component —
 * this one renders the real artwork wherever it's been approved for use.
 */
const EVOLUTION_SRC: Record<BrainStage, string> = {
  1: "/mascots/evolutions/evolution1.png",
  2: "/mascots/evolutions/evolution2.png",
  3: "/mascots/evolutions/evolution3.png",
  4: "/mascots/evolutions/evolution4.png",
  5: "/mascots/evolutions/evolution5.png",
};

export function EvolutionMascot({
  stage,
  size = 96,
  priority = false,
  className = "",
}: {
  stage: BrainStage;
  /** Rendered size in px — the asset is square, so this sets both width and height. */
  size?: number;
  /** Only set for an image that's visible immediately on page load. */
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={EVOLUTION_SRC[stage]}
      alt={`Braina — ${STAGE_LABEL[stage]}`}
      width={size}
      height={size}
      priority={priority}
      className={className}
    />
  );
}
