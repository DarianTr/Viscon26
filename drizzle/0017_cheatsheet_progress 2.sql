-- How much of each session is cheatsheet work, and the progress students report.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "cheatsheet_minutes" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cheatsheet_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "user_plan_id" uuid NOT NULL REFERENCES "user_plans"("id") ON DELETE cascade,
  "subject" text NOT NULL,
  "percent" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cheatsheet_percent" CHECK ("percent" between 0 and 100)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cheatsheet_reports_user_plan_id_subject_index" ON "cheatsheet_reports" ("user_plan_id", "subject");
