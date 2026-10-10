import { fromGrade } from "./grades";

/*
 * How a plan's subjects become knowledge-service topics. Plain functions with
 * no server-only imports, so scripts (e.g. the demo-data seed) share them.
 *
 * For now every subject gets three hardcoded topics, and its exam covers them
 * equally. Topics of one subject share its id as their parent (a group key in
 * the service), so the model treats them as related.
 */

export type Subject = {
  name: string;
  examDate: string | null;
  targetGrade: number | null;
  currentGrade: number | null;
};

export type KnowledgeSubject = Subject & {
  id: string;
  topics: { id: string; name: string }[];
};

/** Three topics per kind of subject, matched by a keyword in its name. First match wins. */
const SUBTOPICS: [RegExp, [string, string, string]][] = [
  [/analys|calculus|analysis/, ["Sequences & series", "Differentiation", "Integration"]],
  [/linear-algebra|linalg|lineare-algebra/, ["Linear systems", "Vector spaces", "Eigenvalues"]],
  [/physi/, ["Mechanics", "Oscillations & waves", "Thermodynamics"]],
  [/algorithm|data-struct|datenstruk/, ["Sorting & searching", "Data structures", "Graph algorithms"]],
  [/discrete|diskret|diskmath/, ["Logic & proofs", "Combinatorics", "Number theory"]],
  [/probab|stochast|statist|wahrschein/, ["Probability", "Random variables", "Statistics"]],
  [/program|informatik|computer-science|coding/, ["Fundamentals", "Object-oriented design", "Recursion"]],
  [/chem/, ["Atoms & bonding", "Thermochemistry", "Kinetics"]],
  [/econom|oekonom|okonom/, ["Microeconomics", "Macroeconomics", "Markets"]],
];
const FALLBACK: [string, string, string] = ["Concepts", "Methods", "Applications"];

/** A grade from the plan wizard ("4.5"), or null when missing or out of range. */
export function parseGrade(value: string | undefined | null): number | null {
  const n = Number(value);
  return value && Number.isFinite(n) && n >= 1 && n <= 6 ? n : null;
}

/** A stable, URL-safe id for a name: "Analysis II" → "analysis-ii". */
export function topicSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "subject"
  );
}

/** The hardcoded topics for a subject name. */
export function subtopicsFor(name: string): string[] {
  const slug = topicSlug(name);
  return SUBTOPICS.find(([re]) => re.test(slug))?.[1] ?? FALLBACK;
}

/**
 * Injected course profile. Server-side callers load this from the DB and pass
 * it in; the type lives here so knowledge-topics stays free of server imports.
 */
export type CourseProfile = {
  topics: { id: string; name: string }[];
};

/**
 * Subjects with unique ids and their topics, in plan order; nameless subjects
 * are dropped. When `profiles` is supplied (keyed by subject slug or alias),
 * the stored VVZ topics replace the hardcoded fallback for that subject.
 */
export function toKnowledgeSubjects(
  subjects: Subject[],
  profiles?: Map<string, CourseProfile>,
): KnowledgeSubject[] {
  const used = new Set<string>();
  return subjects
    .filter((x) => x.name?.trim())
    .map((x) => {
      let id = topicSlug(x.name);
      for (let i = 2; used.has(id); i++) id = `${topicSlug(x.name)}-${i}`;
      used.add(id);

      const profile = profiles?.get(id);
      const topics = profile
        ? profile.topics.map((t) => ({ ...t }))
        : subtopicsFor(x.name).map((name) => ({ id: `${id}.${topicSlug(name)}`, name }));

      return { ...x, id, topics };
    });
}

const clamp = (x: number) => Math.min(0.95, Math.max(0.05, x));

/** Body for the service's `PUT /plans/:id/topics`: every subject's topics. */
export function topicsPayload(subjects: KnowledgeSubject[]) {
  return {
    topics: subjects.flatMap((s) =>
      s.topics.map((t) => ({
        id: t.id,
        name: t.name,
        parentId: s.id,
        examDate: /^\d{4}-\d{2}-\d{2}$/.test(s.examDate ?? "") ? s.examDate : null,
        // The wizard's self-assessed current grade is the prior; it's a guess, hence the sd.
        ...(s.currentGrade !== null ? { priorMean: clamp(fromGrade(s.currentGrade)), priorSd: 0.15 } : {}),
      })),
    ),
  };
}
