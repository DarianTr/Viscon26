import { z } from "zod";

export const userFields = {
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,32}$/, "2–32 characters: letters, digits, . _ -"),
  name: z.string().trim().min(1).max(100),
  hue: z.number().int().min(0).max(360),
  spiritAnimal: z.string().trim().min(1).max(40),
  program: z.string().trim().max(200).nullable(),
  weeklyGoalHours: z.number().int().min(0).max(100),
};

export const createUserSchema = z.object({
  handle: userFields.handle,
  name: userFields.name,
  hue: userFields.hue.optional(),
  program: userFields.program.optional(),
  weeklyGoalHours: userFields.weeklyGoalHours.optional(),
});

export const updateUserSchema = z
  .object(userFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Provide at least one field" });

export const listUsersQuery = z.object({
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
