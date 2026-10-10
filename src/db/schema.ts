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
 * Study sessions are theory recaps, exercise sheets, mock exams or quizzes;
 * lectures and exams live in the same table so the calendar reads from one place.
 */
export const sessionType = pgEnum("session_type", [
  "theory",
  "exercises",
  "mock_exam",
  "quiz",
  "lecture",
  "exam",
  "buffer",
  "break",
]);

/** Where a subject's preparation is when a block happens — see PrepPhase in lib/scheduler.ts. */
export const prepPhase = pgEnum("prep_phase", ["foundation", "build", "peak", "taper"]);

/** What a scheduled block is for — see blockActivities in lib/types.ts. */
export const blockActivity = pgEnum("block_activity", [
  "study",
  "mock_exam",
  "mock_review",
  "cheatsheet",
  "exam_eve",
  "short_break",
  "lunch",
  "dinner",
  "buffer",
  "exam",
  "quiz",
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
  /**
   * The X-User-Id the VIScon reverse proxy sends (see `src/lib/auth.ts`).
   * Null for accounts nobody can log in as, e.g. seeded classmates.
   */
  email: text("email").unique(),
  /** Admins can open /admin and edit the database directly. */
  isAdmin: boolean("is_admin").notNull().default(false),
  /** Tone of the daily "go study" push: savage, gentle, or off. */
  nudgeStyle: text("nudge_style").$type<NudgeStyle>().notNull().default("savage"),
  /** Default visibility for new session posts; each post can override it. */
  shareSessionsByDefault: boolean("share_sessions_by_default").notNull().default(true),
  /**
   * Secret in the read-only calendar feed URL (`/api/calendar/<token>.ics`).
   * Stored as-is so settings can show the link again; null means no feed.
   */
  calendarToken: text("calendar_token").unique(),
  createdAt: createdAt(),
});

