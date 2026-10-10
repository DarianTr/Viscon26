import type { Metadata } from "next";
import { like } from "drizzle-orm";
import { AuthForm } from "@/components/auth-form";
import { db, schema as s } from "@/db";
import { getIdentity } from "@/lib/auth";
import { signup } from "../actions";

export const metadata: Metadata = { title: "Sign up" };

/** A free handle from the email's local part: `jdoe@ethz.ch` → `jdoe`, or `jdoe2` if that's taken. */
async function suggestHandle(email: string) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(0, 28).padEnd(2, "0");
  const taken = new Set(
    (await db.select({ handle: s.users.handle }).from(s.users).where(like(s.users.handle, `${base}%`))).map(
      (r) => r.handle,
    ),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export default async function SignupPage() {
  const identity = await getIdentity();
  if (!identity) {
    return (
      <p className="text-center text-sm text-muted">
        You&apos;re not logged in. Open the app through its hackathon address to sign in.
      </p>
    );
  }

  return (
    <AuthForm
      action={signup}
      defaults={{ handle: await suggestHandle(identity.email), name: identity.name }}
      email={identity.email}
    />
  );
}
