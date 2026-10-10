import type { ReactNode } from "react";

/**
 * Small hand-drawn-feeling decorations that share Braina's illustration
 * language: bold mahogany outlines, flat fills from the brand palette, and a
 * slightly imperfect, hand-placed geometry. Decorative only — never load-
 * bearing for layout or data.
 */

const INK = "#250A04";

export function Sparkle({ size = 14, color = "var(--gold)", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <path
        d="M12 1 L14.4 9.6 L23 12 L14.4 14.4 L12 23 L9.6 14.4 L1 12 L9.6 9.6 Z"
        fill={color}
        stroke={INK}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LightningBolt({ size = 18, color = "var(--accent)", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <path
        d="M13.5 1 L4 14h6l-1 9 10-14h-6z"
        fill={color}
        stroke={INK}
        strokeWidth={1.3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BookStack({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 28" width={size} height={(size * 28) / 32} aria-hidden className={className}>
      <rect x={2} y={18} width={28} height={7} rx={2} fill="var(--teal)" stroke={INK} strokeWidth={2} />
      <rect x={4} y={10} width={23} height={7} rx={2} fill="var(--pink)" stroke={INK} strokeWidth={2} />
      <rect x={6} y={2} width={17} height={7} rx={2} fill="var(--gold)" stroke={INK} strokeWidth={2} />
      <path d="M9 5.5h11" stroke={INK} strokeWidth={1.2} strokeLinecap="round" opacity={0.5} />
    </svg>
  );
}

export function CoffeeCup({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden className={className}>
      <path d="M4 10h16v8a8 8 0 0 1-8 8 8 8 0 0 1-8-8z" fill="#fff" stroke={INK} strokeWidth={2.2} />
      <path d="M20 12q6 0 6 5t-6 5" fill="none" stroke={INK} strokeWidth={2.2} />
      <path d="M8 2q1.5 3 0 6M13 2q1.5 3 0 6" stroke={INK} strokeWidth={1.8} strokeLinecap="round" fill="none" opacity={0.6} />
    </svg>
  );
}

export function Headphones({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 28 24" width={size} height={(size * 24) / 28} aria-hidden className={className}>
      <path d="M4 16Q4 2 14 2t10 14" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      <rect x={1} y={14} width={8} height={9} rx={3.5} fill="var(--teal)" stroke={INK} strokeWidth={2} />
      <rect x={19} y={14} width={8} height={9} rx={3.5} fill="var(--teal)" stroke={INK} strokeWidth={2} />
    </svg>
  );
}

/** A friendly speech bubble around short microcopy — Braina "talking" near the mascot. */
export function SpeechBubble({
  children,
  className = "",
  tailSide = "left",
}: {
  children: ReactNode;
  className?: string;
  tailSide?: "left" | "right";
}) {
  return (
    <div
      className={`relative inline-block rounded-2xl border-2 border-foreground bg-surface px-4 py-2.5 shadow-[0_3px_0_0_var(--border)] ${className}`}
    >
      {children}
      <svg
        viewBox="0 0 20 14"
        width={18}
        height={13}
        aria-hidden
        className={`absolute -bottom-[11px] ${tailSide === "left" ? "left-7" : "right-7"}`}
      >
        <path
          d={tailSide === "left" ? "M2 0 L18 0 L4 13 Z" : "M2 0 L18 0 L16 13 Z"}
          fill="var(--surface)"
          stroke={INK}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <rect x={0} y={-2} width={20} height={3} fill="var(--surface)" />
      </svg>
    </div>
  );
}

/** A little sticker-ribbon label, for eyebrows that want to feel collectible rather than clinical. */
export function StickerLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-foreground bg-gold px-3 py-1 font-display text-xs font-bold text-foreground shadow-[0_2px_0_0_var(--border)] ${className}`}
    >
      {children}
    </span>
  );
}

/** A strip of "washi tape" pinning a card to the page — the hand-placed, scrapbook touch. */
export function WashiTape({
  color = "var(--pink)",
  className = "",
}: {
  color?: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 64 24" width={56} height={21} aria-hidden className={className}>
      <rect x={1} y={1} width={62} height={22} rx={2} fill={color} opacity={0.85} stroke={INK} strokeWidth={1.4} />
      <path d="M8 1v22M20 1v22M44 1v22M56 1v22" stroke="#fff" strokeWidth={2} opacity={0.3} />
    </svg>
  );
}

/** A round thumbtack pin — for cards that should feel posted, not generated. */
export function Pin({ size = 18, color = "var(--accent)", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <circle cx={12} cy={10} r={7} fill={color} stroke={INK} strokeWidth={1.6} />
      <circle cx={9.5} cy={7.5} r={2} fill="#fff" opacity={0.6} />
      <path d="M12 16v6" stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

/** A tiny celebratory crown — a per-stage flourish for the brain-evolution trail. */
export function Crown({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 16" width={size} height={(size * 16) / 24} aria-hidden className={className}>
      <path
        d="M2 15 L1 5 L7 9 L12 2 L17 9 L23 5 L22 15 Z"
        fill="var(--gold)"
        stroke={INK}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A small locked badge, for not-yet-reached collectible stages. */
export function LockBadge({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <rect x={5} y={11} width={14} height={10} rx={2.5} fill="var(--surface-2)" stroke={INK} strokeWidth={1.6} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <circle cx={12} cy={16} r={1.6} fill={INK} />
    </svg>
  );
}
