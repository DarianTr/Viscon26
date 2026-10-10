-- Default visibility for new session posts; each post can still override it.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "share_sessions_by_default" boolean DEFAULT true NOT NULL;
