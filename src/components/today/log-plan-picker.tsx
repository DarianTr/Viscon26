"use client";

import { useRouter } from "next/navigation";

/** Which plan to log a data point for; switching reloads the section for that plan. */
export function LogPlanPicker({ plans, value }: { plans: { id: string; title: string }[]; value: string }) {
  const router = useRouter();
  return (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <span className="text-xs font-medium text-muted">Plan</span>
      <select
        value={value}
        onChange={(e) => router.replace(`/?log=${e.target.value}#log-data`, { scroll: false })}
        className="rounded-xl bg-surface-2 px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-accent"
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  );
}
