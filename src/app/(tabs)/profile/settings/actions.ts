"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { hashPassword, verifyPassword } from "@/db/password";
import { userFields } from "@/app/api/users/schemas";
import { deleteOtherSessions, deleteSession, requireUser } from "@/lib/auth";

/*
 * Settings for the signed-in user. Each action acts on the session's user
 * only — never on an id from the form.
 */

export type SettingsState =
  | { error?: string; ok?: string; values?: Record<string, string> }
  | undefined;

const profileSchema = z.object({
  name: userFields.name,
  handle: userFields.handle,
  program: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null),
  hue: z.coerce.number().pipe(userFields.hue),
});

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "New password: at least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, { message: "New passwords don't match" });

async function passwordMatches(userId: string, password: string) {
  const row = await db.query.users.findFirst({
    where: eq(s.users.id, userId),
    columns: { passwordHash: true },
  });
  return !!row?.passwordHash && (await verifyPassword(password, row.passwordHash));
}

export async function updateProfile(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const values = Object.fromEntries(form) as Record<string, string>;
  const parsed = profileSchema.safeParse(values);
  // Echo the input back, since React resets the form after the action.
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const taken = await db.query.users.findFirst({
    where: and(eq(s.users.handle, parsed.data.handle), ne(s.users.id, user.id)),
    columns: { id: true },
  });
  if (taken) return { error: `@${parsed.data.handle} is taken`, values };

  await db.update(s.users).set(parsed.data).where(eq(s.users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: "Profile saved" };
}

export async function changePassword(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await passwordMatches(user.id, parsed.data.current))) {
    return { error: "Current password is wrong" };
  }

  await db
    .update(s.users)
    .set({ passwordHash: await hashPassword(parsed.data.next) })
    .where(eq(s.users.id, user.id));
  await deleteOtherSessions(user.id);
  return { ok: "Password changed — other devices were signed out" };
}

export async function deleteAccount(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  if (!(await passwordMatches(user.id, String(form.get("password") ?? "")))) {
    return { error: "Wrong password" };
  }

  await deleteSession();
  // Cascades to sessions, kudos, friendships, enrollments, …
  await db.delete(s.users).where(eq(s.users.id, user.id));
  redirect("/signup");
}

const nudgeStyleSchema = z.enum(["savage", "gentle", "off"]);

/** How the daily study nudge talks to the user (see `src/lib/nudges.ts`). */
export async function setNudgeStyle(style: string): Promise<void> {
  const user = await requireUser();
  await db
    .update(s.users)
    .set({ nudgeStyle: nudgeStyleSchema.parse(style) })
    .where(eq(s.users.id, user.id));
}
