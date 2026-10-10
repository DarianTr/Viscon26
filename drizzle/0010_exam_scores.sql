create table "exam_scores" (
  "id" uuid primary key default gen_random_uuid() not null,
  "user_id" uuid not null references "users"("id") on delete cascade,
  "user_plan_id" uuid references "user_plans"("id") on delete set null,
  "subject" text not null,
  "score" real not null,
  "exam_type" text not null default 'mock',
  "taken_at" date not null,
  "notes" text,
  "created_at" timestamp with time zone not null default now()
);

create index on "exam_scores" ("user_id");
create index on "exam_scores" ("user_plan_id");
