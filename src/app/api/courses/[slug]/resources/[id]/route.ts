import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, jsonError, notFound } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { fetchPageContent } from "@/lib/vvz";

type Ctx = RouteContext<"/api/courses/[slug]/resources/[id]">;

/** GET /api/courses/[slug]/resources/[id] — full resource including content. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { slug, id } = await ctx.params;
    const [resource] = await db
      .select()
      .from(s.courseResources)
      .where(and(eq(s.courseResources.id, id), eq(s.courseResources.courseSlug, slug)));
    if (!resource) return notFound("Resource");
    return Response.json(resource);
  });
}

/**
 * POST /api/courses/[slug]/resources/[id]/fetch — admin: (re-)fetch the
 * content of this resource and store it. PDFs return url-only (no text yet).
 */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user.isAdmin) return jsonError(403, "Admin only");

    const { slug, id } = await ctx.params;
    const [resource] = await db
      .select({ url: s.courseResources.url })
      .from(s.courseResources)
      .where(and(eq(s.courseResources.id, id), eq(s.courseResources.courseSlug, slug)));
    if (!resource) return notFound("Resource");

    const isPdf = resource.url.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      return jsonError(422, "PDF text extraction not yet supported via this endpoint.");
    }

    const content = await fetchPageContent(resource.url);
    if (!content) {
      return jsonError(502, "Could not fetch content from the resource URL.");
    }

    await db
      .update(s.courseResources)
      .set({ content, contentFetchedAt: new Date() })
      .where(eq(s.courseResources.id, id));

    return Response.json({ id, contentLength: content.length });
  });
}
