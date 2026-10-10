import type { CSSProperties, ReactNode } from "react";

/**
 * Braina, the mascot: one silhouette, two layers of variation.
 *
 * `stage` is purely decorative — how many wrinkles show — and never drives
 * app logic. `expression` picks the face. Both are plain data lookups so
 * adding a new one later is a one-line addition, not a new illustration.
 */
export type BrainStage = 1 | 2 | 3 | 4 | 5;

export type BrainExpression =
  | "happy"
  | "sleepy"
  | "confused"
  | "focused"
  | "excited"
  | "proud"
  | "dramatic"
  | "celebrating"
  | "overcaffeinated"
  | "unhinged";

const INK = "#250A04";

export const STAGE_LABEL: Record<BrainStage, string> = {
  1: "Smooth Brain",
  2: "First Wrinkle",
  3: "Growing Brain",
  4: "Big Brain",
  5: "Galaxy Brain",
};

const BODY_PATH =
  "M80 26 C104 24 124 40 122 62 C138 68 140 92 124 104 C128 122 112 138 90 136 C86 140 74 140 70 136 C48 138 32 122 36 104 C20 92 22 68 38 62 C36 40 56 24 80 26 Z";

const WRINKLE_PATHS = [
  "M50 46 Q60 36 72 40",
  "M90 38 Q102 34 112 44",
  "M40 60 Q52 54 62 58",
  "M100 56 Q112 52 122 60",
  "M58 28 Q80 18 102 28",
  "M34 76 Q44 72 52 77",
  "M110 75 Q118 71 128 77",
];

const STAGE_WRINKLES: Record<BrainStage, number> = { 1: 0, 2: 1, 3: 3, 4: 5, 5: 7 };

type EyeShape = "dot" | "round" | "sleepy" | "swirl" | "star" | "wide" | "wink" | "asym" | "happyArc" | "wideShake";
type MouthShape = "smile" | "smirk" | "o" | "wavy" | "flat" | "grin" | "tongue" | "gasp" | "zigzag";
type BrowShape = "up" | "down" | "furrow" | "oneUp";
type Accessory = "zzz" | "sweat" | "sparkle" | "coffee" | "question" | "exclaim";
type ArmPose = "idle" | "up" | "hips" | "point" | "forehead" | "oneUp";

type ExpressionSpec = {
  eyes: EyeShape;
  mouth: MouthShape;
  brows?: BrowShape;
  accessory?: Accessory;
  arms?: ArmPose;
};

const EXPRESSIONS: Record<BrainExpression, ExpressionSpec> = {
  happy: { eyes: "round", mouth: "smile", brows: "up", arms: "idle" },
  sleepy: { eyes: "sleepy", mouth: "flat", accessory: "zzz", arms: "idle" },
  confused: { eyes: "asym", mouth: "wavy", brows: "oneUp", accessory: "question", arms: "idle" },
  focused: { eyes: "dot", mouth: "flat", brows: "down", arms: "idle" },
  excited: { eyes: "star", mouth: "grin", brows: "up", accessory: "sparkle", arms: "up" },
  proud: { eyes: "happyArc", mouth: "smirk", brows: "up", arms: "hips" },
  dramatic: { eyes: "wide", mouth: "gasp", brows: "up", accessory: "exclaim", arms: "forehead" },
  celebrating: { eyes: "happyArc", mouth: "grin", brows: "up", accessory: "sparkle", arms: "up" },
  overcaffeinated: { eyes: "wideShake", mouth: "zigzag", brows: "oneUp", accessory: "coffee", arms: "oneUp" },
  unhinged: { eyes: "swirl", mouth: "tongue", brows: "furrow", arms: "point" },
};

const ARM_TRANSFORMS: Record<ArmPose, { left: string; right: string }> = {
  idle: { left: "rotate(10 40 95)", right: "rotate(-10 120 95)" },
  up: { left: "rotate(-75 40 95)", right: "rotate(75 120 95)" },
  hips: { left: "rotate(48 40 95) translate(3 -5)", right: "rotate(-48 120 95) translate(-3 -5)" },
  oneUp: { left: "rotate(-85 40 95)", right: "rotate(-10 120 95)" },
  point: { left: "rotate(12 40 95)", right: "rotate(-65 120 95)" },
  forehead: { left: "rotate(-135 40 95)", right: "rotate(-10 120 95)" },
};

