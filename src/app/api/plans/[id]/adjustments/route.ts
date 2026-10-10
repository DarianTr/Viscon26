import { z } from "zod";
import { handle, isId, notFound } from "@/lib/http";
import { getOwnedPlan, getTimeline, KnowledgeError, syncTopics } from "@/lib/knowledge";
import { floorsFromPredictions, recommendAdjustments, type TargetFloor } from "@/lib/plan-adjustments";
import { regenerationContext } from "@/lib/plans";
import { subjectPredictions } from "@/lib/predictions";
import { getCurrentUser } from "@/lib/queries";
import { planConfigSchema } from "../../schemas";

type Ctx = RouteContext<"/api/plans/[id]/adjustments">;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** A draft of the plan's settings; without it, the saved settings. Nothing is saved. */
  config: planConfigSchema.optional(),
});

// POST /api/plans/:id/adjustments — Smart plan adjustment for an existing plan:
// ways to make it achievable (lower targets, more time, both), each checked by
// the scheduler with the same inputs a recalibration uses — completed work,
// blocks moved by hand, the rest of the calendar. Targets never go below the
// prediction model's exam-day forecast. Read-only: nothing is saved.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");
    const { title, config } = bodySchema.parse(await request.json().catch(() => ({})));

    const now = new Date();
    const context = await regenerationContext(user.id, id, { ...config, title }, now);
    if (!context) return notFound("Plan");

    // The model's exam-day forecasts are the floors for lower targets, where it has them.
    let floors: Record<string, TargetFloor> = {};
    let model: "forecast" | "unavailable" = "unavailable";
    const owned = await getOwnedPlan(user.id, id);
    if (owned && owned.subjects.length > 0) {
      try {
        await syncTopics(owned);
        floors = floorsFromPredictions(subjectPredictions(await getTimeline(user.id, id), owned.subjects));
        model = "forecast";
      } catch (e) {
        if (!(e instanceof KnowledgeError)) throw e;
      }
    }

    const adjustments = recommendAdjustments({
      config: { planName: context.title ?? context.plan.title, ...context.config, subjects: context.subjects.map((s) => ({ ...s })) },
      now,
      options: { busy: context.busy, progress: context.progress },
      floors,
    });
    return Response.json({ ...adjustments, model });
  });
}
