import { z } from "zod";
import { respondToChallenge, withdrawChallenge } from "@/lib/challenges";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";

type Ctx = RouteContext<"/api/challenges/[id]">;

const respondSchema = z.object({ accept: z.boolean() });

// PATCH /api/challenges/:id — body: { accept }. Answer a pending challenge sent
// to you; accepting adds the session to your day.
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const { accept } = respondSchema.parse(await request.json());
    const ok = isId(id) && (await respondToChallenge(user, id, accept));
    return ok ? new Response(null, { status: 204 }) : notFound("Pending challenge");
  });
}

// DELETE /api/challenges/:id — take back a challenge you sent, while it's unanswered.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const ok = isId(id) && (await withdrawChallenge(user.id, id));
    return ok ? new Response(null, { status: 204 }) : notFound("Pending challenge");
  });
}
