import "server-only";
import { db, schema as s } from "@/db";
import { topicSlug } from "./knowledge-topics";
import { fetchVvzCourseByName } from "./vvz";

/**
 * Ensures a course profile exists for `subjectName`.
 *
 * If the DB already has a profile whose slug or any alias matches
 * `topicSlug(subjectName)`, this is a no-op. Otherwise it queries VVZ by
 * name and stores the result. Errors are swallowed — the caller's flow must
 * not depend on this succeeding.
 */
export async function ensureCourseProfile(subjectName: string): Promise<void> {
  const slug = topicSlug(subjectName);

  // Load all profiles once (table stays small — dozens of courses at most).
  const profiles = await db
    .select({ slug: s.courseProfiles.slug, aliases: s.courseProfiles.aliases })
    .from(s.courseProfiles);

  const exists = profiles.some(
    (p) => p.slug === slug || (p.aliases as string[]).includes(slug),
  );
  if (exists) return;

  // Unknown subject — try VVZ.
  const vvz = await fetchVvzCourseByName(subjectName);
  if (!vvz || vvz.topics.length < 3) return;

  const topics = vvz.topics.map((name) => ({
    id: `${slug}.${topicSlug(name)}`,
    name,
  }));

  await db
    .insert(s.courseProfiles)
    .values({
      slug,
      name: subjectName,
      courseCode: null,
      aliases: [],
      topics,
      description: vvz.description,
      sourceUrl: vvz.sourceUrl,
      fetchedAt: new Date(),
    })
    .onConflictDoNothing();
}
