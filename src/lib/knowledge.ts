import "server-only";
import { cache } from "react";
import { and, eq, ne } from "drizzle-orm";
import { db, schema as s } from "@/db";
import {
  type KnowledgeSubject,
  parseGrade,
  type Subject,
  toKnowledgeSubjects,
  topicsPayload,
} from "./knowledge-topics";

/*
 * Client for the knowledge service (services/knowledge), which estimates each
 * learner's level per topic from logged scores. Only the server talks to it;
 * routes check plan ownership first, because the service has no auth of its own.
 *
 * Until exams are split into topics, every subject of a plan is one topic and
 * each subject's exam covers only that subject.
 */

const BASE = (process.env.KNOWLEDGE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class KnowledgeError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new KnowledgeError(503, "The knowledge service is not reachable");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new KnowledgeError(res.status, body.error ?? "Knowledge service error", body.details);
  return body as T;
}

// --- Types (mirroring the service's camelCase JSON) -------------------------

export const DATA_POINT_TYPES = ["practice", "quiz", "mock", "exam"] as const;
export type DataPointType = (typeof DATA_POINT_TYPES)[number];

export type MeanSd = { mean: number; sd: number };

export type Observation = {
  id: string;
  userId: string;
  planId: string;
  type: DataPointType;
  observedAt: string;
  score: number;
  nPoints: number;
  weights: Record<string, number>;
  sourceRef: string | null;
  createdAt: string;
};

export type TimelineStep = {
  at: string;
  observation: { id: string | null; type: DataPointType; score: number; nPoints: number; weights: Record<string, number> } | null;
  /** Per topic, in `Timeline.topics` order. */
  levels: MeanSd[];
  forecasts: MeanSd[];
  /** Per subject (group), in `Timeline.groups` order: the equal average of its topics. */
  groupLevels: MeanSd[];
  groupForecasts: MeanSd[];
  overall: MeanSd;
  predicted: number | null;
  z: number | null;
  noiseSd: number | null;
};

export type Timeline = {
  asOf: string;
  topics: { id: string; name: string; examDate: string | null }[];
  groups: { id: string; topicIds: string[]; examDate: string | null }[];
  steps: TimelineStep[];
  current: TimelineStep;
  projection: { at: string; levels: MeanSd[]; groupLevels: MeanSd[] }[];
  skipped: (string | null)[];
};

// --- Plans and their topics --------------------------------------------------

export type { KnowledgeSubject };

export type OwnedPlan = {
  id: string;
  title: string;
  /** Each subject with its (for now hardcoded) topics, target and current grade. */
  subjects: KnowledgeSubject[];
};

/** The user's plan with its subjects as topics, or null if it isn't theirs. Database only. */
export const getOwnedPlan = cache(async (userId: string, planId: string): Promise<OwnedPlan | null> => {
  const [plan] = await db
    .select({ id: s.userPlans.id, title: s.userPlans.title, config: s.userPlans.config })
    .from(s.userPlans)
    .where(and(eq(s.userPlans.id, planId), eq(s.userPlans.userId, userId)));
  if (!plan) return null;

  let subjects: Subject[] = (plan.config?.subjects ?? []).map((c) => ({
    name: c.name,
    examDate: c.examDate || null,
    targetGrade: parseGrade(c.targetGrade),
    currentGrade: parseGrade(c.currentGrade),
  }));
  if (subjects.length === 0) {
    // Older plans have no stored subject configs: fall back to their sessions' subjects.
    const rows = await db
      .selectDistinct({ subject: s.sessions.subject })
      .from(s.sessions)
      .where(and(eq(s.sessions.userPlanId, planId), ne(s.sessions.type, "lecture")));
    subjects = rows.map((r) => ({ name: r.subject, examDate: null, targetGrade: null, currentGrade: null }));
  }

  return { id: plan.id, title: plan.title, subjects: toKnowledgeSubjects(subjects) };
});

/** Make the service's topics match the plan's subjects (an idempotent upsert). */
export async function syncTopics(plan: OwnedPlan) {
  if (plan.subjects.length === 0) return;
  await call(`/plans/${plan.id}/topics`, { method: "PUT", body: JSON.stringify(topicsPayload(plan.subjects)) });
}


// --- Observations ------------------------------------------------------------

export type NewObservation = {
  type: DataPointType;
  observedAt: string;
  score: number;
  nPoints?: number;
  weights: Record<string, number>;
};

export function logObservation(userId: string, planId: string, o: NewObservation) {
  return call<Observation>("/observations", {
    method: "POST",
    body: JSON.stringify({ ...o, userId, planId }),
  });
}

export async function listObservations(userId: string, planId: string): Promise<Observation[]> {
  const q = new URLSearchParams({ userId, planId, limit: "1000" });
  return (await call<{ observations: Observation[] }>(`/observations?${q}`)).observations;
}

/** Deletes an observation if it belongs to this user and plan; false otherwise. */
export async function deleteObservation(userId: string, planId: string, id: string) {
  const mine = await listObservations(userId, planId);
  if (!mine.some((o) => o.id === id)) return false;
  await call(`/observations/${id}`, { method: "DELETE" });
  return true;
}

export function getTimeline(userId: string, planId: string) {
  return call<Timeline>(`/users/${userId}/plans/${encodeURIComponent(planId)}/timeline`);
}
