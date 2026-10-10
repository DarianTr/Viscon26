"use client";

import { useState, useTransition } from "react";

type StudyApproach = "foundation" | "balanced" | "exam" | "custom";

type SubjectForm = {
  name: string;
  examDate: string;
  examDuration: string;
  targetGrade: string;
  currentGrade: string;
  confidence: string;
  materials: string[];
  mockCount: string;
  approach: StudyApproach;
  customPhases: string[];
  cheatsheet: string;
  comments: string;
};

type ScheduleConfig = {
  weeklyHours: number;
  studyDays: string[];
  sessionLength: number;
  vacationRanges: { start: string; end: string }[];
};

const MATERIALS = [
  "Lecture slides / scripts",
  "Exercise sheets",
  "Exercise solutions",
  "Past exams",
  "Past exam solutions",
  "Existing summaries",
  "Cheatsheets",
];

const STUDY_PHASES = [
  "Theory recap",
  "Semester exercises",
  "Iterative exam solving",
  "Full exam solving",
  "Timed exam solving",
  "Mock exams",
  "Final revision",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function blank(): SubjectForm {
  return {
    name: "",
    examDate: "",
    examDuration: "",
    targetGrade: "",
    currentGrade: "",
    confidence: "",
    materials: [],
    mockCount: "",
    approach: "balanced",
    customPhases: [],
    cheatsheet: "",
    comments: "",
  };
}

const inputCls =
  "w-full rounded-xl bg-surface px-4 py-3 text-sm ring-1 ring-border focus:outline-none focus:ring-accent";

const labelCls = "block mb-1.5 text-sm font-medium";

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition-colors ${
        checked ? "bg-accent-soft ring-accent" : "bg-surface ring-border hover:ring-foreground/20"
      }`}
    >
      <input
        type="radio" name={name} value={value}
        checked={checked} onChange={onChange}
        className="sr-only"
      />
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-2 ${
          checked ? "bg-accent ring-accent" : "ring-border"
        }`}
      >
        {checked && <span className="size-2 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

// ─── Step components ─────────────────────────────────────────────────────────

function StepBasics({ s, set }: { s: SubjectForm; set: (k: keyof SubjectForm, v: SubjectForm[keyof SubjectForm]) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Subject name</label>
        <input
          className={inputCls} type="text" placeholder="e.g. Analysis II"
          value={s.name} onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Exam date</label>
          <input
            className={inputCls} type="date"
            value={s.examDate} onChange={(e) => set("examDate", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Exam duration (min)</label>
          <input
            className={inputCls} type="number" min={1} step={1} placeholder="180"
            value={s.examDuration} onChange={(e) => set("examDuration", e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Target grade (1–6)</label>
          <input
            className={inputCls} type="number" min={1} max={6} step={0.25} placeholder="5.5"
            value={s.targetGrade} onChange={(e) => set("targetGrade", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Current grade (1–6)</label>
          <input
            className={inputCls} type="number" min={1} max={6} step={0.25} placeholder="3.5"
            value={s.currentGrade} onChange={(e) => set("currentGrade", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function StepLevel({
  s, set,
}: {
  s: SubjectForm;
  set: (k: keyof SubjectForm, v: SubjectForm[keyof SubjectForm]) => void;
}) {
  function toggleMaterial(m: string) {
    const next = s.materials.includes(m)
      ? s.materials.filter((x) => x !== m)
      : [...s.materials, m];
    set("materials", next);
  }

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Semester comfort</label>
        <div className="space-y-2">
          {[
            { v: "very",   t: "Very comfortable" },
            { v: "mostly", t: "Mostly comfortable" },
            { v: "some",   t: "Some knowledge gaps" },
            { v: "little", t: "Not comfortable" },
          ].map(({ v, t }) => (
            <RadioCard
              key={v} name="confidence" value={v}
              checked={s.confidence === v}
              onChange={() => set("confidence", v)}
              title={t}
            />
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Available study materials</label>
        <div className="space-y-1.5">
          {MATERIALS.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 transition-colors ${
                s.materials.includes(m)
                  ? "bg-accent-soft ring-accent"
                  : "bg-surface ring-border"
              }`}
            >
              <input
                type="checkbox"
                checked={s.materials.includes(m)}
                onChange={() => toggleMaterial(m)}
                className="accent-accent"
              />
              <span className="text-sm">{m}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Past / practice exams available</label>
        <input
          className={inputCls} type="number" min={0} step={1} placeholder="3"
          value={s.mockCount} onChange={(e) => set("mockCount", e.target.value)}
        />
      </div>
    </div>
  );
}

function StepApproach({
  s, set,
}: {
  s: SubjectForm;
  set: (k: keyof SubjectForm, v: SubjectForm[keyof SubjectForm]) => void;
}) {
  function togglePhase(p: string) {
    const next = s.customPhases.includes(p)
      ? s.customPhases.filter((x) => x !== p)
      : [...s.customPhases, p];
    set("customPhases", next);
  }

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Study approach</label>
        <div className="space-y-2">
          {[
            { v: "foundation", t: "Build from the basics",   d: "Start with theory, revisit exercises, then past exams." },
            { v: "balanced",   t: "Revise & practice",       d: "Refresh theory while starting past-exam problems early." },
            { v: "exam",       t: "Exam-focused",            d: "Jump straight into past exams, revisit theory as needed." },
            { v: "custom",     t: "Custom approach",         d: "Pick the specific phases you want." },
          ].map(({ v, t, d }) => (
            <RadioCard
              key={v} name="approach" value={v}
              checked={s.approach === v}
              onChange={() => set("approach", v as StudyApproach)}
              title={t} description={d}
            />
          ))}
        </div>
      </div>

      {s.approach === "custom" && (
        <div>
          <label className={labelCls}>Study phases</label>
          <div className="space-y-1.5">
            {STUDY_PHASES.map((p) => (
              <label
                key={p}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 transition-colors ${
                  s.customPhases.includes(p)
                    ? "bg-accent-soft ring-accent"
                    : "bg-surface ring-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={s.customPhases.includes(p)}
                  onChange={() => togglePhase(p)}
                  className="accent-accent"
                />
                <span className="text-sm">{p}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>Cheatsheet strategy</label>
        <div className="space-y-2">
          {[
            { v: "none",     t: "No cheatsheet allowed" },
            { v: "existing", t: "I'll use an existing cheatsheet" },
            { v: "gradual",  t: "I'll build it gradually during revision" },
            { v: "end",      t: "I'll write it towards the end" },
          ].map(({ v, t }) => (
            <RadioCard
              key={v} name="cheatsheet" value={v}
              checked={s.cheatsheet === v}
              onChange={() => set("cheatsheet", v)}
              title={t}
            />
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Anything else? (optional)</label>
        <textarea
          className={inputCls} rows={3}
          placeholder="Priorities, difficulties, preferences…"
          value={s.comments}
          onChange={(e) => set("comments", e.target.value)}
        />
      </div>
    </div>
  );
}

function StepSchedule({
  cfg, setCfg,
}: {
  cfg: ScheduleConfig;
  setCfg: (c: ScheduleConfig) => void;
}) {
  function toggleDay(d: string) {
    const next = cfg.studyDays.includes(d)
      ? cfg.studyDays.filter((x) => x !== d)
      : [...cfg.studyDays, d];
    setCfg({ ...cfg, studyDays: next });
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        We need your schedule to generate sessions. These come from your original plan settings.
      </p>

      <div>
        <label className={labelCls}>Weekly study hours</label>
        <input
          className={inputCls} type="number" min={1} max={100} step={1}
          value={cfg.weeklyHours}
          onChange={(e) => setCfg({ ...cfg, weeklyHours: Number(e.target.value) })}
        />
      </div>

      <div>
        <label className={labelCls}>Study days</label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button
              key={d} type="button"
              onClick={() => toggleDay(d)}
              className={`rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors ${
                cfg.studyDays.includes(d)
                  ? "bg-accent text-white ring-accent"
                  : "bg-surface ring-border"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Session length (minutes)</label>
        <div className="flex gap-2">
          {[60, 90, 120].map((n) => (
            <button
              key={n} type="button"
              onClick={() => setCfg({ ...cfg, sessionLength: n })}
              className={`flex-1 rounded-full py-2 text-sm font-medium ring-1 transition-colors ${
                cfg.sessionLength === n
                  ? "bg-accent text-white ring-accent"
                  : "bg-surface ring-border"
              }`}
            >
              {n} min
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

export function AddSubjectWizard({
  planId,
  storedConfig,
  onDone,
  onClose,
}: {
  planId: string;
  storedConfig: ScheduleConfig | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const needsSchedule = !storedConfig;
  const TOTAL_STEPS = needsSchedule ? 4 : 3;

  const [step, setStep] = useState(1);
  const [subject, setSubject] = useState<SubjectForm>(blank());
  const [schedCfg, setSchedCfg] = useState<ScheduleConfig>(
    storedConfig ?? {
      weeklyHours: 30,
      studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      sessionLength: 90,
      vacationRanges: [],
    },
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; breakdown: Record<string, number>; warnings?: string[] } | null>(null);

  function update<K extends keyof SubjectForm>(k: K, v: SubjectForm[K]) {
    setSubject((prev) => ({ ...prev, [k]: v }));
  }

  // Which content step is this? (1-indexed, schedule step is first if needed)
  const contentStep = needsSchedule ? step - 1 : step;

  function canAdvance(): boolean {
    if (needsSchedule && step === 1) {
      return schedCfg.studyDays.length > 0 && schedCfg.weeklyHours > 0;
    }
    if (contentStep === 1) {
      return (
        !!subject.name.trim() &&
        !!subject.examDate &&
        Number(subject.examDuration) > 0 &&
        Number(subject.targetGrade) >= 1 && Number(subject.targetGrade) <= 6 &&
        Number(subject.currentGrade) >= 1 && Number(subject.currentGrade) <= 6
      );
    }
    if (contentStep === 2) {
      return (
        !!subject.confidence &&
        subject.mockCount !== "" &&
        Number(subject.mockCount) >= 0 &&
        Number.isInteger(Number(subject.mockCount))
      );
    }
    if (contentStep === 3) {
      return (
        !!subject.cheatsheet &&
        (subject.approach !== "custom" || subject.customPhases.length > 0)
      );
    }
    return true;
  }

  function handleSubmit() {
    startTransition(async () => {
      setError(null);
      try {
        const body: Record<string, unknown> = { subject };
        if (needsSchedule) body.scheduleConfig = schedCfg;

        const res = await fetch(`/api/plans/${planId}/subjects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? `Error ${res.status}`);
          return;
        }
        setResult(await res.json());
      } catch {
        setError("Network error — please try again");
      }
    });
  }

  const stepTitles = needsSchedule
    ? ["Schedule", "Subject", "Level & resources", "Study approach"]
    : ["Subject", "Level & resources", "Study approach"];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button
          onClick={result ? onDone : onClose}
          className="rounded-full p-1 text-muted hover:text-foreground"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Add subject</p>
          <p className="text-sm font-semibold">
            {result ? "Done!" : stepTitles[step - 1]}
          </p>
        </div>
        {/* Step dots */}
        {!result && (
          <div className="flex gap-1.5">
            {stepTitles.map((_, i) => (
              <span
                key={i}
                className={`size-2 rounded-full transition-colors ${
                  i + 1 === step ? "bg-accent" : i + 1 < step ? "bg-accent/40" : "bg-surface-2"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {result ? (
          <div className="space-y-6 py-8 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-accent-soft">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="size-8 text-accent">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold">Subject added!</h2>
              <p className="mt-2 text-muted">
                {result.count} sessions generated for {subject.name}.
              </p>
            </div>
            <div className="rounded-2xl bg-surface p-4 text-left">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Breakdown</p>
              <ul className="space-y-1">
                {Object.entries(result.breakdown).map(([subj, n]) => (
                  <li key={subj} className="flex items-center justify-between text-sm">
                    <span>{subj}</span>
                    <span className="font-semibold tabular-nums text-muted">{n} sessions</span>
                  </li>
                ))}
              </ul>
            </div>
            {!!result.warnings?.length && (
              <ul className="space-y-1 rounded-2xl bg-red-500/10 p-4 text-left text-sm text-red-600">
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <button
              onClick={onDone}
              className="rounded-full bg-accent px-8 py-3 font-semibold text-white"
            >
              View plan
            </button>
          </div>
        ) : (
          <>
            {needsSchedule && step === 1 && (
              <StepSchedule cfg={schedCfg} setCfg={setSchedCfg} />
            )}
            {contentStep === 1 && <StepBasics s={subject} set={update} />}
            {contentStep === 2 && <StepLevel s={subject} set={update} />}
            {contentStep === 3 && <StepApproach s={subject} set={update} />}
          </>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* Footer */}
      {!result && (
        <div className="border-t border-border px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-30"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canAdvance() || pending}
              className="w-full rounded-full bg-accent py-3 text-sm font-semibold text-white disabled:opacity-30"
            >
              {pending ? "Generating…" : "Generate schedule"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
