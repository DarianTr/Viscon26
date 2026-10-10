-- One-off: remove what the old demo seed (src/db/seed.ts before it only
-- created the admin) put into a database that real users have since used.
--
-- Seeded users are the ones nobody can log in as (no email), plus the old demo
-- admin @tprazak. Deleting them cascades to their sessions, kudos, comments,
-- tags, friendships, challenges, badges, enrollments and plans, including
-- anything real users did with them (kudos on their posts, friend requests).
-- Real accounts and everything they created stay.
--
-- Dry run (prints what would go, then rolls back):
--   docker compose -p viscon exec -T db psql -U stride stride < deploy/remove-demo-data.sql
-- For real:
--   docker compose -p viscon exec -T db psql -U stride stride -v commit=1 < deploy/remove-demo-data.sql

\set ON_ERROR_STOP on
begin;

create temp table demo_users on commit drop as
  select id, handle, email from users
  where email is null or email = 'demo@example.com' or handle = 'tprazak';

\echo '--- Seeded users to delete:'
select handle, coalesce(email, '(no email)') as email from demo_users order by handle;

\echo '--- Real users that stay:'
select handle, email, is_admin from users where id not in (select id from demo_users) order by created_at;

\echo '--- What goes with them:'
select
  (select count(*) from sessions where user_id in (select id from demo_users)) as sessions,
  (select count(*) from kudos where user_id in (select id from demo_users)
     or session_id in (select id from sessions where user_id in (select id from demo_users))) as kudos,
  (select count(*) from comments where user_id in (select id from demo_users)
     or session_id in (select id from sessions where user_id in (select id from demo_users))) as comments,
  (select count(*) from friendships where requester_id in (select id from demo_users)
     or addressee_id in (select id from demo_users)) as friendships,
  (select count(*) from user_plans where user_id in (select id from demo_users)) as user_plans;

delete from users where id in (select id from demo_users);

-- The old seed's catalog rows. Nothing in the app creates these.
delete from plans where id in ('diskmath-exam', 'basisjahr', 'couch-to-focus', 'algo-sprint', 'analysis-exam');
delete from badges where id in ('streak-10', 'early-bird', 'deep-3h', 'hours-100', 'plan-finisher');
delete from items where title in ('Pitch the idea', 'Ship the MVP', 'Win the hackathon');

-- The knowledge service keys its data by plan id without a foreign key, so
-- the deleted plans' topics, fits and data points are left behind: drop them.
\echo '--- Orphaned knowledge rows:'
select
  (select count(*) from knowledge.observations where plan_id not in (select id::text from user_plans)) as observations,
  (select count(*) from knowledge.topics where plan_id not in (select id::text from user_plans)) as topics;

delete from knowledge.observations where plan_id not in (select id::text from user_plans);
delete from knowledge.plan_fits where plan_id not in (select id::text from user_plans);
delete from knowledge.plan_params where plan_id not in (select id::text from user_plans);
-- Subtopics before their parents (topics reference topics).
delete from knowledge.topics where plan_id not in (select id::text from user_plans) and parent_id is not null;
delete from knowledge.topics where plan_id not in (select id::text from user_plans);

\if :{?commit}
commit;
\echo 'Committed.'
\else
rollback;
\echo 'Dry run: rolled back. Re-run with -v commit=1 to apply.'
\endif
