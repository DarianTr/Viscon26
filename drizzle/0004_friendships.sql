CREATE TABLE "friendships" (
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_requester_id_addressee_id_pk" PRIMARY KEY("requester_id","addressee_id"),
	CONSTRAINT "friendships_not_self" CHECK ("friendships"."requester_id" <> "friendships"."addressee_id")
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendships_addressee_id_index" ON "friendships" USING btree ("addressee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_index" ON "friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
-- Carry over follows: mutual follows become friends, one-way follows become pending requests.
INSERT INTO "friendships" ("requester_id", "addressee_id", "created_at", "accepted_at")
SELECT f."follower_id", f."followee_id", f."created_at",
	CASE WHEN EXISTS (
		SELECT 1 FROM "follows" r WHERE r."follower_id" = f."followee_id" AND r."followee_id" = f."follower_id"
	) THEN now() END
FROM "follows" f
WHERE f."follower_id" <> f."followee_id"
	AND (f."follower_id" < f."followee_id" OR NOT EXISTS (
		SELECT 1 FROM "follows" r WHERE r."follower_id" = f."followee_id" AND r."followee_id" = f."follower_id"
	));
