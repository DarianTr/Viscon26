
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    DEFAULT_FOCUS_DAYS,
    DEFAULT_START_TIME,
    RHYTHMS,
    dailyBufferMinutes,
    dailyWindowMinutes,
    generateStudyPlan,
    previewDay,
} from "@/lib/scheduler";
import type { LernphaseStart, PlanConfig, PlanFeasibility, ScheduleResult, StudyRhythm } from "@/lib/scheduler";
import type { StoredPlanConfig } from "@/db/schema";

/** What step 7 shows, for a new plan or a managed (regenerated) one. */
type Summary = {
    count: number;
    firstDate: Date | null;
    lastDate: Date | null;
    breakdown: Record<string, number>;
    warnings: string[];
    feasibility: PlanFeasibility;
    /** Managing an existing plan: uncompleted blocks replaced, completed ones kept. */
    replaced?: number;
    kept?: number;
    /** Blocks moved by hand: kept in place, or replaced because the new settings rule them out. */
    manualKept?: number;
    manualReplaced?: number;
};

const lernphaseOptions: { value: LernphaseStart; title: string; description: string }[] = [
    {
        value: "recommended",
        title: "Recommended",
        description: "Focus days for subjects that need substantial theory revision; the rest rotate from day one.",
    },
    {
        value: "focus",
        title: "Dedicated focus days",
        description: "Start with one subject at a time, then switch to mixed days.",
    },
    {
        value: "mixed",
        title: "Mixed preparation",
        description: "Rotate subjects from the beginning.",
    },
];

type StudyApproach = "foundation" | "balanced" | "exam" | "custom";

type Subject = {
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
    completed: boolean;
};

type VacationRange = {
    start: string;
    end: string;
};

const createSubject = (): Subject => ({
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
    completed: false,
});

const studyPhases = [
    "Theory recap",
    "Semester exercises",
    "Iterative exam solving",
    "Full exam solving",
    "Timed exam solving",
    "Mock exams",
    "Final revision",
];

const formatHours = (minutes: number) => `${Math.round(minutes / 60)} h`;

/** Minutes after midnight → "HH:MM". */
const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Per subject: how many of the available mocks are planned, and how many wait in reserve. */
function MockPlanList({ subjects }: { subjects: PlanFeasibility["subjects"] }) {
    const withMocks = subjects.filter((s) => s.mocks.available > 0);
    if (withMocks.length === 0) return null;
    return (
        <div className="space-y-2 rounded-xl bg-surface-2 p-4">
            <p className="text-sm font-semibold">Mock exams</p>
            {withMocks.map((s) => (
                <div key={s.name} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                        <span>{s.name}</span>
                        <span className="tabular-nums text-muted">
                            {s.mocks.planned} of {s.mocks.available} planned
                            {s.mocks.reserve > 0 && ` · ${s.mocks.reserve} in reserve`}
                        </span>
                    </div>
                    <p className="text-xs text-muted">{s.mocks.reason}</p>
                </div>
            ))}
            <p className="text-xs text-muted">
                Reserve mocks are added if your results show you need more practice.
            </p>
        </div>
    );
}

const segmentLabels: Record<string, string> = {
    study: "Study",
    short_break: "Break",
    lunch: "Lunch",
    dinner: "Dinner",
    buffer: "Buffer / catch-up",
};

const subjectColors = [
    "#F2A7C4", // Braina pink
    "#D6D6B1", // Pearl beige
    "#BFE1DE", // Soft teal tint
    "#F2CB8C", // Warm gold tint
    "#F0B7A8", // Soft brick tint
    "#C7D2DD", // Soft slate tint
    "#E8C9D6", // Blush
    "#D9C3BB", // Dusty taupe
];

// useSearchParams needs a Suspense boundary for the page to prerender.
export default function NewPlanPage() {
    return (
        <Suspense>
            <NewPlanForm />
        </Suspense>
    );
}

