import { handle, isId, jsonError, notFound } from "@/lib/http";
import { addPhoto } from "@/lib/mutations";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, sniffImageType } from "@/lib/photos";
import { getCurrentUser, getOwnActivity } from "@/lib/queries";

type Ctx = RouteContext<"/api/tasks/[id]/photos">;

// POST /api/tasks/:id/photos — multipart form with a `photo` file (JPEG, PNG
// or WebP, up to 5 MB). Only on your own completed sessions.
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const activity = isId(id) && (await getOwnActivity(user.id, id));
    if (!activity) return notFound("Activity");

    const file = (await request.formData().catch(() => null))?.get("photo");
    if (!(file instanceof File)) return jsonError(400, "Send the image as a `photo` form field");
    if (file.size > MAX_PHOTO_BYTES) return jsonError(413, "Photos can be at most 5 MB");

    const data = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImageType(data);
    if (!contentType) return jsonError(415, "Photos must be JPEG, PNG or WebP");

    const photo = await addPhoto(activity.id, contentType, data);
    if (!photo) return jsonError(409, `A post can have at most ${MAX_PHOTOS} photos`);
    return Response.json({ photo }, { status: 201 });
  });
}
