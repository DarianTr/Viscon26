ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "nudge_style" text DEFAULT 'savage' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenger_id" uuid NOT NULL,
	"challengee_id" uuid NOT NULL,
	"source_session_id" uuid NOT NULL,
	"response_session_id" uuid,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "challenges_not_self" CHECK ("challenger_id" <> "challengee_id"),
	CONSTRAINT "challenges_status" CHECK ("status" in ('pending', 'accepted', 'declined', 'completed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text DEFAULT '/' NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challengee_id_users_id_fk" FOREIGN KEY ("challengee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "challenges" ADD CONSTRAINT "challenges_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "challenges" ADD CONSTRAINT "challenges_response_session_id_sessions_id_fk" FOREIGN KEY ("response_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challenges_challengee_id_status_index" ON "challenges" USING btree ("challengee_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challenges_challenger_id_index" ON "challenges" USING btree ("challenger_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "challenges_response_session_index" ON "challenges" USING btree ("response_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "challenges_open_index" ON "challenges" USING btree ("source_session_id","challengee_id") WHERE status in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_index" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_index" ON "notifications" USING btree ("user_id","created_at");
