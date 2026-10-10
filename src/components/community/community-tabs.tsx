"use client";

import { useState } from "react";
import { Brain } from "@/components/mascot/brain";
import { ExpressionMascot } from "@/components/mascot/expression-mascot";
import { Avatar, Card } from "@/components/ui/primitives";
import { emptyStateLines } from "@/lib/mascot";
import type { Activity, Challenge, LeaderboardEntry, Person } from "@/lib/types";
import { ActivityCard } from "./activity-card";
import { ChallengeList } from "./challenge-list";
import { FriendSearch } from "./friend-search";

const segments = ["Feed", "You", "Challenges", "Leaderboard", "Friends"] as const;
type Segment = (typeof segments)[number];
const medals = ["🥇", "🥈", "🥉"];

export function CommunityTabs({
  feed,
  mine,
  leaderboard,
  friends,
  challenges,
  initialTab,
}: {
  feed: Activity[];
  /** The user's own activities, private ones included. */
  mine: Activity[];
  leaderboard: LeaderboardEntry[];
  friends: Person[];
  challenges: { received: Challenge[]; sent: Challenge[] };
  /** Notifications link straight to a segment, e.g. ?tab=challenges. */
  initialTab?: string;
}) {
  const [segment, setSegment] = useState<Segment>(
    () => segments.find((s) => s.toLowerCase() === initialTab) ?? "Feed",
  );
  const badges: Partial<Record<Segment, number>> = {
    Friends: friends.filter((p) => p.status === "received").length,
    Challenges: challenges.received.filter((c) => c.status === "pending").length,
  };
  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 bg-background/90 px-4 pt-1 pb-3 backdrop-blur-xl sm:mx-0 sm:px-0">
        <div className="flex overflow-x-auto rounded-full border-2 border-border bg-surface-2 p-1 [scrollbar-width:none]">
          {segments.map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`flex-1 shrink-0 rounded-full px-3 py-2 text-sm font-bold whitespace-nowrap transition-colors ${
                segment === s ? "border-2 border-foreground bg-surface text-foreground" : "border-2 border-transparent text-muted"
              }`}
            >
              {s}
              {!!badges[s] && (
                <span
                  aria-label={`${badges[s]} ${s === "Friends" ? "friend requests" : "open challenges"}`}
                  className="ml-1.5 inline-grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] leading-5 text-white"
                >
                  {badges[s]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {segment === "Feed" && <ActivityList activities={feed} empty={emptyStateLines.noFriends} mood="confused" />}

      {segment === "You" && <ActivityList activities={mine} empty={emptyStateLines.noPosts} mood="sleepy" />}

      {segment === "Challenges" && <ChallengeList received={challenges.received} sent={challenges.sent} />}

      {segment === "Leaderboard" && (
        <Card className="p-2">
          <p className="px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
            Study hours · this week
          </p>
          <ol>
            {leaderboard.map((entry, i) => (
              <li
                key={entry.id}
                className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${entry.you ? "border-2 border-accent/30 bg-accent-soft" : ""}`}
              >
                <span
                  aria-label={i < 3 ? `${i + 1}${["st", "nd", "rd"][i]} place` : undefined}
                  className={`w-7 text-center font-bold ${i < 3 ? "text-xl" : "text-sm text-muted"}`}
                >
                  {medals[i] ?? i + 1}
                </span>
                <Avatar initials={entry.initials} hue={entry.hue} size="sm" />
                <span className="flex-1 font-semibold">{entry.name}</span>
                <span className="font-display text-sm font-bold tabular-nums">{entry.hours.toFixed(1)} h</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {segment === "Friends" && <FriendSearch friends={friends} />}
    </>
  );
}

function ActivityList({
  activities,
  empty,
  mood,
}: {
  activities: Activity[];
  empty: string;
  mood: "confused" | "sleepy";
}) {
  if (activities.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        {mood === "sleepy" ? <ExpressionMascot expression="sleepy" size={96} /> : <Brain expression="confused" size={72} />}
        <p className="max-w-[28ch] text-sm text-muted">{empty}</p>
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {activities.map((activity) => (
        <li key={activity.id}>
          <ActivityCard activity={activity} />
        </li>
      ))}
    </ul>
  );
}
