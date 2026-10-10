"use client";

import { formatGrade } from "@/lib/grades";
import type { KnowledgeSubject, StudyFocus } from "@/lib/knowledge";

export function StudyFocusCard({
  focus,
  subjects,
}: {
  focus: StudyFocus;
  subjects: KnowledgeSubject[];
}) {
  if (focus.topics.length === 0) return null;

  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  // Group by subject, preserving priority order within each group.
  const groups = new Map<string, { name: string; topics: StudyFocus["topics"] }>();
  for (const t of focus.topics) {
    const key = t.subjectId ?? "__none__";
    if (!groups.has(key)) {
      groups.set(key, { name: subjectName.get(key) ?? key, topics: [] });
    }
    groups.get(key)!.topics.push(t);
  }
  // Sort groups by their highest-priority topic (already sorted in focus.topics).
  const orderedGroups = [...groups.values()].sort(
    (a, b) => (b.topics[0]?.allocation ?? 0) - (a.topics[0]?.allocation ?? 0),
  );

  // The widest bar = the highest allocation across all topics.
  const maxAlloc = Math.max(...focus.topics.map((t) => t.allocation), 1);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Suggested topic mix for your next session, ranked by gap to target, time to
        exam and current uncertainty.
      </p>

      {orderedGroups.map((group) => (
        <section key={group.name} className="space-y-2">
          {groups.size > 1 && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {group.name}
            </h3>
          )}
          {group.topics.map((t) => (
            <TopicRow key={t.topicId} topic={t} maxAlloc={maxAlloc} />
          ))}
        </section>
      ))}
    </div>
  );
}

function TopicRow({
  topic,
  maxAlloc,
}: {
  topic: StudyFocus["topics"][0];
  maxAlloc: number;
}) {
  const barWidth = (topic.allocation / maxAlloc) * 100;
  const pct = Math.round(topic.allocation);

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{topic.topicName}</span>
          {topic.tags.map((tag) => (
            <Tag key={tag} tag={tag} />
          ))}
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      <div className="text-right tabular-nums">
        <span className="text-sm font-semibold">{pct}%</span>
        <br />
        <span className="font-mono text-[11px] text-muted">
          {formatGrade(topic.currentMean)}
        </span>
      </div>
    </div>
  );
}

const TAG_STYLES: Record<string, string> = {
  "weakest": "text-accent ring-accent/40",
  "least certain": "text-deep ring-deep/40",
  "exam soon": "text-recovery ring-recovery/40",
};

function Tag({ tag }: { tag: string }) {
  const cls = TAG_STYLES[tag] ?? "text-muted ring-border";
  return (
    <span className={`rounded-full px-1.5 text-[10.5px] font-medium whitespace-nowrap ring-1 ${cls}`}>
      {tag}
    </span>
  );
}
