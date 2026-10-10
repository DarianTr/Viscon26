-- Idempotent for the same reason as 0007_user_plans.
alter table "user_plans" add column if not exists "config" jsonb;
