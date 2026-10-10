import { z } from "zod";
import { blockActivities } from "@/lib/types";

const taskType = z.enum(["deep", "intervals", "tempo", "recovery", "lecture", "exam", "buffer", "break"]);
const timestamp = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createTaskSchema = z.object({
  /** Defaults to the current user. */
  userId: z.uuid().optional(),
  planId: z.string().min(1).nullable().optional(),
  type: taskType,
  activity: z.enum(blockActivities).nullable().optional(),
  /** Null only for breaks and buffers, which belong to no subject. */
  subject: z.string().trim().min(1).max(100).nullable(),
  cheatsheetTarget: z.number().int().min(0).max(100).nullable().optional(),
  cheatsheetMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  detail: optionalText(500),
  scheduledAt: timestamp,
  plannedMinutes: z.number().int().min(1).max(24 * 60),
  location: optionalText(200),
  note: optionalText(2000),
  shared: z.boolean().optional(),
  calendarOrder: z.number().int().min(0).nullable().optional(),
});

/** A new block: everything except breaks and buffers needs a subject. */
export const newTaskSchema = createTaskSchema.refine(
  (task) => task.subject !== null || task.type === "buffer" || task.type === "break",
  { message: "A subject is required", path: ["subject"] },
);

export const updateTaskSchema = createTaskSchema
  .omit({ userId: true })
  .partial()
  .extend({
    done: z.boolean().optional(),
    actualMinutes: z.number().int().min(1).max(24 * 60).optional(),
    focus: z.number().int().min(0).max(100).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Provide at least one field" });

export const listTasksQuery = z.object({
  userId: z.uuid().optional(),
  type: taskType.optional(),
  done: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  /** Scheduled at or after this instant. */
  from: timestamp.optional(),
  /** Scheduled before this instant. */
  to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
