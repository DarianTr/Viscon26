import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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
  uniqueIndex,
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
  /** The student's chosen personal spirit animal. */
  spiritAnimal: text("spirit_animal").notNull().default("owl"),
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

/**
 * One row per pair of users. Pending until the addressee accepts the request;
 * declining, cancelling or unfriending deletes the row.
 */
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    /** Null while the request is pending. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    index().on(t.addresseeId),
    // At most one row per pair, whichever way round the request went.
    uniqueIndex("friendships_pair_index").on(
      sql`least(${t.requesterId}, ${t.addresseeId})`,
      sql`greatest(${t.requesterId}, ${t.addresseeId})`,
    ),
    check("friendships_not_self", sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

export type PlanPhase = { name: string; weeks: number };

export type StoredSubjectConfig = {
  name: string;
  examDate: string;
  examDuration: string;
  targetGrade: string;
  currentGrade: string;
  confidence: string;
  approach: string;
  customPhases: string[];
  mockCount: string;
  allocation: number;
  materials: string[];
  cheatsheet: string;
  comments: string;
};

export type StoredPlanConfig = {
  weeklyHours: number;
  studyDays: string[];
  sessionLength: number;
  vacationRanges: { start: string; end: string }[];
  /** Per-subject configs persisted at creation time and updated by the strategy agent. */
  subjects?: StoredSubjectConfig[];
  /** Preferred session start hour (e.g. 9 = 09:00), set by the strategy agent from behavioral data. */
  preferredStartHour?: number;
};

/** A custom study plan created by the user via the plan wizard. */
export const userPlans = pgTable(
  "user_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    config: jsonb("config").$type<StoredPlanConfig>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const plans = pgTable("plans", {
  /** Readable plan slug. */
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
    userPlanId: uuid("user_plan_id").references(() => userPlans.id, { onDelete: "set null" }),
    type: sessionType("type").notNull(),
    blocksStudy: boolean("blocks_study").notNull().default(false),
    calendarOrder: integer("calendar_order"),
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
    index().on(t.userPlanId),
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

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Photos on a session's post, stored in the database so the app needs no file storage. */
export const sessionPhotos = pgTable(
  "session_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    /** Sniffed from the bytes on upload: image/jpeg, image/png or image/webp. */
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.sessionId, t.createdAt)],
);

/** Friends the author studied with, tagged on the session's post. */
export const sessionTags = pgTable(
  "session_tags",
  {
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] }), index().on(t.userId)],
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

/** Exam scores logged by the user for mock or past exams. */
export const examScores = pgTable(
  "exam_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userPlanId: uuid("user_plan_id").references(() => userPlans.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    /** Swiss grade scale 1–6. */
    score: real("score").notNull(),
    examType: text("exam_type").$type<"mock" | "past">().notNull().default("mock"),
    takenAt: date("taken_at").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), index().on(t.userPlanId)],
);

/** The original starter example, kept for /api/items. */
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: createdAt(),
});

export type CourseProfileTopic = { id: string; name: string };

/**
 * One row per ETH course, shared across all users. Topics are fetched from the
 * VVZ (Vorlesungsverzeichnis) and stored here so every student's plan benefits
 * from the real course structure rather than three hardcoded fallback topics.
 */
export const courseProfiles = pgTable("course_profiles", {
  /** URL-safe slug, e.g. "diskrete-mathematik". Primary match key. */
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  /** Official ETH course code, e.g. "252-0025-01". */
  courseCode: text("course_code"),
  /** Additional slugs for the same course (e.g. English alias "discrete-mathematics"). */
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  topics: jsonb("topics").$type<CourseProfileTopic[]>().notNull().default([]),
  description: text("description"),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