function NewPlanForm() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Navigation
    const [step, setStep] = useState(1);

    // "Manage plan": /plans/new?edit=<id> loads that plan's answers into this form.
    const editId = searchParams.get("edit");
    const [loadingPlan, setLoadingPlan] = useState(!!editId);

    // The open subject lives in the URL (?subject=N) so the browser
    // back button returns to the subject overview.
    const subjectParam = searchParams.get("subject");
    const activeSubject = subjectParam === null ? -1 : Number(subjectParam);

    // Form state is not persisted, so drop a stale ?subject on reload.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.has("subject")) {
            params.delete("subject");
            window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
        }
    }, []);


    // STEP 1
    const [planName, setPlanName] = useState("");
    const [subjectCount, setSubjectCount] = useState("");

    // STEP 2
    const [weeklyHours, setWeeklyHours] = useState(30);
    const [studyDays, setStudyDays] = useState<string[]>([
        "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
    ]);
    const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
    const [rhythm, setRhythm] = useState<StudyRhythm>("balanced");
    const [lernphaseStart, setLernphaseStart] = useState<LernphaseStart>("recommended");
    const [focusDays, setFocusDays] = useState(DEFAULT_FOCUS_DAYS);
    // Regular sessions are one block of the chosen rhythm.
    const sessionLength = RHYTHMS[rhythm].block;
    const [vacationRanges, setVacationRanges] = useState<VacationRange[]>([]);

    // STEPS 3-5
    const [subjects, setSubjects] = useState<Subject[]>([]);

    const averageHoursPerDay = studyDays.length
        ? weeklyHours / studyDays.length
        : 0;

    // Each study day ends with a buffer that isn't focused study.
    const dailyBufferHours =
        dailyBufferMinutes(dailyWindowMinutes({ weeklyHours, studyDays })) / 60;

    // What a standard study day looks like with these settings.
    const dayPreview = studyDays.length
        ? previewDay({ weeklyHours, studyDays, startTime, rhythm, sessionLength })
        : null;
    const pauseMinutes = dayPreview?.segments
        .filter((seg) => seg.activity !== "study" && seg.activity !== "buffer")
        .reduce((total, seg) => total + seg.minutes, 0) ?? 0;

    const validVacationRanges = vacationRanges.every(
        (r) => r.start && r.end && r.end >= r.start
    );

    const allSubjectsComplete =
        subjects.length > 0 && subjects.every((s) => s.completed);

    const completedCount = subjects.filter((s) => s.completed).length;

    const subject = step === 3 ? subjects[activeSubject] : undefined;

    const inputClass =
        "w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent";

    const cardClass =
        "space-y-6 rounded-[1.75rem] border-2 border-border bg-surface p-6 shadow-[0_3px_0_0_var(--border)]";

    const primaryButton =
        "rounded-full border-[2.5px] border-foreground bg-accent px-6 py-3 text-sm font-display font-bold text-surface shadow-[0_3px_0_0_var(--foreground)] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none";

    const secondaryButton =
        "rounded-full border-2 border-foreground/70 bg-surface px-6 py-3 text-sm font-display font-bold shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none";

    const [distribution, setDistribution] = useState<number[]>([]);
    const [recommendedDistribution, setRecommendedDistribution] =
        useState<number[]>([]);

    // STEP 7 — generation state
    const [isGenerating, setIsGenerating] = useState(false);
    const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
    const [generationError, setGenerationError] = useState<string | null>(null);
    // Saved once the user accepts the plan (straight away when it fits).
    const [planSaved, setPlanSaved] = useState(false);
    const [summary, setSummary] = useState<Summary | null>(null);
    // "Continue anyway" on a plan that needs more time.
    const [acceptedShortfall, setAcceptedShortfall] = useState(false);
    // The workload is sized from the first generation's hours, so adjusting
    // availability afterwards actually closes a gap.
    const [workloadBasis, setWorkloadBasis] = useState<number | null>(null);

    // Managing a plan: fill the form with its stored answers and start at availability.
    useEffect(() => {
        if (!editId) return;
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(`/api/plans/${editId}`);
                if (!response.ok) throw new Error(`Couldn't load this plan (HTTP ${response.status})`);
                const { title, config } = (await response.json()) as { title: string; config: StoredPlanConfig | null };
                if (cancelled) return;
                if (!config?.subjects?.length) throw new Error("This plan was created before plans stored their settings, so it can't be edited here.");
                setPlanName(title);
                setSubjectCount(String(config.subjects.length));
                setWeeklyHours(config.weeklyHours);
                setStudyDays(config.studyDays);
                setStartTime(config.startTime ?? (config.preferredStartHour !== undefined
                    ? `${String(config.preferredStartHour).padStart(2, "0")}:00`
                    : DEFAULT_START_TIME));
                setRhythm(config.rhythm ?? "balanced");
                setLernphaseStart(config.lernphaseStart ?? "recommended");
                setFocusDays(config.focusDays ?? DEFAULT_FOCUS_DAYS);
                setVacationRanges(config.vacationRanges);
                setSubjects(config.subjects.map((stored) => ({
                    ...createSubject(),
                    ...stored,
                    approach: stored.approach as StudyApproach,
                    completed: true,
                })));
                // Keep the stored split: no "recommended" baseline means it counts as customised.
                setDistribution(config.subjects.map((stored) => stored.allocation));
                setRecommendedDistribution([]);
                setWorkloadBasis(config.workloadBasisWeeklyMinutes ?? null);
                setStep(2);
            } catch (err) {
                if (!cancelled) setGenerationError(err instanceof Error ? err.message : "Unknown error");
            } finally {
                if (!cancelled) setLoadingPlan(false);
            }
        })();
        return () => { cancelled = true; };
    }, [editId]);


    // Update a single subject without losing other subjects' answers.
    function updateSubject<K extends keyof Subject>(
        key: K,
        value: Subject[K]
    ) {
        setSubjects((previous) =>
            previous.map((s, i) =>
                i === activeSubject
                    ? { ...s, [key]: value, completed: false }
                    : s
            )
        );
    }

    // Generate subject cards from Step 1.
    function initializeSubjects() {
        const count = Number(subjectCount);

        setSubjects((previous) =>
            Array.from(
                { length: count },
                (_, i) => previous[i] ?? createSubject()
            )
        );

        setStep(2);
    }

    function openSubject(index: number) {
        window.history.pushState(null, "", `?${editId ? `edit=${editId}&` : ""}subject=${index}`);
        window.scrollTo({ top: 0 });
    }

    // The subject page is always pushed from the overview,
    // so going back in history returns there.
    function closeSubject() {
        window.history.back();
    }

    function finishSubject() {
        setSubjects((previous) =>
            previous.map((s, i) =>
                i === activeSubject ? { ...s, completed: true } : s
            )
        );

        closeSubject();
    }

    const validSubject =
        !!subject?.name.trim() &&
        !!subject.examDate &&
        Number(subject.examDuration) > 0 &&
        Number(subject.targetGrade) >= 1 &&
        Number(subject.targetGrade) <= 6 &&
        Number(subject.currentGrade) >= 1 &&
        Number(subject.currentGrade) <= 6 &&
        !!subject.confidence &&
        subject.mockCount !== "" &&
        Number(subject?.mockCount) >= 0 &&
        Number.isInteger(Number(subject?.mockCount)) &&
        !!subject?.cheatsheet &&
        (subject?.approach !== "custom" ||
            subject.customPhases.length > 0);


    // Convert weights into whole percentages that total exactly 100.
    function allocatePercentages(
        weights: number[],
        total: number = 100
    ): number[] {
        if (weights.length === 0) return [];

        const sum = weights.reduce((a, b) => a + b, 0);

        const normalized = weights.map((w) =>
            sum > 0
                ? (Math.max(0, w) / sum) * total
                : total / weights.length
        );

        const result = normalized.map(Math.floor);

        const remainder =
            total - result.reduce((a, b) => a + b, 0);

        const order = normalized
            .map((value, i) => ({
                index: i,
                fraction: value - result[i],
            }))
            .sort((a, b) => b.fraction - a.fraction);

        for (let i = 0; i < remainder; i++) {
            result[order[i].index] += 1;
        }

        return result;
    }

    // Suggest distribution based on the grade gap
    // and how soon each exam takes place.
    function calculateRecommendedDistribution(): number[] {
        const today = new Date();

        const weights = subjects.map((s) => {
            const gradeGap = Math.max(
                0,
                Number(s.targetGrade) - Number(s.currentGrade)
            );

            const examDate = new Date(`${s.examDate}T12:00:00`);

            const daysUntilExam = Math.max(
                1,
                Math.ceil(
                    (examDate.getTime() - today.getTime()) / 86400000
                )
            );

            const urgency = 1 + 14 / Math.max(7, daysUntilExam);

            return (1 + gradeGap) * urgency;
        });

        return allocatePercentages(weights);
    }

    // Open Step 6 with the recommended distribution, keeping one the user
    // already adjusted (e.g. when coming back via "Adjust my plan").
    function openDistribution() {
        const recommended = calculateRecommendedDistribution();
        const customized =
            distribution.length === subjects.length &&
            distribution.some((value, i) => value !== recommendedDistribution[i]);

        setRecommendedDistribution(recommended);
        if (!customized) setDistribution([...recommended]);
        setStep(6);
    }

    // Adjust one subject while keeping the total at 100%.
    function changeAllocation(index: number, newValue: number) {
        setDistribution((previous) => {
            if (previous.length <= 1) return [100];

            const updated = [...previous];
            const selectedValue = Math.max(
                0,
                Math.min(100, newValue)
            );

            const remaining = 100 - selectedValue;

            const otherIndices = previous
                .map((_, i) => i)
                .filter((i) => i !== index);

            const otherWeights = otherIndices.map(
                (i) => previous[i]
            );

            const redistributed = allocatePercentages(
                otherWeights,
                remaining
            );

            updated[index] = selectedValue;

            otherIndices.forEach((i, position) => {
                updated[i] = redistributed[position];
            });

            return updated;
        });
    }

    // Build the schedule; save it right away unless the goals need more time.
    /** The plan's settings, as stored with the plan. */
    function storedConfig(basis: number | null): StoredPlanConfig {
        return {
            weeklyHours,
            studyDays,
            sessionLength,
            startTime,
            rhythm,
            lernphaseStart,
            focusDays,
            vacationRanges,
            ...(basis !== null ? { workloadBasisWeeklyMinutes: basis } : {}),
            subjects: subjects.map(({ completed: _, ...subject }, index) => ({
                ...subject,
                allocation: distribution[index] ?? 0,
            })),
        };
    }

    // Build the schedule; save it right away unless the goals need more time
    // or an existing plan's remaining schedule would be replaced.
    async function generatePlan() {
        setScheduleResult(null);
        setSummary(null);
        setGenerationError(null);
        setPlanSaved(false);
        setAcceptedShortfall(false);
        setIsGenerating(true);
        setStep(7);

        try {
            if (editId) {
                // Managing a plan: the server regenerates around completed work. Preview first.
                const preview = await regenerate(false);
                setSummary(preview);
                setIsGenerating(false);
                return;
            }

            const config: PlanConfig = { planName, ...storedConfig(workloadBasis), subjects: storedConfig(workloadBasis).subjects! };
            // Schedule around what's already on the calendar (e.g. other plans).
            const lastExam = subjects.reduce((max, s) => (s.examDate > max ? s.examDate : max), "");
            const params = new URLSearchParams({
                from: new Date().toISOString(),
                to: new Date(`${lastExam}T23:59:59`).toISOString(),
            });
            const response = await fetch(`/api/tasks/busy?${params}`);
            if (!response.ok) throw new Error(`Couldn't load your calendar (HTTP ${response.status})`);
            const { busy } = await response.json();
            const result = generateStudyPlan(config, new Date(), { busy });

            setWorkloadBasis(result.workloadBasisWeeklyMinutes);
            setScheduleResult(result);
            setSummary({
                count: result.sessions.length,
                firstDate: result.firstDate,
                lastDate: result.lastDate,
                breakdown: result.breakdown,
                warnings: result.warnings,
                feasibility: result.feasibility,
            });

            if (result.feasibility.needsMoreTime) setIsGenerating(false);
            else void savePlan(result);
        } catch (err) {
            setGenerationError(err instanceof Error ? err.message : "Unknown error");
            setIsGenerating(false);
        }
    }

    /** Regenerates the managed plan on the server: a preview, or for real. */
    async function regenerate(apply: boolean): Promise<Summary> {
        const response = await fetch(`/api/plans/${editId}/regenerate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: planName, config: storedConfig(workloadBasis), apply }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        const data = await response.json();
        return {
            count: data.created,
            firstDate: data.firstDate ? new Date(data.firstDate) : null,
            lastDate: data.lastDate ? new Date(data.lastDate) : null,
            breakdown: data.breakdown,
            warnings: data.warnings,
            feasibility: data.feasibility,
            replaced: data.replaced,
            kept: data.kept,
            manualKept: data.manualKept,
            manualReplaced: data.manualReplaced,
        };
    }

    // Managing a plan: replace its uncompleted schedule after the user confirmed.
    async function applyChanges() {
        setIsGenerating(true);
        setGenerationError(null);
        try {
            setSummary(await regenerate(true));
            setPlanSaved(true);
        } catch (err) {
            setGenerationError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setIsGenerating(false);
        }
    }

    // "Continue anyway": keep the best-effort schedule.
    function continueAnyway() {
        setAcceptedShortfall(true);
        if (!editId && scheduleResult) void savePlan(scheduleResult);
    }

    // Back to the availability step with every answer kept.
    function adjustPlan() {
        setScheduleResult(null);
        setSummary(null);
        setGenerationError(null);
        setStep(2);
        window.scrollTo({ top: 0 });
    }

    async function savePlan(result: ScheduleResult) {
        setIsGenerating(true);
        setGenerationError(null);

        try {
            const response = await fetch("/api/tasks/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    planTitle: planName,
                    planConfig: {
                        ...storedConfig(result.workloadBasisWeeklyMinutes),
                        planStart: result.planStart,
                        focusDates: result.focusDates,
                    },
                    tasks: result.sessions.map((s) => ({
                        type: s.type,
                        subject: s.subject,
                        title: s.title,
                        detail: s.detail,
                        scheduledAt: s.scheduledAt.toISOString(),
                        plannedMinutes: s.plannedMinutes,
                        activity: s.activity,
                        cheatsheetTarget: s.cheatsheetTarget ?? null,
                        cheatsheetMinutes: s.cheatsheetMinutes ?? null,
                        shared: false,
                    })),
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || `HTTP ${response.status}`);
            }

            setPlanSaved(true);
        } catch (err) {
            setGenerationError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setIsGenerating(false);
        }
    }


    return (
        <main className="mx-auto max-w-2xl space-y-8 px-4 py-10 pb-24">
            {/* Back to plans */}
            <button
                type="button"
                onClick={() => router.push("/plans")}
                className="text-sm text-muted hover:underline"
            >
                ← Back to plans
            </button>

            {/* Page heading */}
            <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                    {editId ? "Manage plan" : "Custom study plan"}
                </p>

                <h1 className="mt-2 text-3xl font-bold">
                    {editId ? (planName || "Your study plan") : <>Let&apos;s create your study plan</>}
                </h1>

                <p className="mt-2 text-sm text-muted">
                    {editId
                        ? "Change any of your answers. Completed sessions and logged results stay; only the remaining schedule is rebuilt."
                        : "Build your personalized exam preparation schedule."}
                </p>
            </div>

            {editId && loadingPlan && (
                <div className={cardClass}>
                    <p className="text-sm text-muted">Loading your plan…</p>
                </div>
            )}
            {editId && !loadingPlan && generationError && step !== 7 && (
                <div className={cardClass}>
                    <p className="text-sm text-red-600">{generationError}</p>
                </div>
            )}


            {/* STEP 1 — GENERAL INFORMATION */}
            {step === 1 && (
                <div className={cardClass}>
                    <h2 className="text-xl font-bold">
                        Your study plan
                    </h2>

                    <div>
                        <label htmlFor="planName" className="mb-2 block text-sm font-semibold">
                            Name your plan
                        </label>

                        <input
                            id="planName"
                            type="text"
                            placeholder="e.g. Winter Exams 2027"
                            value={planName}
                            onChange={(e) => setPlanName(e.target.value)}
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label htmlFor="subjectCount" className="mb-2 block text-sm font-semibold">
                            How many subjects are you preparing for?
                        </label>

                        <input
                            id="subjectCount"
                            type="number"
                            min="1"
                            max="20"
                            placeholder="e.g. 4"
                            value={subjectCount}
                            onChange={(e) => setSubjectCount(e.target.value)}
                            className={inputClass}
                        />
                    </div>

                    <button
                        type="button"
                        disabled={
                            !planName.trim() ||
                            !Number.isInteger(Number(subjectCount)) ||
                            Number(subjectCount) < 1 ||
                            Number(subjectCount) > 20
                        }
                        onClick={initializeSubjects}
                        className={`${primaryButton} w-full`}
                    >
                        Next →
                    </button>
                </div>
            )}

            {/* STEP 2 — STUDY AVAILABILITY */}
            {step === 2 && (
                <div className={cardClass}>
                    <div>
                        <h2 className="text-xl font-bold">
                            Your study availability
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                            Tell us how much time you can dedicate to studying.
                        </p>
                    </div>

                    {/* Weekly hours */}
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <label htmlFor="weeklyHours" className="text-sm font-semibold">
                                How many focused hours can you study per week?
                            </label>
                            <span className="text-xl font-bold">
                                {weeklyHours}h
                            </span>
                        </div>

                        <input
                            id="weeklyHours"
                            type="range"
                            min="1"
                            max="70"
                            value={weeklyHours}
                            onChange={(e) => setWeeklyHours(Number(e.target.value))}
                            className="mt-4 w-full accent-foreground"
                        />
                    </div>

                    {/* Available days */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            Which days are you available?
                        </p>

                        <div className="grid grid-cols-7 gap-2">
                            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                                (day) => (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() =>
                                            setStudyDays((prev) =>
                                                prev.includes(day)
                                                    ? prev.filter((d) => d !== day)
                                                    : [...prev, day]
                                            )
                                        }
                                        className={`rounded-xl border px-1 py-3 text-xs font-medium ${studyDays.includes(day)
                                                ? "border-foreground bg-foreground text-background"
                                                : "border-border"
                                            }`}
                                    >
                                        {day}
                                    </button>
                                )
                            )}
                        </div>
                    </div>

                    {/* Session length */}
                    <div>
                        <label htmlFor="startTime" className="mb-2 block text-sm font-semibold">
                            When do you want to start studying?
                        </label>
                        <input
                            id="startTime"
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value || DEFAULT_START_TIME)}
                            className={inputClass}
                        />
                    </div>

                    {/* Study rhythm */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            Preferred study rhythm
                        </p>

                        <div className="space-y-3">
                            {(Object.keys(RHYTHMS) as StudyRhythm[]).map((key) => (
                                <label
                                    key={key}
                                    className="flex items-start gap-3 text-sm"
                                >
                                    <input
                                        type="radio"
                                        name="rhythm"
                                        checked={rhythm === key}
                                        onChange={() => setRhythm(key)}
                                        className="mt-1 accent-foreground"
                                    />
                                    <span>
                                        <span className="font-medium">{RHYTHMS[key].label}</span>
                                        <span className="block text-xs text-muted">
                                            {RHYTHMS[key].blurb} Lunch and dinner are added when your day runs through them.
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* How the Lernphase starts */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            How would you like to start your Lernphase?
                        </p>
                        <div className="space-y-3">
                            {lernphaseOptions.map((option) => (
                                <label key={option.value} className="flex items-start gap-3 text-sm">
                                    <input
                                        type="radio"
                                        name="lernphaseStart"
                                        checked={lernphaseStart === option.value}
                                        onChange={() => setLernphaseStart(option.value)}
                                        className="mt-1 accent-foreground"
                                    />
                                    <span>
                                        <span className="font-medium">{option.title}</span>
                                        <span className="block text-xs text-muted">{option.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        {lernphaseStart !== "mixed" && (
                            <label className="mt-4 flex items-center gap-3 text-sm">
                                <span>Focus days per subject</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={focusDays}
                                    onChange={(e) => setFocusDays(Math.min(10, Math.max(1, Number(e.target.value) || DEFAULT_FOCUS_DAYS)))}
                                    className="w-20 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                                />
                                <span className="text-xs text-muted">study days, skipping days off and vacations</span>
                            </label>
                        )}
                    </div>

                    {/* Average hours */}
                    <div className="rounded-xl bg-surface-2 p-5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                            Your schedule
                        </p>

                        <p className="mt-2 text-2xl font-bold">
                            {studyDays.length
                                ? `${averageHoursPerDay.toFixed(1)} hours/day`
                                : "Select your study days"}
                        </p>

                        <p className="mt-1 text-xs text-muted">
                            Average hours per selected study day
                            {studyDays.length > 0 && (
                                <>
                                    {" "}— {(averageHoursPerDay - dailyBufferHours).toFixed(1)}h
                                    focused study + {dailyBufferHours.toFixed(1)}h buffer / catch-up time
                                    {pauseMinutes > 0 && <>, plus {(pauseMinutes / 60).toFixed(1)}h of breaks and meals</>}
                                </>
                            )}
                        </p>

                        {/* A typical day — every block can still be moved in the calendar later. */}
                        {dayPreview && dayPreview.segments.length > 0 && (
                            <ol className="mt-4 space-y-1 text-xs">
                                {dayPreview.segments.map((seg) => (
                                    <li key={seg.start} className="flex gap-3">
                                        <span className="w-24 shrink-0 font-mono tabular-nums text-muted">
                                            {clock(seg.start)}–{clock(seg.start + seg.minutes)}
                                        </span>
                                        <span className={seg.activity === "study" ? "font-medium" : "text-muted"}>
                                            {segmentLabels[seg.activity] ?? seg.activity}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>

                    {/* Vacation periods */}
                    <div className="space-y-4 border-t border-border pt-6">
                        <div>
                            <p className="text-sm font-semibold">
                                Vacation days
                            </p>
                            <p className="mt-1 text-xs text-muted">
                                Add periods when you won&apos;t be studying.
                            </p>
                        </div>

                        {vacationRanges.map((range, index) => (
                            <div
                                key={index}
                                className="space-y-3 rounded-xl border border-border p-4"
                            >
                                <div className="flex justify-between">
                                    <p className="text-sm font-semibold">
                                        Vacation {index + 1}
                                    </p>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setVacationRanges((prev) =>
                                                prev.filter((_, i) => i !== index)
                                            )
                                        }
                                        className="text-xs text-red-500"
                                    >
                                        Remove
                                    </button>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-2">
                                        <span className="block text-xs text-muted">
                                            Start date
                                        </span>
                                        <input
                                            type="text"
                                            placeholder="YYYY-MM-DD"
                                            value={range.start}
                                            onChange={(e) =>
                                                setVacationRanges((prev) =>
                                                    prev.map((r, i) =>
                                                        i === index
                                                            ? { ...r, start: e.target.value }
                                                            : r
                                                    )
                                                )
                                            }
                                            className={inputClass}
                                        />
                                    </label>

                                    <label className="space-y-2">
                                        <span className="block text-xs text-muted">
                                            End date
                                        </span>
                                        <input
                                            type="text"
                                            placeholder="YYYY-MM-DD"
                                            value={range.end}
                                            onChange={(e) =>
                                                setVacationRanges((prev) =>
                                                    prev.map((r, i) =>
                                                        i === index
                                                            ? { ...r, end: e.target.value }
                                                            : r
                                                    )
                                                )
                                            }
                                            className={inputClass}
                                        />
                                    </label>
                                </div>
                            </div>
                        ))}

                        <button
                            type="button"
                            onClick={() =>
                                setVacationRanges((prev) => [
                                    ...prev,
                                    { start: "", end: "" },
                                ])
                            }
                            className={secondaryButton}
                        >
                            + Add vacation period
                        </button>
                    </div>

                    <div className="flex justify-between pt-2">
                        <button
                            type="button"
                            onClick={() => setStep(1)}
                            className={secondaryButton}
                        >
                            ← Previous
                        </button>

                        <button
                            type="button"
                            disabled={!studyDays.length || !validVacationRanges}
                            onClick={() => setStep(3)}
                            className={primaryButton}
                        >
                            Next →
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 3 — SUBJECT OVERVIEW */}
            {step === 3 && !subject && (
                <div className={cardClass}>
                    <div>
                        <h2 className="text-xl font-bold">
                            Your subjects
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                            Set up each subject individually.
                        </p>
                        <p className="mt-2 text-sm font-medium">
                            {completedCount} of {subjects.length} completed
                        </p>
                    </div>

                    {/* Progress */}
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div
                            className="h-full rounded-full bg-foreground transition-all"
                            style={{
                                width: `${subjects.length
                                        ? (completedCount / subjects.length) * 100
                                        : 0
                                    }%`,
                            }}
                        />
                    </div>

                    {/* Subject cards */}
                    <div className="grid gap-4 sm:grid-cols-2">
                        {subjects.map((s, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => openSubject(index)}
                                style={{
                                    backgroundColor:
                                        subjectColors[index % subjectColors.length],
                                }}
                                className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-black/10 p-5 text-center text-gray-900 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
                            >
                                <span className="text-lg font-bold">
                                    {s.name || `Subject ${index + 1}`}
                                </span>

                                <span
                                    className={`flex size-14 items-center justify-center rounded-full text-3xl ${s.completed
                                            ? "bg-white/75 text-green-700"
                                            : "bg-white/50 text-gray-900"
                                        }`}
                                >
                                    {s.completed ? "✓" : "+"}
                                </span>

                                <span className="text-sm font-medium text-gray-700">
                                    {s.completed
                                        ? "Completed · Click to edit"
                                        : "Click to set up"}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Navigation */}
                    <div className="flex justify-between pt-2">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            className={secondaryButton}
                        >
                            ← Previous
                        </button>

                        <button
                            type="button"
                            disabled={!allSubjectsComplete}
                            onClick={openDistribution}
                            className={primaryButton}
                        >
                            Next →
                        </button>
                    </div>

                    {!allSubjectsComplete && (
                        <p className="text-center text-xs text-muted">
                            Complete all subjects to continue.
                        </p>
                    )}
                </div>
            )}

            {/* SUBJECT SETUP (?subject=N) */}
            {subject && (
                <div className={cardClass}>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                            Subject {activeSubject + 1} of {subjects.length}
                        </p>
                        <h2 className="mt-2 text-xl font-bold">
                            Subject details
                        </h2>
                    </div>

                    {/* Subject name */}
                    <div>
                        <label htmlFor="subjectName" className="mb-2 block text-sm font-semibold">
                            Subject name
                        </label>
                        <input
                            id="subjectName"
                            type="text"
                            value={subject.name}
                            placeholder="e.g. Analysis II"
                            onChange={(e) => updateSubject("name", e.target.value)}
                            className={inputClass}
                        />
                    </div>

                    {/* Exam date */}
                    <div>
                        <label htmlFor="examDate" className="mb-2 block text-sm font-semibold">
                            Exam date
                        </label>
                        <input
                            id="examDate"
                            type="date"
                            value={subject.examDate}
                            onChange={(e) =>
                                updateSubject("examDate", e.target.value)
                            }
                            className={inputClass}
                        />
                    </div>

                    {/* Target grade */}
                    <div>
                        <label htmlFor="targetGrade" className="mb-2 block text-sm font-semibold">
                            Target grade
                        </label>
                        <input
                            id="targetGrade"
                            type="number"
                            min="1"
                            max="6"
                            step="0.25"
                            value={subject.targetGrade}
                            placeholder="e.g. 5.5"
                            onChange={(e) =>
                                updateSubject("targetGrade", e.target.value)
                            }
                            className={inputClass}
                        />
                    </div>

                    {/* Current grade */}
                    <div>
                        <label htmlFor="currentGrade" className="mb-2 block text-sm font-semibold">
                            What grade would you get if the exam were tomorrow?
                        </label>
                        <input
                            id="currentGrade"
                            type="number"
                            min="1"
                            max="6"
                            step="0.25"
                            value={subject.currentGrade}
                            placeholder="e.g. 4.0"
                            onChange={(e) =>
                                updateSubject("currentGrade", e.target.value)
                            }
                            className={inputClass}
                        />
                    </div>

                    {/* Exam duration */}
                    <div>
                        <label htmlFor="examDuration" className="mb-2 block text-sm font-semibold">
                            How long is this exam? (minutes)
                        </label>
                        <input
                            id="examDuration"
                            type="number"
                            min="1"
                            step="1"
                            value={subject.examDuration}
                            placeholder="e.g. 120"
                            onChange={(e) =>
                                updateSubject("examDuration", e.target.value)
                            }
                            className={inputClass}
                        />
                    </div>

                    {/* Semester confidence */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            How comfortable did you feel with this subject
                            during the semester?
                        </p>

                        <div className="space-y-3">
                            {[
                                ["very", "Very comfortable"],
                                ["mostly", "Mostly comfortable"],
                                ["some", "Some knowledge gaps"],
                                ["little", "Not comfortable"],
                            ].map(([value, label]) => (
                                <label
                                    key={value}
                                    className="flex items-center gap-3 text-sm"
                                >
                                    <input
                                        type="radio"
                                        name="confidence"
                                        checked={subject.confidence === value}
                                        onChange={() =>
                                            updateSubject("confidence", value)
                                        }
                                        className="accent-foreground"
                                    />
                                    {label}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Study preferences */}
                    <h3 className="border-t border-border pt-6 text-lg font-bold">
                        Study preferences
                    </h3>

                    {/* Study materials */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            Study materials
                        </p>
                        <p className="mb-3 text-xs text-muted">
                            Select which materials you have available.
                        </p>

                        <div className="space-y-3">
                            {[
                                "Lecture slides / scripts",
                                "Exercise sheets",
                                "Exercise solutions",
                                "Past exams",
                                "Past exam solutions",
                                "Existing summaries",
                                "Cheatsheets",
                            ].map((material) => (
                                <label
                                    key={material}
                                    className="flex items-center gap-3 text-sm"
                                >
                                    <input
                                        type="checkbox"
                                        checked={subject.materials.includes(material)}
                                        onChange={(e) =>
                                            updateSubject(
                                                "materials",
                                                e.target.checked
                                                    ? [...subject.materials, material]
                                                    : subject.materials.filter(
                                                        (m) => m !== material
                                                    )
                                            )
                                        }
                                        className="accent-foreground"
                                    />
                                    {material}
                                </label>
                            ))}
                        </div>

                        <p className="mt-3 text-xs text-muted">
                            File uploads will be added later.
                        </p>
                    </div>

                    {/* Past exams */}
                    <div>
                        <label htmlFor="mockCount" className="mb-2 block text-sm font-semibold">
                            How many past exams or practice exams are available?
                        </label>
                        <input
                            id="mockCount"
                            type="number"
                            min="0"
                            step="1"
                            placeholder="e.g. 8"
                            value={subject.mockCount}
                            onChange={(e) =>
                                updateSubject("mockCount", e.target.value)
                            }
                            className={inputClass}
                        />
                    </div>

                    {/* Study approach */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            How would you like to prepare for this subject?
                        </p>

                        <div className="space-y-3">
                            {[
                                {
                                    value: "foundation",
                                    title: "Build from the basics",
                                    description:
                                        "Start with theory, revisit exercises, then work towards exams.",
                                },
                                {
                                    value: "balanced",
                                    title: "Revise & practice",
                                    description:
                                        "Refresh theory while starting past-exam problems early.",
                                },
                                {
                                    value: "exam",
                                    title: "Exam-focused",
                                    description:
                                        "Start directly with past exams and revisit theory when needed.",
                                },
                                {
                                    value: "custom",
                                    title: "Custom approach",
                                    description:
                                        "Select the specific study phases you want.",
                                },
                            ].map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                        updateSubject(
                                            "approach",
                                            option.value as StudyApproach
                                        )
                                    }
                                    className={`w-full rounded-xl border p-4 text-left ${subject.approach === option.value
                                            ? "border-foreground bg-surface-2"
                                            : "border-border"
                                        }`}
                                >
                                    <p className="text-sm font-semibold">
                                        {subject.approach === option.value ? "● " : "○ "}
                                        {option.title}
                                    </p>
                                    <p className="mt-1 text-xs text-muted">
                                        {option.description}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Custom phases */}
                    {subject.approach === "custom" && (
                        <div className="rounded-xl bg-surface-2 p-4">
                            <p className="mb-3 text-sm font-semibold">
                                Choose your study phases
                            </p>

                            <div className="space-y-3">
                                {studyPhases.map((phase) => (
                                    <label
                                        key={phase}
                                        className="flex items-center gap-3 text-sm"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={subject.customPhases.includes(phase)}
                                            onChange={(e) =>
                                                updateSubject(
                                                    "customPhases",
                                                    e.target.checked
                                                        ? [...subject.customPhases, phase]
                                                        : subject.customPhases.filter(
                                                            (p) => p !== phase
                                                        )
                                                )
                                            }
                                            className="accent-foreground"
                                        />
                                        {phase}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Cheatsheet */}
                    <div>
                        <p className="mb-3 text-sm font-semibold">
                            How will you handle your cheatsheet?
                        </p>

                        <div className="space-y-3">
                            {[
                                ["none", "No cheatsheet allowed"],
                                ["existing", "I'll use an existing cheatsheet"],
                                ["gradual", "I'll build it gradually during revision"],
                                ["end", "I'll write it towards the end"],
                            ].map(([value, label]) => (
                                <label
                                    key={value}
                                    className="flex items-center gap-3 text-sm"
                                >
                                    <input
                                        type="radio"
                                        name="cheatsheet"
                                        checked={subject.cheatsheet === value}
                                        onChange={() =>
                                            updateSubject("cheatsheet", value)
                                        }
                                        className="accent-foreground"
                                    />
                                    {label}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Additional comments */}
                    <div>
                        <label htmlFor="comments" className="mb-2 block text-sm font-semibold">
                            Anything else we should know?
                            <span className="ml-2 font-normal text-muted">
                                (optional)
                            </span>
                        </label>

                        <textarea
                            id="comments"
                            rows={4}
                            placeholder="Any difficulties, priorities or personal preferences..."
                            value={subject.comments}
                            onChange={(e) =>
                                updateSubject("comments", e.target.value)
                            }
                            className={inputClass}
                        />
                    </div>

                    {/* Navigation */}
                    <div className="flex justify-between pt-2">
                        <button
                            type="button"
                            onClick={closeSubject}
                            className={secondaryButton}
                        >
                            ← Back to subjects
                        </button>

                        <button
                            type="button"
                            disabled={!validSubject}
                            onClick={finishSubject}
                            className={primaryButton}
                        >
                            Save subject ✓
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 6 — PLACEHOLDER */}

            {/* STEP 6 — RECOMMENDED SUBJECT DISTRIBUTION */}
            {step === 6 && (
                <div className={cardClass}>
                    <div>
                        <h2 className="text-xl font-bold">
                            Your recommended subject distribution
                        </h2>

                        <p className="mt-2 text-sm text-muted">
                            Based on your current level, target grades,
                            and exam dates, here&apos;s how we recommend
                            distributing your study time.
                        </p>

                        <p className="mt-2 text-sm text-muted">
                            You can adjust the percentages to match
                            your personal priorities.
                        </p>
                    </div>

                    {/* Stacked percentage bar */}
                    <div className="flex h-5 overflow-hidden rounded-full">
                        {distribution.map((percentage, index) => (
                            <div
                                key={index}
                                style={{
                                    width: `${percentage}%`,
                                    backgroundColor:
                                        subjectColors[index % subjectColors.length],
                                }}
                                className="transition-all duration-200"
                            />
                        ))}
                    </div>

                    {/* Individual subject sliders */}
                    <div className="space-y-7">
                        {subjects.map((subject, index) => (
                            <div key={index}>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="size-3 rounded-full"
                                            style={{
                                                backgroundColor:
                                                    subjectColors[index % subjectColors.length],
                                            }}
                                        />

                                        <span className="text-sm font-semibold">
                                            {subject.name}
                                        </span>
                                    </div>

                                    <span className="text-sm font-bold">
                                        {distribution[index] ?? 0}%
                                    </span>
                                </div>

                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={distribution[index] ?? 0}
                                    disabled={subjects.length === 1}
                                    onChange={(e) =>
                                        changeAllocation(
                                            index,
                                            Number(e.target.value)
                                        )
                                    }
                                    className="w-full cursor-pointer accent-foreground disabled:cursor-not-allowed"
                                />

                                <p className="mt-1 text-xs text-muted">
                                    {(
                                        (weeklyHours * (distribution[index] ?? 0)) /
                                        100
                                    ).toFixed(1)}{" "}
                                    hours per week on average
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Total & reset */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                        <div>
                            <p className="text-sm font-semibold">
                                Total:{" "}
                                {distribution.reduce((a, b) => a + b, 0)}%
                            </p>
                            <p className="text-xs text-muted">
                                The total always stays at 100%.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                setDistribution([...recommendedDistribution])
                            }
                            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
                        >
                            ↺ Revert to recommended
                        </button>
                    </div>

                    {/* Navigation */}
                    <div className="space-y-4 pt-3">
                        <button
                            type="button"
                            onClick={generatePlan}
                            className={`${primaryButton} w-full`}
                        >
                            Generate plan →
                        </button>

                        <button
                            type="button"
                            onClick={() => setStep(3)}
                            className={`${secondaryButton} w-full`}
                        >
                            ← Previous
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 7 — GENERATING / RESULT */}
            {step === 7 && (
                <div className={cardClass}>
                    {isGenerating ? (
                        /* Loading */
                        <div className="flex flex-col items-center gap-4 py-8 text-center">
                            <div className="size-10 animate-spin rounded-full border-4 border-border border-t-foreground" />
                            <p className="font-semibold">Building your schedule…</p>
                            <p className="text-sm text-muted">
                                Scheduling sessions with spacing, interleaving, and exam practice.
                            </p>
                        </div>
                    ) : generationError ? (
                        /* Error */
                        <div className="space-y-4 py-4 text-center">
                            <p className="text-lg font-bold text-red-600">Something went wrong</p>
                            <p className="text-sm text-muted">{generationError}</p>
                            <button
                                type="button"
                                onClick={() => setStep(6)}
                                className={secondaryButton}
                            >
                                ← Go back
                            </button>
                        </div>
                    ) : summary && !planSaved && summary.feasibility.needsMoreTime && !acceptedShortfall ? (
                        /* Goals need more time than the plan has */
                        <div className="space-y-6">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                                    Before we save
                                </p>
                                <h2 className="mt-2 text-2xl font-bold">
                                    Your study goals need more time
                                </h2>
                                <p className="mt-2 text-sm text-muted">
                                    Based on your current goals, exam dates and availability, your
                                    study plan may require more time than you&apos;ve allocated.
                                </p>
                            </div>

                            <div className="grid grid-cols-3 gap-3 text-center">
                                {([
                                    ["Needed (approx.)", formatHours(summary.feasibility.requiredMinutes)],
                                    ["Available", formatHours(summary.feasibility.availableMinutes)],
                                    // Only a real overall gap is a shortage; deadlines are explained below.
                                    summary.feasibility.overallShortfallMinutes > 0
                                        ? ["Short overall", formatHours(summary.feasibility.overallShortfallMinutes)]
                                        : ["Overall", "Enough"],
                                ] as const).map(([label, value]) => (
                                    <div key={label} className="rounded-xl bg-surface-2 p-3">
                                        <p className="text-xl font-bold tabular-nums">{value}</p>
                                        <p className="mt-1 text-xs text-muted">{label}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-muted">
                                Focused study hours before your last exam, without buffer time.
                                &quot;Needed&quot; is an estimate from your target grades, confidence,
                                and the mock exams planned for you.
                            </p>

                            {/* Deadlines: work due before an exam whose days are already full */}
                            {summary.feasibility.deadlineShortfallMinutes > 0 && (
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold">Tight before exam dates</p>
                                    <p className="text-xs text-muted">
                                        {summary.feasibility.overallShortfallMinutes > 0
                                            ? `On top of that, about ${formatHours(summary.feasibility.deadlineShortfallMinutes)} of study falls due before an exam whose days are already full:`
                                            : `There are enough hours in total, but about ${formatHours(summary.feasibility.deadlineShortfallMinutes)} of study falls due before an exam whose days are already full:`}
                                    </p>
                                    {summary.feasibility.subjects
                                        .filter((s) => s.shortfallMinutes > 0)
                                        .map((s) => (
                                            <div key={s.name} className="text-sm">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span>{s.name}</span>
                                                    <span className="tabular-nums text-muted">{formatHours(s.shortfallMinutes)} don&apos;t fit</span>
                                                </div>
                                                <p className="text-xs text-muted">
                                                    Needs about {formatHours(s.requiredMinutes)} before its exam on{" "}
                                                    {new Date(`${s.examDate}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })};{" "}
                                                    {formatHours(s.availableBeforeExamMinutes)} of study time exist before then, shared with your other subjects.
                                                </p>
                                            </div>
                                        ))}
                                </div>
                            )}
                            {summary.feasibility.deadlineShortfallMinutes === 0 && (
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold">Where time is tightest</p>
                                    {summary.feasibility.subjects
                                        .filter((s) => s.shortfallMinutes > 0)
                                        .map((s) => (
                                            <div key={s.name} className="flex items-center justify-between gap-3 text-sm">
                                                <span>{s.name}</span>
                                                <span className="tabular-nums text-muted">
                                                    {formatHours(s.shortfallMinutes)} short of{" "}
                                                    {formatHours(s.requiredMinutes)}
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            )}

                            <MockPlanList subjects={summary.feasibility.subjects} />

                            {summary.feasibility.suggestions.length > 0 && (
                                <div className="space-y-2 rounded-xl bg-surface-2 p-4">
                                    <p className="text-sm font-semibold">What would help</p>
                                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                                        {summary.feasibility.suggestions.map((suggestion) => (
                                            <li key={suggestion}>{suggestion}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="space-y-3">
                                <button
                                    type="button"
                                    onClick={adjustPlan}
                                    className={`${primaryButton} w-full`}
                                >
                                    Adjust my plan
                                </button>
                                <button
                                    type="button"
                                    disabled={summary.feasibility.scheduledMinutes === 0}
                                    onClick={continueAnyway}
                                    className={`${secondaryButton} w-full disabled:opacity-50`}
                                >
                                    Continue anyway
                                </button>
                                <p className="text-center text-xs text-muted">
                                    Your answers are kept — adjusting takes you back to your
                                    availability, then through your subjects. Continuing keeps a
                                    best-effort schedule within your study days and hours, and
                                    lists what it couldn&apos;t fit.
                                </p>
                            </div>
                        </div>
                    ) : summary && !planSaved && editId ? (
                        /* Managing a plan: confirm before replacing the remaining schedule */
                        <div className="space-y-6">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                                    Confirm changes
                                </p>
                                <h2 className="mt-2 text-2xl font-bold">
                                    Replace your remaining schedule?
                                </h2>
                                <p className="mt-2 text-sm text-muted">
                                    {summary.replaced} upcoming or missed block{summary.replaced === 1 ? "" : "s"} will
                                    be replaced by {summary.count} new ones. Your {summary.kept} completed
                                    session{summary.kept === 1 ? "" : "s"} and logged exam results stay as they are,
                                    and their work isn&apos;t scheduled again.
                                </p>
                                {!!summary.manualKept && (
                                    <p className="mt-2 text-sm text-muted">
                                        {summary.manualKept} block{summary.manualKept === 1 ? "" : "s"} you moved by hand
                                        stay{summary.manualKept === 1 ? "s" : ""} where you put {summary.manualKept === 1 ? "it" : "them"}.
                                    </p>
                                )}
                                {!!summary.manualReplaced && (
                                    <p className="mt-2 text-sm font-semibold text-accent">
                                        {summary.manualReplaced} block{summary.manualReplaced === 1 ? "" : "s"} you moved by hand
                                        no longer fit{summary.manualReplaced === 1 ? "s" : ""} your new settings (day off, vacation or after
                                        the exam) and will be replaced.
                                    </p>
                                )}
                            </div>
                            {summary.feasibility.adjustments.length > 0 && (
                                <ul className="list-disc space-y-1 rounded-xl bg-surface-2 p-4 pl-8 text-xs text-muted">
                                    {summary.feasibility.adjustments.map((note) => <li key={note}>{note}</li>)}
                                </ul>
                            )}
                            <div className="space-y-3">
                                <button type="button" onClick={() => void applyChanges()} className={`${primaryButton} w-full`}>
                                    Replace schedule
                                </button>
                                <button type="button" onClick={adjustPlan} className={`${secondaryButton} w-full`}>
                                    Back to my settings
                                </button>
                            </div>
                        </div>
                    ) : summary && planSaved ? (
                        /* Success */
                        <div className="space-y-6">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                                    {editId ? "Plan updated" : "Plan ready"}
                                </p>
                                <h2 className="mt-2 text-2xl font-bold">
                                    {planName}
                                </h2>
                                <p className="mt-1 text-sm text-muted">
                                    {summary.count} sessions scheduled
                                    {summary.firstDate && summary.lastDate && (
                                        <> from{" "}
                                            {summary.firstDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                            {" "}to{" "}
                                            {summary.lastDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                        </>
                                    )}
                                </p>
                            </div>

                            {summary.feasibility.needsMoreTime && (
                                <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm text-muted">
                                    <p>
                                        Your targets are ambitious: about{" "}
                                        {formatHours(summary.feasibility.shortfallMinutes)} of the
                                        study they need didn&apos;t fit into your available time.
                                        Not scheduled:
                                    </p>
                                    <ul className="list-disc space-y-1 pl-5 text-xs">
                                        {summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                                    </ul>
                                </div>
                            )}

                            {summary.feasibility.adjustments.length > 0 && (
                                <ul className="list-disc space-y-1 rounded-xl bg-surface-2 p-4 pl-8 text-xs text-muted">
                                    {summary.feasibility.adjustments.map((note) => <li key={note}>{note}</li>)}
                                </ul>
                            )}

                            {summary.feasibility.unusedMinutes >= 60 && (
                                <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">
                                    About {formatHours(summary.feasibility.unusedMinutes)} of
                                    your available study time is left free: your goals don&apos;t need
                                    it, so we didn&apos;t pad it with extra tasks. Those days simply
                                    end earlier.
                                </p>
                            )}

                            {!summary.feasibility.needsMoreTime && summary.warnings.length > 0 && (
                                <ul className="list-disc space-y-1 rounded-xl bg-surface-2 p-4 pl-8 text-xs text-muted">
                                    {summary.warnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                    ))}
                                </ul>
                            )}

                            <MockPlanList subjects={summary.feasibility.subjects} />

                            {/* Per-subject breakdown */}
                            <div className="space-y-2">
                                <p className="text-sm font-semibold">Sessions per subject</p>
                                {Object.entries(summary.breakdown).map(([name, count], i) => (
                                    <div key={name} className="flex items-center gap-3">
                                        <span
                                            className="size-3 shrink-0 rounded-full"
                                            style={{ backgroundColor: subjectColors[i % subjectColors.length] }}
                                        />
                                        <span className="flex-1 text-sm">{name}</span>
                                        <span className="text-sm font-semibold tabular-nums">{count}</span>
                                    </div>
                                ))}
                            </div>

                            {/* How the scheduler works */}
                            <div className="rounded-xl bg-surface-2 p-4 space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                                    How this schedule was built
                                </p>
                                <ul className="space-y-1.5 text-xs text-muted">
                                    <li>
                                        <span className="font-medium text-foreground">Retrieval practice</span>
                                        {" "}— every session opens with a recall warm-up and closes with an exit quiz.
                                    </li>
                                    <li>
                                        <span className="font-medium text-foreground">Spacing</span>
                                        {" "}— recovery sessions implement a 1 → 3 → 7 → 14 day recall cycle for each topic.
                                    </li>
                                    <li>
                                        <span className="font-medium text-foreground">Interleaving</span>
                                        {" "}— subjects rotate across days, at most two a day and each grouped together; your Lernphase can open with focus days on one subject.
                                    </li>
                                    <li>
                                        <span className="font-medium text-foreground">Exam practice</span>
                                        {" "}— mock exams match the real exam&apos;s length, are spread over the final stretch before it, and each one is followed by a review that gets shorter as the exam approaches (minimum 1 h).
                                    </li>
                                    <li>
                                        <span className="font-medium text-foreground">Your availability</span>
                                        {" "}— sessions only fall on your selected days, never during vacations, and never exceed your daily hours; each study day ends with buffer / catch-up time.
                                    </li>
                                    <li>
                                        <span className="font-medium text-foreground">Cheatsheet</span>
                                        {" "}— time for it comes out of each subject&apos;s study as you chose: inside theory sessions with milestones, in dedicated sessions near the exam, or a short re-read.
                                    </li>
                                    <li>
                                        <span className="font-medium text-foreground">Hours formula</span>
                                        {" "}— required_hours = est_hours × (1.25 − 0.5 × confidence), scaling between 0.75× (very confident) and 1.25× (not comfortable).
                                    </li>
                                </ul>
                            </div>

                            <button
                                type="button"
                                onClick={() => router.push("/calendar")}
                                className={`${primaryButton} w-full`}
                            >
                                View in calendar →
                            </button>

                            <button
                                type="button"
                                onClick={() => router.push("/plans")}
                                className={`${secondaryButton} w-full`}
                            >
                                Back to plans
                            </button>
                        </div>
                    ) : null}
                </div>
            )}

        </main>
    );
}
