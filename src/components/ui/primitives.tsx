import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

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
          <p className="text-xs font-bold tracking-wide text-accent uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 font-display text-[30px] leading-tight font-extrabold tracking-tight md:text-4xl">
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
      className={`rounded-[1.75rem] border-2 border-border bg-surface p-5 shadow-[0_3px_0_0_var(--border)] ${className}`}
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
      <h2 className="font-display text-xl font-bold tracking-tight">{children}</h2>
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
    sm: "size-8 text-xs border-[1.5px]",
    md: "size-10 text-sm border-2",
    lg: "size-20 text-2xl border-[3px]",
  };
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border-foreground font-display font-bold text-white ${sizes[size]}`}
      style={{
        // Deeper, less saturated than the old 70%/62% formula — keeps each
        // person's hue distinct but at the muted, ink-and-paper intensity
        // the rest of the palette (accent, teal, slate) sits at, instead of
        // reading like a bright, generic-app blue.
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${hue + 35} 50% 28%))`,
      }}
    >
      {initials}
    </span>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-accent text-surface border-foreground shadow-[0_3px_0_0_var(--foreground)] hover:bg-[#a53120]",
  dark: "bg-foreground text-background border-foreground shadow-[0_3px_0_0_var(--border)] hover:opacity-90",
  ghost: "bg-surface text-foreground border-foreground/70 shadow-[0_3px_0_0_var(--border)] hover:bg-surface-2",
  soft: "bg-surface-2 text-foreground border-transparent shadow-none hover:bg-beige",
} as const;

const BUTTON_SIZES = {
  sm: "px-4 py-2 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
} as const;

/** The one tactile, press-down button every call to action in the app uses. */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full border-[2.5px] font-display font-bold tracking-wide transition-[transform,box-shadow,background-color] duration-150 active:translate-y-[3px] active:shadow-none disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent focus-visible:outline-offset-2 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/** Circular progress ring; `value` is 0–1. */
export function Ring({
  value,
  size = 64,
  stroke = 7,
  children,
  className = "text-accent",
  trackClassName = "stroke-surface-2",
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
  trackClassName?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={trackClassName} />
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
