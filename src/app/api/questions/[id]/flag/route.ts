import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";

type Ctx = { params: Promise<{ id: string }> };

const flagSchema = z.object({
  reason: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
});

// POST /api/questions/[id]/flag
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Question");

    const [question] = await db
      .select({ id: s.questions.id })
      .from(s.questions)
      .where(eq(s.questions.id, id));

    if (!question) return notFound("Question");

    const body = flagSchema.parse(await request.json());

    // Insert flag — ignore duplicate (one flag per user per question)
    await db
      .insert(s.questionFlags)
      .values({
        questionId: id,
        userId: user.id,
        reason: body.reason,
        note: body.note ?? null,
      })
      .onConflictDoNothing();

    // Mark the question as flagged
    await db
      .update(s.questions)
      .set({ status: "flagged" })
      .where(eq(s.questions.id, id));

    return Response.json({ flagged: true });
  });
}
