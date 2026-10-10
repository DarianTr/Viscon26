import {
  dailyBufferMinutes,
  dailyWindowMinutes,
  generateStudyPlan,
  previewDay,
  type GenerateOptions,
  type PlanConfig,
  type PlanFeasibility,
} from "./scheduler";

/*
 * Smart plan adjustment: concrete changes that make an unrealistic plan
 * achievable. Every candidate is checked by running the real scheduler
 * (generateStudyPlan) with the plan's own inputs, so its feasibility — breaks,
 * buffers, vacations, exam deadlines, at most two subjects a day, mock lengths
 * — is the scheduler's verdict, not an estimate made here.
 *
 *   targets   lower target grades in 0.25 steps where that frees study time,
 *             never below the student's current grade or the prediction
 *             model's exam-day forecast (the floors);
 *   time      the smallest weekly increase on the current days that closes the
 *             gap, within a realistic day; only if that isn't enough, another day;
 *   balanced  about half of that increase, then targets only as far as needed.
 *
 * Safe for client code: new plans run it in the browser, existing plans on the server.
 */

/** Longest realistic study day: focused study plus buffer (breaks and meals come on top). */
export const MAX_DAY_WINDOW_MINUTES = 10 * 60;
/** Grades move in quarter steps on the Swiss 1–6 scale. */
const GRADE_STEP = 0.25;
/** A target change that frees less than this isn't worth asking for. */
const MIN_GAIN_MINUTES = 15;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type FeasibilitySummary = {
  availableMinutes: number;
  requiredMinutes: number;
  shortfallMinutes: number;
  needsMoreTime: boolean;
  /** Subjects with a shortfall, largest first. */
  subjects: { name: string; shortfallMinutes: number }[];
};

export type TargetFloor = { grade: number; source: "current grade" | "predicted exam grade" };

export type TargetChange = { subject: string; from: number; to: number; floor: TargetFloor };

export type Recommendation = {
  kind: "targets" | "time" | "balanced";
  /** The scheduler found no remaining shortfall worth warning about. */
  resolved: boolean;
  /** Something changes at all (false: nothing in this direction helps). */
  changes: boolean;
  weeklyHours: { from: number; to: number };
  studyDays: { from: string[]; to: string[] };
  /** Study hours per study day (focused study + buffer), before and after. */
  dailyHours: { from: number; to: number };
  targets: TargetChange[];
  feasibility: FeasibilitySummary;
  explanation: string;
};

export type Adjustments = {
  current: FeasibilitySummary;
  targets: Recommendation;
  time: Recommendation;
  balanced: Recommendation;
};

export type AdjustmentInput = {
  /** The plan as it would be generated now, with its workload basis frozen. */
  config: PlanConfig;
  now: Date;
  options?: Omit<GenerateOptions, "suggest" | "immersionCut">;
  /** Per subject: the lowest target worth proposing. Defaults to the current grade. */
  floors?: Record<string, TargetFloor>;
};

export function summarize(f: PlanFeasibility): FeasibilitySummary {
  return {
    availableMinutes: f.availableMinutes,
    requiredMinutes: f.requiredMinutes,
    shortfallMinutes: f.shortfallMinutes,
    needsMoreTime: f.needsMoreTime,
    subjects: f.subjects.filter((s) => s.shortfallMinutes > 0).map((s) => ({ name: s.name, shortfallMinutes: s.shortfallMinutes })),
  };
}

const hours = (minutes: number) => `${Math.round(minutes / 60)} h`;
const roundDown = (grade: number) => Math.floor(grade / GRADE_STEP + 1e-9) * GRADE_STEP;
const roundUp = (grade: number) => Math.ceil(grade / GRADE_STEP - 1e-9) * GRADE_STEP;

/** Whether a study day of this length is realistic and fits before midnight with its breaks. */
export function dayFits(config: Pick<PlanConfig, "startTime" | "preferredStartHour" | "rhythm" | "sessionLength">, weeklyHours: number, studyDays: string[]): boolean {
  if (!studyDays.length) return false;
  const window = dailyWindowMinutes({ weeklyHours, studyDays });
  if (window > MAX_DAY_WINDOW_MINUTES) return false;
  const capacity = window - dailyBufferMinutes(window);
  const placed = previewDay({ ...config, weeklyHours, studyDays }).placed.reduce((t, m) => t + m, 0);
  return placed >= capacity;
}

