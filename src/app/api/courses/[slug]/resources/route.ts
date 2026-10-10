import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, jsonError, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { discoverResourceLinks, fetchPageContent } from "@/lib/vvz";

type Ctx = RouteContext<"/api/courses/[slug]/resources">;

/**
 * GET /api/courses/[slug]/resources — list stored resources for a course.
 * Optionally filtered by ?type=exercises|script|slides|exam|solution|website|other
 */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const type = new URL(req.url).searchParams.get("type");

    const [profile] = await db
      .select({ slug: s.courseProfiles.slug })
      .from(s.courseProfiles)
      .where(eq(s.courseProfiles.slug, slug));
    if (!profile) return notFound("Course profile");

    const resources = await db
      .select({
        id: s.courseResources.id,
        title: s.courseResources.title,
        type: s.courseResources.type,
        url: s.courseResources.url,
        hasContent: s.courseResources.content,
        contentFetchedAt: s.courseResources.contentFetchedAt,
        createdAt: s.courseResources.createdAt,
      })
      .from(s.courseResources)
      .where(eq(s.courseResources.courseSlug, slug))
      .orderBy(asc(s.courseResources.type), asc(s.courseResources.title));

    const filtered = type
      ? resources.filter((r) => r.type === type)
      : resources;

    return Response.json({
      courseSlug: slug,
      resources: filtered.map((r) => ({
        ...r,
        hasContent: r.hasContent !== null,
      })),
    });
  });
}

/**
 * POST /api/courses/[slug]/resources/refresh — admin: re-discover resources
 * from the course website and upsert them into course_resources.
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user.isAdmin) return jsonError(403, "Admin only");

    const { slug } = await ctx.params;
    const [profile] = await db
      .select({ websiteUrl: s.courseProfiles.websiteUrl })
      .from(s.courseProfiles)
      .where(eq(s.courseProfiles.slug, slug));
    if (!profile) return notFound("Course profile");

    if (!profile.websiteUrl) {
      return jsonError(422, "No websiteUrl stored for this course — cannot discover resources.");
    }

    const links = await discoverResourceLinks(profile.websiteUrl);
    if (links.length === 0) {
      return Response.json({ courseSlug: slug, stored: 0, message: "No resource links found." });
    }

    let stored = 0;
    for (const link of links) {
      const isPdf = link.url.toLowerCase().endsWith(".pdf");
      let content: string | null = null;
      let contentFetchedAt: Date | null = null;
      if (!isPdf) {
        content = await fetchPageContent(link.url);
        contentFetchedAt = content ? new Date() : null;
      }

      await db
        .insert(s.courseResources)
        .values({ courseSlug: slug, title: link.title, type: link.type, url: link.url, content, contentFetchedAt })
        .onConflictDoUpdate({
          target: s.courseResources.url,
          set: { title: link.title, type: link.type, content, contentFetchedAt },
        });
      stored++;
    }

    return Response.json({ courseSlug: slug, stored });
  });
}
