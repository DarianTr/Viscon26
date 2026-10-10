create table if not exists "course_profiles" (
  "slug"        text primary key,
  "name"        text not null,
  "course_code" text,
  "aliases"     jsonb not null default '[]',
  "topics"      jsonb not null default '[]',
  "description" text,
  "source_url"  text,
  "fetched_at"  timestamp with time zone not null default now()
);
