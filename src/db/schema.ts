import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Study sessions use running vocabulary (deep = long run, etc.); lectures and
 * exams live in the same table so the calendar reads from one place.
 */
export const sessionType = pgEnum("session_type", [
  "deep",
  "intervals",
  "tempo",
  "recovery",
  "lecture",
  "exam",
]);

export const planLevel = pgEnum("plan_level", ["Beginner", "Intermediate", "Advanced"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  /** Avatar gradient hue, 0–360. */
  hue: integer("hue").notNull().default(200),
  program: text("program"),
  weeklyGoalHours: integer("weekly_goal_hours").notNull().default(20),
  /** scrypt hash from `src/db/password.ts`; null means the user can't log in. */
  passwordHash: text("password_hash"),
  /** Admins can open /admin and edit the database directly. */
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: createdAt(),
});

/** Login sessions. The cookie holds a random token; only its SHA-256 is stored. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index().on(t.followeeId)],
);

export type PlanPhase = { name: string; weeks: number };

export const plans = pgTable("plans", {
  /** Readable slug, e.g. "analysis-exam". */
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  goal: text("goal").notNull(),
  weeks: integer("weeks").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull(),
  level: planLevel("level").notNull(),
  /** Tailwind gradient classes for the plan's cover. */
  gradient: text("gradient").notNull(),
  phases: jsonb("phases").$type<PlanPhase[]>().notNull(),
});

export const enrollments = pgTable(
  "enrollments",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    startedOn: date("started_on").notNull(),
    examDate: date("exam_date"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.planId] }), index().on(t.planId)],
);

/**
 * A scheduled study session — or, once `completedAt` is set, an activity that
 * shows up in the community feed (the Strava half of the app).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    type: sessionType("type").notNull(),
    subject: text("subject").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    plannedMinutes: integer("planned_minutes").notNull(),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    actualMinutes: integer("actual_minutes"),
    /** Focus score 0–100, when the session was tracked. */
    focus: integer("focus"),
    /** Focus level over the session, 0–1, sampled evenly. */
    trace: jsonb("trace").$type<number[]>(),
    location: text("location"),
    note: text("note"),
    /** Whether a completed session is posted to the feed. */
    shared: boolean("shared").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId, t.scheduledAt),
    index().on(t.completedAt),
  ],
);

export const kudos = pgTable(
  "kudos",
  {
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.sessionId)],
);

export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: createdAt(),
});

export const clubMembers = pgTable(
  "club_members",
  {
    clubId: uuid("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clubId, t.userId] }), index().on(t.userId)],
);

export const badges = pgTable("badges", {
  id: text("id").primaryKey(),
  emoji: text("emoji").notNull(),
  label: text("label").notNull(),
  position: real("position").notNull().default(0),
});

export const userBadges = pgTable(
  "user_badges",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    badgeId: text("badge_id").notNull().references(() => badges.id, { onDelete: "cascade" }),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);

/** The original starter example, kept for /api/items. */
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: createdAt(),
});
