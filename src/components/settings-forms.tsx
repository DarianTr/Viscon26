"use client";

import { useActionState, useState } from "react";
import {
  changePassword,
  deleteAccount,
  updateProfile,
  type SettingsState,
} from "@/app/(tabs)/profile/settings/actions";
import { Avatar, Card, SectionTitle } from "@/components/ui/primitives";
import { initials } from "@/lib/session-types";

const input =
  "w-full rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-accent";
const button = "rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60";

type Me = {
  name: string;
  handle: string;
  program: string | null;
  hue: number;
  weeklyGoalHours: number;
};

export function SettingsForms({ me }: { me: Me }) {
  return (
    <>
      <ProfileForm me={me} />
      <PasswordForm />
      <DeleteForm />
    </>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  const [hue, setHue] = useState(me.hue);
  const [name, setName] = useState(me.name);
  const v = state?.values;

  return (
    <>
      <SectionTitle>Profile</SectionTitle>
      <Card>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Avatar initials={initials(name || "?")} hue={hue} size="lg" />
            <label className="flex-1 text-sm">
              <span className="font-medium">Avatar colour</span>
              <input
                name="hue"
                type="range"
                min={0}
                max={360}
                value={hue}
                onChange={(e) => setHue(Number(e.target.value))}
                className="mt-2 w-full accent-accent"
              />
            </label>
          </div>
          <Field label="Name">
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              className={input}
            />
          </Field>
          <Field label="Handle">
            <input
              name="handle"
              defaultValue={v?.handle ?? me.handle}
              autoCapitalize="none"
              autoComplete="username"
              required
              className={input}
            />
          </Field>
          <Field label="Study programme">
            <input
              name="program"
              defaultValue={v?.program ?? me.program ?? ""}
              placeholder="e.g. BSc Computer Science, ETH"
              className={input}
            />
          </Field>
          <Field label="Weekly goal (hours)">
            <input
              name="weeklyGoalHours"
              type="number"
              min={0}
              max={100}
              defaultValue={v?.weeklyGoalHours ?? me.weeklyGoalHours}
              required
              className={input}
            />
          </Field>
          <Status state={state} />
          <button disabled={pending} className={`${button} bg-accent self-start`}>
            {pending ? "Saving…" : "Save profile"}
          </button>
        </form>
      </Card>
    </>
  );
}

function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);

  return (
    <>
      <SectionTitle>Password</SectionTitle>
      <Card>
        <form action={action} className="flex flex-col gap-3">
          <input
            name="current"
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            required
            className={input}
          />
          <input
            name="next"
            type="password"
            placeholder="New password"
            autoComplete="new-password"
            required
            className={input}
          />
          <input
            name="confirm"
            type="password"
            placeholder="Repeat new password"
            autoComplete="new-password"
            required
            className={input}
          />
          <Status state={state} />
          <button disabled={pending} className={`${button} bg-accent self-start`}>
            {pending ? "…" : "Change password"}
          </button>
        </form>
      </Card>
    </>
  );
}

function DeleteForm() {
  const [state, action, pending] = useActionState(deleteAccount, undefined);

  return (
    <>
      <SectionTitle>Danger zone</SectionTitle>
      <Card>
        <form
          action={action}
          onSubmit={(e) => {
            if (!confirm("Delete your account and all your sessions? This can't be undone.")) {
              e.preventDefault();
            }
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-muted">
            Deletes your account, sessions, kudos and follows for good.
          </p>
          <input
            name="password"
            type="password"
            placeholder="Confirm with your password"
            autoComplete="current-password"
            required
            className={input}
          />
          <Status state={state} />
          <button disabled={pending} className={`${button} bg-tempo self-start`}>
            {pending ? "…" : "Delete account"}
          </button>
        </form>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function Status({ state }: { state: SettingsState }) {
  if (state?.error) return <p className="text-sm text-tempo">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-recovery">{state.ok}</p>;
  return null;
}
