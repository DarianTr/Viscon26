/**
 * Demo data for the knowledge pages: `npm run db:seed-knowledge`.
 *
 * Creates (or reuses) the plan "Basisprüfung (demo)" for the demo user with
 * four first-year ETH CS courses and their real topics from `course_profiles`
 * (run `npm run db:seed-courses` first), and logs a realistic learning phase:
 * lectures are over, the exams are 2–5 weeks away, and for the last four
 * weeks the student has been reviewing each course topic by topic:
 *
 * - topic exercises on what's being reviewed, every few days (with solutions
 *   at hand, so they run a bit high);
 * - short self-tests on topics reviewed earlier;
 * - full old exams under exam conditions about every ten days;
 * - one course reviewed only sporadically, so the model stays unsure there.
 *
 * Every topic follows a hidden curve: where the semester left it, a slow fade
 * since, and gains once it's reviewed. Some topics aren't reviewed yet.
 * `--truth` prints the hidden levels for checking. Re-running replaces the
 * plan's data points. Needs the database and the knowledge service
 * (KNOWLEDGE_URL, default http://localhost:8000).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "./schema";
import { type StoredPlanConfig, type StoredSubjectConfig } from "./schema";
import { fromGrade, toGrade, zurichNoon, zurichToday } from "../lib/grades";
import { profileMap, toKnowledgeSubjects, topicsPayload, type KnowledgeSubject } from "../lib/knowledge-topics";

const DEMO_HANDLE = process.env.DEMO_USER_HANDLE ?? "tprazak";
const KNOWLEDGE = (process.env.KNOWLEDGE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const PLAN_TITLE = "Basisprüfung (demo)";
const SHOW_TRUTH = process.argv.includes("--truth");

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// --- Deterministic randomness ---------------------------------------------

let rngState = 11;
function rand() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const clamp01 = (x: number) => Math.min(0.97, Math.max(0.03, x));

// --- Dates (days relative to today, in Zurich) --------------------------------

const today = zurichToday();
const dayIso = (offset: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** The learning phase (lectures over, exams ahead) began four weeks ago. */
const PHASE_START = -28;

// --- The demo courses --------------------------------------------------------

type CourseSpec = {
  name: string;
  current: string;
  target: string;
  /** Days from today to the exam. */
  examIn: number;
  /** How much this student gains when reviewing a topic, relative to average. */
  strength: number;
  /** Chance of doing topic exercises on a given study day for this course. */
  diligence: number;
  /** Full old exams written so far in the learning phase. */
  oldExams: number;
};

const COURSES: CourseSpec[] = [
  { name: "Diskrete Mathematik", current: "4", target: "5", examIn: 15, strength: 1.0, diligence: 0.45, oldExams: 3 },
  { name: "Lineare Algebra", current: "4.5", target: "5", examIn: 22, strength: 1.2, diligence: 0.4, oldExams: 2 },
  { name: "Algorithmen und Datenstrukturen", current: "4", target: "4.5", examIn: 29, strength: 0.8, diligence: 0.4, oldExams: 2 },
  { name: "Einführung in die Programmierung", current: "4.5", target: "5", examIn: 36, strength: 1.05, diligence: 0.12, oldExams: 0 },
];

const TYPES = {
  practice: { c: 2.5, bias: 0.06 }, // exercise sheets are done with notes
  quiz: { c: 1.5, bias: 0 },
  mock: { c: 1.2, bias: 0 },
} as const;

// --- Hidden learning curves ---------------------------------------------------

type TopicTruth = {
  /** Level when the learning phase began (where the semester left it). */
  start: number;
  /** Day the student starts reviewing it; after today means not reviewed yet. */
  reviewed: number;
  peak: number;
  tau: number;
  /** Fade per day while not being reviewed. */
  fade: number;
};

function truthFor(course: CourseSpec, topics: number): TopicTruth[] {
  const base = fromGrade(Number(course.current));
  // Topics are reviewed one after another, in a shuffled order; the last ones
  // fall after today, so not everything has been reviewed yet.
  const order = Array.from({ length: topics }, (_, i) => i).sort(() => rand() - 0.5);
  const span = course.examIn - PHASE_START - 5; // finish reviewing shortly before the exam
  return Array.from({ length: topics }, (_, i) => {
    const start = clamp01(base - 0.05 + 0.12 * normal()); // some topics shaky, some solid
    const gain = between(0.12, 0.3) * course.strength * (rand() < 0.2 ? 0.5 : 1); // some just don't click
    return {
      start,
      reviewed: PHASE_START + Math.floor((order.indexOf(i) * span) / topics),
      peak: clamp01(start + gain),
      tau: between(3, 9),
      fade: between(0.0005, 0.0015),
    };
  });
}

function level(t: TopicTruth, day: number): number {
  const sinceStart = day - PHASE_START;
  if (day < t.reviewed) return Math.max(0, t.start - t.fade * sinceStart);
  const before = t.start - t.fade * (t.reviewed - PHASE_START);
  return before + (t.peak - before) * (1 - Math.exp(-(day - t.reviewed) / t.tau));
}

type DataPoint = { type: keyof typeof TYPES; day: number; topics: string[]; points: number; maxPoints: number };

