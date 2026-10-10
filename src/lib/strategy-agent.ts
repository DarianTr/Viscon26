import "server-only";
import OpenAI from "openai";

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

export type SubjectRecommendation = {
  subject: string;
  /** 2–3 sentence plain-language insight for the student. */
  insight: string;
  urgency: "low" | "medium" | "high";
  /** Only present when a different approach would help. */
  suggestedApproach?: "foundation" | "balanced" | "exam";
  /**
   * Signed delta applied to the subject's confidence score (−1 to +1).
   * Negative = student over-estimated their level; positive = under-estimated.
   */
  confidenceDelta: number;
  /** Specific topics / error patterns extracted from score notes. */
  priorityTopics: string[];
};

export type StrategyResult = {
  recommendations: SubjectRecommendation[];
  overallInsight: string;
};

const recommendTool: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_recommendations",
    description: "Submit structured study strategy recommendations based on exam performance data.",
    parameters: {
      type: "object",
      properties: {
        overallInsight: {
          type: "string",
          description:
            "1–2 sentence overall assessment and the single most important action the student should take right now.",
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              subject: { type: "string" },
              insight: {
                type: "string",
                description:
                  "2–3 sentences: what the score data reveals and the most concrete change to make. Reference actual scores/notes.",
              },
              urgency: {
                type: "string",
                enum: ["low", "medium", "high"],
                description:
                  "'high' if average below 4.0 or exam within 2 weeks. 'medium' if trending down or near target. 'low' if on track.",
              },
              suggestedApproach: {
                type: "string",
                enum: ["foundation", "balanced", "exam"],
                description:
                  "Only include when a change would clearly help. 'foundation' = conceptual groundwork; 'balanced' = theory + practice mix; 'exam' = drill past papers.",
              },
              confidenceDelta: {
                type: "number",
                description:
                  "Value from −1 to +1. Negative if scores reveal over-confidence; positive if scores are better than expected. 0 if appropriate.",
              },
              priorityTopics: {
                type: "array",
                items: { type: "string" },
                description:
                  "Specific topics or error patterns to prioritise, extracted from score notes. Empty array if notes are sparse.",
              },
            },
            required: ["subject", "insight", "urgency", "confidenceDelta", "priorityTopics"],
          },
        },
      },
      required: ["overallInsight", "recommendations"],
    },
  },
};

export async function runStrategyAgent(
  scores: ScoreEntry[],
  subjects: SubjectStat[],
): Promise<StrategyResult> {
  const client = new OpenAI();
  const today = new Date().toISOString().slice(0, 10);

  const sections = subjects.map((sub) => {
    const subScores = scores.filter((sc) => sc.subject === sub.subject);
    const pct = sub.total > 0 ? Math.round((sub.done / sub.total) * 100) : 0;
    const examLine = sub.examDate
      ? `Exam on ${sub.examDate.slice(0, 10)}`
      : "No exam date set";

    const scoreLines =
      subScores.length === 0
        ? "  No scores logged yet."
        : subScores
            .map(
              (sc) =>
                `  • ${sc.takenAt} | ${sc.examType === "mock" ? "Mock" : "Past paper"} → ${sc.score}/6` +
                (sc.notes ? ` ("${sc.notes}")` : ""),
            )
            .join("\n");

    return (
      `### ${sub.subject}\n` +
      `Progress: ${pct}% (${sub.done}/${sub.total} sessions) | ${examLine}\n` +
      `Scores:\n${scoreLines}`
    );
  });

  const userPrompt =
    `A student on the Swiss grade system (1–6, passing = 4.0) has logged the following exam performance. ` +
    `Analyse each subject and give targeted, evidence-based recommendations.\n\n` +
    `Today: ${today}\n\n` +
    sections.join("\n\n") +
    `\n\nReference the actual scores and notes — be specific, not generic.`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a concise study strategy advisor who gives specific, data-driven recommendations.",
      },
      { role: "user", content: userPrompt },
    ],
    tools: [recommendTool],
    tool_choice: { type: "function", function: { name: "submit_recommendations" } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") throw new Error("Strategy agent returned no tool call");

  return JSON.parse(toolCall.function.arguments) as StrategyResult;
}
