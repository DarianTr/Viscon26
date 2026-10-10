import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, isId, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";

type Ctx = RouteContext<"/api/plans/[id]/subjects/files/[fileId]">;

// DELETE /api/plans/:id/subjects/files/:fileId — remove one uploaded study material.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { id, fileId } = await ctx.params;
    if (!isId(id) || !isId(fileId)) return notFound("File");
    const [row] = await db
      .delete(s.userCourseMaterials)
      .where(
        and(
          eq(s.userCourseMaterials.id, fileId),
          eq(s.userCourseMaterials.userPlanId, id),
          eq(s.userCourseMaterials.userId, user.id),
        ),
      )
      .returning({ id: s.userCourseMaterials.id });
    return row ? new Response(null, { status: 204 }) : notFound("File");
  });
}