function learningPhase(subject: KnowledgeSubject, course: CourseSpec, truth: TopicTruth[]): DataPoint[] {
  const ids = subject.topics.map((t) => t.id);
  const out: DataPoint[] = [];
  const add = (type: DataPoint["type"], day: number, idx: number[], maxPoints: number) => {
    if (day >= 0 || idx.length === 0) return;
    const p = idx.reduce((sum, i) => sum + level(truth[i], day), 0) / idx.length + TYPES[type].bias;
    const sd = Math.sqrt((TYPES[type].c * Math.max(0.05, p * (1 - p))) / maxPoints);
    const score = Math.min(1, Math.max(0, p + sd * normal()));
    out.push({ type, day, topics: idx.map((i) => ids[i]), points: Math.round(score * maxPoints), maxPoints });
  };
  const reviewedBy = (day: number) => truth.flatMap((t, i) => (t.reviewed <= day ? [i] : []));
  const all = truth.map((_, i) => i);

  for (let day = PHASE_START; day < 0; day++) {
    if (rand() < course.diligence) {
      // Exercises on the topic under review, sometimes together with the previous one.
      const current = reviewedBy(day).sort((a, b) => truth[b].reviewed - truth[a].reviewed);
      const idx = current.length > 1 && rand() < 0.35 ? current.slice(0, 2) : current.slice(0, 1);
      add("practice", day, idx, pick([12, 16, 20, 24]));
    }
    // About once a week, a quick self-test on something reviewed earlier.
    const earlier = reviewedBy(day - 4);
    if (earlier.length && rand() < 0.14 * (0.5 + course.diligence)) add("quiz", day, [pick(earlier)], pick([8, 10, 12]));
  }
  // Full old exams under exam conditions, spread over the phase.
  for (let k = 0; k < course.oldExams; k++) {
    add("mock", Math.round(PHASE_START + ((k + 1) * -PHASE_START) / (course.oldExams + 1)), all, pick([60, 80, 100]));
  }
  return out.sort((a, b) => a.day - b.day);
}

// --- Knowledge service --------------------------------------------------------

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${KNOWLEDGE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  }).catch(() => {
    throw new Error(`The knowledge service isn't reachable at ${KNOWLEDGE}. Start it first (see README).`);
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.handle, DEMO_HANDLE));
  if (!user) throw new Error(`No user @${DEMO_HANDLE}. Run npm run db:seed first.`);

  const profiles = profileMap(
    await db
      .select({ slug: s.courseProfiles.slug, aliases: s.courseProfiles.aliases, topics: s.courseProfiles.topics })
      .from(s.courseProfiles),
  );

  const subjectConfigs: StoredSubjectConfig[] = COURSES.map((c) => ({
    name: c.name,
    examDate: dayIso(c.examIn),
    examDuration: "180",
    targetGrade: c.target,
    currentGrade: c.current,
    confidence: "some",
    approach: "balanced",
    customPhases: [],
    mockCount: String(c.oldExams + 2),
    allocation: Math.round(100 / COURSES.length),
    materials: [],
    cheatsheet: "",
    comments: "",
  }));
  const config: StoredPlanConfig = {
    weeklyHours: 20,
    studyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    sessionLength: 90,
    vacationRanges: [],
    subjects: subjectConfigs,
  };

  const subjects = toKnowledgeSubjects(
    COURSES.map((c, i) => ({
      name: c.name,
      examDate: subjectConfigs[i].examDate,
      targetGrade: Number(c.target),
      currentGrade: Number(c.current),
    })),
    profiles,
  );
  const missing = subjects.filter((x) => !profiles.has(x.id)).map((x) => x.name);
  if (missing.length) {
    throw new Error(`No course profile for ${missing.join(", ")}. Run npm run db:seed-courses first.`);
  }

  let [plan] = await db
    .select({ id: s.userPlans.id })
    .from(s.userPlans)
    .where(and(eq(s.userPlans.userId, user.id), eq(s.userPlans.title, PLAN_TITLE)));
  if (plan) await db.update(s.userPlans).set({ config }).where(eq(s.userPlans.id, plan.id));
  else [plan] = await db.insert(s.userPlans).values({ userId: user.id, title: PLAN_TITLE, config }).returning({ id: s.userPlans.id });

  // Exactly these topics: earlier demo runs may have left placeholder topics.
  await call(`/plans/${plan.id}/topics?prune=true`, { method: "PUT", body: JSON.stringify(topicsPayload(subjects)) });

  // Replace earlier demo data points.
  const q = new URLSearchParams({ userId: user.id, planId: plan.id, limit: "1000" });
  const { observations } = (await call(`/observations?${q}`)) as { observations: { id: string }[] };
  for (const o of observations) await call(`/observations/${o.id}`, { method: "DELETE" });

  let logged = 0;
  for (const [i, subject] of subjects.entries()) {
    const course = COURSES[i];
    const truth = truthFor(course, subject.topics.length);
    const points = learningPhase(subject, course, truth);
    for (const p of points) {
      await call("/observations", {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          planId: plan.id,
          type: p.type,
          observedAt: zurichNoon(dayIso(p.day)),
          score: p.points / p.maxPoints,
          nPoints: p.maxPoints,
          weights: Object.fromEntries(p.topics.map((t) => [t, 1])),
          sourceRef: `demo:${subject.id}:${logged++}`,
        }),
      });
    }
    const counts = (["practice", "quiz", "mock"] as const).map((t) => points.filter((p) => p.type === t).length);
    console.log(`${subject.name}: ${subject.topics.length} topics, ${counts[0]} exercises, ${counts[1]} self-tests, ${counts[2]} old exams`);
    if (SHOW_TRUTH) {
      for (const [k, t] of subject.topics.entries()) {
        const reviewed = truth[k].reviewed < 0 ? `reviewed since ${dayIso(truth[k].reviewed)}` : "not reviewed yet";
        console.log(`  ${t.id.padEnd(60)} true grade today ${toGrade(level(truth[k], 0)).toFixed(2)}  (${reviewed})`);
      }
    }
  }
  console.log(`\nLogged ${logged} data points for @${DEMO_HANDLE}. Open /plans/${plan.id}/forecast`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