export type NudgeStyle = "savage" | "gentle" | "off";

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
  /** Focused weekly minutes the scheduler sizes the workload from (see scheduler.ts). */
  workloadBasisWeeklyMinutes?: number;
  /** Daily start, "HH:MM". */
  startTime?: string;
  rhythm?: "balanced" | "sprint" | "deep";
  /** How the Lernphase begins, and how many focus days a subject gets (see scheduler.ts). */
  lernphaseStart?: "recommended" | "focus" | "mixed";
  focusDays?: number;
  /** First day of the plan, "YYYY-MM-DD" — workload and focus days count from here. */
  planStart?: string;
  /** Initial focus days the scheduler planned: "YYYY-MM-DD" → subject. Moves respect them. */
  focusDates?: Record<string, string>;
  /** Exam Eve days: "YYYY-MM-DD" → subject(s). Nothing else is moved onto them. */
  eveDates?: Record<string, string[]>;
  /** Saved edits the schedule doesn't reflect yet; cleared by a recalibration (see lib/plan-changes.ts). */
  pendingChanges?: string[];
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
    /** Set when the student archives the plan. Otherwise its status follows its exam dates (lib/plan-status.ts). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
);

/** How far the student says a subject's cheatsheet is — the latest report counts. */
export const cheatsheetReports = pgTable(
  "cheatsheet_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userPlanId: uuid("user_plan_id").notNull().references(() => userPlans.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    percent: integer("percent").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userPlanId, t.subject), check("cheatsheet_percent", sql`${t.percent} between 0 and 100`)],
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
    activity: blockActivity("activity"),
    blocksStudy: boolean("blocks_study").notNull().default(false),
    calendarOrder: integer("calendar_order"),
    /** The academic subject; null for breaks and buffers, which belong to none. */
    subject: text("subject"),
    /** Cheatsheet milestone (cumulative %) a session should reach — the plan, not the student's progress. */
    cheatsheetTarget: integer("cheatsheet_target"),
    /** Minutes of the session reserved for the cheatsheet: all of a cheatsheet session, part of a combined one. */
    cheatsheetMinutes: integer("cheatsheet_minutes"),
    /** Moved by hand in the calendar: regenerating the plan keeps it where feasible. */
    movedManually: boolean("moved_manually").notNull().default(false),
    /** The subject's preparation phase at this block: foundation, build, peak or taper. */
    prepPhase: prepPhase("prep_phase"),
    title: text("title").notNull(),
    detail: text("detail"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    plannedMinutes: integer("planned_minutes").notNull(),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Set when the student chose to skip a planned session; it stays on the calendar, marked skipped. */
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
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

export type ChallengeStatus = "pending" | "accepted" | "declined" | "completed";

/**
 * "Beat this": a user dares a friend to do one of their completed sessions.
 * Accepting copies the session into the friend's day (`responseSessionId`);
 * completing that copy completes the challenge.
 */
export const challenges = pgTable(
  "challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengerId: uuid("challenger_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    challengeeId: uuid("challengee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The challenger's completed session the friend has to match. */
    sourceSessionId: uuid("source_session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    /** The challengee's copy, created on accept. */
    responseSessionId: uuid("response_session_id").references(() => sessions.id, { onDelete: "set null" }),
    message: text("message"),
    status: text("status").$type<ChallengeStatus>().notNull().default("pending"),
    createdAt: createdAt(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index().on(t.challengeeId, t.status),
    index().on(t.challengerId),
    uniqueIndex("challenges_response_session_index").on(t.responseSessionId),
    // One open dare per session per friend; once answered, it can be sent again.
    uniqueIndex("challenges_open_index")
      .on(t.sourceSessionId, t.challengeeId)
      .where(sql`status in ('pending', 'accepted')`),
    check("challenges_not_self", sql`${t.challengerId} <> ${t.challengeeId}`),
    check("challenges_status", sql`${t.status} in ('pending', 'accepted', 'declined', 'completed')`),
  ],
);

/** A browser's Web Push subscription. A user has one per device they enabled push on. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

/**
 * Everything we've pushed (or tried to) to a user. Doubles as the in-app inbox
 * and, through `dedupeKey`, keeps scheduled nudges to one per user per day.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Where tapping it leads, e.g. /community?tab=challenges. */
    url: text("url").notNull().default("/"),
    dedupeKey: text("dedupe_key").unique(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
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
  /** What students should be able to do after the course (VVZ "Lernziel" section). */
  learningObjectives: text("learning_objectives"),
  /** Textbook references from VVZ "Literatur" section. */
  literature: text("literature"),
  /** Official course website URL, extracted from VVZ links section. */
  websiteUrl: text("website_url"),
  /** VVZ search/detail page URL where this data was fetched from. */
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CourseMaterialType = "script" | "exercises" | "slides" | "exam" | "solution" | "other";
export type CourseResourceType = "script" | "exercises" | "slides" | "exam" | "solution" | "website" | "other";

/**
 * Course materials (PDFs, exercise sheets, scripts, etc.) discovered from
 * course websites. Stored server-side so quiz generation can use them for all
 * students studying the same course.
 */
export const courseResources = pgTable("course_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseSlug: text("course_slug")
    .notNull()
    .references(() => courseProfiles.slug, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** Broad category for filtering in quiz generation. */
  type: text("type").$type<CourseResourceType>().notNull().default("other"),
  /** Canonical URL of the resource (PDF, HTML page, etc.). */
  url: text("url").notNull().unique(),
  /** Extracted plain text content, capped at ~100 k chars. Null if not yet fetched or PDF. */
  content: text("content"),
  contentFetchedAt: timestamp("content_fetched_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export type McqContent = {
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

/**
 * A generated (or manually authored) multiple-choice question tied to a course
 * topic. `status` moves pending → trusted once enough users have answered it;
 * flagged questions are hidden from future quizzes.
 */
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseSlug: text("course_slug")
      .notNull()
      .references(() => courseProfiles.slug, { onDelete: "cascade" }),
    topicId: text("topic_id").notNull(),
    type: text("type").notNull().default("mcq"),
    content: jsonb("content").$type<McqContent>().notNull(),
    source: text("source").notNull().default("generated"),
    /** 'pending' | 'trusted' | 'flagged' */
    status: text("status").notNull().default("pending"),
    requiredViews: integer("required_views").notNull().default(3),
    createdAt: createdAt(),
  },
  (t) => [index("questions_course_topic_status_idx").on(t.courseSlug, t.topicId, t.status)],
);

/** One row per (question, user) pair — records whether the user answered correctly. */
export const questionViews = pgTable(
  "question_views",
  {
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    answeredCorrectly: boolean("answered_correctly").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);

/** A user reports a question as wrong / misleading / offensive. */
export const questionFlags = pgTable(
  "question_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("question_flags_question_user_idx").on(t.questionId, t.userId)],
);

/**
 * Files uploaded by a student for a specific subject in their plan.
 * Extracted text is stored so quiz generation can use it without re-fetching.
 */
export const userCourseMaterials = pgTable(
  "user_course_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userPlanId: uuid("user_plan_id").notNull().references(() => userPlans.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    type: text("type").$type<CourseMaterialType>().notNull().default("other"),
    fileSize: integer("file_size").notNull(),
    /** Extracted plain text content for quiz generation, capped at ~100 k chars. */
    content: text("content"),
    createdAt: createdAt(),
  },
  (t) => [index("user_course_materials_plan_idx").on(t.userPlanId, t.subject)],
);
