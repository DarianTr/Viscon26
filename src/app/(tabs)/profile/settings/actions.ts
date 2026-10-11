"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { userFields } from "@/app/api/users/schemas";
import { requireUser } from "@/lib/auth";
import { newCalendarToken } from "@/lib/calendar-feed";

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

export async function deleteAccount(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  if (String(form.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase() !== user.handle) {
    return { error: `Type @${user.handle} to confirm` };
  }

  // Cascades to sessions, kudos, friendships, enrollments, …
  await db.delete(s.users).where(eq(s.users.id, user.id));
  // The proxy still knows them, so they land on a fresh signup.
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

/** Default visibility for new session posts; each post can still override it. */
export async function setDefaultSessionPrivacy(shared: boolean): Promise<void> {
  const user = await requireUser();
  await db.update(s.users).set({ shareSessionsByDefault: shared }).where(eq(s.users.id, user.id));
}

/**
 * Creates the user's calendar feed, or replaces its secret so every existing
 * subscription stops updating. Returns the new token.
 */
export async function resetCalendarFeed(): Promise<string> {
  const user = await requireUser();
  const token = newCalendarToken();
  await db.update(s.users).set({ calendarToken: token }).where(eq(s.users.id, user.id));
  return token;
}

/** Turns the feed off; subscribed clients get a 404 from then on. */
export async function disableCalendarFeed(): Promise<void> {
  const user = await requireUser();
  await db.update(s.users).set({ calendarToken: null }).where(eq(s.users.id, user.id));
}
