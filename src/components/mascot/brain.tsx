import { useId, type CSSProperties, type ReactNode } from "react";

/**
 * Braina, the mascot: one squishy silhouette, two layers of variation.
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
  | "victorious"
  | "overcaffeinated"
  | "unhinged";

const INK = "#250A04";
const PINK_DEEP = "var(--pink-deep)";

export const STAGE_LABEL: Record<BrainStage, string> = {
  1: "Smooth Brain",
  2: "First Wrinkle",
  3: "Growing Brain",
  4: "Big Brain",
  5: "Galaxy Brain",
};

/** A rounder, squishier gumdrop silhouette — twin lobes melting into a soft belly. */
const BODY_PATH =
  "M80 22 C57 22 40 33 37 52 C20 57 13 76 22 93 C15 108 23 127 42 134 C54 141 68 144 80 144 C92 144 106 141 118 134 C137 127 145 108 138 93 C147 76 140 57 123 52 C120 33 103 22 80 22 Z";

const WRINKLE_PATHS = [
  "M50 44 Q60 34 73 38",
  "M88 36 Q101 32 112 42",
  "M40 58 Q52 52 63 56",
  "M98 54 Q111 50 122 58",
  "M58 26 Q80 16 102 26",
  "M33 74 Q44 70 53 75",
  "M108 73 Q117 69 128 75",
];

const STAGE_WRINKLES: Record<BrainStage, number> = { 1: 0, 2: 1, 3: 3, 4: 5, 5: 7 };

type EyeShape = "dot" | "round" | "sleepy" | "swirl" | "star" | "wide" | "wink" | "asym" | "happyArc" | "wideShake";
type MouthShape = "smile" | "smirk" | "o" | "wavy" | "flat" | "grin" | "tongue" | "gasp" | "zigzag";
type BrowShape = "up" | "down" | "furrow" | "oneUp";
type Accessory = "zzz" | "sweat" | "sparkle" | "coffee" | "question" | "exclaim" | "headphones" | "burst";
type ArmPose = "idle" | "up" | "victory" | "hips" | "point" | "forehead" | "oneUp";

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
  focused: { eyes: "dot", mouth: "flat", brows: "down", accessory: "headphones", arms: "idle" },
  excited: { eyes: "star", mouth: "grin", brows: "up", accessory: "sparkle", arms: "up" },
  proud: { eyes: "happyArc", mouth: "smirk", brows: "up", arms: "hips" },
  dramatic: { eyes: "wide", mouth: "gasp", brows: "up", accessory: "exclaim", arms: "forehead" },
  celebrating: { eyes: "happyArc", mouth: "grin", brows: "up", accessory: "sparkle", arms: "up" },
  victorious: { eyes: "happyArc", mouth: "grin", brows: "up", accessory: "burst", arms: "victory" },
  overcaffeinated: { eyes: "wideShake", mouth: "zigzag", brows: "oneUp", accessory: "coffee", arms: "oneUp" },
  unhinged: { eyes: "swirl", mouth: "tongue", brows: "furrow", arms: "point" },
};

const ARM_TRANSFORMS: Record<ArmPose, { left: string; right: string }> = {
  idle: { left: "rotate(10 38 96)", right: "rotate(-10 122 96)" },
  up: { left: "rotate(-75 38 96)", right: "rotate(75 122 96)" },
  victory: { left: "rotate(-98 38 96) translate(2 -6)", right: "rotate(98 122 96) translate(-2 -6)" },
  hips: { left: "rotate(48 38 96) translate(3 -5)", right: "rotate(-48 122 96) translate(-3 -5)" },
  oneUp: { left: "rotate(-88 38 96)", right: "rotate(-10 122 96)" },
  point: { left: "rotate(12 38 96)", right: "rotate(-65 122 96)" },
  forehead: { left: "rotate(-135 38 96)", right: "rotate(-10 122 96)" },
};

/** Big, glossy sclera + pupil + sparkle highlight — the main charm driver. */
function GlossyEye({ cx, cy, r = 9.5 }: { cx: number; cy: number; r?: number }) {
  const dir = cx < 80 ? 1 : -1;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke={INK} strokeWidth={3} />
      <circle cx={cx + dir * 1.8} cy={cy + 1.6} r={r * 0.56} fill={INK} />
      <circle cx={cx + dir * 0.4} cy={cy - 2.4} r={r * 0.2} fill="#fff" />
    </>
  );
}

