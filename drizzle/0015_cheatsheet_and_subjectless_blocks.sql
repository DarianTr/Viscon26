-- Cheatsheet sessions and milestones; breaks and buffers stop pretending to be subjects.
ALTER TYPE "public"."block_activity" ADD VALUE IF NOT EXISTS 'cheatsheet';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "subject" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "cheatsheet_target" integer;--> statement-breakpoint
-- Plans generated earlier stored their buffers as subject "Buffer" and breaks as "Break".
UPDATE "sessions" SET "subject" = NULL WHERE "type" IN ('buffer', 'break');
