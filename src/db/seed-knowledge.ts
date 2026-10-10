/**
 * Demo data for the knowledge pages: `npm run db:seed-knowledge`.
 *
 * Creates (or reuses) the plan "Basisprüfung (demo)" for the demo user and
 * logs six weeks of practice sheets, quizzes and mocks into the knowledge
 * service, so the grade forecast and the spider chart have something to show.
 * Re-running replaces the plan's demo data points. Needs the database and the
 * knowledge service (KNOWLEDGE_URL, default http://localhost:8000) running.
 *
 * Every topic has its own hidden learning curve, so the model has real
 * differences to find: a weak topic, a fast learner, a solid one, and one
 * subject logged so rarely that the model stays unsure about it.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "./schema";
import { type StoredPlanConfig, type StoredSubjectConfig } from "./schema";
import { toKnowledgeSubjects, topicsPayload, type KnowledgeSubject } from "../lib/knowledge-topics";

const TZ = "Europe/Zurich";
const DEMO_HANDLE = process.env.DEMO_USER_HANDLE ?? "tprazak";
const KNOWLEDGE = (process.env.KNOWLEDGE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const PLAN_TITLE = "Basisprüfung (demo)";
const HISTORY_DAYS = 42;

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// --- Deterministic randomness ---------------------------------------------

let rngState = 7;
function rand() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

// --- Dates ------------------------------------------------------------------

const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const dayIso = (offset: number) => {
  const d = new Date(`${todayIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// --- The demo plan ----------------------------------------------------------

/** start = level 6 weeks ago, gain = what it adds by the end, tau = how fast (days). */
type Curve = { start: number; gain: number; tau: number };

const SUBJECTS: {
  name: string;
  examIn: number;
  target: string;
  current: string;
  curves: [Curve, Curve, Curve];
  /** How often it gets practised: 1 = every few days, lower = rarely. */
  diligence: number;
  mocks: number[];
}[] = [
  {
    name: "Analysis II",
    examIn: 24,
    target: "5",
    current: "4",
    // Series: catching up fast. Differentiation: solid. Integration: weak and slow.
    curves: [{ start: 0.38, gain: 0.32, tau: 14 }, { start: 0.62, gain: 0.1, tau: 10 }, { start: 0.34, gain: 0.16, tau: 30 }],
    diligence: 1,
    mocks: [-21, -6],
  },
  {
    name: "Linear Algebra",
    examIn: 31,
    target: "4.5",
    current: "4.5",
    // Systems: strong. Vector spaces: steady. Eigenvalues: improving quickly.
    curves: [{ start: 0.74, gain: 0.08, tau: 10 }, { start: 0.55, gain: 0.18, tau: 22 }, { start: 0.42, gain: 0.28, tau: 12 }],
    diligence: 0.9,
    mocks: [-14],
  },
  {
    name: "Physics",
    examIn: 38,
    target: "4.5",
    current: "3.5",
    // Mechanics: fine. Waves: the weak spot. Thermodynamics: coming along.
    curves: [{ start: 0.55, gain: 0.14, tau: 15 }, { start: 0.3, gain: 0.1, tau: 25 }, { start: 0.4, gain: 0.22, tau: 15 }],
    diligence: 0.8,
    mocks: [-10],
  },
  {
    name: "Algorithms & Data Structures",
    examIn: 45,
    target: "5",
    current: "4",
    curves: [{ start: 0.66, gain: 0.08, tau: 10 }, { start: 0.55, gain: 0.14, tau: 15 }, { start: 0.42, gain: 0.16, tau: 15 }],
    // Barely logged yet: the model should stay unsure here.
    diligence: 0.25,
    mocks: [],
  },
];

const TYPES = {
  practice: { points: 20, c: 2.5, bias: 0.06 }, // with notes: runs a bit high
  quiz: { points: 12, c: 1.5, bias: 0 },
  mock: { points: 60, c: 1.2, bias: 0 },
} as const;

