import type { StoredPlanConfig, StoredSubjectConfig } from "@/db/schema";

/*
 * Managing a plan saves settings without re-running the scheduler. This
 * decides what a save means for the schedule: which edits only change labels
 * (a subject's name, its materials, comments) and which leave the remaining
 * calendar out of date until the student recalibrates. Safe for client code.
 */

/** Subject answers the scheduler reads; changing one calls for a recalibration. */
const SCHEDULED_SUBJECT_FIELDS: [keyof StoredSubjectConfig, string][] = [
  ["examDate", "exam date"],
  ["examDuration", "exam duration"],
  ["targetGrade", "target grade"],
  ["currentGrade", "current grade"],
  ["confidence", "confidence"],
  ["mockCount", "past exams"],
  ["approach", "approach"],
  ["customPhases", "phases"],
  ["cheatsheet", "cheatsheet"],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type PlanChanges = {
  /** Short descriptions of edits the schedule doesn't reflect yet. */
  pending: string[];
  /** Subjects renamed in place: [old name, new name]. */
  renames: [string, string][];
};

/**
 * What changed between the saved config and the edited one. Subjects are
 * matched by position: subjects can be added at the end, not reordered.
 */
export function describeChanges(saved: StoredPlanConfig, next: StoredPlanConfig): PlanChanges {
  const pending: string[] = [];
  if (
    !same(saved.weeklyHours, next.weeklyHours) ||
    !same(saved.studyDays, next.studyDays) ||
    !same(saved.vacationRanges, next.vacationRanges) ||
    !same(saved.startTime, next.startTime) ||
    !same(saved.rhythm, next.rhythm) ||
    !same(saved.sessionLength, next.sessionLength)
  ) {
    pending.push("Study availability");
  }
  if (!same(saved.lernphaseStart, next.lernphaseStart) || !same(saved.focusDays, next.focusDays)) {
    pending.push("Lernphase start");
  }

  const before = saved.subjects ?? [];
  const after = next.subjects ?? [];
  const renames: [string, string][] = [];
  after.forEach((subject, i) => {
    const old = before[i];
    if (!old) {
      pending.push(`New subject: ${subject.name}`);
      return;
    }
    if (old.name !== subject.name) renames.push([old.name, subject.name]);
    const fields = SCHEDULED_SUBJECT_FIELDS.filter(([key]) => !same(old[key], subject[key])).map(([, label]) => label);
    if (fields.length) pending.push(`${subject.name}: ${fields.join(", ")}`);
  });
  if (after.some((subject, i) => before[i] && before[i].allocation !== subject.allocation)) {
    pending.push("Subject distribution");
  }
  return { pending, renames };
}

/** Adds new pending changes to earlier ones, renaming subjects in the earlier ones. */
export function mergePending(earlier: string[] | undefined, changes: PlanChanges): string[] {
  const renamed = (earlier ?? []).map((line) =>
    changes.renames.reduce(
      (text, [from, to]) => (text.startsWith(`${from}:`) || text === `New subject: ${from}` ? text.replace(from, to) : text),
      line,
    ),
  );
  return [...new Set([...renamed, ...changes.pending])];
}

/** The subject names that would clash after renaming (case-insensitive), if any. */
export function duplicateNames(subjects: { name: string }[]): string[] {
  const seen = new Map<string, number>();
  for (const { name } of subjects) seen.set(name.trim().toLowerCase(), (seen.get(name.trim().toLowerCase()) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name);
}
