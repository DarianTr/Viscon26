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
export type EventType = SessionType | "lecture" | "exam";

export type Task = {
  id: string;
  type: SessionType;
  subject: string;
  title: string;
  detail: string | null;
  minutes: number;
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
  title: string;
  /** ISO timestamp. */
  start: string;
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
  mine: boolean;
};

export type LeaderboardEntry = UserSummary & { hours: number; you: boolean };

export type Club = { id: string; name: string; emoji: string; members: number; joined: boolean };

export type Profile = {
  name: string;
  initials: string;
  hue: number;
  handle: string;
  program: string | null;
  followers: number;
  following: number;
  streak: number;
  totals: { hours: number; sessions: number; kudos: number };
  /** Hours per day this week, Monday first. */
  week: number[];
  weeklyGoal: number;
  subjects: { name: string; hours: number }[];
  badges: { emoji: string; label: string; earned: boolean }[];
};

/** A user as returned by /api/users. */
export type User = {
  id: string;
  handle: string;
  name: string;
  hue: number;
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
  subject: string;
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
