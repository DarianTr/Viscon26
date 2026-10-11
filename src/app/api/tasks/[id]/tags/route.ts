import { z } from "zod";
import { handle, isId, jsonError, notFound } from "@/lib/http";
import { setTags } from "@/lib/mutations";
import { MAX_TAGS } from "@/lib/photos";
import { getCurrentUser, getOwnActivity } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/tags">;

const tagsSchema = z.object({ userIds: z.array(z.uuid()).max(MAX_TAGS) });

// PUT /api/tasks/:id/tags — body: { userIds }. Replaces the friends tagged on
// your own completed session.
export async function PUT(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const activity = isId(id) && (await getOwnActivity(user.id, id));
    if (!activity) return notFound("Activity");
    const { userIds } = tagsSchema.parse(await request.json());
    const ok = await setTags(user, activity.id, userIds);
    return ok ? new Response(null, { status: 204 }) : jsonError(400, "You can only tag your friends");
  });
}
