import { MASCOT_HEALTH_MAX, MASCOT_STATUS_LABEL, MASCOT_STATUS_LINE, type MascotStatus } from "@/lib/mascot";

const STATUS_COLOR: Record<MascotStatus, string> = {
  thriving: "var(--gold)",
  steady: "var(--accent)",
  slipping: "var(--tempo)",
  neglected: "var(--muted)",
};

/**
 * The decaying half of mascot status: a health bar that falls when the plan
 * isn't followed (or there's none and no studying happens), separate from
 * the all-time, never-decaying evolution stage above it.
 */
export function MascotStatusBadge({ health, status }: { health: number; status: MascotStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <div className="mt-6 border-t-2 border-dashed border-border pt-5 text-left">
      <div className="flex items-center justify-between text-xs font-bold tracking-wide uppercase">
        <span style={{ color }}>{MASCOT_STATUS_LABEL[status]}</span>
        <span className="text-muted">{health}/{MASCOT_HEALTH_MAX}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${health}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-2 text-sm text-muted">{MASCOT_STATUS_LINE[status]}</p>
    </div>
  );
}