export function recommendAdjustments({ config, now, options = {}, floors = {} }: AdjustmentInput): Adjustments {
  const cache = new Map<string, PlanFeasibility>();
  const run = (c: PlanConfig) => {
    const key = JSON.stringify([c.weeklyHours, c.studyDays, c.subjects.map((s) => s.targetGrade)]);
    let f = cache.get(key);
    if (!f) {
      f = generateStudyPlan(c, now, { ...options, suggest: false }).feasibility;
      cache.set(key, f);
    }
    return f;
  };
  const base = run(config);
  const daily = (c: Pick<PlanConfig, "weeklyHours" | "studyDays">) => Math.round(dailyWindowMinutes(c) / 6) / 10;

  const floorOf = (name: string, current: number): TargetFloor => {
    const f = floors[name];
    // Never below the current grade (a target under it is no target), nor below the model's forecast.
    return f && f.grade > current
      ? { grade: roundUp(f.grade), source: f.source }
      : { grade: roundUp(current), source: "current grade" };
  };

  /** Lower targets one quarter at a time, always where it frees the most time, until the plan fits. */
  function lowerTargets(start: PlanConfig) {
    let cfg = start;
    let f = run(cfg);
    while (f.needsMoreTime) {
      let best: { cfg: PlanConfig; f: PlanFeasibility; gain: number } | null = null;
      for (const [i, s] of cfg.subjects.entries()) {
        const target = Number(s.targetGrade);
        const floor = floorOf(s.name, Number(s.currentGrade) || 0).grade;
        const next = Math.max(floor, roundDown(target - GRADE_STEP + 1e-9));
        if (!(target > next)) continue;
        const trial = { ...cfg, subjects: cfg.subjects.map((x, j) => (j === i ? { ...x, targetGrade: String(next) } : x)) };
        const tf = run(trial);
        const gain = f.shortfallMinutes - tf.shortfallMinutes;
        if (gain >= MIN_GAIN_MINUTES && (!best || gain > best.gain)) best = { cfg: trial, f: tf, gain };
      }
      if (!best) break;
      cfg = best.cfg;
      f = best.f;
    }
    return { cfg, f };
  }

  /** The smallest weekly hours on these days that close the gap, within a realistic day. */
  function findHours(start: PlanConfig, studyDays: string[], from: number) {
    let best: { w: number; f: PlanFeasibility } | null = null;
    for (let w = from; dayFits(start, w, studyDays); w++) {
      const f = run({ ...start, weeklyHours: w, studyDays });
      if (!best || f.shortfallMinutes < best.f.shortfallMinutes) best = { w, f };
      if (!f.needsMoreTime) return { w, f, resolved: true };
    }
    return best ? { ...best, resolved: false } : null;
  }

  const targetChanges = (cfg: PlanConfig): TargetChange[] =>
    cfg.subjects.flatMap((s, i) => {
      const from = Number(config.subjects[i].targetGrade);
      const to = Number(s.targetGrade);
      return to !== from ? [{ subject: s.name, from, to, floor: floorOf(s.name, Number(s.currentGrade) || 0) }] : [];
    });

  const recommendation = (kind: Recommendation["kind"], cfg: PlanConfig, f: PlanFeasibility, explanation: string): Recommendation => {
    const targets = targetChanges(cfg);
    return {
      kind,
      resolved: !f.needsMoreTime,
      changes: targets.length > 0 || cfg.weeklyHours !== config.weeklyHours || cfg.studyDays.join() !== config.studyDays.join(),
      weeklyHours: { from: config.weeklyHours, to: cfg.weeklyHours },
      studyDays: { from: config.studyDays, to: cfg.studyDays },
      dailyHours: { from: daily(config), to: daily(cfg) },
      targets,
      feasibility: summarize(f),
      explanation,
    };
  };

  // A plan that already fits needs nothing.
  if (!base.needsMoreTime) {
    const none = (kind: Recommendation["kind"]) => recommendation(kind, config, base, "Your plan already fits — nothing needs to change.");
    return { current: summarize(base), targets: none("targets"), time: none("time"), balanced: none("balanced") };
  }

  // ── A: targets only ────────────────────────────────────────────────────────
  const a = lowerTargets(config);
  const freed = base.shortfallMinutes - a.f.shortfallMinutes;
  const targets = recommendation(
    "targets",
    a.cfg,
    a.f,
    targetChanges(a.cfg).length === 0
      ? "Lower targets wouldn't free meaningful study time here: your plan's workload depends mostly on your confidence and exam dates, so time is the constraint."
      : !a.f.needsMoreTime
        ? `Smaller grade gaps need fewer hours and mock exams; these targets fit your current schedule.`
        : `These targets free about ${hours(freed)}, but ${hours(a.f.shortfallMinutes)} still don't fit — lower targets alone can't close the gap.`,
  );

  // ── B: more time ───────────────────────────────────────────────────────────
  const missing = WEEK.filter((d) => !config.studyDays.includes(d));
  const daySets = [config.studyDays, ...missing.map((_, n) => WEEK.filter((d) => config.studyDays.includes(d) || missing.slice(0, n + 1).includes(d)))];
  let timeFound: { w: number; f: PlanFeasibility; resolved: boolean; days: string[] } | null = null;
  for (const days of daySets) {
    // A day set with more days starts from the same total hours.
    const found = findHours(config, days, days === config.studyDays ? config.weeklyHours + 1 : config.weeklyHours);
    if (!found) continue;
    if (!timeFound || found.f.shortfallMinutes < timeFound.f.shortfallMinutes) timeFound = { ...found, days };
    if (found.resolved) break;
  }
  const timeCfg = timeFound ? { ...config, weeklyHours: timeFound.w, studyDays: timeFound.days } : config;
  const timeF = timeFound?.f ?? base;
  const addedDays = timeCfg.studyDays.filter((d) => !config.studyDays.includes(d));
  const time = recommendation(
    "time",
    timeCfg,
    timeF,
    !timeFound
      ? `Your study days are already as long as is realistic (up to ${MAX_DAY_WINDOW_MINUTES / 60} h including buffer), so more time can't be added.`
      : timeFound.resolved
        ? `${timeCfg.weeklyHours - config.weeklyHours} more hours a week${addedDays.length ? `, with ${addedDays.join(" and ")} as extra study day${addedDays.length > 1 ? "s" : ""} to keep days shorter` : " on your current days"} give the plan the time it needs.`
        : `No amount of extra time within realistic days (up to ${MAX_DAY_WINDOW_MINUTES / 60} h) closes the gap. The closest is ${timeCfg.weeklyHours} h a week, which still leaves ${hours(timeF.shortfallMinutes)} that don't fit before your exam dates and other commitments.`,
  );

  // ── C: balanced ────────────────────────────────────────────────────────────
  // The fewest extra hours on the current days that, with targets lowered only
  // where that frees time, close the gap; if more time alone can't, half of it.
  let mid: { cfg: PlanConfig; f: PlanFeasibility } | null = null;
  if (time.resolved && time.studyDays.to.join() === config.studyDays.join()) {
    for (let w = config.weeklyHours + 1; w <= time.weeklyHours.to; w++) {
      const trial = lowerTargets({ ...config, weeklyHours: w });
      if (!trial.f.needsMoreTime) {
        mid = trial;
        break;
      }
    }
  }
  if (!mid) {
    let w = config.weeklyHours + Math.max(1, Math.ceil((time.weeklyHours.to - config.weeklyHours) / 2));
    while (w > config.weeklyHours && !dayFits(config, w, config.studyDays)) w--;
    mid = lowerTargets({ ...config, weeklyHours: w });
  }
  const sameAsTime = targetChanges(mid.cfg).length === 0 && mid.cfg.weeklyHours === time.weeklyHours.to;
  const balanced = recommendation(
    "balanced",
    mid.cfg,
    mid.f,
    mid.f.needsMoreTime
      ? `This narrows the gap to ${hours(mid.f.shortfallMinutes)}; it doesn't close it fully.`
      : sameAsTime
        ? "Lower targets barely change the hours this plan needs, so the smallest balanced change is the extra study time alone."
        : targetChanges(mid.cfg).length
          ? `${mid.cfg.weeklyHours - config.weeklyHours} more hours a week and slightly lower targets close the gap — less extra time than without changing targets.`
          : "A small increase in study time is enough on its own — no target needs to change.",
  );

  return { current: summarize(base), targets, time, balanced };
}

/** Grade floors from the prediction model: never propose a target below its exam-day forecast. */
export function floorsFromPredictions(predictions: { subject: string; examDay: { grade: number } }[]): Record<string, TargetFloor> {
  return Object.fromEntries(
    predictions.map((p) => [p.subject, { grade: p.examDay.grade, source: "predicted exam grade" as const }]),
  );
}
