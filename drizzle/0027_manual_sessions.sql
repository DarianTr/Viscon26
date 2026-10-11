-- Sessions the student added by hand (planned or logged); only these can be edited in full or deleted.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "added_manually" boolean DEFAULT false NOT NULL;
