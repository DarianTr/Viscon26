import { handle, isId, notFound } from "@/lib/http";
import { deleteUser, getUser, updateUser } from "@/lib/users";
import { updateUserSchema } from "../schemas";

type Ctx = RouteContext<"/api/users/[id]">;

// GET /api/users/:id
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = isId(id) ? await getUser(id) : undefined;
    return user ? Response.json({ user }) : notFound("User");
  });
}

// PATCH /api/users/:id — body: any of { handle, name, hue, program, weeklyGoalHours }
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("User");
    const user = await updateUser(id, updateUserSchema.parse(await request.json()));
    return user ? Response.json({ user }) : notFound("User");
  });
}

// DELETE /api/users/:id — also deletes the user's tasks, kudos and friendships.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const deleted = isId(id) && (await deleteUser(id));
    return deleted ? new Response(null, { status: 204 }) : notFound("User");
  });
}
