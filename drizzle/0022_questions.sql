-- Quiz / practice question tables
CREATE TABLE IF NOT EXISTS "questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "course_slug" text NOT NULL REFERENCES "course_profiles"("slug") ON DELETE CASCADE,
  "topic_id" text NOT NULL,
  "type" text NOT NULL DEFAULT 'mcq',
  "content" jsonb NOT NULL,
  "source" text NOT NULL DEFAULT 'generated',
  "status" text NOT NULL DEFAULT 'pending',
  "required_views" integer NOT NULL DEFAULT 3,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "question_views" (
  "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "answered_correctly" boolean NOT NULL,
  "answered_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("question_id", "user_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "question_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("question_id", "user_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "questions_course_topic_status_idx" ON "questions" ("course_slug", "topic_id", "status");
