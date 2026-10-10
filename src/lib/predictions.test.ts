import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGrade, Z90 } from "./grades";
import { toKnowledgeSubjects } from "./knowledge-topics";
import { formatPredictedGrade, predictionFor, subjectPredictions, type PredictionTimeline } from "./predictions";

const subjects = toKnowledgeSubjects([
  { name: "Analysis", examDate: "2027-02-12", targetGrade: 5, currentGrade: 4 },
  { name: "Physics", examDate: "2027-02-20", targetGrade: 5.5, currentGrade: 4.5 },
]);
const [analysis, physics] = subjects;

// Groups deliberately in a different order than the subjects.
const timeline = (observations: { weights: Record<string, number> }[] = []): PredictionTimeline => ({
  asOf: "2026-10-11T08:00:00Z",
  groups: [{ id: physics.id }, { id: analysis.id }],
  current: {
    groupLevels: [{ mean: 0.7, sd: 0.1 }, { mean: 0.6, sd: 0.12 }],
    groupForecasts: [{ mean: 0.8, sd: 0.08 }, { mean: 0.74, sd: 0.1 }],
  },
  steps: [{ observation: null }, ...observations.map((o) => ({ observation: o }))],
});

describe("subject predictions", () => {
  it("reads each subject's own group by id, never by position", () => {
    const p = predictionFor(timeline(), analysis)!;
    assert.equal(p.subject, "Analysis");
    assert.equal(p.current.grade, 1 + 5 * 0.6);
    assert.equal(p.examDay.grade, 1 + 5 * 0.74);
    const q = predictionFor(timeline(), physics)!;
    assert.equal(q.current.grade, 1 + 5 * 0.7);
    assert.equal(q.examDay.grade, 1 + 5 * 0.8);
  });

  it("shows exactly what the detailed charts show for the same timeline", () => {
    const t = timeline();
    const p = predictionFor(t, analysis)!;
    // The charts format the timeline's scores with formatGrade.
    assert.equal(formatPredictedGrade(p.current.grade), formatGrade(t.current.groupLevels[1].mean));
    assert.equal(formatPredictedGrade(p.examDay.grade), formatGrade(t.current.groupForecasts[1].mean));
    assert.equal(formatPredictedGrade(p.examDay.low), formatGrade(0.74 - Z90 * 0.1));
    assert.equal(formatPredictedGrade(p.examDay.high), formatGrade(0.74 + Z90 * 0.1));
    assert.equal(p.asOf, t.asOf);
  });

  it("current and exam-day grades are separate model outputs, not the target", () => {
    const p = predictionFor(timeline(), physics)!;
    assert.notEqual(p.current.grade, p.examDay.grade);
    assert.notEqual(p.examDay.grade, p.targetGrade);
  });

  it("without data points the prediction is the self-assessment", () => {
    const p = predictionFor(timeline(), analysis)!;
    assert.equal(p.basis, "self-assessment");
    assert.equal(p.evidence, 0);
  });

  it("counts only data points on the subject's own topics", () => {
    const mock = { weights: Object.fromEntries(analysis.topics.map((t) => [t.id, 1])) };
    const t = timeline([mock, mock]);
    assert.equal(predictionFor(t, analysis)!.evidence, 2);
    assert.equal(predictionFor(t, analysis)!.basis, "data");
    assert.equal(predictionFor(t, physics)!.evidence, 0);
  });

  it("a subject the model doesn't know yet has no prediction, rather than a made-up one", () => {
    const newSubject = toKnowledgeSubjects([{ name: "Chemistry", examDate: null, targetGrade: null, currentGrade: null }])[0];
    assert.equal(predictionFor(timeline(), newSubject), null);
    assert.deepEqual(subjectPredictions(timeline(), [analysis, newSubject]).map((p) => p.subject), ["Analysis"]);
  });

  it("grades stay on the 1–6 scale even at the edges", () => {
    const t = timeline();
    t.current.groupForecasts[1] = { mean: 0.99, sd: 0.2 };
    const p = predictionFor(t, analysis)!;
    assert.equal(p.examDay.high, 6);
    assert.ok(p.examDay.low >= 1);
  });
});
