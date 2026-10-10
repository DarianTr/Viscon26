import { z } from "zod";
import { handle, isId, jsonError, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import {
  DATA_POINT_TYPES,
  getOwnedPlan,
  KnowledgeError,
  listObservations,
  logObservation,
  syncTopics,
} from "@/lib/knowledge";
import { fromGrade, zurichNoon, zurichToday } from "@/lib/grades";

type Ctx = RouteContext<"/api/plans/[id]/observations">;

const knowledgeError = (e: unknown) => {
  if (e instanceof KnowledgeError) return jsonError(e.status, e.message, e.details);
  throw e;
};

// GET /api/plans/:id/observations — the user's logged data points for this plan, oldest first.
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");
    try {
      if (!(await getOwnedPlan(user.id, id))) return notFound("Plan");
      return Response.json({ observations: await listObservations(user.id, id) });
    } catch (e) {
      return knowledgeError(e);
    }
  });
}

const score = z.union([
  z.object({ points: z.number().min(0), maxPoints: z.number().positive().max(10_000) })
    .refine((v) => v.points <= v.maxPoints, { message: "Points can't exceed the maximum" }),
  z.object({ grade: z.number().min(1).max(6) }),
]);

const createSchema = z.object({
  type: z.enum(DATA_POINT_TYPES),
  /** A subject of the plan (its id). */
  subject: z.string().min(1).max(100),
  /** Which of the subject's topics it covered, weighted equally; all of them if omitted. */
  topics: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  takenOn: z.iso.date(),
  score,
});

// POST /api/plans/:id/observations — body: { type, subject, topics?, takenOn, score: { points, maxPoints } | { grade } }
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");
    const data = createSchema.parse(await request.json());
    const today = zurichToday();
    if (data.takenOn > today) return jsonError(400, "The date can't be in the future");
    try {
      const plan = await getOwnedPlan(user.id, id);
      if (!plan) return notFound("Plan");
      const subject = plan.subjects.find((x) => x.id === data.subject);
      if (!subject) return jsonError(400, "Unknown subject for this plan", data.subject);
      const known = new Set(subject.topics.map((t) => t.id));
      const covered = data.topics ? [...new Set(data.topics)] : [...known];
      const unknown = covered.filter((t) => !known.has(t));
      if (unknown.length > 0) return jsonError(400, `Unknown topics for ${subject.name}`, unknown);
      await syncTopics(plan);
      const observation = await logObservation(user.id, id, {
        type: data.type,
        // Today: now, so the model counts it immediately (it only replays data points up
        // to now). Earlier days: midday in Zurich, so the date never shifts across zones.
        observedAt: data.takenOn === today ? new Date().toISOString() : zurichNoon(data.takenOn),
        ...("grade" in data.score
          ? { score: fromGrade(data.score.grade) } // points default to the type's usual count
          : { score: data.score.points / data.score.maxPoints, nPoints: data.score.maxPoints }),
        weights: Object.fromEntries(covered.map((t) => [t, 1])),
      });
      return Response.json({ observation }, { status: 201 });
    } catch (e) {
      return knowledgeError(e);
    }
  });
}
