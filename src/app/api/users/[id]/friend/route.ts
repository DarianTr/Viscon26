import { handle, isId, jsonError, notFound } from "@/lib/http";
import { setFriend } from "@/lib/mutations";
import { getCurrentUser } from "@/lib/queries";

type Ctx = RouteContext<"/api/users/[id]/friend">;

function toggle(on: boolean) {
  return (_request: Request, ctx: Ctx) =>
    handle(async () => {
      const { id } = await ctx.params;
      if (!isId(id)) return notFound("User");
      const user = await getCurrentUser();
      if (id === user.id) return jsonError(400, "You can't befriend yourself");
      const status = await setFriend(user, id, on);
      return status ? Response.json({ status }) : notFound("User");
    });
}

// PUT /api/users/:id/friend — send a friend request, or accept theirs.
// DELETE — cancel your request, decline theirs, or unfriend.
export const PUT = toggle(true);
export const DELETE = toggle(false);
