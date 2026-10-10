import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { latestMockGrades } from "./plan-progress";
import { formatPredictedGrade, subjectOfDataPoint, type SubjectPrediction } from "./predictions";
import { toKnowledgeSubjects } from "./knowledge-topics";
import { buildStrategyPrompt, predictionLine } from "./strategy-prompt";

const prediction = (overrides: Partial<SubjectPrediction> = {}): SubjectPrediction => ({
  subjectId: "analysis",
  subject: "Analysis",
  current: { grade: 4.2, low: 3.6, high: 4.8 },
  examDay: { grade: 5.1, low: 4.4, high: 5.7 },
  evidence: 3,
  basis: "data",
  examDate: "2027-02-12",
  targetGrade: 5,
  asOf: "2026-10-11T08:00:00Z",
  ...overrides,
});

describe("strategy agent input", () => {
  it("gives the agent the model's grades, exactly as the app shows them", () => {
    const line = predictionLine(prediction());
    assert.ok(line.includes(`current ${formatPredictedGrade(4.2)}`));
    assert.ok(line.includes(`predicted exam grade ${formatPredictedGrade(5.1)}`));
    assert.ok(line.includes("based on 3 logged results"));
  });

  it("says when a prediction is only the student's own estimate", () => {
    assert.ok(predictionLine(prediction({ basis: "self-assessment", evidence: 0 })).includes("own estimate (low confidence)"));
    assert.equal(predictionLine(undefined), "Grade model: no prediction for this subject yet.");
  });

  it("lists exam scores and logged data points per subject, oldest first, and forbids other grades", () => {
    const prompt = buildStrategyPrompt({
      today: "2026-10-11",
      subjects: [
        { subject: "Analysis", total: 10, done: 4, examDate: "2027-02-12" },
        { subject: "Physics", total: 8, done: 0, examDate: null },
      ],
      scores: [{ subject: "Analysis", score: 4.5, examType: "mock", takenAt: "2026-10-05", notes: "series" }],
      dataPoints: [
        { subject: "Analysis", type: "quiz", takenOn: "2026-10-01", grade: 4, points: 10 },
        { subject: "Analysis", type: "mock", takenOn: "2026-10-09", grade: 4.75, points: 60 },
      ],
      predictions: [prediction()],
      hourlyActivity: [],
    });
    const analysis = prompt.slice(prompt.indexOf("### Analysis"), prompt.indexOf("### Physics"));
    assert.ok(analysis.indexOf("Quiz → 4.00/6") < analysis.indexOf("Mock → 4.5/6"));
    assert.ok(analysis.indexOf("Mock → 4.5/6") < analysis.indexOf("Mock exam → 4.75/6 on 60 points"));
    assert.ok(analysis.includes("current 4.20"));
    assert.ok(prompt.slice(prompt.indexOf("### Physics")).includes("No results logged yet."));
    assert.ok(prompt.includes("never state a different current or predicted grade of your own"));
  });
});

describe("mock results for recalibration", () => {
  it("the latest result per subject wins, whichever source logged it", () => {
    assert.deepEqual(
      latestMockGrades([
        { subject: "Analysis", takenOn: "2026-10-09", grade: 4.75 }, // data point
        { subject: "Analysis", takenOn: "2026-10-05", grade: 4.5 }, // exam score
        { subject: "Physics", takenOn: "2026-10-01", grade: 3.5 },
      ]),
      { Analysis: 4.75, Physics: 3.5 },
    );
    assert.deepEqual(latestMockGrades([]), {});
  });

  it("a data point belongs to the subject whose topics it covers", () => {
    const subjects = toKnowledgeSubjects([
      { name: "Analysis", examDate: null, targetGrade: null, currentGrade: null },
      { name: "Physics", examDate: null, targetGrade: null, currentGrade: null },
    ]);
    const physicsTopic = subjects[1].topics[0].id;
    assert.equal(subjectOfDataPoint({ [physicsTopic]: 1 }, subjects), "Physics");
    assert.equal(subjectOfDataPoint({ "unknown.topic": 1 }, subjects), null);
  });
});
