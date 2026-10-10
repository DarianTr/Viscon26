"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { getIdentity, getSessionUser } from "@/lib/auth";

export type AuthState = { error?: string; handle?: string; name?: string; program?: string } | undefined;

const signupSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,32}$/, "Handle: 2–32 characters, letters, digits, . _ -"),
  name: z.string().trim().min(1, "Enter your name").max(100),
  /** The degree they're pursuing — `users.program`, editable in Settings. */
  program: z
    .string()
    .trim()
    .max(200, "Degree: at most 200 characters")
    .optional()
    .transform((v) => v || null),
});

/** Creates the profile for whoever the reverse proxy logged in (see `src/lib/auth.ts`). */
export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const echo = {
    handle: String(form.get("handle") ?? ""),
    name: String(form.get("name") ?? ""),
    program: String(form.get("program") ?? ""),
  };
  const identity = await getIdentity();
  if (!identity) return { error: "You're not logged in. Open the app through its hackathon address.", ...echo };
  // Already has a profile (e.g. signed up in another tab).
  if (await getSessionUser()) redirect("/");

  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, ...echo };

  const [user] = await db
    .insert(s.users)
    .values({ ...parsed.data, email: identity.email })
    .onConflictDoNothing()
    .returning({ id: s.users.id });
  if (!user) {
    // Either the handle is taken, or the email signed up in the meantime.
    const mine = await db.query.users.findFirst({ where: eq(s.users.email, identity.email), columns: { id: true } });
    if (mine) redirect("/");
    return { error: `@${parsed.data.handle} is taken`, ...echo };
  }

  redirect("/");
}
