create table if not exists "user_course_materials" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" uuid not null references "users"("id") on delete cascade,
  "user_plan_id" uuid not null references "user_plans"("id") on delete cascade,
  "subject" text not null,
  "filename" text not null,
  "mime_type" text not null default 'application/octet-stream',
  "type" text not null default 'other',
  "file_size" integer not null,
  "content" text,
  "created_at" timestamp with time zone not null default now()
);

create index if not exists "user_course_materials_plan_idx" on "user_course_materials"("user_plan_id", "subject");
