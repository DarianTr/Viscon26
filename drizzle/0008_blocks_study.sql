ALTER TABLE "sessions" ADD COLUMN "blocks_study" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "sessions" SET "blocks_study" = true WHERE "type"::text = 'vacation';
