import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, jsonError, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { fetchVvzCourse } from "@/lib/vvz";
import { topicSlug } from "@/lib/knowledge-topics";

type Ctx = RouteContext<"/api/courses/[slug]">;

/** GET /api/courses/[slug] — full detail including topics. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const [profile] = await db
      .select()
      .from(s.courseProfiles)
      .where(eq(s.courseProfiles.slug, slug));
    if (!profile) return notFound("Course profile");
    return Response.json(profile);
  });
}

/**
 * POST /api/courses/[slug]/refresh is at a separate path; this PATCH lets an
 * admin re-fetch from VVZ and update the stored topics in place.
 */
export async function PATCH(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user.isAdmin) return jsonError(403, "Admin only");

    const { slug } = await ctx.params;
    const [profile] = await db
      .select()
      .from(s.courseProfiles)
      .where(eq(s.courseProfiles.slug, slug));
    if (!profile) return notFound("Course profile");

    if (!profile.courseCode) {
      return jsonError(422, "No courseCode stored — cannot refresh from VVZ automatically.");
    }

    const vvz = await fetchVvzCourse(profile.courseCode);
    if (!vvz) {
      return jsonError(502, "VVZ did not return usable content for this course code. The page may not be available yet for the current semester.");
    }

    const topics = vvz.topics.map((name) => ({
      id: `${slug}.${topicSlug(name)}`,
      name,
    }));

    await db
      .update(s.courseProfiles)
      .set({ topics, description: vvz.description, sourceUrl: vvz.sourceUrl, fetchedAt: new Date() })
      .where(eq(s.courseProfiles.slug, slug));

    return Response.json({ slug, topicCount: topics.length });
  });
}

/** DELETE /api/courses/[slug] — admin: remove a course profile. */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user.isAdmin) return jsonError(403, "Admin only");

    const { slug } = await ctx.params;
    const [deleted] = await db
      .delete(s.courseProfiles)
      .where(eq(s.courseProfiles.slug, slug))
      .returning({ slug: s.courseProfiles.slug });
    if (!deleted) return notFound("Course profile");
    return new Response(null, { status: 204 });
  });
}
