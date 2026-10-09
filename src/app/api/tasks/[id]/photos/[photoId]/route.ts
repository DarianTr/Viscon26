import { handle, isId, notFound } from "@/lib/http";
import { deletePhoto } from "@/lib/mutations";
import { getCurrentUser, getOwnActivity } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/photos/[photoId]">;

// DELETE /api/tasks/:id/photos/:photoId — only on your own sessions.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id, photoId } = await ctx.params;
    const user = await getCurrentUser();
    const activity = isId(id) && isId(photoId) && (await getOwnActivity(user.id, id));
    const deleted = activity && (await deletePhoto(activity.id, photoId));
    return deleted ? new Response(null, { status: 204 }) : notFound("Photo");
  });
}
