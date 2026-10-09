import { handle, isId, notFound } from "@/lib/http";
import { setClubMembership } from "@/lib/mutations";
import { getCurrentUser } from "@/lib/queries";

type Ctx = RouteContext<"/api/clubs/[id]/membership">;

function toggle(on: boolean) {
  return (_request: Request, ctx: Ctx) =>
    handle(async () => {
      const { id } = await ctx.params;
      if (!isId(id)) return notFound("Club");
      const user = await getCurrentUser();
      const ok = await setClubMembership(user.id, id, on);
      return ok ? new Response(null, { status: 204 }) : notFound("Club");
    });
}

// PUT /api/clubs/:id/membership — join. DELETE — leave.
export const PUT = toggle(true);
export const DELETE = toggle(false);
