"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";

const input =
  "w-full rounded-xl border-2 border-border bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent";

/**
 * The signup form: picks a handle, name and degree for the account the reverse
 * proxy already logged in. `defaults` prefills it from the proxy's headers.
 */
export function AuthForm({
  action,
  defaults,
  email,
}: {
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
  defaults: { handle: string; name: string };
  email: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-center text-sm text-muted">
        Welcome! Set up your profile for <span className="font-medium text-foreground">{email}</span>.
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Handle</span>
        <input
          name="handle"
          placeholder="Handle"
          autoComplete="username"
          autoCapitalize="none"
          defaultValue={state?.handle ?? defaults.handle}
          required
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Name</span>
        <input
          name="name"
          placeholder="Full name"
          autoComplete="name"
          defaultValue={state?.name ?? defaults.name}
          required
          className={input}
        />
      </label>
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
      {state?.error && <p className="text-sm text-tempo">{state.error}</p>}
      <button
        disabled={pending}
        className="mt-1 rounded-full border-[2.5px] border-foreground bg-accent py-2.5 font-display text-sm font-bold text-white shadow-[0_3px_0_0_var(--foreground)] active:translate-y-[3px] active:shadow-none disabled:opacity-60 disabled:shadow-none"
      >
        {pending ? "…" : "Create account"}
      </button>
    </form>
  );
}
