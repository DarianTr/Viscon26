"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chanceAtLeast, formatGrade, fromGrade, gradeSd, Z90 } from "@/lib/grades";
import type { KnowledgeSubject, MeanSd, Timeline } from "@/lib/knowledge";
import {
  DAY,
  type Density,
  examTime,
  formatDay,
  interpolate,
  MeasurementGradients,
  paintDensity,
  TYPE_COLOR,
  TYPE_LABEL,
  useSchemeVersion,
  useWidth,
} from "./chart-utils";

type Mode = "trajectory" | "history";
const ALL = -1;
const M = { l: 34, r: 84, t: 14, b: 28 };
const HEIGHT = 320;
const BELL_W = 46;

export function ForecastChart({ timeline, subjects, initialSubjectId, showSubjectSelector = true }: { timeline: Timeline; subjects: KnowledgeSubject[]; initialSubjectId?: string; showSubjectSelector?: boolean }) {
  const topics = subjects;
  const [selected, setSelected] = useState(() => Math.max(0, subjects.findIndex((subject) => subject.id === initialSubjectId)));
  // The timeline's group for the selected subject (its topics' equal average).
  const group = selected === ALL ? -1 : timeline.groups.findIndex((g) => g.id === subjects[selected]?.id);
  const [modeChoice, setMode] = useState<Mode>("trajectory");
  // A plan-wide trajectory would need covariances the timeline doesn't carry.
  const mode: Mode = selected === ALL ? "history" : modeChoice;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scheme = useSchemeVersion();
  const [hover, setHover] = useState<{ t: number; d: { m: number; s: number } } | null>(null);

  const asOf = Date.parse(timeline.asOf);
  const topic = selected === ALL ? null : topics[selected];
  const examDates = topics.map((t) => (t.examDate ? examTime(t.examDate) : null));
  const exam = selected === ALL ? Math.max(...examDates.map((d) => d ?? 0)) || null : examDates[selected];
  const targets = topics.map((t) => (t.targetGrade ? fromGrade(t.targetGrade) : null));
  const target =
    selected === ALL
      ? targets.every((t) => t !== null) && targets.length
        ? (targets as number[]).reduce((a, b) => a + b, 0) / targets.length
        : null
      : targets[selected];

  const pick = (step: { groupForecasts: MeanSd[]; overall: MeanSd }) =>
    selected === ALL ? step.overall : step.groupForecasts[group];
  const forecastNow = pick(timeline.current);

  const steps = timeline.steps.map((s) => ({ ...s, t: Date.parse(s.at) }));
  const t0 = Math.min(steps[0]?.t ?? asOf, asOf - 7 * DAY);
  const t1 = Math.max(exam ?? 0, asOf + 7 * DAY);
  const plotW = Math.max(120, width - M.l - M.r);
  const plotH = HEIGHT - M.t - M.b;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => M.t + (1 - Math.min(1, Math.max(0, v))) * plotH;

  // The distribution to paint at each moment.
  const lookup = useMemo(() => {
    const segs = steps.map((s, i) => ({
      from: s.t,
      to: i + 1 < steps.length ? steps[i + 1].t : asOf,
      value: mode === "history" ? pick(s) : s.groupLevels[group],
    }));
    const ahead = timeline.projection.map((p) => ({
      t: Date.parse(p.at),
      m: p.groupLevels[group]?.mean ?? 0,
      s: p.groupLevels[group]?.sd ?? 1,
    }));
    return (t: number): Density => {
      if (t <= asOf) {
        const seg = segs.findLast((g) => g.from <= t);
        return seg ? { m: seg.value.mean, s: seg.value.sd, peak: 0.95 } : null;
      }
      if (mode === "history" || selected === ALL) return null;
      const p = interpolate(ahead, t);
      return p ? { m: p.m, s: p.s, peak: 0.48 } : null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, selected, group, mode, asOf]);

  useEffect(() => {
    if (canvasRef.current && width > 0) paintDensity(canvasRef.current, plotW, plotH, t0, t1, lookup, 0, 1, "--slate");
  }, [lookup, width, plotW, plotH, t0, t1, scheme]);

  // Bell curve of the forecast, lying on its side at the exam (trajectory) or now (history).
  const bellAt = mode === "history" ? asOf : (exam ?? asOf);
  const bell = (() => {
    const { mean, sd } = forecastNow;
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const v = mean - 3 * sd + (6 * sd * i) / 60;
      // The curve's shape, scaled so its peak is BELL_W pixels wide.
      const d = Math.exp(-0.5 * ((v - mean) / sd) ** 2);
      pts.push(`${(x(bellAt) + d * BELL_W).toFixed(1)},${y(v).toFixed(1)}`);
    }
    return `M${x(bellAt)},${y(mean - 3 * sd)}L${pts.join("L")}L${x(bellAt)},${y(mean + 3 * sd)}Z`;
  })();

  const selectedTopics = new Set(selected === ALL ? [] : topics[selected].topics.map((t) => t.id));
  const points = steps.filter(
    (s) => s.observation && (selected === ALL || Object.keys(s.observation.weights).some((t) => selectedTopics.has(t))),
  );
  // Weekly ticks (Mondays), thinned so labels never collide.
  const every = [7, 14, 28, 56].find((d) => (d * DAY * plotW) / (t1 - t0) >= 64) ?? 56;
  const weekTicks: number[] = [];
  const monday = Date.UTC(2024, 0, 1);
  for (let t = t0 + ((7 * DAY - ((t0 - monday) % (7 * DAY))) % (7 * DAY)); t <= t1; t += every * DAY) {
    weekTicks.push(t);
  }
  const chance = target !== null ? chanceAtLeast(forecastNow.mean, forecastNow.sd, target) : null;
  const daysLeft = exam ? Math.max(0, Math.ceil((exam - asOf) / DAY)) : null;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left - M.l) / plotW) * (t1 - t0);
    const d = lookup(t);
    setHover(d ? { t, d } : null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {showSubjectSelector && <Segmented
          label="Subject"
          value={selected}
          onChange={setSelected}
          options={[
            ...(topics.length > 1 ? [{ value: ALL, label: "All (average)" }] : []),
            ...topics.map((t, i) => ({ value: i, label: t.name })),
          ]}
        />}
        <Segmented
          label="View"
          value={mode}
          onChange={setMode}
          disabled={selected === ALL}
          options={[
            { value: "trajectory", label: "Level → exam" },
            { value: "history", label: "Forecast history" },
          ]}
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={exam ? `Predicted grade, ${formatDay(exam)}` : "Predicted grade"} value={formatGrade(forecastNow.mean)} />
        <Stat
          label="90% range"
          value={`${formatGrade(forecastNow.mean - Z90 * forecastNow.sd)}–${formatGrade(forecastNow.mean + Z90 * forecastNow.sd)}`}
        />
        <Stat
          label={target !== null ? `Chance of ${formatGrade(target)} or better` : "Target"}
          value={chance !== null ? `${Math.round(100 * chance)}%` : "not set"}
        />
        <Stat label="Exam in" value={daysLeft !== null ? `${daysLeft} days` : "no date"} />
      </dl>

      <div ref={wrapRef} className="relative w-full">
        {width > 0 && (
          <>
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute"
              style={{ left: M.l, top: M.t }}
              aria-hidden
            />
            <svg
              viewBox={`0 0 ${width} ${HEIGHT}`}
              width={width}
              height={HEIGHT}
              className="relative block overflow-visible"
              role="img"
              aria-label={`Grade forecast for ${topic?.name ?? "all subjects"}`}
            >
              <MeasurementGradients prefix="fc" />
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <g key={g}>
                  <line x1={M.l} x2={M.l + plotW} y1={y(fromGrade(g))} y2={y(fromGrade(g))} className="stroke-border" />
                  <text x={M.l - 8} y={y(fromGrade(g)) + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">
                    {g}
                  </text>
                </g>
              ))}
              {weekTicks.map((t) => (
                <text key={t} x={x(t)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted font-mono text-[11px]">
                  {formatDay(t)}
                </text>
              ))}
              <line x1={x(asOf)} x2={x(asOf)} y1={M.t} y2={M.t + plotH} className="stroke-muted" strokeDasharray="2 3" />
              <text x={x(asOf) + 4} y={M.t + 10} className="fill-muted text-[11px]">
                today
              </text>
              {exam && (
                <>
                  <line x1={x(exam)} x2={x(exam)} y1={M.t} y2={M.t + plotH} className="stroke-foreground" strokeOpacity={0.35} />
                  <text x={x(exam) + 4} y={M.t + 10} className="fill-foreground text-[11px] font-semibold">
                    exam
                  </text>
                </>
              )}
              {target !== null && (
                <>
                  <line x1={M.l} x2={M.l + plotW} y1={y(target)} y2={y(target)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 4" />
                  <text x={M.l + 6} y={y(target) - 6} fill="var(--accent)" className="text-[11px] font-semibold">
                    target {formatGrade(target)}
                  </text>
                </>
              )}
              <path d={bell} fill="var(--surface)" fillOpacity={0.55} stroke="var(--teal)" strokeWidth={2} />
              <text x={x(bellAt) + BELL_W + 6} y={y(forecastNow.mean) + 4} className="fill-foreground text-[12px] font-semibold">
                {formatGrade(forecastNow.mean)}
              </text>
              {points.map((s, i) => {
                const o = s.observation!;
                const sd = s.noiseSd ?? 0.1;
                const top = y(o.score + 1.96 * sd);
                const w = o.type === "mock" || o.type === "exam" ? 7 : 5;
                return (
                  <rect
                    key={o.id ?? i}
                    x={x(s.t) - w / 2}
                    y={top}
                    width={w}
                    height={Math.max(3, y(o.score - 1.96 * sd) - top)}
                    rx={w / 2}
                    fill={`url(#fc-${o.type})`}
                    fillOpacity={0.3 + 0.7 * Math.min(1, (0.05 / sd) ** 1.5)}
                  >
                    <title>{`${TYPE_LABEL[o.type]}, ${formatDay(s.t)}: grade ${formatGrade(o.score)} on ${o.nPoints} points`}</title>
                  </rect>
                );
              })}
              {hover && (
                <line x1={x(hover.t)} x2={x(hover.t)} y1={M.t} y2={M.t + plotH} className="stroke-muted" />
              )}
              <rect
                x={M.l}
                y={M.t}
                width={plotW}
                height={plotH}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>
            {hover && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-foreground px-2.5 py-1.5 text-xs whitespace-nowrap text-background tabular-nums"
                style={{ left: Math.min(Math.max(x(hover.t), 90), width - 90), top: y(hover.d.m + Z90 * hover.d.s) - 8 }}
              >
                {formatDay(hover.t)}
                {hover.t > asOf ? " · projected" : ""}
                <br />
                <b>
                  {mode === "history" ? "Exam forecast" : "Level"} {formatGrade(hover.d.m)}
                </b>{" "}
                ± {gradeSd(Z90 * hover.d.s).toFixed(2)}
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-1.5 text-xs text-muted">
        <p>
          {mode === "history"
            ? "Shading: exam forecast over time (darker = more likely)."
            : "Shading: grades over time (darker = more likely); after today, projected to exam."}
        </p>
        <div className="flex items-center gap-x-4 overflow-x-auto whitespace-nowrap pb-1">
          {Object.entries(TYPE_LABEL).map(([type, label]) => (
            <span key={type} className="inline-flex shrink-0 items-center gap-1.5">
              <span className="inline-block h-3.5 w-1.5 rounded-full" style={{ background: TYPE_COLOR[type] }} />
              {label}
            </span>
          ))}
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <svg width="22" height="12" aria-hidden><path d="M1 10 C6 10 6 2 11 2 S16 10 21 10" fill="none" stroke="var(--teal)" strokeWidth="2" /></svg>
            Exam-grade distribution
          </span>
        </div>
        <p>Bars: each score&apos;s own measurement noise.</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3.5 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap gap-1 rounded-2xl bg-surface-2 p-1 ${disabled ? "opacity-50" : ""}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
            o.value === value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
