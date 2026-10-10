import { z } from "zod";
import { handle, isId, notFound } from "@/lib/http";
import { addComment } from "@/lib/mutations";
import { getCurrentUser, getVisibleActivity, listComments } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/comments">;

const commentSchema = z.object({ body: z.string().trim().min(1).max(1000) });

// GET /api/tasks/:id/comments — comments on an activity you can see in the feed.
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const activity = isId(id) && (await getVisibleActivity(user.id, id));
    if (!activity) return notFound("Activity");
    return Response.json({ comments: await listComments(user.id, activity.id, activity.ownerId) });
  });
}

// POST /api/tasks/:id/comments — body: { body }
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const activity = isId(id) && (await getVisibleActivity(user.id, id));
    if (!activity) return notFound("Activity");
    const { body } = commentSchema.parse(await request.json());
    return Response.json({ comment: await addComment(user, activity, body) }, { status: 201 });
  });
}
