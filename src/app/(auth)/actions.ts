"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { hashPassword, verifyPassword } from "@/db/password";
import { createSession, deleteSession } from "@/lib/auth";

export type AuthState = { error?: string; handle?: string; name?: string; program?: string } | undefined;

const handleField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,32}$/, "Handle: 2–32 characters, letters, digits, . _ -");

const loginSchema = z.object({
  handle: handleField,
  password: z.string().min(1, "Enter your password"),
});

const signupSchema = z.object({
  handle: handleField,
  name: z.string().trim().min(1, "Enter your name").max(100),
  password: z.string().min(8, "Password: at least 8 characters").max(200),
  /** The degree they're pursuing — `users.program`, editable in Settings. */
  program: z
    .string()
    .trim()
    .max(200, "Degree: at most 200 characters")
    .optional()
    .transform((v) => v || null),
});

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  const handle = String(form.get("handle") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message, handle };

  const user = await db.query.users.findFirst({ where: eq(s.users.handle, parsed.data.handle) });
  const ok = user?.passwordHash && (await verifyPassword(parsed.data.password, user.passwordHash));
  if (!user || !ok) return { error: "Wrong handle or password", handle };

  await createSession(user.id);
  redirect("/");
}

export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  const echo = {
    handle: String(form.get("handle") ?? ""),
    name: String(form.get("name") ?? ""),
    program: String(form.get("program") ?? ""),
  };
  if (!parsed.success) return { error: parsed.error.issues[0].message, ...echo };

  const { password, ...data } = parsed.data;
  const [user] = await db
    .insert(s.users)
    .values({ ...data, passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: s.users.handle })
    .returning({ id: s.users.id });
  if (!user) return { error: `@${data.handle} is taken`, ...echo };

  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
