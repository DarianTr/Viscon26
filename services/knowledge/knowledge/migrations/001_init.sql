-- Runs with search_path set to the service's own schema (default `knowledge`),
-- so these tables never collide with the Drizzle-managed `public` schema.

-- Topics and subtopics of a plan. `position` fixes their order in the state vector.
create table topics (
  plan_id    text not null,
  id         text not null,
  parent_id  text,
  name       text not null,
  prior_mean real not null default 0.5 check (prior_mean between 0 and 1),
  prior_sd   real not null default 0.2 check (prior_sd > 0),
  position   integer not null default 0,
  primary key (plan_id, id),
  foreign key (plan_id, parent_id) references topics (plan_id, id)
);

-- How a kind of assessment measures ability: noise c·p(1−p)/n + tau2, offset bias.
-- Values here are priors; per-plan MAP estimates live in type_fits.
create table assessment_types (
  id         text primary key,
  name       text not null,
  n_default  real not null check (n_default > 0),
  c_prior    real not null check (c_prior > 0),
  tau2       real not null default 0.0001 check (tau2 >= 0),
  bias_prior real not null default 0,
  -- Anchors (mocks, exams) define the scale: no bias is fitted for them.
  bias_fixed boolean not null default false
);

insert into assessment_types (id, name, n_default, c_prior, bias_prior, bias_fixed) values
  ('practice', 'Practice sheet', 10, 3.0, 0.05, false),
  ('quiz',     'Quiz',           20, 1.5, 0.0,  false),
  ('mock',     'Mock exam',      60, 1.0, 0.0,  true),
  ('exam',     'Exam',           100, 1.0, 0.0, true);

-- Model settings per plan; a plan without a row uses the defaults.
create table plan_params (
  plan_id          text primary key,
  half_life_days   real not null default 20 check (half_life_days > 0),
  slope_prior_mean real not null default 0.005,
  slope_prior_sd   real not null default 0.005 check (slope_prior_sd > 0),
  q_level          real not null default 0.0001 check (q_level >= 0),
  q_slope          real not null default 0.0000001 check (q_slope >= 0),
  learner_bias_sd  real not null default 0.04 check (learner_bias_sd > 0),
  rho_sibling      real not null default 0.5 check (rho_sibling between 0 and 1),
  rho_global       real not null default 0.15 check (rho_global between 0 and 1)
);

-- The latest MAP fit per plan. Rows exist only for what was actually fitted.
create table plan_fits (
  plan_id          text primary key,
  half_life_days   real,
  half_life_sd     real,
  slope_prior_mean real,
  slope_prior_sd   real,
  objective        double precision,
  converged        boolean not null,
  starts_agree     boolean not null,
  n_observations   integer not null,
  n_learners       integer not null,
  fitted_at        timestamptz not null default now()
);

create table type_fits (
  plan_id  text not null references plan_fits (plan_id) on delete cascade,
  type_id  text not null references assessment_types (id) on delete cascade,
  c        real,
  c_sd     real,
  bias     real,
  bias_sd  real,
  primary key (plan_id, type_id)
);

-- The log. Everything else about a learner is derived by replaying it.
create table observations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  plan_id     text not null,
  type_id     text not null references assessment_types (id),
  observed_at timestamptz not null,
  score       real not null check (score between 0 and 1),
  n_points    real not null check (n_points > 0),
  -- {topic_id: weight}; normalised to sum 1 when used.
  weights     jsonb not null,
  -- Where the score came from, e.g. a sessions.id in the app. Makes logging idempotent.
  source_ref  text,
  created_at  timestamptz not null default now()
);

create index observations_learner on observations (user_id, plan_id, observed_at);
create index observations_plan on observations (plan_id, observed_at);
create unique index observations_source on observations (plan_id, user_id, source_ref)
  where source_ref is not null;
