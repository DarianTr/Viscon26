import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser, getVisiblePhoto } from "@/lib/queries";

type Ctx = RouteContext<"/api/photos/[id]">;

// GET /api/photos/:id — the image, if it's on an activity you can see.
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const photo = isId(id) && (await getVisiblePhoto(user.id, id));
    if (!photo) return notFound("Photo");
    return new Response(new Uint8Array(photo.data), {
      headers: {
        "Content-Type": photo.contentType,
        // Photos never change (a new upload gets a new id), but who may see
        // them can, so only the browser caches them, and not for long.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
