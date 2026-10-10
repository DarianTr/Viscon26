"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain } from "./mascot/brain";
import {
  CalendarIcon,
  CommunityIcon,
  PlansIcon,
  ProfileIcon,
  TodayIcon,
} from "./icons";

const tabs = [
  { href: "/", label: "Today", icon: TodayIcon },
  { href: "/plans", label: "Plans", icon: PlansIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/community", label: "Community", icon: CommunityIcon },
  { href: "/profile", label: "Profile", icon: ProfileIcon },
] as const;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Bottom tab bar — the primary navigation on phones. */
export function TabBar() {
  const isActive = useIsActive();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 pt-2.5 pb-2 text-[10.5px] font-bold transition-colors ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <span
                  className={`grid size-8 place-items-center rounded-full transition-colors ${active ? "bg-accent-soft" : ""}`}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.4 : 1.9} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type PlanSummary = { title: string; week: number; weeks: number; phase: string | null };

/** The same tabs as a sidebar on tablets and desktops. */
export function SideNav({ plan }: { plan: PlanSummary | null }) {
  const isActive = useIsActive();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r-2 border-border px-4 py-6 md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2 px-3">
        <Brain size={36} stage={1} expression="happy" idle={false} />
        <span className="font-display text-xl font-extrabold tracking-tight">Braina</span>
      </Link>
      <ul className="flex flex-col gap-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
                  active
                    ? "border-foreground bg-accent-soft text-accent"
                    : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      {plan && (
        <Link
          href="/plans"
          className="mt-auto rounded-[1.5rem] border-2 border-border bg-surface p-4 text-xs text-muted shadow-[0_3px_0_0_var(--border)]"
        >
          <p className="font-display font-bold text-foreground">{plan.title}</p>
          <p className="mt-1">
            Week {plan.week} of {plan.weeks}
            {plan.phase && ` · ${plan.phase} phase`}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(plan.week / plan.weeks) * 100}%` }}
            />
          </div>
        </Link>
      )}
    </aside>
  );
}
