import { handle, isId, notFound } from "@/lib/http";
import { deleteComment } from "@/lib/mutations";
import { getCurrentUser, getVisibleActivity } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/comments/[commentId]">;

// DELETE /api/tasks/:id/comments/:commentId — your own comment, or any on your activity.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id, commentId } = await ctx.params;
    if (!isId(id) || !isId(commentId)) return notFound("Comment");
    const user = await getCurrentUser();
    const activity = await getVisibleActivity(user.id, id);
    const deleted = activity && (await deleteComment(user.id, activity, commentId));
    return deleted ? new Response(null, { status: 204 }) : notFound("Comment");
  });
}