const EYES: Record<EyeShape, ReactNode> = {
  dot: (
    <>
      <circle cx={58} cy={80} r={4.4} fill={INK} />
      <circle cx={102} cy={80} r={4.4} fill={INK} />
    </>
  ),
  round: (
    <>
      <GlossyEye cx={58} cy={78} />
      <GlossyEye cx={102} cy={78} />
    </>
  ),
  sleepy: (
    <>
      <path d="M51 80 q7 6 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <path d="M95 80 q7 6 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
    </>
  ),
  swirl: (
    <>
      <path d="M53 76a5 5 0 1 1 7 6a3 3 0 1 0 3 3" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <path d="M97 76a5 5 0 1 1 7 6a3 3 0 1 0 3 3" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </>
  ),
  star: (
    <>
      <MiniStar x={58} y={78} s={8} fill="#fff" />
      <MiniStar x={102} y={78} s={8} fill="#fff" />
    </>
  ),
  wide: (
    <>
      <GlossyEye cx={58} cy={78} r={10.5} />
      <GlossyEye cx={102} cy={78} r={10.5} />
    </>
  ),
  wink: (
    <>
      <path d="M51 80 q7 6 14 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
      <GlossyEye cx={102} cy={78} />
    </>
  ),
  asym: (
    <>
      <GlossyEye cx={58} cy={78} r={8} />
      <path d="M92 81 q6 5 12 0" stroke={INK} strokeWidth={3.2} fill="none" strokeLinecap="round" />
    </>
  ),
  happyArc: (
    <>
      <path d="M51 83 q7 -11 14 0" stroke={INK} strokeWidth={3.6} fill="none" strokeLinecap="round" />
      <path d="M95 83 q7 -11 14 0" stroke={INK} strokeWidth={3.6} fill="none" strokeLinecap="round" />
    </>
  ),
  wideShake: (
    <>
      <GlossyEye cx={57} cy={77} r={9.5} />
      <GlossyEye cx={103} cy={80} r={9.5} />
    </>
  ),
};

