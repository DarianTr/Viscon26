"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatGrade } from "@/lib/grades";
import type { DataPointType, KnowledgeSubject, Observation } from "@/lib/knowledge";
import { TYPE_COLOR, TYPE_LABEL } from "./chart-utils";
import { Segmented } from "./forecast-chart";

const TYPES: { value: DataPointType; label: string; hint: string }[] = [
  { value: "practice", label: "Practice sheet", hint: "Exercise sheets and homework, often with notes" },
  { value: "quiz", label: "Quiz", hint: "Short tests and self-checks" },
  { value: "mock", label: "Mock exam", hint: "Exam-like conditions: the best anchor" },
  { value: "exam", label: "Exam", hint: "The real thing" },
];

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

export function LogDataPointForm({ planId, subjects }: { planId: string; subjects: KnowledgeSubject[] }) {
  const router = useRouter();
  const [type, setType] = useState<DataPointType>("practice");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const subject = subjects.find((x) => x.id === subjectId) ?? subjects[0];
  const [covered, setCovered] = useState<Set<string>>(() => new Set(subject?.topics.map((t) => t.id)));
  const [mode, setMode] = useState<"points" | "grade">("points");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const score =
      mode === "points"
        ? { points: Number(fd.get("points")), maxPoints: Number(fd.get("maxPoints")) }
        : { grade: Number(fd.get("grade")) };
    setError(null);
    setSaved(null);
    if (covered.size === 0) {
      setError("Tick at least one topic the data point covered.");
      return;
    }
    const res = await fetch(`/api/plans/${planId}/observations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, subject: subject.id, topics: [...covered], takenOn: fd.get("takenOn"), score }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error === "Invalid request" ? "Check the score: points can't exceed the maximum." : (body.error ?? "Couldn't save the data point"));
      return;
    }
    setSaved(`Logged ${TYPE_LABEL[type].toLowerCase()} for ${subject.name}.`);
    form.querySelectorAll<HTMLInputElement>("input[type=number]").forEach((i) => {
      if (i.name !== "maxPoints") i.value = "";
    });
    startTransition(() => router.refresh());
  }

  const input =
    "w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-accent tabular-nums";

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium text-muted">What did you do?</legend>
        <Segmented label="Kind of data point" value={type} onChange={setType} options={TYPES} />
        <p className="text-xs text-muted">{TYPES.find((t) => t.value === type)?.hint}</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Subject</span>
          <select
            id="subject"
            name="subject"
            required
            className={input}
            value={subject?.id}
            onChange={(e) => {
              const next = subjects.find((x) => x.id === e.target.value);
              setSubjectId(e.target.value);
              setCovered(new Set(next?.topics.map((t) => t.id)));
            }}
          >
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">Date</span>
          <input id="takenOn" name="takenOn" type="date" required defaultValue={today()} max={today()} className={input} />
        </label>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium text-muted">Topics it covered</legend>
        <div className="flex flex-wrap gap-2">
          {subject?.topics.map((t) => {
            const on = covered.has(t.id);
            return (
              <label
                key={t.id}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 transition-colors ${
                  on ? "bg-foreground text-background ring-foreground" : "bg-surface-2 text-muted ring-border"
                }`}
              >
                <input
                  id={`topic-${t.id}`}
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() =>
                    setCovered((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    })
                  }
                />
                {t.name}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          A sheet on one topic tells the model most about that topic; a mixed one shares the credit.
        </p>
      </fieldset>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted">Result</span>
          <Segmented
            label="Enter the result as"
            value={mode}
            onChange={setMode}
            options={[
              { value: "points", label: "Points" },
              { value: "grade", label: "Grade" },
            ]}
          />
        </div>
        {mode === "points" ? (
          <div className="flex items-center gap-2">
            <input id="points" name="points" type="number" min={0} step="any" required placeholder="Scored" className={input} aria-label="Points scored" />
            <span className="text-muted">of</span>
            <input id="maxPoints" name="maxPoints" type="number" min={1} step="any" required placeholder="Max" defaultValue={type === "mock" || type === "exam" ? 60 : 20} key={type} className={input} aria-label="Maximum points" />
          </div>
        ) : (
          <input id="grade" name="grade" type="number" min={1} max={6} step={0.25} required placeholder="e.g. 4.75" className={input} aria-label="Grade from 1 to 6" />
        )}
        <p className="text-xs text-muted">
          {mode === "points"
            ? "Points tell the model how precise the result is: 4 of 5 counts much less than 48 of 60."
            : "With a grade only, the model assumes a typical number of points for this kind of data point."}
        </p>
      </div>

      {error && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">{error}</p>}
      {saved && <p className="text-sm text-recovery">{saved}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
      >
        {pending ? "Updating…" : "Log data point"}
      </button>
    </form>
  );
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Zurich" });

export function DataPointList({
  planId,
  subjects,
  observations,
}: {
  planId: string;
  subjects: KnowledgeSubject[];
  observations: Observation[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const topicOf = new Map(subjects.flatMap((x) => x.topics.map((t) => [t.id, { subject: x, topic: t }] as const)));

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/plans/${planId}/observations/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError("Couldn't delete that data point. Try again.");
      return;
    }
    router.refresh();
  }

  if (observations.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No data points yet. Log your first one above.</p>;
  }
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-accent">{error}</p>}
      <ul className="divide-y divide-border">
        {[...observations].reverse().map((o) => {
          const ids = Object.keys(o.weights);
          const found = ids.map((id) => topicOf.get(id)).filter((x) => x !== undefined);
          const subject = found[0]?.subject;
          const label = !subject
            ? ids.join(", ")
            : found.length === subject.topics.length
              ? subject.name
              : `${subject.name}: ${found.map((x) => x.topic.name).join(", ")}`;
          return (
            <li key={o.id} className="flex items-center gap-3 py-2.5">
              <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: TYPE_COLOR[o.type] }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {TYPE_LABEL[o.type]} · {label}
                </p>
                <p className="text-xs text-muted">{dayFmt.format(new Date(o.observedAt))}</p>
              </div>
              <div className="text-right text-sm tabular-nums">
                <p className="font-semibold">{formatGrade(o.score)}</p>
                <p className="text-xs text-muted">
                  {Math.round(o.score * o.nPoints * 10) / 10} / {o.nPoints} pts
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(o.id)}
                disabled={busy === o.id}
                className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-accent disabled:opacity-50"
                aria-label={`Delete ${TYPE_LABEL[o.type]} from ${dayFmt.format(new Date(o.observedAt))}`}
              >
                {busy === o.id ? "…" : "Delete"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
