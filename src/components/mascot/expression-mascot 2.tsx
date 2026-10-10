import Image from "next/image";

/**
 * The official illustrated Braina assets for the moods that have matching
 * artwork (public/mascots/expressions/*.png — all 1254×1254 transparent
 * PNGs, plus evolution1 reused for "happy"). Expressions with no matching
 * asset (e.g. "confused") are NOT covered here — those call sites keep the
 * hand-drawn SVG `Brain` component instead of forcing the wrong face onto
 * the wrong moment.
 */
export type RealExpression = "happy" | "sleepy" | "focused" | "excited" | "proud" | "celebrating";

const EXPRESSION_SRC: Record<RealExpression, string> = {
  happy: "/mascots/evolutions/evolution1.png",
  sleepy: "/mascots/expressions/sleepy.png",
  focused: "/mascots/expressions/focused.png",
  excited: "/mascots/expressions/marveled.png",
  proud: "/mascots/expressions/strength.png",
  celebrating: "/mascots/expressions/strength.png",
};

const EXPRESSION_ALT: Record<RealExpression, string> = {
  happy: "Braina, happy",
  sleepy: "Braina, sleepy",
  focused: "Braina, focused and wearing headphones",
  excited: "Braina, excited and reading",
  proud: "Braina, flexing proudly",
  celebrating: "Braina, celebrating",
};

export function ExpressionMascot({
  expression,
  size = 96,
  priority = false,
  className = "",
}: {
  expression: RealExpression;
  /** Rendered size in px — the asset is square, so this sets both width and height. */
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={EXPRESSION_SRC[expression]}
      alt={EXPRESSION_ALT[expression]}
      width={size}
      height={size}
      priority={priority}
      className={className}
    />
  );
}
