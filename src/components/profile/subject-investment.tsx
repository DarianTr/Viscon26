import { Card } from "@/components/ui/primitives";
import { subjectColor } from "@/lib/session-types";

/**
 * Where completed study time went, per academic subject. Breaks and buffers
 * are never subjects, and unused buffer time is never study time, so the
 * shares only divide time actually studied.
 */
export function SubjectInvestment({ subjects }: { subjects: { name: string; minutes: number }[] }) {
  const studied = subjects.filter((s) => s.minutes > 0);
  const total = studied.reduce((sum, s) => sum + s.minutes, 0);
  if (total === 0) {
    return <Card className="text-sm text-muted">Complete a study session to see where your time goes.</Card>;
  }

  return (
    <Card className="flex flex-col gap-4">
      {studied.map((subject) => {
        const share = Math.round((subject.minutes / total) * 100);
        const color = subjectColor(subject.name);
        return (
          <div key={subject.name}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className={`font-medium ${color.text}`}>{subject.name}</span>
              <span className={`font-semibold tabular-nums ${color.text}`}>
                {share}% <span className="font-normal text-muted">· {Math.round((subject.minutes / 60) * 10) / 10} h</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${share}% of study time`}>
              <div className="h-full rounded-full" style={{ width: `${share}%`, background: color.value }} />
            </div>
          </div>
        );
      })}
    </Card>
  );
}
