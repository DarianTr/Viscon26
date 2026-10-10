/** Shapes shared by the backend (data layer, route handlers) and the frontend. */

export type Item = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
};

/** Study session types, modelled on run types in a training plan. */
export type SessionType = "deep" | "intervals" | "tempo" | "recovery";

/** Everything the calendar can show. */
/**
 * "buffer" is the daily catch-up block and "break" covers breaks and meals —
 * on the calendar, but not focused study.
 */
export type EventType = SessionType | "lecture" | "exam" | "buffer" | "break";

/** What a calendar block is for; null for entries created before activities existed. */
export const blockActivities = [
  "study",
  "mock_exam",
  "mock_review",
  "cheatsheet",
  "short_break",
  "lunch",
  "dinner",
  "buffer",
  "exam",
] as const;
export type BlockActivity = (typeof blockActivities)[number];

export type Task = {
  id: string;
  type: SessionType;
  subject: string;
  title: string;
  detail: string | null;
  /** Planned duration in minutes. */
  minutes: number;
  /** Actual minutes studied — null until the session is completed. */
  actualMinutes: number | null;
  /** Start time, "HH:MM" in the users' time zone. */
  time: string;
  done: boolean;
};

export type PlanPhase = { name: string; weeks: number };

export type Plan = {
  id: string;
  title: string;
  subject: string;
  goal: string;
  weeks: number;
  hoursPerWeek: number;
  level: "Beginner" | "Intermediate" | "Advanced";
  gradient: string;
  phases: PlanPhase[];
  enrolled: number;
};

export type ActivePlan = {
  plan: Plan;
  currentWeek: number;
  examDate: string | null;
  /** Monday first. */
  weekSessions: { day: string; type: SessionType | null; done: boolean }[];
};

export type CalendarEvent = {
  id: string;
  type: EventType;
  activity: BlockActivity | null;
  /** Null for breaks and buffers. */
  subject: string | null;
  /** Minutes of the block reserved for the cheatsheet, and the milestone it aims for. */
  cheatsheetMinutes: number | null;
  cheatsheetTarget: number | null;
  title: string;
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp: start + minutes. */
  end: string;
  minutes: number;
  calendarOrder: number | null;
};

export type UserSummary = { id: string; name: string; initials: string; hue: number };

export type Activity = {
  id: string;
  user: UserSummary;
  postedAgo: string;
  location: string | null;
  title: string;
  type: SessionType;
  subject: string;
  minutes: number;
  focus: number | null;
  trace: number[] | null;
  kudos: number;
  /** Whether the current user gave kudos. */
  kudoed: boolean;
  comments: number;
  note: string | null;
  /** URLs of the post's photos, oldest first. */
  photos: { id: string; url: string }[];
  /** Friends the author studied with. */
  tagged: UserSummary[];
  mine: boolean;
  /** False for private sessions, which only their author sees. */
  shared: boolean;
};

export type Comment = {
  id: string;
  user: UserSummary;
  body: string;
  postedAgo: string;
  /** The current user wrote it. */
  mine: boolean;
  /** The current user may delete it: their own comment, or one on their activity. */
  canDelete: boolean;
};

/**
 * Where someone stands with you: friends, a request you sent, a request they
 * sent you, or nothing yet.
 */
export type FriendStatus = "friends" | "sent" | "received" | "none";

/** Someone in friend search. */
export type Person = UserSummary & {
  handle: string;
  program: string | null;
  status: FriendStatus;
};

export type LeaderboardEntry = UserSummary & { hours: number; you: boolean };

export type Profile = {
  name: string;
  initials: string;
  hue: number;
  spiritAnimal: string;
  handle: string;
  program: string | null;
  friends: number;
  streak: number;
  totals: { hours: number; sessions: number; kudos: number };
  /** Hours per day this week, Monday first. */
  week: number[];
  weeklyGoal: number;
  /** Academic subjects only — breaks and buffers are never subjects. */
  subjects: { name: string; hours: number; minutes: number; examHoursRemaining: number | null }[];
  badges: { emoji: string; label: string; earned: boolean }[];
};

/** A user as returned by /api/users. */
export type User = {
  id: string;
  handle: string;
  name: string;
  hue: number;
  spiritAnimal: string;
  program: string | null;
  weeklyGoalHours: number;
  createdAt: string;
};

/**
 * A task as returned by /api/tasks: one row of the sessions table, i.e. a
 * planned study session, lecture or exam. Done once `completedAt` is set.
 */
export type TaskRecord = {
  id: string;
  userId: string;
  planId: string | null;
  type: EventType;
  activity: BlockActivity | null;
  /** Null for breaks and buffers. */
  subject: string | null;
  cheatsheetTarget: number | null;
  cheatsheetMinutes: number | null;
  title: string;
  detail: string | null;
  scheduledAt: string;
  plannedMinutes: number;
  done: boolean;
  completedAt: string | null;
  actualMinutes: number | null;
  focus: number | null;
  trace: number[] | null;
  location: string | null;
  note: string | null;
  shared: boolean;
  createdAt: string;
};

export type ChallengeStatus = "pending" | "accepted" | "declined" | "completed";

/** A dare to match one of the challenger's sessions, from either side. */
export type Challenge = {
  id: string;
  status: ChallengeStatus;
  message: string | null;
  sentAgo: string;
  /** The other person: the challenger on received ones, the challengee on sent ones. */
  other: UserSummary;
  /** What has to be beaten. */
  source: { title: string; type: SessionType; subject: string | null; minutes: number; focus: number | null };
  /** How the challengee did, once completed. */
  result: { minutes: number; focus: number | null } | null;
};

export type NudgeStyle = "savage" | "gentle" | "off";
