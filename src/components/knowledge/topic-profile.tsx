"use client";

import { useState } from "react";
import { chanceAtLeast, formatGrade, fromGrade, gradeSd, Z90 } from "@/lib/grades";
import type { KnowledgeSubject, MeanSd, Timeline } from "@/lib/knowledge";
import { DAY, formatDay, useWidth } from "./chart-utils";
import { Segmented } from "./forecast-chart";

type Compare = "week" | "exam";
const ALL = "all";
const BANDS = [2.2, 1.645, 1.15, 0.67, 0.3];

/** One axis of the spider chart: a topic, with its values pulled out of the timeline. */
type Axis = {
  id: string;
  name: string;
  subject: KnowledgeSubject;
  subjectIndex: number;
  now: MeanSd;
  compare: MeanSd;
  target: number | null;
};

export function TopicProfile({ timeline, subjects }: { timeline: Timeline; subjects: KnowledgeSubject[] }) {
  const [compare, setCompare] = useState<Compare>("week");
  const [focus, setFocus] = useState<string>(ALL);
  const asOf = Date.parse(timeline.asOf);

  const weekAgo = asOf - 7 * DAY;
  const earlier = timeline.steps.findLast((s) => Date.parse(s.at) <= weekAgo) ?? timeline.steps[0];
  const cmpLabel = compare === "exam" ? "Exam-day forecast" : `A week ago (${formatDay(weekAgo)})`;
  const index = new Map(timeline.topics.map((t, i) => [t.id, i]));

  // Per topic, for the list (and the chart when one subject is chosen).
  const axes: Axis[] = subjects.flatMap((subject, subjectIndex) =>
    focus !== ALL && focus !== subject.id
      ? []
      : subject.topics.flatMap((t) => {
          const i = index.get(t.id);
          if (i === undefined) return [];
          return [{
            id: t.id,
            name: t.name,
            subject,
            subjectIndex,
            now: timeline.current.levels[i],
            compare: compare === "exam" ? timeline.current.forecasts[i] : earlier.levels[i],
            target: subject.targetGrade ? fromGrade(subject.targetGrade) : null,
          }];
        }),
  );

  // With all subjects, real course topics would mean dozens of axes: one per subject instead.
  const groupIndex = new Map(timeline.groups.map((g, i) => [g.id, i]));
  const bySubject = focus === ALL && subjects.length > 1;
  const radarAxes: Axis[] = !bySubject
    ? axes
    : subjects.flatMap((subject, subjectIndex) => {
        const g = groupIndex.get(subject.id);
        if (g === undefined) return [];
        return [{
          id: subject.id,
          name: subject.name,
          subject,
          subjectIndex,
          now: timeline.current.groupLevels[g],
          compare: compare === "exam" ? timeline.current.groupForecasts[g] : earlier.groupLevels[g],
          target: subject.targetGrade ? fromGrade(subject.targetGrade) : null,
        }];
      });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Segmented
          label="Subjects"
          value={focus}
          onChange={setFocus}
          options={[{ value: ALL, label: "All subjects" }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <Segmented
          label="Compare with"
          value={compare}
          onChange={setCompare}
          options={[
            { value: "week", label: "A week ago" },
            { value: "exam", label: "Exam-day forecast" },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm bg-foreground/25" />
          Level now: shading is the distribution
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden><line x1="0" x2="22" y1="4" y2="4" className="stroke-muted" strokeWidth="1.5" strokeDasharray={compare === "exam" ? "2 3" : "6 4"} /></svg>
          {cmpLabel}
        </span>
        {axes.some((a) => a.target !== null) && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden><line x1="0" x2="22" y1="4" y2="4" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 4" /></svg>
            Target grade
          </span>
        )}
      </div>
      {radarAxes.length >= 3 ? (
        <Radar axes={radarAxes} compareAhead={compare === "exam"} grouped={false} />
      ) : (
        <p className="text-sm text-muted">The spider chart needs at least three axes; pick a subject to see its topics.</p>
      )}
      {bySubject && (
        <p className="text-xs text-muted">One axis per subject: the average of its topics. Pick a subject above to see each topic.</p>
      )}
      <ProgressList axes={axes} timeline={timeline} compareAhead={compare === "exam"} />
    </div>
  );
}

function Radar({ axes, compareAhead, grouped }: { axes: Axis[]; compareAhead: boolean; grouped: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const size = Math.max(300, Math.min(520, width));
  const pad = axes.length > 6 ? 82 : 70;
  const R = size / 2 - pad;
  const c = size / 2;
  const K = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / K;
  const pt = (i: number, v: number) => {
    const r = R * Math.min(1, Math.max(0, v));
    return [c + Math.cos(angle(i)) * r, c + Math.sin(angle(i)) * r];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
  const path = (vals: number[]) => "M" + vals.map((v, i) => pt(i, v).map((n) => n.toFixed(1)).join(",")).join("L") + "Z";
  // Light wedges mark which axes belong to which subject.
  const wedge = (from: number, to: number) => {
    const a0 = angle(from) - Math.PI / K;
    const a1 = angle(to) + Math.PI / K;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${c},${c}L${c + R * Math.cos(a0)},${c + R * Math.sin(a0)}A${R},${R} 0 ${large} 1 ${c + R * Math.cos(a1)},${c + R * Math.sin(a1)}Z`;
  };
  const spans: { from: number; to: number; subjectIndex: number }[] = [];
  axes.forEach((a, i) => {
    const last = spans.at(-1);
    if (last && last.subjectIndex === a.subjectIndex) last.to = i;
    else spans.push({ from: i, to: i, subjectIndex: a.subjectIndex });
  });

  return (
    <div ref={ref} className="mx-auto w-full max-w-[520px]">
      {width > 0 && (
        <svg viewBox={`0 0 ${size} ${size}`} className="block h-auto w-full overflow-visible" role="img" aria-label="Spider chart of topic levels">
          {grouped &&
            spans.map((sp, k) => (
              <path key={sp.from} d={wedge(sp.from, sp.to)} className="fill-foreground" fillOpacity={k % 2 ? 0.035 : 0} />
            ))}
          {[2, 3, 4, 5, 6].map((g) => (
            <g key={g}>
              <polygon points={poly(Array(K).fill(fromGrade(g)))} className="fill-none stroke-border" />
              <text x={pt(0, fromGrade(g))[0] + 5} y={pt(0, fromGrade(g))[1] + 4} className="fill-muted font-mono text-[10px]">
                {g}
              </text>
            </g>
          ))}
          {axes.map((_, i) => {
            const [x2, y2] = pt(i, 1);
            return <line key={i} x1={c} y1={c} x2={x2} y2={y2} className="stroke-border" />;
          })}
          {/* Nested rings between m − zσ and m + zσ overlap into a fading band. */}
          {BANDS.map((z) => (
            <path
              key={z}
              d={path(axes.map((a) => a.now.mean + z * a.now.sd)) + path(axes.map((a) => Math.max(0, a.now.mean - z * a.now.sd)))}
              fillRule="evenodd"
              className="fill-foreground"
              fillOpacity={0.09}
            />
          ))}
          <polygon points={poly(axes.map((a) => a.compare.mean))} className="fill-none stroke-muted" strokeWidth={1.5} strokeDasharray={compareAhead ? "2 3" : "6 4"} />
          {axes.every((a) => a.target !== null) && (
            <polygon points={poly(axes.map((a) => a.target!))} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 4" />
          )}
          <polygon points={poly(axes.map((a) => a.now.mean))} className="fill-none stroke-foreground" strokeWidth={2} strokeLinejoin="round" />
          {axes.map((a, i) => {
            const ang = angle(i);
            const lx = c + Math.cos(ang) * (R + 14);
            const ly = c + Math.sin(ang) * (R + 14);
            const anchor = Math.abs(Math.cos(ang)) < 0.3 ? "middle" : Math.cos(ang) > 0 ? "start" : "end";
            const dy = Math.sin(ang) < -0.5 ? -14 : Math.sin(ang) > 0.5 ? 12 : 0;
            return (
              <g key={a.id}>
                <text x={lx} y={ly + dy} textAnchor={anchor} className="fill-foreground text-[11.5px] font-semibold">
                  {a.name.length > 20 ? `${a.name.slice(0, 19)}…` : a.name}
                </text>
                <text x={lx} y={ly + dy + 13} textAnchor={anchor} className="fill-muted font-mono text-[10.5px]">
                  {formatGrade(a.now.mean)} ± {gradeSd(Z90 * a.now.sd).toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function ProgressList({ axes, timeline, compareAhead }: { axes: Axis[]; timeline: Timeline; compareAhead: boolean }) {
  const change = (a: Axis) => (compareAhead ? a.compare.mean - a.now.mean : a.now.mean - a.compare.mean);
  const weakest = argBy(axes, (a) => -a.now.mean);
  const unsure = argBy(axes, (a) => a.now.sd);
  const most = argBy(axes, change);
  const groupIndex = new Map(timeline.groups.map((g, i) => [g.id, i]));
  const bySubject = axes.reduce<Map<string, Axis[]>>(
    (m, a) => m.set(a.subject.id, [...(m.get(a.subject.id) ?? []), a]),
    new Map(),
  );
  const columns = "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem_4rem] items-center gap-3";

  return (
    <div>
      <div className={`${columns} pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase`}>
        <span>Topic</span>
        <span>Distribution (grade 1–6)</span>
        <span className="text-right">Now</span>
        <span className="text-right">{compareAhead ? "To exam" : "7 days"}</span>
      </div>
      {[...bySubject.values()].map((group) => {
        const subject = group[0].subject;
        const g = groupIndex.get(subject.id);
        const level = g !== undefined ? timeline.current.groupLevels[g] : null;
        const forecast = g !== undefined ? timeline.current.groupForecasts[g] : null;
        const target = subject.targetGrade ? fromGrade(subject.targetGrade) : null;
        return (
          <section key={subject.id} className="border-t border-border pt-2.5 pb-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <h3 className="font-semibold">{subject.name}</h3>
              {level && forecast && (
                <p className="text-xs text-muted tabular-nums">
                  now {formatGrade(level.mean)} · exam forecast {formatGrade(forecast.mean)}
                  {target !== null && ` · ${Math.round(100 * chanceAtLeast(forecast.mean, forecast.sd, target))}% chance of ${formatGrade(target)}`}
                </p>
              )}
            </div>
            {group.map((a) => {
              const { mean: m, sd: s } = a.now;
              const stops = Array.from({ length: 41 }, (_, k) => {
                const v = k / 40;
                const alpha = 0.8 * Math.exp(-0.5 * ((v - m) / s) ** 2);
                return `color-mix(in srgb, var(--foreground) ${(100 * alpha).toFixed(1)}%, transparent) ${(100 * v).toFixed(1)}%`;
              });
              const d = change(a);
              return (
                <div key={a.id} className={`${columns} py-2 text-sm`}>
                  <div className="min-w-0">
                    <p className="truncate">{a.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a === weakest && <Badge tone="bad">weakest</Badge>}
                      {a === unsure && <Badge tone="info">least certain</Badge>}
                      {a === most && change(a) > 0.005 && <Badge tone="good">{compareAhead ? "most to gain" : "most progress"}</Badge>}
                    </div>
                  </div>
                  <div
                    className="relative h-6 overflow-hidden rounded-md"
                    style={{ background: `linear-gradient(to right, ${stops.join(",")}), var(--surface-2)` }}
                    title={`${a.name}: grade ${formatGrade(m)}, 90% ${formatGrade(m - Z90 * s)}–${formatGrade(m + Z90 * s)}`}
                  >
                    <span className="absolute inset-y-1 w-0 border-l-[1.5px] border-dashed border-muted" style={{ left: `${100 * a.compare.mean}%` }} />
                    {a.target !== null && (
                      <span className="absolute inset-y-0 w-0 border-l-[1.5px] border-dashed" style={{ left: `${100 * a.target}%`, borderColor: "var(--accent)" }} />
                    )}
                    <span className="absolute inset-y-1 -ml-px w-0.5 rounded bg-foreground" style={{ left: `${100 * m}%` }} />
                  </div>
                  <div className="text-right font-mono text-[13px] tabular-nums">
                    {formatGrade(m)}
                    <br />
                    <span className="text-muted">± {gradeSd(Z90 * s).toFixed(2)}</span>
                  </div>
                  <div className={`text-right font-mono text-[13px] tabular-nums ${d >= 0 ? "text-recovery" : "text-accent"}`}>
                    {d >= 0 ? "+" : "−"}
                    {Math.abs(gradeSd(d)).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function argBy<T>(items: T[], score: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const x of items) {
    const v = score(x);
    if (v > bestScore) [best, bestScore] = [x, v];
  }
  return best;
}

function Badge({ tone, children }: { tone: "bad" | "info" | "good"; children: React.ReactNode }) {
  const cls = {
    bad: "text-accent ring-accent/40",
    info: "text-deep ring-deep/40",
    good: "text-recovery ring-recovery/40",
  }[tone];
  return <span className={`rounded-full px-1.5 text-[10.5px] font-medium whitespace-nowrap ring-1 ${cls}`}>{children}</span>;
}
