import "server-only";
import OpenAI from "openai";
import type { SubjectPrediction } from "./predictions";
import {
  buildStrategyPrompt,
  type DataPointEntry,
  type HourlyActivity,
  type ScoreEntry,
  type SubjectStat,
} from "./strategy-prompt";

export type { DataPointEntry, HourlyActivity, ScoreEntry, SubjectStat };

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
  /**
   * Suggested first-session start hour derived from behavioral data (5–12).
   * Null if there is insufficient session history to make a recommendation.
   */
  preferredStartHour: number | null;
};

const recommendTool: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_recommendations",
    description: "Submit structured study strategy recommendations based on exam performance and behavioral data.",
    parameters: {
      type: "object",
      properties: {
        overallInsight: {
          type: "string",
          description:
            "1–2 sentence overall assessment and the single most important action the student should take right now.",
        },
        preferredStartHour: {
          type: "number",
          description:
            "Recommended first-session start hour (integer 5–12) based on when the student historically completes sessions with highest focus. Set to null if fewer than 5 completed sessions exist or data is inconclusive.",
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
      required: ["overallInsight", "preferredStartHour", "recommendations"],
    },
  },
};

export async function runStrategyAgent(
  scores: ScoreEntry[],
  subjects: SubjectStat[],
  hourlyActivity: HourlyActivity[],
  /** The grade prediction model's results and evidence (lib/predictions.ts). */
  model: { predictions: SubjectPrediction[]; dataPoints: DataPointEntry[] } = { predictions: [], dataPoints: [] },
): Promise<StrategyResult> {
  const client = new OpenAI();
  const userPrompt = buildStrategyPrompt({
    today: new Date().toISOString().slice(0, 10),
    subjects,
    scores,
    dataPoints: model.dataPoints,
    predictions: model.predictions,
    hourlyActivity,
  });

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
