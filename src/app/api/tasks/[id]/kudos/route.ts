import { handle, isId, notFound } from "@/lib/http";
import { setKudos } from "@/lib/mutations";
import { getCurrentUser, getVisibleActivity } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/kudos">;

function toggle(on: boolean) {
  return (_request: Request, ctx: Ctx) =>
    handle(async () => {
      const { id } = await ctx.params;
      const user = await getCurrentUser();
      const activity = isId(id) && (await getVisibleActivity(user.id, id));
      if (!activity) return notFound("Activity");
      await setKudos(user.id, activity.id, on);
      return new Response(null, { status: 204 });
    });
}

// PUT /api/tasks/:id/kudos — give kudos on an activity you can see. DELETE — take them back.
export const PUT = toggle(true);
export const DELETE = toggle(false);