const EYES: Record<EyeShape, ReactNode> = {
  dot: (
    <>
      <circle cx={60} cy={80} r={4} fill={INK} />
      <circle cx={100} cy={80} r={4} fill={INK} />
    </>
  ),
  round: (
    <>
      <circle cx={60} cy={80} r={7} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={61.5} cy={79} r={2.4} fill={INK} />
      <circle cx={100} cy={80} r={7} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={101.5} cy={79} r={2.4} fill={INK} />
    </>
  ),
  sleepy: (
    <>
      <path d="M53 80 q7 6 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <path d="M93 80 q7 6 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
    </>
  ),
  swirl: (
    <>
      <path d="M55 76a5 5 0 1 1 7 6a3 3 0 1 0 3 3" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <path d="M95 76a5 5 0 1 1 7 6a3 3 0 1 0 3 3" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </>
  ),
  star: (
    <>
      <Star x={60} y={80} s={7} fill="#fff" />
      <Star x={100} y={80} s={7} fill="#fff" />
    </>
  ),
  wide: (
    <>
      <circle cx={60} cy={80} r={9} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={60} cy={80} r={3.2} fill={INK} />
      <circle cx={100} cy={80} r={9} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={100} cy={80} r={3.2} fill={INK} />
    </>
  ),
  wink: (
    <>
      <path d="M53 80 q7 6 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <circle cx={100} cy={80} r={6} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={100} cy={80} r={2.2} fill={INK} />
    </>
  ),
  asym: (
    <>
      <circle cx={60} cy={80} r={6} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={60} cy={80} r={2.2} fill={INK} />
      <path d="M94 81 q6 5 12 0" stroke={INK} strokeWidth={3.2} fill="none" strokeLinecap="round" />
    </>
  ),
  happyArc: (
    <>
      <path d="M53 83 q7 -10 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <path d="M93 83 q7 -10 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
    </>
  ),
  wideShake: (
    <>
      <circle cx={60} cy={80} r={8} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={59} cy={78} r={3} fill={INK} />
      <circle cx={100} cy={80} r={8} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={102} cy={81} r={3} fill={INK} />
    </>
  ),
};

