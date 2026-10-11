"use client";

import { useEffect, useState, useTransition } from "react";
import { setNudgeStyle } from "@/app/(tabs)/profile/settings/actions";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import type { NudgeStyle } from "@/lib/types";

type PushState = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

const styles: { value: NudgeStyle; label: string; example: string }[] = [
  { value: "savage", label: "Savage", example: "“Lena did 3 sessions today. Where are you at? 👀”" },
  { value: "gentle", label: "Gentle", example: "“Lena studied 2 h today. Fancy a quick session?”" },
  { value: "off", label: "Off", example: "No daily nudges. Challenges, friend requests, braincells and comments still come through." },
];

/** `applicationServerKey` wants the VAPID key as bytes, not base64url. */
function base64UrlToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

/**
 * Push on this device, and the tone of the daily nudge. Push needs a service
 * worker (`public/sw.js`); on iPhones it only works once the app is on the
 * home screen.
 */
export function NotificationSettings({
  vapidPublicKey,
  nudgeStyle,
}: {
  /** Null when the server has no VAPID keys, i.e. push is switched off. */
  vapidPublicKey: string | null;
  nudgeStyle: NudgeStyle;
}) {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [style, setStyle] = useState(nudgeStyle);
  const [savingStyle, startSaving] = useTransition();

  useEffect(() => {
    detectPush().then(setState);
  }, []);

  async function enable() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setState(Notification.permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidPublicKey),
      });
      await api.savePushSubscription(sub.toJSON());
      setState("on");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await api.deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      await api.sendTestPush();
      setMessage("Sent. Brace yourself.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function chooseStyle(next: NudgeStyle) {
    const prev = style;
    setStyle(next);
    startSaving(() => setNudgeStyle(next).catch(() => setStyle(prev)));
  }

  return (
    <>
      <SectionTitle>Notifications</SectionTitle>
      <Card className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium">Push on this device</p>
            <p className="text-sm text-muted">{pushHint(state, vapidPublicKey !== null)}</p>
          </div>
          {vapidPublicKey && (state === "off" || state === "on") && (
            <button
              role="switch"
              aria-checked={state === "on"}
              aria-label="Push notifications"
              disabled={busy}
              onClick={state === "on" ? disable : enable}
              className={`relative h-7 w-12 shrink-0 rounded-full border-2 border-foreground transition-colors disabled:opacity-60 ${
                state === "on" ? "bg-accent" : "bg-surface-2"
              }`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full border-2 border-foreground bg-surface transition-[left] ${
                  state === "on" ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          )}
        </div>
        {state === "on" && (
          <button
            onClick={test}
            disabled={busy}
            className="self-start rounded-full bg-surface-2 px-4 py-2 text-sm font-bold disabled:opacity-60"
          >
            Send me a test nudge
          </button>
        )}
        {message && <p className="text-sm text-muted">{message}</p>}

        <fieldset className="flex flex-col gap-2" disabled={savingStyle}>
          <legend className="mb-2 font-medium">Daily nudge, if you haven&apos;t studied by 18:00</legend>
          {styles.map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border-2 px-3 py-2.5 transition-colors ${
                style === s.value ? "border-accent bg-accent-soft" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="nudgeStyle"
                checked={style === s.value}
                onChange={() => chooseStyle(s.value)}
                className="mt-1 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block text-sm text-muted">{s.example}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>
    </>
  );
}

/** Where push stands on this device. Registers the service worker on the way. */
async function detectPush(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return ios && !window.matchMedia("(display-mode: standalone)").matches ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const sub = await reg.pushManager.getSubscription();
    // Re-sync, in case the server dropped it or another account used this device.
    if (sub) api.savePushSubscription(sub.toJSON()).catch(() => {});
    return sub ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

function pushHint(state: PushState, configured: boolean) {
  if (!configured) return "Push isn't set up on this server yet.";
  switch (state) {
    case "loading":
      return "Checking…";
    case "unsupported":
      return "This browser can't receive push notifications.";
    case "ios-install":
      return "On iPhone, add Braina to your home screen first (Share → Add to Home Screen), then open it from there.";
    case "denied":
      return "Notifications are blocked for this site. Allow them in your browser settings.";
    case "off":
      return "Get challenges and nudges even when Braina is closed.";
    case "on":
      return "You'll hear about challenges, and about it when you slack off.";
  }
}
