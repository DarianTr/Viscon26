-- Session types named for what the student does, not running vocabulary.
ALTER TYPE "public"."session_type" RENAME VALUE 'deep' TO 'theory';--> statement-breakpoint
ALTER TYPE "public"."session_type" RENAME VALUE 'intervals' TO 'exercises';--> statement-breakpoint
ALTER TYPE "public"."session_type" RENAME VALUE 'tempo' TO 'mock_exam';--> statement-breakpoint
ALTER TYPE "public"."session_type" RENAME VALUE 'recovery' TO 'quiz';--> statement-breakpoint
-- Blocks the old mapping typed wrongly. Activities compare as text: 'quiz' may have
-- been added to block_activity in this same migration run, and Postgres rejects new
-- enum values before their transaction commits.
UPDATE "sessions" SET "type" = 'quiz' WHERE "activity"::text = 'quiz';--> statement-breakpoint
UPDATE "sessions" SET "type" = 'mock_exam' WHERE "activity"::text IN ('mock_exam', 'mock_review');--> statement-breakpoint
UPDATE "sessions" SET "type" = 'theory' WHERE "activity"::text IN ('cheatsheet', 'exam_eve');--> statement-breakpoint
UPDATE "sessions" SET "type" = 'theory' WHERE "type" = 'quiz' AND "activity"::text = 'study' AND "title" LIKE '%Final revision%';
