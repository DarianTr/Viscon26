import { handle, isId, notFound } from "@/lib/http";
import { setKudos } from "@/lib/mutations";
import { getCurrentUser } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/kudos">;

function toggle(on: boolean) {
  return (_request: Request, ctx: Ctx) =>
    handle(async () => {
      const { id } = await ctx.params;
      if (!isId(id)) return notFound("Task");
      const user = await getCurrentUser();
      const ok = await setKudos(user.id, id, on);
      return ok ? new Response(null, { status: 204 }) : notFound("Task");
    });
}

// PUT /api/tasks/:id/kudos — give kudos. DELETE — take them back.
export const PUT = toggle(true);
export const DELETE = toggle(false);
