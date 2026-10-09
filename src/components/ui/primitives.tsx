import type { CSSProperties, ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 md:pt-10">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight md:text-3xl">
          {title}
        </h1>
      </div>
      {action}
    </header>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`rounded-3xl bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-border ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mt-8 mb-3 flex items-center justify-between">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Avatar({
  initials,
  hue,
  size = "md",
}: {
  initials: string;
  hue: number;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-20 text-2xl",
  };
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${sizes[size]}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 80% 60%), hsl(${hue + 40} 75% 48%))`,
      }}
    >
      {initials}
    </span>
  );
}

/** Circular progress ring; `value` is 0–1. */
export function Ring({
  value,
  size = 64,
  stroke = 7,
  children,
  className = "text-accent",
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, value))}
          className={`transition-[stroke-dashoffset] duration-700 ${className}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
