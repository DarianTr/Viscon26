import { z } from "zod";
import { asc } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { handle, jsonError } from "@/lib/http";
import { getCurrentUser } from "@/lib/queries";
import { fetchVvzCourse } from "@/lib/vvz";
import { topicSlug } from "@/lib/knowledge-topics";

/** GET /api/courses — list all stored course profiles. */
export async function GET() {
  return handle(async () => {
    const courses = await db
      .select({
        slug: s.courseProfiles.slug,
        name: s.courseProfiles.name,
        courseCode: s.courseProfiles.courseCode,
        aliases: s.courseProfiles.aliases,
        topicCount: s.courseProfiles.topics,
        fetchedAt: s.courseProfiles.fetchedAt,
      })
      .from(s.courseProfiles)
      .orderBy(asc(s.courseProfiles.name));

    return Response.json({
      courses: courses.map((c) => ({
        ...c,
        topicCount: (c.topicCount as unknown[]).length,
      })),
    });
  });
}

const upsertBody = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  courseCode: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  /** If omitted, the server tries to fetch topics live from VVZ. */
  topics: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
  description: z.string().optional(),
});

/**
 * POST /api/courses — admin: create or replace a course profile.
 * When `topics` is absent and `courseCode` is present, the handler fetches the
 * course content from VVZ and extracts topics automatically.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user.isAdmin) return jsonError(403, "Admin only");

    const body = upsertBody.parse(await request.json());

    let topics = body.topics ?? [];
    let description = body.description ?? null;
    let sourceUrl: string | null = null;

    if (topics.length === 0 && body.courseCode) {
      const vvz = await fetchVvzCourse(body.courseCode);
      if (vvz) {
        topics = vvz.topics.map((name) => ({
          id: `${body.slug}.${topicSlug(name)}`,
          name,
        }));
        description = vvz.description;
        sourceUrl = vvz.sourceUrl;
      }
    }

    if (topics.length === 0) {
      return jsonError(422, "No topics found. Provide topics explicitly or ensure the VVZ page for this course code is reachable.");
    }

    await db
      .insert(s.courseProfiles)
      .values({
        slug: body.slug,
        name: body.name,
        courseCode: body.courseCode ?? null,
        aliases: body.aliases,
        topics,
        description,
        sourceUrl,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: s.courseProfiles.slug,
        set: {
          name: body.name,
          courseCode: body.courseCode ?? null,
          aliases: body.aliases,
          topics,
          description,
          sourceUrl,
          fetchedAt: new Date(),
        },
      });

    return Response.json({ slug: body.slug, topicCount: topics.length }, { status: 201 });
  });
}
