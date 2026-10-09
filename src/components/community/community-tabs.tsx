"use client";

import { useState } from "react";
import { Avatar, Card } from "@/components/ui/primitives";
import type { Activity, LeaderboardEntry, Person } from "@/lib/types";
import { ActivityCard } from "./activity-card";
import { FriendSearch } from "./friend-search";

const segments = ["Feed", "Leaderboard", "Friends"] as const;

export function CommunityTabs({
  feed,
  leaderboard,
  friends,
}: {
  feed: Activity[];
  leaderboard: LeaderboardEntry[];
  friends: Person[];
}) {
  const [segment, setSegment] = useState<(typeof segments)[number]>("Feed");
  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 bg-background/85 px-4 pt-1 pb-3 backdrop-blur-xl sm:mx-0 sm:px-0">
        <div className="grid grid-cols-3 rounded-full bg-surface-2 p-1">
          {segments.map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`rounded-full py-2 text-sm font-semibold transition-colors ${
                segment === s ? "bg-surface text-foreground shadow-sm" : "text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {segment === "Feed" && feed.length === 0 && (
        <Card className="py-10 text-center text-sm text-muted">
          Nothing here yet — find classmates under Friends to see their sessions.
        </Card>
      )}

      {segment === "Feed" && (
        <ul className="flex flex-col gap-4">
          {feed.map((activity) => (
            <li key={activity.id}>
              <ActivityCard activity={activity} />
            </li>
          ))}
        </ul>
      )}

      {segment === "Leaderboard" && (
        <Card className="p-2">
          <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Study hours · this week
          </p>
          <ol>
            {leaderboard.map((entry, i) => (
              <li
                key={entry.id}
                className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${entry.you ? "bg-accent-soft" : ""}`}
              >
                <span className={`w-5 text-center font-bold ${i < 3 ? "text-accent" : "text-muted"}`}>{i + 1}</span>
                <Avatar initials={entry.initials} hue={entry.hue} size="sm" />
                <span className="flex-1 font-medium">{entry.name}</span>
                <span className="font-mono text-sm font-semibold tabular-nums">{entry.hours.toFixed(1)} h</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {segment === "Friends" && <FriendSearch friends={friends} />}

    </>
  );
}
