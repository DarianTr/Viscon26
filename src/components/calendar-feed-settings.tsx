"use client";

import { useState, useTransition } from "react";
import { disableCalendarFeed, resetCalendarFeed } from "@/app/(tabs)/profile/settings/actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Card, SectionTitle } from "@/components/ui/primitives";

const pill = "rounded-full bg-surface-2 px-4 py-2 text-sm font-bold disabled:opacity-60";

/**
 * The read-only feed of the app's calendar for Apple Calendar, Google
 * Calendar, Outlook, … `origin` is where the app is reached from outside;
 * `token` is null while the feed is off.
 */
export function CalendarFeedSettings({ origin, token: initial }: { origin: string; token: string | null }) {
  const [token, setToken] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();

  const url = token ? `${origin}/api/calendar/${token}.ics` : null;
  const webcal = url?.replace(/^https?:/, "webcal:");

  function run(action: () => Promise<void>, done?: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        await action();
        if (done) setMessage(done);
      } catch {
        setMessage("Something went wrong. Try again.");
      }
    });
  }

  async function reset() {
    const ok = await confirm({
      title: "Reset the subscription link?",
      message: "Calendars subscribed with the current link stop updating. You'll need to subscribe again with the new one.",
      confirmLabel: "Reset link",
    });
    if (ok) run(async () => setToken(await resetCalendarFeed()), "New link created. Subscribe again with it.");
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied. Add it as a calendar subscription (“From URL”) in your calendar app.");
    } catch {
      setMessage("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <>
      <SectionTitle>
        <span id="calendar-feed" className="scroll-mt-6">Calendar subscription</span>
      </SectionTitle>
      <Card className="flex flex-col gap-4">
        <div>
          <p className="font-medium">See your study plan in your own calendar</p>
          <p className="text-sm text-muted">
            Apple Calendar, Google Calendar, Outlook and others can subscribe to everything in your Braina calendar.
            It&apos;s read-only there: move or change blocks here and your calendar app catches up on its next refresh
            (Google can take several hours).
          </p>
        </div>

        {url ? (
          <>
            <input
              readOnly
              value={url}
              aria-label="Calendar subscription link"
              onFocus={(e) => e.target.select()}
              className="w-full rounded-xl border-2 border-border bg-surface-2 px-3.5 py-2.5 font-mono text-xs outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-2">
              <a
                href={webcal}
                className="rounded-full border-2 border-foreground bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none"
              >
                Open in calendar app
              </a>
              <a
                href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}`}
                target="_blank"
                rel="noreferrer"
                className={pill}
              >
                Add to Google Calendar
              </a>
              <button type="button" onClick={copy} className={pill}>
                Copy link
              </button>
            </div>
            <p className="text-sm text-muted">
              Anyone with this link can see your schedule. If it leaked, reset it — old subscriptions stop updating.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={reset} className={pill}>
                Reset link
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(async () => { await disableCalendarFeed(); setToken(null); }, "Subscription turned off.")}
                className={pill}
              >
                Turn off
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => setToken(await resetCalendarFeed()))}
            className="self-start rounded-full border-2 border-foreground bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-[0_3px_0_0_var(--border)] active:translate-y-[3px] active:shadow-none disabled:opacity-60 disabled:shadow-none"
          >
            {pending ? "Creating…" : "Create subscription link"}
          </button>
        )}
        {message && <p className="text-sm text-muted">{message}</p>}
      </Card>
      {dialog}
    </>
  );
}
