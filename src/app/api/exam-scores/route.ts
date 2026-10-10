import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { handle, isId, parseQuery } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { db, schema as s } from "@/db";

const querySchema = z.object({ planId: z.string() });

export async function GET(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { planId } = parseQuery(request, querySchema);
    if (!isId(planId)) return Response.json([]);

    const scores = await db
      .select({
        id: s.examScores.id,
        subject: s.examScores.subject,
        score: s.examScores.score,
        examType: s.examScores.examType,
        takenAt: s.examScores.takenAt,
        notes: s.examScores.notes,
      })
      .from(s.examScores)
      .where(and(eq(s.examScores.userId, user.id), eq(s.examScores.userPlanId, planId)))
      .orderBy(asc(s.examScores.takenAt));

    return Response.json(scores);
  });
}

const createSchema = z.object({
  userPlanId: z.string().optional(),
  subject: z.string().trim().min(1).max(100),
  score: z.number().min(1).max(6),
  examType: z.enum(["mock", "past"]),
  takenAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    const data = createSchema.parse(await request.json());

    const [score] = await db
      .insert(s.examScores)
      .values({ ...data, userId: user.id })
      .returning({
        id: s.examScores.id,
        subject: s.examScores.subject,
        score: s.examScores.score,
        examType: s.examScores.examType,
        takenAt: s.examScores.takenAt,
        notes: s.examScores.notes,
      });

    return Response.json(score, { status: 201 });
  });
}
