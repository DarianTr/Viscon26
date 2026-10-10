-- parent_id becomes a group key: topics sharing it are siblings (correlated,
-- and examined together). The group needn't be a topic itself, e.g. a subject
-- whose three topics are tracked but which has no level of its own.
alter table topics drop constraint if exists topics_plan_id_parent_id_fkey;
