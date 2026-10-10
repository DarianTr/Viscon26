import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import {
  getOwnedPlan,
  getRecommendedTopics,
  KnowledgeError,
  syncTopics,
} from "@/lib/knowledge";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/plans/:id/focus
// Returns the plan's study focus (recommended topics) for client-side rendering.
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const plan = await getOwnedPlan(user.id, id);
    if (!plan) return notFound("Plan");

    if (plan.subjects.length === 0) {
      return Response.json({ error: "This plan has no subjects yet." }, { status: 422 });
    }

    try {
      await syncTopics(plan);
      const focus = await getRecommendedTopics(user.id, plan);
      return Response.json(focus);
    } catch (e) {
      if (e instanceof KnowledgeError) {
        return Response.json({ error: e.message }, { status: e.status >= 500 ? 503 : e.status });
      }
      throw e;
    }
  });
}
