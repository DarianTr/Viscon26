import { toGrade, Z90 } from "./grades";
import type { KnowledgeSubject } from "./knowledge-topics";

/*
 * The grade prediction for each subject of a plan, read from the knowledge
 * service's timeline (services/knowledge) — the one model behind every grade
 * the app shows. The plan summary, the forecast and topic charts and the AI
 * strategy agent all take their numbers from here, so a subject's grades
 * agree wherever they appear. Nothing here estimates anything itself.
 * Safe for client code.
 */

/** The parts of a knowledge timeline (lib/knowledge.ts) a prediction is read from. */
export type PredictionTimeline = {
  asOf: string;
  groups: { id: string }[];
  current: {
    groupLevels: { mean: number; sd: number }[];
    groupForecasts: { mean: number; sd: number }[];
  };
  steps: { observation: { weights: Record<string, number> } | null }[];
};

/** A grade on the Swiss 1–6 scale with its central 90% interval. */
export type GradeEstimate = { grade: number; low: number; high: number };

export type SubjectPrediction = {
  subjectId: string;
  subject: string;
  /** Present readiness: the model's estimate of the grade if the exam were today. */
  current: GradeEstimate;
  /** The model's forecast of the grade on exam day. */
  examDay: GradeEstimate;
  /** Logged data points (practice, quizzes, mocks, exams) that inform this subject. */
  evidence: number;
  /** "self-assessment": no data points yet, so the estimate is the onboarding guess. */
  basis: "self-assessment" | "data";
  examDate: string | null;
  targetGrade: number | null;
  /** When the model computed this (the timeline's asOf). */
  asOf: string;
};

const clamp = (score: number) => Math.min(1, Math.max(0, score));

/** A score distribution (fraction correct, mean ± sd) as a grade with its 90% interval. */
export function gradeEstimate({ mean, sd }: { mean: number; sd: number }): GradeEstimate {
  return {
    grade: toGrade(clamp(mean)),
    low: toGrade(clamp(mean - Z90 * sd)),
    high: toGrade(clamp(mean + Z90 * sd)),
  };
}

/** The prediction for one subject, found by its id — never by position. Null if the model doesn't know it. */
export function predictionFor(
  timeline: PredictionTimeline,
  subject: Pick<KnowledgeSubject, "id" | "name" | "topics" | "examDate" | "targetGrade">,
): SubjectPrediction | null {
  const g = timeline.groups.findIndex((group) => group.id === subject.id);
  const level = timeline.current.groupLevels[g];
  const forecast = timeline.current.groupForecasts[g];
  if (g < 0 || !level || !forecast) return null;
  const topics = new Set(subject.topics.map((t) => t.id));
  const evidence = timeline.steps.filter(
    (step) => step.observation && Object.keys(step.observation.weights).some((t) => topics.has(t)),
  ).length;
  return {
    subjectId: subject.id,
    subject: subject.name,
    current: gradeEstimate(level),
    examDay: gradeEstimate(forecast),
    evidence,
    basis: evidence > 0 ? "data" : "self-assessment",
    examDate: subject.examDate,
    targetGrade: subject.targetGrade,
    asOf: timeline.asOf,
  };
}

/** Every subject's prediction, in the plan's subject order. */
export function subjectPredictions(timeline: PredictionTimeline, subjects: KnowledgeSubject[]): SubjectPrediction[] {
  return subjects.map((s) => predictionFor(timeline, s)).filter((p): p is SubjectPrediction => p !== null);
}

/** How every grade is shown, so the same prediction reads the same everywhere. */
export const formatPredictedGrade = (grade: number) => grade.toFixed(2);

/** The subject a logged data point belongs to: the one whose topics it covers. */
export function subjectOfDataPoint(
  weights: Record<string, number>,
  subjects: Pick<KnowledgeSubject, "name" | "topics">[],
): string | null {
  const ids = Object.keys(weights);
  return subjects.find((s) => s.topics.some((t) => ids.includes(t.id)))?.name ?? null;
}
