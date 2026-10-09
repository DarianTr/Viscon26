"use client";

import { useState } from "react";
import { CommentIcon, HeartIcon, MapPinIcon } from "@/components/icons";
import { Avatar, Card } from "@/components/ui/primitives";
import { formatMinutes, sessionTypes, type Activity } from "@/lib/study-data";

/** A Strava-style activity post for a finished study session. */
export function ActivityCard({ activity }: { activity: Activity }) {
  const [liked, setLiked] = useState(false);
  const type = sessionTypes[activity.type];

  return (
    <Card className="p-0">
      <div className="flex items-center gap-3 px-4 pt-4">
        <Avatar initials={activity.user.initials} hue={activity.user.hue} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{activity.user.name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            {activity.postedAgo} · <MapPinIcon className="size-3" /> {activity.location}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${type.soft}`}>{type.label}</span>
      </div>

      <div className="px-4 pt-3">
        <h3 className="text-lg font-bold">{activity.title}</h3>
        {activity.note && <p className="mt-1 text-sm">{activity.note}</p>}
      </div>

      <dl className="grid grid-cols-3 gap-2 px-4 pt-4">
        <Metric label="Subject" value={activity.subject} />
        <Metric label="Time" value={formatMinutes(activity.minutes)} />
        <Metric label="Focus" value={`${activity.focus}%`} />
      </dl>

      <FocusTrace values={activity.trace} className={type.soft.split(" ")[1]} />

      <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
        <button
          onClick={() => setLiked((l) => !l)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
            liked ? "text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          <HeartIcon className={`size-5 transition-transform ${liked ? "scale-110 fill-current" : ""}`} />
          {activity.kudos + (liked ? 1 : 0)} kudos
        </button>
        <button className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted hover:text-foreground">
          <CommentIcon className="size-5" />
          {activity.comments}
        </button>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}

/** Focus-over-time area chart — stands in for the run map on a Strava post. */
function FocusTrace({ values, className }: { values: number[]; className: string }) {
  const w = 300;
  const h = 64;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - v * (h - 6)}`);
  const line = `M${points.join(" L")}`;
  return (
    <div className={`mx-4 mt-4 mb-3 rounded-2xl bg-surface-2 p-3 ${className}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full" aria-label="Focus over the session">
        <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" opacity={0.15} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
