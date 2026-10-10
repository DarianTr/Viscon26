"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function KnowledgeNav({ planId }: { planId: string }) {
  const pathname = usePathname();
  const links = [
    { href: `/plans/${planId}/forecast`, label: "Grade forecast" },
    { href: `/plans/${planId}/topics`, label: "Subjects" },
    { href: `/plans/${planId}/log`, label: "Log data" },
  ];
  return (
    <nav aria-label="Knowledge" className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1">
      {links.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
