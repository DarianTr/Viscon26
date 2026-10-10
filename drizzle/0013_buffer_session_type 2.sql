-- The scheduler's daily "Buffer / Catch-up Time" block.
ALTER TYPE "public"."session_type" ADD VALUE IF NOT EXISTS 'buffer';
