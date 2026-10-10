import { handle, isId, jsonError, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { deleteObservation, getOwnedPlan, KnowledgeError } from "@/lib/knowledge";

type Ctx = RouteContext<"/api/plans/[id]/observations/[obsId]">;

// DELETE /api/plans/:id/observations/:obsId
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id, obsId } = await ctx.params;
    if (!isId(id) || !isId(obsId)) return notFound("Data point");
    try {
      if (!(await getOwnedPlan(user.id, id))) return notFound("Plan");
      if (!(await deleteObservation(user.id, id, obsId))) return notFound("Data point");
      return new Response(null, { status: 204 });
    } catch (e) {
      if (e instanceof KnowledgeError) return jsonError(e.status, e.message, e.details);
      throw e;
    }
  });
}
