import "server-only";
import { notFound } from "next/navigation";
import { isId } from "@/lib/http";
import {
  getOwnedPlan,
  getRecommendedTopics,
  getTimeline,
  KnowledgeError,
  listObservations,
  syncTopics,
  type Observation,
  type OwnedPlan,
  type StudyFocus,
  type Timeline,
} from "@/lib/knowledge";
import { getCurrentUser } from "@/lib/queries";

export type Loaded =
  | { plan: OwnedPlan; timeline: Timeline; observations: Observation[]; focus: StudyFocus; error: null }
  | { plan: OwnedPlan; timeline: null; observations: Observation[]; focus: null; error: string };

/** The plan, synced to the knowledge service, with the learner's timeline and data points. */
export async function loadKnowledge(id: string): Promise<Loaded> {
  const user = await getCurrentUser();
  const plan = isId(id) ? await getOwnedPlan(user.id, id) : null;
  if (!plan) notFound();
  if (plan.subjects.length === 0) {
    return { plan, timeline: null, observations: [], focus: null, error: "This plan has no subjects yet." };
  }
  try {
    await syncTopics(plan);
    const [timeline, observations, focus] = await Promise.all([
      getTimeline(user.id, plan.id),
      listObservations(user.id, plan.id),
      getRecommendedTopics(user.id, plan),
    ]);
    return { plan, timeline, observations, focus, error: null };
  } catch (e) {
    if (e instanceof KnowledgeError) return { plan, timeline: null, observations: [], focus: null, error: e.message };
    throw e;
  }
}
