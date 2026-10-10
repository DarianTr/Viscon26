/**
 * Seed the four first-year ETH CS courses into `course_profiles`.
 *
 * For each course the script:
 *   1. Tries to fetch topics live from VVZ (network permitting).
 *   2. Falls back to the curated topic list below if VVZ is unreachable or
 *      returns too little content.
 *   3. Upserts the row — safe to re-run.
 *
 * Usage:
 *   npm run db:seed-courses
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "./schema";
import { topicSlug } from "../lib/knowledge-topics";
import { fetchVvzCourse } from "../lib/vvz";

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// ---------------------------------------------------------------------------
// Curated course definitions (authoritative fallback when VVZ is unavailable)
// ---------------------------------------------------------------------------

type CourseSpec = {
  slug: string;
  name: string;
  courseCode: string;
  aliases: string[];
  topics: string[];
};

const COURSES: CourseSpec[] = [
  {
    slug: "diskrete-mathematik",
    name: "Diskrete Mathematik",
    courseCode: "252-0025-01",
    aliases: ["discrete-mathematics", "discrete-math", "diskrete-math"],
    topics: [
      "Propositional Logic",
      "Predicate Logic",
      "Sets and Relations",
      "Proof Techniques",
      "Number Theory",
      "Combinatorics",
      "Graph Theory",
      "Automata Theory",
      "Discrete Probability",
    ],
  },
  {
    slug: "lineare-algebra",
    name: "Lineare Algebra",
    courseCode: "401-0131-00",
    aliases: ["linear-algebra", "linalg"],
    topics: [
      "Vectors and Matrices",
      "Linear Systems of Equations",
      "Vector Spaces and Subspaces",
      "Linear Maps",
      "Determinants",
      "Eigenvalues and Eigenvectors",
      "Orthogonality and Gram-Schmidt",
      "Singular Value Decomposition",
    ],
  },
  {
    slug: "einfuhrung-in-die-programmierung",
    name: "Einführung in die Programmierung",
    courseCode: "252-0027-00",
    aliases: [
      "introduction-to-programming",
      "einfuhrung-programmierung",
      "programmierung",
    ],
    topics: [
      "Variables and Types",
      "Control Flow",
      "Functions and Scope",
      "Classes and Objects",
      "Pointers and Memory",
      "Recursion",
      "Standard Algorithms",
      "Data Structures",
      "Exception Handling",
    ],
  },
  {
    slug: "algorithmen-und-datenstrukturen",
    name: "Algorithmen und Datenstrukturen",
    courseCode: "252-0026-00",
    aliases: [
      "algorithms-data-structures",
      "algorithms-and-data-structures",
      "algorithms-datenstrukturen",
    ],
    topics: [
      "Algorithm Analysis",
      "Sorting Algorithms",
      "Trees and Search Structures",
      "Hash Tables",
      "Graph Algorithms",
      "Dynamic Programming",
      "Greedy Algorithms",
      "Amortized Analysis",
    ],
  },
  {
    slug: "spca",
    name: "Systems Programming and Computer Architecture",
    courseCode: "252-0061-00",
    aliases: [
      "systems-programming-and-computer-architecture",
      "systems-programming",
      "systemsprogrammierung",
    ],
    topics: [
      "Instruction Set Architecture",
      "Assembly Programming",
      "Memory Hierarchy and Caches",
      "Pipelining",
      "Virtual Memory",
      "I/O and Interrupts",
      "Concurrency and Synchronisation",
    ],
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedCourse(spec: CourseSpec) {
  let topics = spec.topics.map((name) => ({
    id: `${spec.slug}.${topicSlug(name)}`,
    name,
  }));
  let description: string | null = null;
  let sourceUrl: string | null = null;

  // Attempt live VVZ fetch and prefer it when it returns enough topics.
  console.log(`  Fetching ${spec.courseCode} from VVZ…`);
  try {
    const vvz = await fetchVvzCourse(spec.courseCode);
    if (vvz && vvz.topics.length >= 4) {
      topics = vvz.topics.map((name) => ({
        id: `${spec.slug}.${topicSlug(name)}`,
        name,
      }));
      description = vvz.description;
      sourceUrl = vvz.sourceUrl;
      console.log(`  ✓ VVZ returned ${topics.length} topics for "${spec.name}"`);
    } else {
      console.log(`  ↩ VVZ returned insufficient topics — using curated list (${topics.length} topics)`);
    }
  } catch {
    console.log(`  ↩ VVZ unreachable — using curated list (${topics.length} topics)`);
  }

  await db
    .insert(s.courseProfiles)
    .values({
      slug: spec.slug,
      name: spec.name,
      courseCode: spec.courseCode,
      aliases: spec.aliases,
      topics,
      description,
      sourceUrl,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: s.courseProfiles.slug,
      set: {
        name: spec.name,
        courseCode: spec.courseCode,
        aliases: spec.aliases,
        topics,
        description,
        sourceUrl,
        fetchedAt: new Date(),
      },
    });

  console.log(`  Saved "${spec.name}" (${topics.length} topics, aliases: ${spec.aliases.join(", ")})\n`);
}

async function main() {
  console.log("Seeding ETH first-year CS course profiles…\n");
  for (const course of COURSES) {
    console.log(`→ ${course.name} [${course.courseCode}]`);
    await seedCourse(course);
  }
  console.log(`Done. ${COURSES.length} courses upserted into course_profiles.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
