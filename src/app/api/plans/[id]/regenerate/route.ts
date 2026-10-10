import { z } from "zod";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { regeneratePlan } from "@/lib/plans";
import { planConfigSchema } from "../../schemas";

type Ctx = RouteContext<"/api/plans/[id]/regenerate">;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** New settings; without them, the plan's saved settings ("Recalibrate plan"). */
  config: planConfigSchema.optional(),
  /** false: only preview what would change; true: replace the upcoming uncompleted schedule. */
  apply: z.boolean(),
});

// POST /api/plans/:id/regenerate — "Recalibrate plan": regenerate the schedule
// from now on, with new or the saved settings. Everything before now, completed
// blocks and logged exam scores stay; their work isn't scheduled again. Preview
// first with apply: false to see what would be replaced.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Plan");

    const { title, config, apply } = bodySchema.parse(await request.json());
    const outcome = await regeneratePlan(user.id, id, { ...config, title }, { apply });
    if (!outcome) return notFound("Plan");

    const { result, replaced, kept, manualKept, manualReplaced } = outcome;
    return Response.json({
      applied: apply,
      replaced,
      kept,
      manualKept,
      manualReplaced,
      created: result.sessions.length,
      breakdown: result.breakdown,
      warnings: result.warnings,
      feasibility: result.feasibility,
      firstDate: result.firstDate,
      lastDate: result.lastDate,
    });
  });
}
