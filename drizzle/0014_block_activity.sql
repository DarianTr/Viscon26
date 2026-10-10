-- Breaks and meals in the daily timetable, and what each block is for.
ALTER TYPE "public"."session_type" ADD VALUE IF NOT EXISTS 'break';--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."block_activity" AS ENUM('study', 'mock_exam', 'mock_review', 'short_break', 'lunch', 'dinner', 'buffer', 'exam');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "activity" "block_activity";
