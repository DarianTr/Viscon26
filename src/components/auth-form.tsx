"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";

const input =
  "w-full rounded-xl border-2 border-border bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent";

/** The login and signup forms; signup adds name and degree fields. */
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
        <>
          <input name="name" placeholder="Full name" autoComplete="name" defaultValue={state?.name} required className={input} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">What degree are you currently pursuing?</span>
            <input
              name="program"
              placeholder="e.g. BSc Computer Science, ETH Zürich"
              defaultValue={state?.program}
              maxLength={200}
              className={input}
            />
          </label>
        </>
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
        className="mt-1 rounded-full border-[2.5px] border-foreground bg-accent py-2.5 font-display text-sm font-bold text-white shadow-[0_3px_0_0_var(--foreground)] active:translate-y-[3px] active:shadow-none disabled:opacity-60 disabled:shadow-none"
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
