import { z } from "zod";

/** A subject's onboarding answers, as stored in a plan's config. */
export const storedSubjectSchema = z.object({
  name: z.string(),
  examDate: z.string(),
  examDuration: z.string(),
  targetGrade: z.string(),
  currentGrade: z.string(),
  confidence: z.string(),
  approach: z.string(),
  customPhases: z.array(z.string()),
  mockCount: z.string(),
  allocation: z.number(),
  materials: z.array(z.string()),
  cheatsheet: z.string(),
  comments: z.string(),
});

/** A plan's stored config (StoredPlanConfig) — everything the scheduler needs to regenerate it. */
export const planConfigSchema = z.object({
  weeklyHours: z.number().positive(),
  studyDays: z.array(z.string()),
  sessionLength: z.number().positive(),
  vacationRanges: z.array(z.object({ start: z.string(), end: z.string() })),
  subjects: z.array(storedSubjectSchema).optional(),
  preferredStartHour: z.number().optional(),
  workloadBasisWeeklyMinutes: z.number().positive().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  rhythm: z.enum(["balanced", "sprint", "deep"]).optional(),
  lernphaseStart: z.enum(["recommended", "focus", "mixed"]).optional(),
  focusDays: z.number().int().min(1).max(10).optional(),
  planStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  focusDates: z.record(z.string(), z.string()).optional(),
  eveDates: z.record(z.string(), z.array(z.string())).optional(),
});
