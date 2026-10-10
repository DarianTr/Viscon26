alter table "course_profiles"
  add column if not exists "learning_objectives" text,
  add column if not exists "literature" text,
  add column if not exists "website_url" text;

create table if not exists "course_resources" (
  "id" uuid primary key default gen_random_uuid(),
  "course_slug" text not null references "course_profiles"("slug") on delete cascade,
  "title" text not null,
  "type" text not null default 'other',
  "url" text not null,
  "content" text,
  "content_fetched_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now()
);

create unique index if not exists "course_resources_url_idx" on "course_resources"("url");
create index if not exists "course_resources_slug_idx" on "course_resources"("course_slug");