const MOUTHS: Record<MouthShape, ReactNode> = {
  smile: <path d="M66 100 q14 15 28 0" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />,
  smirk: <path d="M70 102 q10 8 22 -2" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />,
  o: <ellipse cx={80} cy={102} rx={6} ry={8} fill={INK} />,
  wavy: <path d="M68 100 q6 6 12 0 t12 0" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />,
  flat: <line x1={71} y1={100} x2={89} y2={100} stroke={INK} strokeWidth={4} strokeLinecap="round" />,
  grin: (
    <>
      <path d="M64 97 q16 20 32 0 Z" fill={INK} />
      <path d="M72 104 q8 8 16 0 Z" fill="#fff" opacity={0.9} />
    </>
  ),
  tongue: (
    <>
      <path d="M68 98 q12 16 24 0 Z" fill={INK} />
      <path d="M75 106 q5 8 10 0 Z" fill={PINK_DEEP} />
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
      <path d="M50 68 q8 -6 16 -2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M94 68 q8 -6 16 -2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
  down: (
    <>
      <path d="M50 64 q8 6 16 2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M94 64 q8 6 16 2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
  furrow: (
    <>
      <path d="M52 70 l14 -4" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d="M94 66 l14 4" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  oneUp: (
    <>
      <path d="M50 62 q8 -8 16 -2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M94 68 q8 2 16 2" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
};

const ACCESSORIES: Record<Accessory, ReactNode> = {
  zzz: (
    <g fontFamily="var(--font-display)" fontWeight={700} fill={INK} opacity={0.8}>
      <text x={112} y={44}>z</text>
      <text x={121} y={34} fontSize={13}>
        z
      </text>
      <text x={132} y={22} fontSize={16}>
        z
      </text>
    </g>
  ),
  sweat: <path d="M116 42 q7 10 0 17 q-7 -7 0 -17 Z" fill="#9AD8EA" stroke={INK} strokeWidth={2} />,
  sparkle: (
    <g className="mascot-sparkle">
      <MiniStar x={26} y={30} s={7} fill="var(--gold)" />
      <MiniStar x={132} y={26} s={5} fill="var(--gold)" />
      <MiniStar x={122} y={50} s={4} fill="var(--gold)" />
    </g>
  ),
  coffee: (
    <g transform="translate(102 100)">
      <path d="M0 0 h18 v12 a9 9 0 0 1 -9 9 a9 9 0 0 1 -9 -9 Z" fill="#fff" stroke={INK} strokeWidth={2.4} />
      <path d="M18 3 q8 0 8 6 t-8 6" fill="none" stroke={INK} strokeWidth={2.4} />
      <path d="M4 -6 q2 -4 0 -8 M10 -6 q2 -4 0 -8" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
    </g>
  ),
  question: (
    <text x={108} y={40} fontFamily="var(--font-display)" fontWeight={800} fontSize={20} fill={INK}>
      ?
    </text>
  ),
  exclaim: (
    <text x={112} y={40} fontFamily="var(--font-display)" fontWeight={800} fontSize={20} fill="var(--accent)">
      !
    </text>
  ),
  headphones: (
    <g>
      <path d="M36 64 Q80 4 124 64" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <rect x={27} y={56} width={18} height={28} rx={8} fill="var(--teal)" stroke={INK} strokeWidth={3} />
      <rect x={115} y={56} width={18} height={28} rx={8} fill="var(--teal)" stroke={INK} strokeWidth={3} />
      <circle cx={36} cy={70} r={3} fill="var(--focus-ink, #F7F5EC)" opacity={0.7} />
      <circle cx={124} cy={70} r={3} fill="var(--focus-ink, #F7F5EC)" opacity={0.7} />
    </g>
  ),
  burst: (
    <g stroke={INK} strokeWidth={2.2} strokeLinecap="round" opacity={0.55}>
      <path d="M80 4 v12" />
      <path d="M38 14 l7 9" />
      <path d="M122 14 l-7 9" />
      <path d="M14 48 l10 5" />
      <path d="M146 48 l-10 5" />
    </g>
  ),
};

function MiniStar({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
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
      <MiniStar x={22} y={44} s={5} fill="var(--gold)" />
      <MiniStar x={138} y={40} s={6} fill="var(--gold)" />
      <MiniStar x={80} y={8} s={5} fill="var(--gold)" />
      <MiniStar x={42} y={14} s={4} fill="var(--gold)" />
      <MiniStar x={118} y={12} s={4} fill="var(--gold)" />
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
  /** Gentle idle breathing/bob; switch off where motion would distract (e.g. a paused timer). */
  idle?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const spec = EXPRESSIONS[expression];
  const arms = ARM_TRANSFORMS[spec.arms ?? "idle"];
  const wrinkleCount = STAGE_WRINKLES[stage];
  const uid = useId();
  const clipId = `${uid}-body`;
  const glowId = `${uid}-glow`;

  return (
    <svg
      viewBox="0 0 160 164"
      width={size}
      height={(size * 164) / 160}
      role="img"
      aria-label={`Braina the brain — ${STAGE_LABEL[stage]}, feeling ${expression}`}
      className={`${idle ? "mascot-idle" : ""} ${className}`}
      style={style}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={BODY_PATH} />
        </clipPath>
        <radialGradient id={glowId} cx="34%" cy="26%" r="65%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* grounding shadow */}
      <ellipse cx={80} cy={156} rx={36} ry={7} fill={INK} opacity={0.12} />

      <rect x={58} y={130} width={15} height={24} rx={7.5} fill="var(--pink)" stroke={INK} strokeWidth={3} />
      <rect x={87} y={130} width={15} height={24} rx={7.5} fill="var(--pink)" stroke={INK} strokeWidth={3} />

      <g transform={arms.left}>
        <rect x={12} y={88} width={34} height={17} rx={8.5} fill="var(--pink)" stroke={INK} strokeWidth={3} />
      </g>
      <g transform={arms.right}>
        <rect x={114} y={88} width={34} height={17} rx={8.5} fill="var(--pink)" stroke={INK} strokeWidth={3} />
      </g>

      <path d={BODY_PATH} fill="var(--pink)" stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />

      {/* volumetric shading, clipped to the silhouette */}
      <g clipPath={`url(#${clipId})`}>
        <ellipse cx={80} cy={152} rx={64} ry={26} fill={PINK_DEEP} opacity={0.3} />
        <ellipse cx={52} cy={44} rx={48} ry={34} fill={`url(#${glowId})`} />
      </g>

      <ellipse cx={51} cy={96} rx={6.5} ry={4.3} fill={PINK_DEEP} opacity={0.55} />
      <ellipse cx={109} cy={96} rx={6.5} ry={4.3} fill={PINK_DEEP} opacity={0.55} />

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
