import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { handle, isId, jsonError, notFound, parseQuery } from "@/lib/http";
import { getOwnedPlan } from "@/lib/knowledge";
import { getCurrentUser } from "@/lib/queries";
import type { McqContent } from "@/db/schema";

type Ctx = RouteContext<"/api/plans/[id]/practice/questions">;

/** A question shape returned to the client — without the correct answer index. */
export type QuestionForUser = Omit<McqContent, "correctIndex"> & {
  id: string;
  topicId: string;
};

// GET /api/plans/[id]/practice/questions?topicId=X&limit=5
export async function GET(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const plan = await getOwnedPlan(user.id, id);
    if (!plan) return notFound("Plan");

    const { topicId, limit: limitStr } = parseQuery(
      request,
      z.object({ topicId: z.string().min(1), limit: z.string().optional() }),
    );
    const limit = Math.min(20, Math.max(1, parseInt(limitStr ?? "5", 10) || 5));

    // Questions for this topic that aren't flagged and haven't been answered by this user.
    const alreadyAnswered = db
      .select({ questionId: s.questionViews.questionId })
      .from(s.questionViews)
      .where(eq(s.questionViews.userId, user.id));

    const flaggedByUser = db
      .select({ questionId: s.questionFlags.questionId })
      .from(s.questionFlags)
      .where(eq(s.questionFlags.userId, user.id));

    const rows = await db
      .select({
        id: s.questions.id,
        topicId: s.questions.topicId,
        content: s.questions.content,
      })
      .from(s.questions)
      .where(
        and(
          eq(s.questions.topicId, topicId),
          notInArray(s.questions.status, ["flagged"]),
          sql`${s.questions.id} not in ${alreadyAnswered}`,
          sql`${s.questions.id} not in ${flaggedByUser}`,
        ),
      )
      .limit(limit);

    const questions: QuestionForUser[] = rows.map((r) => ({
      id: r.id,
      topicId: r.topicId,
      stem: r.content.stem,
      options: r.content.options,
      explanation: r.content.explanation,
    }));

    return Response.json({ questions });
  });
}

const generateSchema = z.object({
  topicId: z.string().min(1),
  count: z.number().int().min(1).max(20).optional(),
});

// POST /api/plans/[id]/practice/questions — generate MCQs via OpenAI
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const plan = await getOwnedPlan(user.id, id);
    if (!plan) return notFound("Plan");

    const body = generateSchema.parse(await request.json());
    const { topicId, count = 5 } = body;

    // Extract course slug from topicId (everything before the first ".")
    const courseSlug = topicId.split(".")[0];

    // Fetch course profile
    const [profile] = await db
      .select({
        slug: s.courseProfiles.slug,
        name: s.courseProfiles.name,
        description: s.courseProfiles.description,
        learningObjectives: s.courseProfiles.learningObjectives,
        topics: s.courseProfiles.topics,
      })
      .from(s.courseProfiles)
      .where(eq(s.courseProfiles.slug, courseSlug));

    if (!profile) return jsonError(404, "Course profile not found for this topic");

    // Find topic name from profile
    const topicEntry = profile.topics.find((t) => t.id === topicId);
    const topicName = topicEntry?.name ?? topicId.split(".").slice(1).join(" ");

    // Fetch exercise/script content from course_resources (up to 3000 chars)
    const resourceRows = await db
      .select({ content: s.courseResources.content, type: s.courseResources.type })
      .from(s.courseResources)
      .where(
        and(
          eq(s.courseResources.courseSlug, courseSlug),
          inArray(s.courseResources.type, ["exercises", "script"]),
        ),
      )
      .limit(5);

    let resources = "";
    for (const r of resourceRows) {
      if (!r.content) continue;
      resources += r.content;
      if (resources.length >= 3000) {
        resources = resources.slice(0, 3000);
        break;
      }
    }

    // Build OpenAI prompt
    const systemPrompt =
      `You are generating multiple-choice exam questions for ETH Zürich university students.\n` +
      `Generate ${count} questions specifically about "${topicName}" in the course "${profile.name}".\n` +
      `University-level difficulty. Each question must have exactly 4 options, one correct answer.\n` +
      `Include a brief educational explanation of the correct answer.\n` +
      `Return valid JSON: {"questions":[{"stem":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]}`;

    const userPrompt =
      `Topic: ${topicName}\n` +
      `Course description: ${profile.description ?? "N/A"}\n` +
      `Learning objectives: ${profile.learningObjectives ?? "N/A"}\n` +
      (resources ? `Course materials:\n${resources}` : "");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let generated: { questions?: unknown[] };
    try {
      generated = JSON.parse(raw) as { questions?: unknown[] };
    } catch {
      return jsonError(502, "OpenAI returned invalid JSON");
    }

    const mcqSchema = z.object({
      stem: z.string().min(1),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string().min(1),
    });

    const valid = (generated.questions ?? [])
      .map((q) => mcqSchema.safeParse(q))
      .filter((r) => r.success)
      .map((r) => r.data!);

    if (valid.length === 0) {
      return jsonError(502, "OpenAI returned no valid questions");
    }

    // Persist questions
    const inserted = await db
      .insert(s.questions)
      .values(
        valid.map((q) => ({
          courseSlug,
          topicId,
          type: "mcq" as const,
          content: q,
          source: "generated",
          status: "pending",
        })),
      )
      .returning({
        id: s.questions.id,
        topicId: s.questions.topicId,
        content: s.questions.content,
      });

    const questions: QuestionForUser[] = inserted.map((r) => ({
      id: r.id,
      topicId: r.topicId,
      stem: r.content.stem,
      options: r.content.options,
      explanation: r.content.explanation,
    }));

    return Response.json({ questions }, { status: 201 });
  });
}
