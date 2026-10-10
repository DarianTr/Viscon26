"use client";

import { useState, useTransition } from "react";
import { setDefaultSessionPrivacy } from "@/app/(tabs)/profile/settings/actions";
import { Card, SectionTitle } from "@/components/ui/primitives";

/** Default visibility for new community posts; each post keeps its own toggle to override it. */
export function PrivacySettings({ shareSessionsByDefault }: { shareSessionsByDefault: boolean }) {
  const [shared, setShared] = useState(shareSessionsByDefault);
  const [saving, startSaving] = useTransition();

  function choose(next: boolean) {
    const prev = shared;
    setShared(next);
    startSaving(() => setDefaultSessionPrivacy(next).catch(() => setShared(prev)));
  }

  return (
    <>
      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium">Share new sessions with friends</p>
            <p className="text-sm text-muted">
              {shared
                ? "New posts go to your friends' feed by default."
                : "New posts stay private by default."}{" "}
              You can still change it on any post.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={shared}
            aria-label="Share new sessions with friends by default"
            disabled={saving}
            onClick={() => choose(!shared)}
            className={`relative h-7 w-12 shrink-0 rounded-full border-2 border-foreground transition-colors disabled:opacity-60 ${
              shared ? "bg-accent" : "bg-surface-2"
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full border-2 border-foreground bg-surface transition-[left] ${
                shared ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </Card>
    </>
  );
}
