"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 pt-2.5 pb-2 text-[10.5px] font-medium transition-colors ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className="size-6" strokeWidth={active ? 2.3 : 1.9} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The same tabs as a sidebar on tablets and desktops. */
export function SideNav() {
  const isActive = useIsActive();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border px-4 py-6 md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-3">
        <span className="grid size-8 place-items-center rounded-xl bg-accent text-sm font-black text-white">
          S
        </span>
        <span className="text-lg font-bold tracking-tight">Stride</span>
      </Link>
      <ul className="flex flex-col gap-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto rounded-2xl bg-surface p-4 text-xs text-muted ring-1 ring-border">
        <p className="font-semibold text-foreground">Analysis II plan</p>
        <p className="mt-1">Week 3 of 8 · Build phase</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[37%] rounded-full bg-accent" />
        </div>
      </div>
    </aside>
  );
}
