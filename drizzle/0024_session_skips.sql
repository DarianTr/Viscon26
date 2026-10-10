-- Planned sessions the student chose to skip; they stay on the calendar, marked skipped.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "skipped_at" timestamp with time zone;
