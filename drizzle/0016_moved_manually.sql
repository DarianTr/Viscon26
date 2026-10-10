-- Blocks the student placed by hand; regenerating a plan keeps them where feasible.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "moved_manually" boolean DEFAULT false NOT NULL;
