import { z } from "zod";
import { deleteItem, getItem, updateItem } from "@/lib/store";
import { handle, isId, notFound } from "@/lib/http";

const updateItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    done: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one of: title, done",
  });

type Ctx = RouteContext<"/api/items/[id]">;

// GET /api/items/:id
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Item");
    const item = await getItem(id);
    return item ? Response.json({ item }) : notFound("Item");
  });
}

// PATCH /api/items/:id — body: { title?: string, done?: boolean }
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Item");
    const patch = updateItemSchema.parse(await request.json());
    const item = await updateItem(id, patch);
    return item ? Response.json({ item }) : notFound("Item");
  });
}

// DELETE /api/items/:id
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!isId(id)) return notFound("Item");
    const deleted = await deleteItem(id);
    return deleted ? new Response(null, { status: 204 }) : notFound("Item");
  });
}