const level = (c: Curve, day: number) => c.start + c.gain * (1 - Math.exp(-(day + HISTORY_DAYS) / c.tau));

type DataPoint = { type: keyof typeof TYPES; day: number; topics: string[]; points: number; maxPoints: number };

function history(subject: KnowledgeSubject, spec: (typeof SUBJECTS)[number]): DataPoint[] {
  const ids = subject.topics.map((t) => t.id);
  const out: DataPoint[] = [];
  const add = (type: DataPoint["type"], day: number, idx: number[]) => {
    const t = TYPES[type];
    const p = idx.reduce((sum, i) => sum + level(spec.curves[i], day), 0) / idx.length + t.bias;
    const sd = Math.sqrt((t.c * Math.max(0.05, p * (1 - p))) / t.points);
    const score = Math.min(1, Math.max(0, p + sd * normal()));
    out.push({ type, day, topics: idx.map((i) => ids[i]), points: Math.round(score * t.points), maxPoints: t.points });
  };
  for (let day = -HISTORY_DAYS; day < 0; day++) {
    // Practice sheets every few days, mostly mixing two topics.
    if (rand() < 0.3 * spec.diligence) {
      const first = Math.floor(rand() * 3);
      add("practice", day, rand() < 0.65 ? [first, (first + 1 + Math.floor(rand() * 2)) % 3] : [first]);
    }
    // A short single-topic quiz about once a week.
    if (rand() < 0.14 * spec.diligence) add("quiz", day, [Math.floor(rand() * 3)]);
  }
  for (const day of spec.mocks) add("mock", day, [0, 1, 2]);
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

  const subjectConfigs: StoredSubjectConfig[] = SUBJECTS.map((x) => ({
    name: x.name,
    examDate: dayIso(x.examIn),
    examDuration: "180",
    targetGrade: x.target,
    currentGrade: x.current,
    confidence: "some",
    approach: "balanced",
    customPhases: [],
    mockCount: String(x.mocks.length),
    allocation: Math.round(100 / SUBJECTS.length),
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

  let [plan] = await db
    .select({ id: s.userPlans.id })
    .from(s.userPlans)
    .where(and(eq(s.userPlans.userId, user.id), eq(s.userPlans.title, PLAN_TITLE)));
  if (plan) await db.update(s.userPlans).set({ config }).where(eq(s.userPlans.id, plan.id));
  else [plan] = await db.insert(s.userPlans).values({ userId: user.id, title: PLAN_TITLE, config }).returning({ id: s.userPlans.id });

  const subjects = toKnowledgeSubjects(
    SUBJECTS.map((x, i) => ({
      name: x.name,
      examDate: subjectConfigs[i].examDate,
      targetGrade: Number(x.target),
      currentGrade: Number(x.current),
    })),
  );
  await call(`/plans/${plan.id}/topics`, { method: "PUT", body: JSON.stringify(topicsPayload(subjects)) });

  // Replace earlier demo data points.
  const q = new URLSearchParams({ userId: user.id, planId: plan.id, limit: "1000" });
  const { observations } = (await call(`/observations?${q}`)) as { observations: { id: string }[] };
  for (const o of observations) await call(`/observations/${o.id}`, { method: "DELETE" });

  let logged = 0;
  for (const [i, subject] of subjects.entries()) {
    const points = history(subject, SUBJECTS[i]);
    for (const p of points) {
      await call("/observations", {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          planId: plan.id,
          type: p.type,
          observedAt: `${dayIso(p.day)}T${pick(["09", "13", "17"])}:00:00+02:00`,
          score: p.points / p.maxPoints,
          nPoints: p.maxPoints,
          weights: Object.fromEntries(p.topics.map((t) => [t, 1])),
          sourceRef: `demo:${subject.id}:${logged++}`,
        }),
      });
    }
    console.log(`${subject.name}: ${points.length} data points`);
  }
  console.log(`\nLogged ${logged} data points for @${DEMO_HANDLE}. Open /plans/${plan.id}/forecast`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
