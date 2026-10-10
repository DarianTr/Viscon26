-- Plans the student archived by hand; whether a plan is finished follows its exam dates.
ALTER TABLE "user_plans" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
