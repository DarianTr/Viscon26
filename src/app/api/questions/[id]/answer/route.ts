import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { handle, isId, notFound } from "@/lib/http";
import { logObservation } from "@/lib/knowledge";
import { getCurrentUser } from "@/lib/queries";

type Ctx = { params: Promise<{ id: string }> };

const answerSchema = z.object({
  selectedIndex: z.number().int().min(0).max(3),
  planId: z.string().uuid(),
});

// POST /api/questions/[id]/answer
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Question");

    const body = answerSchema.parse(await request.json());

    // Fetch the question; 404 if not found or flagged
    const [question] = await db
      .select()
      .from(s.questions)
      .where(and(eq(s.questions.id, id), sql`${s.questions.status} <> 'flagged'`));

    if (!question) return notFound("Question");

    const correct = body.selectedIndex === question.content.correctIndex;

    // Upsert into question_views — first answer counts; ignore if already answered
    await db
      .insert(s.questionViews)
      .values({
        questionId: id,
        userId: user.id,
        answeredCorrectly: correct,
      })
      .onConflictDoNothing();

    // Promotion check: no flags + enough distinct users answered → trusted
    const [flagCount] = await db
      .select({ n: count() })
      .from(s.questionFlags)
      .where(eq(s.questionFlags.questionId, id));

    const [viewCount] = await db
      .select({ n: count() })
      .from(s.questionViews)
      .where(eq(s.questionViews.questionId, id));

    let promoted = false;
    if ((flagCount?.n ?? 0) === 0 && (viewCount?.n ?? 0) >= question.requiredViews) {
      await db
        .update(s.questions)
        .set({ status: "trusted" })
        .where(and(eq(s.questions.id, id), eq(s.questions.status, "pending")));
      promoted = true;
    }

    // Log observation to knowledge service
    const topicId = question.topicId;
    await logObservation(user.id, body.planId, {
      type: "quiz",
      observedAt: new Date().toISOString(),
      score: correct ? 1.0 : 0.25,
      weights: { [topicId]: 1 },
    });

    return Response.json({
      correct,
      correctIndex: question.content.correctIndex,
      explanation: question.content.explanation,
      ...(promoted ? { promoted: true } : {}),
    });
  });
}
