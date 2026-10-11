"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Button } from "@/components/ui/primitives";
import { formatGrade } from "@/lib/grades";
import type { StudyFocus, TopicRecommendation } from "@/lib/knowledge";
import type { QuestionForUser } from "@/app/api/plans/[id]/practice/questions/route";

type Phase = "pick" | "quiz" | "done";

type AnswerResult = {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  promoted?: boolean;
};

export function PracticeSection({
  planId,
  focus,
}: {
  planId: string;
  focus: StudyFocus;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [selectedTopic, setSelectedTopic] = useState<TopicRecommendation | null>(null);
  const [questions, setQuestions] = useState<QuestionForUser[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [generating, setGenerating] = useState<string | null>(null); // topicId being generated
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [loadingTopicId, setLoadingTopicId] = useState<string | null>(null);
  const [genFailed, setGenFailed] = useState(false);

  const maxAlloc = Math.max(...focus.topics.map((t) => t.allocation), 1);

  async function fetchQuestions(topic: TopicRecommendation) {
    setLoadingTopicId(topic.topicId);
    try {
      const res = await fetch(
        `/api/plans/${planId}/practice/questions?topicId=${encodeURIComponent(topic.topicId)}&limit=5`,
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { questions: QuestionForUser[] };
      return data.questions;
    } finally {
      setLoadingTopicId(null);
    }
  }

  async function generateQuestions(topic: TopicRecommendation) {
    setGenerating(topic.topicId);
    try {
      const res = await fetch(`/api/plans/${planId}/practice/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId: topic.topicId, count: 5 }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { questions: QuestionForUser[] };
      return data.questions;
    } finally {
      setGenerating(null);
    }
  }

  async function startQuiz(topic: TopicRecommendation) {
    setGenFailed(false);
    let qs = await fetchQuestions(topic);
    if (qs.length === 0) {
      // No existing questions — generate some
      qs = await generateQuestions(topic);
    }
    if (qs.length === 0) {
      setGenFailed(true);
      return;
    }
    setSelectedTopic(topic);
    setQuestions(qs);
    setQIndex(0);
    setSelectedOption(null);
    setResult(null);
    setScore({ correct: 0, total: 0 });
    setFlagged(false);
    setPhase("quiz");
  }

  async function submitAnswer(optionIndex: number) {
    if (result !== null || questions.length === 0) return;
    const q = questions[qIndex];
    setSelectedOption(optionIndex);

    const res = await fetch(`/api/questions/${q.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedIndex: optionIndex, planId }),
    });

    if (!res.ok) return;
    const data = (await res.json()) as AnswerResult;
    setResult(data);
    setScore((prev) => ({
      correct: prev.correct + (data.correct ? 1 : 0),
      total: prev.total + 1,
    }));
  }

  function nextQuestion() {
    if (qIndex + 1 >= questions.length) {
      setPhase("done");
      return;
    }
    setQIndex((i) => i + 1);
    setSelectedOption(null);
    setResult(null);
    setFlagged(false);
  }

  async function flagQuestion() {
    if (!questions[qIndex]) return;
    setFlagging(true);
    try {
      await fetch(`/api/questions/${questions[qIndex].id}/flag`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "incorrect_or_misleading" }),
      });
      setFlagged(true);
    } finally {
      setFlagging(false);
    }
  }

  function resetToPick() {
    setPhase("pick");
    setSelectedTopic(null);
    setQuestions([]);
    setQIndex(0);
    setSelectedOption(null);
    setResult(null);
    setFlagged(false);
    setScore({ correct: 0, total: 0 });
    setGenFailed(false);
  }

  // ---- Pick phase ----
  if (phase === "pick") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Choose a topic to practice. Your weakest topics are listed first.
        </p>
        {focus.topics.length === 0 && (
          <Card>
            <p className="text-sm text-muted">No topics available yet. Add subjects to your plan first.</p>
          </Card>
        )}
        {genFailed && (
          <Card>
            <p className="text-sm text-destructive">
              Could not generate questions. Check that your OpenAI API key is configured, then try again.
            </p>
          </Card>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {focus.topics.map((topic) => (
            <TopicCard
              key={topic.topicId}
              topic={topic}
              maxAlloc={maxAlloc}
              loading={loadingTopicId === topic.topicId || generating === topic.topicId}
              onStart={() => startQuiz(topic)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ---- Quiz phase ----
  if (phase === "quiz" && questions.length > 0) {
    const q = questions[qIndex];
    const prefixes = ["A", "B", "C", "D"];
    const answered = result !== null;

    return (
      <div className="space-y-4">
        {/* Progress bar */}
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{selectedTopic?.topicName}</span>
          <span>
            Question {qIndex + 1} of {questions.length}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${((qIndex + 1) / questions.length) * 100}%` }}
          />
        </div>

        <Card>
          <p className="text-base font-medium leading-relaxed">{q.stem}</p>
        </Card>

        {/* Options */}
        <div className="space-y-2">
          {q.options.map((option, i) => {
            let style =
              "w-full text-left rounded-2xl border-2 border-border bg-surface px-4 py-3 text-sm font-medium transition-colors";
            if (answered) {
              if (i === result.correctIndex) {
                style += " border-green-500 bg-green-50 text-green-800";
              } else if (i === selectedOption && !result.correct) {
                style += " border-red-400 bg-red-50 text-red-800";
              } else {
                style += " opacity-50";
              }
            } else {
              style += " hover:bg-surface-2 cursor-pointer";
            }

            return (
              <button
                key={i}
                className={style}
                disabled={answered}
                onClick={() => submitAnswer(i)}
              >
                <span className="mr-2 font-bold">{prefixes[i]}.</span>
                {option}
              </button>
            );
          })}
        </div>

        {/* Post-answer: explanation + controls */}
        {answered && (
          <Card className="space-y-3">
            <p className="text-sm font-semibold">
              {result.correct ? "Correct!" : "Not quite."}
            </p>
            <p className="text-sm text-muted">{result.explanation}</p>

            <div className="flex items-center justify-between gap-2 pt-1">
              {!flagged ? (
                <button
                  className="text-xs text-muted underline hover:text-foreground disabled:opacity-50"
                  onClick={flagQuestion}
                  disabled={flagging}
                >
                  {flagging ? "Flagging…" : "Flag this question"}
                </button>
              ) : (
                <span className="text-xs text-muted">Question flagged</span>
              )}

              <Button
                variant="primary"
                size="sm"
                onClick={nextQuestion}
              >
                {qIndex + 1 >= questions.length ? "Finish" : "Next question"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ---- Done phase ----
  if (phase === "done") {
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    return (
      <div className="space-y-4">
        <Card className="text-center space-y-3">
          <p className="text-4xl font-extrabold font-display">
            {score.correct}/{score.total}
          </p>
          <p className="text-sm text-muted">
            {pct >= 80
              ? "Excellent work!"
              : pct >= 50
                ? "Good effort — keep it up."
                : "Keep practising — you'll get there."}
          </p>
          <p className="text-xs text-muted">
            {pct}% correct on {selectedTopic?.topicName}
          </p>
        </Card>

        <Link
          href={`/?log=${planId}#log-data`}
          className="flex w-full items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
        >
          Upload results
        </Link>
        <Button variant="ghost" className="w-full" onClick={resetToPick}>
          Try another topic
        </Button>
      </div>
    );
  }

  return null;
}

function TopicCard({
  topic,
  maxAlloc,
  loading,
  onStart,
}: {
  topic: TopicRecommendation;
  maxAlloc: number;
  loading: boolean;
  onStart: () => void;
}) {
  const barWidth = (topic.allocation / maxAlloc) * 100;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-sm font-semibold">{topic.topicName}</p>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-muted">
          {formatGrade(topic.currentMean)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        disabled={loading}
        onClick={onStart}
      >
        {loading ? "Loading…" : "Start quiz"}
      </Button>
    </Card>
  );
}
