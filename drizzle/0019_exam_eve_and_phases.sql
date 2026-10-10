-- Exam Eve final reviews, and each block's preparation phase.
ALTER TYPE "public"."block_activity" ADD VALUE IF NOT EXISTS 'exam_eve';--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."prep_phase" AS ENUM('foundation', 'build', 'peak', 'taper');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "prep_phase" "prep_phase";
