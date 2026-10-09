import { handle, isId, jsonError, notFound } from "@/lib/http";
import { setFollow } from "@/lib/mutations";
import { getCurrentUser } from "@/lib/queries";

type Ctx = RouteContext<"/api/users/[id]/follow">;

function toggle(on: boolean) {
  return (_request: Request, ctx: Ctx) =>
    handle(async () => {
      const { id } = await ctx.params;
      if (!isId(id)) return notFound("User");
      const user = await getCurrentUser();
      if (id === user.id) return jsonError(400, "You can't follow yourself");
      const ok = await setFollow(user.id, id, on);
      return ok ? new Response(null, { status: 204 }) : notFound("User");
    });
}

// PUT /api/users/:id/follow — follow. DELETE — unfollow.
export const PUT = toggle(true);
export const DELETE = toggle(false);
