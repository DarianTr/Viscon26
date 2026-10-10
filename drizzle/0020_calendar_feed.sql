-- Secret token for each user's read-only calendar subscription (iCalendar feed).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_calendar_token_unique" ON "users" ("calendar_token");
