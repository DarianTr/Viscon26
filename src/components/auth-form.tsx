"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";

const input =
  "w-full rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-accent";

/** The login and signup forms; signup adds a name field. */
export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const signup = mode === "signup";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        name="handle"
        placeholder="Handle"
        autoComplete="username"
        autoCapitalize="none"
        defaultValue={state?.handle}
        required
        className={input}
      />
      {signup && (
        <input name="name" placeholder="Full name" autoComplete="name" defaultValue={state?.name} required className={input} />
      )}
      <input
        name="password"
        type="password"
        placeholder="Password"
        autoComplete={signup ? "new-password" : "current-password"}
        required
        className={input}
      />
      {state?.error && <p className="text-sm text-tempo">{state.error}</p>}
      <button
        disabled={pending}
        className="mt-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "…" : signup ? "Create account" : "Log in"}
      </button>
      <p className="text-center text-sm text-muted">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={signup ? "/login" : "/signup"} className="font-medium text-accent">
          {signup ? "Log in" : "Sign up"}
        </Link>
      </p>
    </form>
  );
}
