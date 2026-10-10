import { formatPredictedGrade, type SubjectPrediction } from "./predictions";

/*
 * The strategy agent's input, as text. Its grades come from the prediction
 * model (lib/predictions.ts) and it is told to use them, so the advice never
 * contradicts the grades the app shows. Plain functions, so they're testable.
 */

export type ScoreEntry = {
  subject: string;
  score: number;
  examType: "mock" | "past";
  takenAt: string;
  notes: string | null;
};

export type SubjectStat = {
  subject: string;
  total: number;
  done: number;
  examDate: string | null;
};

export type HourlyActivity = {
  hour: number; // 0–23
  sessions: number; // completed sessions in this hour
  avgFocus: number | null; // 0–100, null if no focus data
};

/** A result logged through "Log data" (the prediction model's evidence). */
export type DataPointEntry = {
  subject: string;
  type: "practice" | "quiz" | "mock" | "exam";
  takenOn: string;
  /** On the 1–6 scale. */
  grade: number;
  points: number;
};

const DATA_POINT_LABEL: Record<DataPointEntry["type"], string> = {
  practice: "Practice sheet",
  quiz: "Quiz",
  mock: "Mock exam",
  exam: "Exam",
};

/** The prediction model's line for a subject: the numbers the agent must use. */
export function predictionLine(p: SubjectPrediction | undefined): string {
  if (!p) return "Grade model: no prediction for this subject yet.";
  const range = (e: SubjectPrediction["current"]) => `${formatPredictedGrade(e.low)}–${formatPredictedGrade(e.high)}`;
  return (
    `Grade model (as of ${p.asOf.slice(0, 10)}): current ${formatPredictedGrade(p.current.grade)} (90% ${range(p.current)}), ` +
    `predicted exam grade ${formatPredictedGrade(p.examDay.grade)} (90% ${range(p.examDay)})` +
    (p.targetGrade !== null ? `, target ${p.targetGrade}` : "") +
    (p.basis === "self-assessment"
      ? " — no results logged yet, so this is the student's own estimate (low confidence)."
      : ` — based on ${p.evidence} logged result${p.evidence === 1 ? "" : "s"}.`)
  );
}

export function buildStrategyPrompt({
  today,
  subjects,
  scores,
  dataPoints,
  predictions,
  hourlyActivity,
}: {
  today: string;
  subjects: SubjectStat[];
  scores: ScoreEntry[];
  dataPoints: DataPointEntry[];
  predictions: SubjectPrediction[];
  hourlyActivity: HourlyActivity[];
}): string {
  const sections = subjects.map((sub) => {
    const pct = sub.total > 0 ? Math.round((sub.done / sub.total) * 100) : 0;
    const examLine = sub.examDate ? `Exam on ${sub.examDate.slice(0, 10)}` : "No exam date set";
    const results = [
      ...scores
        .filter((sc) => sc.subject === sub.subject)
        .map((sc) => ({
          on: sc.takenAt,
          line:
            `  • ${sc.takenAt} | ${sc.examType === "mock" ? "Mock" : "Past paper"} → ${sc.score}/6` +
            (sc.notes ? ` ("${sc.notes}")` : ""),
        })),
      ...dataPoints
        .filter((d) => d.subject === sub.subject)
        .map((d) => ({
          on: d.takenOn,
          line: `  • ${d.takenOn} | ${DATA_POINT_LABEL[d.type]} → ${formatPredictedGrade(d.grade)}/6 on ${d.points} points`,
        })),
    ].sort((a, b) => a.on.localeCompare(b.on));
    const scoreLines = results.length === 0 ? "  No results logged yet." : results.map((r) => r.line).join("\n");

    return (
      `### ${sub.subject}\n` +
      `Progress: ${pct}% (${sub.done}/${sub.total} sessions) | ${examLine}\n` +
      `${predictionLine(predictions.find((p) => p.subject === sub.subject))}\n` +
      `Results:\n${scoreLines}`
    );
  });

  const totalSessions = hourlyActivity.reduce((s, h) => s + h.sessions, 0);
  const behaviorSection =
    totalSessions < 5
      ? "Behavioral data: Fewer than 5 completed sessions — not enough data to recommend a start hour."
      : "## Session timing behavior\n" +
        hourlyActivity
          .map((h) => {
            const label = `${String(h.hour).padStart(2, "0")}:00`;
            const focus = h.avgFocus !== null ? ` (avg focus ${h.avgFocus}/100)` : "";
            return `  ${label}: ${h.sessions} session${h.sessions !== 1 ? "s" : ""}${focus}`;
          })
          .join("\n") +
        "\nUse this to suggest a preferredStartHour that maximises productive study time.";

  return (
    `A student on the Swiss grade system (1–6, passing = 4.0) has logged the following exam performance and study behavior. ` +
    `Analyse each subject and give targeted, evidence-based recommendations.\n\n` +
    `Each subject's "Grade model" line is the app's grade prediction, which the student also sees. Use those numbers ` +
    `when you mention grades; never state a different current or predicted grade of your own.\n\n` +
    `Today: ${today}\n\n` +
    sections.join("\n\n") +
    `\n\n${behaviorSection}` +
    `\n\nReference the actual scores and notes — be specific, not generic.`
  );
}
