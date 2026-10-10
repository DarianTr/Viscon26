"use client";

import Link from "next/link";
import { useState } from "react";
import { ExpressionMascot } from "@/components/mascot/expression-mascot";
import { Avatar, Button, Card } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { beatChallenge, formatEffort, sessionTypes, subjectColor } from "@/lib/session-types";
import type { Challenge } from "@/lib/types";

/** Challenges you received (answer them here) and ones you sent. */
export function ChallengeList({ received, sent }: { received: Challenge[]; sent: Challenge[] }) {
  if (received.length === 0 && sent.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        <ExpressionMascot expression="sleepy" size={96} />
        <p className="max-w-[32ch] text-sm text-muted">
          No challenges yet. Finish something hard, then tap ⚔️ on your post to make your friends suffer too.
        </p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {received.length > 0 && <Section title="For you" challenges={received} side="received" />}
      {sent.length > 0 && <Section title="You sent" challenges={sent} side="sent" />}
    </div>
  );
}

function Section({ title, challenges, side }: { title: string; challenges: Challenge[]; side: Side }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-muted uppercase">{title}</h2>
      <ul className="flex flex-col gap-3">
        {challenges.map((c) => (
          <li key={c.id}>
            <ChallengeCard challenge={c} side={side} />
          </li>
        ))}
      </ul>
    </section>
  );
}

type Side = "received" | "sent";

function ChallengeCard({ challenge, side }: { challenge: Challenge; side: Side }) {
  const [status, setStatus] = useState(challenge.status);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { other, source } = challenge;
  const type = sessionTypes[source.type];

  async function act(fn: () => Promise<void>, next?: Challenge["status"]) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (next) setStatus(next);
      else setGone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (gone) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar initials={other.initials} hue={other.hue} size="sm" />
        <p className="min-w-0 flex-1 text-sm">
          {side === "received" ? (
            <>
              <span className="font-semibold">{other.name}</span> challenged you
            </>
          ) : (
            <>
              You challenged <span className="font-semibold">{other.name}</span>
            </>
          )}
          <span className="text-muted"> · {challenge.sentAgo}</span>
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${type.soft}`}>{type.label}</span>
      </div>

      {challenge.message && <p className="mt-3 font-display text-lg font-bold">“{challenge.message}”</p>}

      <div className="mt-3 rounded-2xl bg-surface-2 px-3 py-2.5">
        <p className="font-semibold">{source.title}</p>
        <p className="text-sm text-muted">
          {source.subject && (
            <>
              <span className={subjectColor(source.subject).text}>{source.subject}</span> ·{" "}
            </>
          )}
          to beat:{" "}
          <span className="font-medium text-foreground">{formatEffort(source)}</span>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <StatusLine challenge={challenge} status={status} side={side} />
        {side === "received" && status === "pending" && (
          <span className="ml-auto flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => act(() => api.respondToChallenge(challenge.id, false), "declined")}
            >
              Chicken out
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act(() => api.respondToChallenge(challenge.id, true), "accepted")}>
              Accept
            </Button>
          </span>
        )}
        {side === "sent" && status === "pending" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={busy}
            onClick={() => act(() => api.withdrawChallenge(challenge.id))}
          >
            Withdraw
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-tempo">{error}</p>}
    </Card>
  );
}

function StatusLine({
  challenge,
  status,
  side,
}: {
  challenge: Challenge;
  /** The live status, which may be ahead of `challenge.status` after answering. */
  status: Challenge["status"];
  side: Side;
}) {
  const { result } = challenge;
  const them = challenge.other.name.split(" ")[0];
  switch (status) {
    case "pending":
      return <span className="text-muted">{side === "received" ? "Well? Everyone's watching." : `Waiting for ${them}…`}</span>;
    case "accepted":
      return side === "received" ? (
        <Link href="/" className="font-semibold text-accent">
          On your list for today → go do it
        </Link>
      ) : (
        <span className="text-muted">{them} accepted. They&apos;re on it.</span>
      );
    case "declined":
      return <span className="text-muted">{side === "received" ? "You chickened out 🐔" : `${them} chickened out 🐔`}</span>;
    case "completed": {
      if (!result) return <span className="text-muted">Done</span>;
      const challengeeWon = beatChallenge(result, challenge.source);
      const youWon = side === "received" ? challengeeWon : !challengeeWon;
      return (
        <span>
          <span className={`font-bold ${youWon ? "text-recovery" : "text-tempo"}`}>{youWon ? "You won 🏆" : "You lost 💀"}</span>
          <span className="text-muted">
            {" "}
            · {side === "received" ? "you" : them} did {formatEffort(result)}
          </span>
        </span>
      );
    }
  }
}
