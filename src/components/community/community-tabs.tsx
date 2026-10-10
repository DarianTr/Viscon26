"use client";

import { useState } from "react";
import { Avatar, Card } from "@/components/ui/primitives";
import type { Activity, LeaderboardEntry, Person } from "@/lib/types";
import { ActivityCard } from "./activity-card";
import { FriendSearch } from "./friend-search";

const segments = ["Feed", "You", "Leaderboard", "Friends"] as const;
const medals = ["🥇", "🥈", "🥉"];

export function CommunityTabs({
  feed,
  mine,
  leaderboard,
  friends,
}: {
  feed: Activity[];
  /** The user's own activities, private ones included. */
  mine: Activity[];
  leaderboard: LeaderboardEntry[];
  friends: Person[];
}) {
  const [segment, setSegment] = useState<(typeof segments)[number]>("Feed");
  const requests = friends.filter((p) => p.status === "received").length;
  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 bg-background/85 px-4 pt-1 pb-3 backdrop-blur-xl sm:mx-0 sm:px-0">
        <div className="grid grid-cols-4 rounded-full bg-surface-2 p-1">
          {segments.map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`rounded-full py-2 text-sm font-semibold transition-colors ${
                segment === s ? "bg-surface text-foreground shadow-sm" : "text-muted"
              }`}
            >
              {s}
              {s === "Friends" && requests > 0 && (
                <span
                  aria-label={`${requests} friend requests`}
                  className="ml-1.5 inline-grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] leading-5 text-white"
                >
                  {requests}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {segment === "Feed" && (
        <ActivityList
          activities={feed}
          empty="Nothing here yet — add classmates under Friends to see their sessions."
        />
      )}

      {segment === "You" && (
        <ActivityList activities={mine} empty="Finish a session and it shows up here." />
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
                <span
                  aria-label={i < 3 ? `${i + 1}${["st", "nd", "rd"][i]} place` : undefined}
                  className={`w-7 text-center font-bold ${i < 3 ? "text-xl" : "text-sm text-muted"}`}
                >
                  {medals[i] ?? i + 1}
                </span>
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

function ActivityList({ activities, empty }: { activities: Activity[]; empty: string }) {
  if (activities.length === 0) {
    return <Card className="py-10 text-center text-sm text-muted">{empty}</Card>;
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