const MOUTHS: Record<MouthShape, ReactNode> = {
  smile: <path d="M68 100 q12 14 24 0" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />,
  smirk: <path d="M70 102 q10 8 22 -2" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />,
  o: <ellipse cx={80} cy={102} rx={6} ry={8} fill={INK} />,
  wavy: <path d="M68 100 q6 6 12 0 t12 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />,
  flat: <line x1={71} y1={100} x2={89} y2={100} stroke={INK} strokeWidth={4} strokeLinecap="round" />,
  grin: <path d="M67 98 q13 18 26 0 Z" fill={INK} />,
  tongue: (
    <>
      <path d="M68 98 q12 16 24 0 Z" fill={INK} />
      <path d="M75 106 q5 8 10 0 Z" fill="var(--pink-deep)" />
    </>
  ),
  gasp: <ellipse cx={80} cy={103} rx={7} ry={9} fill={INK} />,
  zigzag: (
    <path
      d="M68 100 l6 6 l6 -6 l6 6 l6 -6"
      stroke={INK}
      strokeWidth={3.4}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

const BROWS: Record<BrowShape, ReactNode> = {
  up: (
    <>
      <path d="M52 70 q8 -6 16 -2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M92 70 q8 -6 16 -2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
  down: (
    <>
      <path d="M52 66 q8 6 16 2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M92 66 q8 6 16 2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
  furrow: (
    <>
      <path d="M54 72 l14 -4" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d="M92 68 l14 4" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  oneUp: (
    <>
      <path d="M52 64 q8 -8 16 -2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M92 70 q8 2 16 2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
};

const ACCESSORIES: Record<Accessory, ReactNode> = {
  zzz: (
    <g fontFamily="var(--font-display)" fontWeight={700} fill={INK} opacity={0.8}>
      <text x={110} y={46}>z</text>
      <text x={119} y={36} fontSize={13}>
        z
      </text>
      <text x={130} y={24} fontSize={16}>
        z
      </text>
    </g>
  ),
  sweat: <path d="M116 44 q7 10 0 17 q-7 -7 0 -17 Z" fill="#9AD8EA" stroke={INK} strokeWidth={2} />,
  sparkle: (
    <g className="mascot-sparkle">
      <Star x={28} y={32} s={7} fill="var(--gold)" />
      <Star x={130} y={28} s={5} fill="var(--gold)" />
      <Star x={120} y={52} s={4} fill="var(--gold)" />
    </g>
  ),
  coffee: (
    <g transform="translate(104 102)">
      <path d="M0 0 h18 v12 a9 9 0 0 1 -9 9 a9 9 0 0 1 -9 -9 Z" fill="#fff" stroke={INK} strokeWidth={2.4} />
      <path d="M18 3 q8 0 8 6 t-8 6" fill="none" stroke={INK} strokeWidth={2.4} />
      <path d="M4 -6 q2 -4 0 -8 M10 -6 q2 -4 0 -8" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
    </g>
  ),
  question: (
    <text x={110} y={42} fontFamily="var(--font-display)" fontWeight={800} fontSize={20} fill={INK}>
      ?
    </text>
  ),
  exclaim: (
    <text x={114} y={42} fontFamily="var(--font-display)" fontWeight={800} fontSize={20} fill="var(--accent)">
      !
    </text>
  ),
};

function Star({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  const p = [
    [0, -s],
    [s * 0.3, -s * 0.3],
    [s, 0],
    [s * 0.3, s * 0.3],
    [0, s],
    [-s * 0.3, s * 0.3],
    [-s, 0],
    [-s * 0.3, -s * 0.3],
  ]
    .map(([px, py]) => `${px} ${py}`)
    .join(" L");
  return <path transform={`translate(${x} ${y})`} d={`M${p} Z`} fill={fill} stroke={INK} strokeWidth={1.1} />;
}

function GalaxyHalo() {
  return (
    <g className="mascot-sparkle" opacity={0.9}>
      <Star x={24} y={44} s={5} fill="var(--gold)" />
      <Star x={136} y={40} s={6} fill="var(--gold)" />
      <Star x={80} y={10} s={5} fill="var(--gold)" />
      <Star x={44} y={16} s={4} fill="var(--gold)" />
      <Star x={116} y={14} s={4} fill="var(--gold)" />
    </g>
  );
}

export function Brain({
  stage = 1,
  expression = "happy",
  size = 96,
  idle = true,
  className = "",
  style,
}: {
  stage?: BrainStage;
  expression?: BrainExpression;
  size?: number;
  /** Gentle idle bob; switch off where motion would distract (e.g. the focus timer). */
  idle?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const spec = EXPRESSIONS[expression];
  const arms = ARM_TRANSFORMS[spec.arms ?? "idle"];
  const wrinkleCount = STAGE_WRINKLES[stage];

  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      role="img"
      aria-label={`Braina the brain — ${STAGE_LABEL[stage]}, feeling ${expression}`}
      className={`${idle ? "mascot-idle" : ""} ${className}`}
      style={style}
    >
      <rect x={60} y={128} width={14} height={22} rx={7} fill="var(--pink)" stroke={INK} strokeWidth={3} />
      <rect x={86} y={128} width={14} height={22} rx={7} fill="var(--pink)" stroke={INK} strokeWidth={3} />

      <g transform={arms.left}>
        <rect x={16} y={88} width={32} height={15} rx={7.5} fill="var(--pink)" stroke={INK} strokeWidth={3} />
      </g>
      <g transform={arms.right}>
        <rect x={112} y={88} width={32} height={15} rx={7.5} fill="var(--pink)" stroke={INK} strokeWidth={3} />
      </g>

      <path d={BODY_PATH} fill="var(--pink)" stroke={INK} strokeWidth={4} strokeLinejoin="round" />

      <ellipse cx={53} cy={97} rx={6} ry={4} fill="var(--pink-deep)" opacity={0.55} />
      <ellipse cx={107} cy={97} rx={6} ry={4} fill="var(--pink-deep)" opacity={0.55} />

      {WRINKLE_PATHS.slice(0, wrinkleCount).map((d, i) => (
        <path key={i} d={d} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" opacity={0.85} />
      ))}

      {spec.brows && BROWS[spec.brows]}
      {EYES[spec.eyes]}
      {MOUTHS[spec.mouth]}
      {spec.accessory && ACCESSORIES[spec.accessory]}
      {stage === 5 && <GalaxyHalo />}
    </svg>
  );
}
