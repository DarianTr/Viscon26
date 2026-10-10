# Knowledge service

## Overview

The service estimates **how good each learner is at each topic of a plan**,
and how sure it is, from scores they log. Scores can come from practice
sheets, quizzes, mocks or exams, and a single score can cover several topics
in any mix.

It is meant to feed a study scheduler that focuses on topics that are weak,
uncertain or heavily weighted in the exam. It also forecasts the exam score
with an honest 90% interval.

- **Model:** a multivariate Kalman filter. Every topic has a level and a
  learning rate, and the learning rate fades over time. Each learner also has
  their own bias per assessment type. A score's noise depends on how many
  points it was out of.
- **Fitting:** MAP estimates of each assessment type's noise and bias, pooled
  over all learners of a plan.
- **Storage:** the log of scores is the only stored data. A learner's state is
  recomputed from it on every request.
- **Stack:** Python 3.12, FastAPI, NumPy and SciPy. Data lives in the app's
  Postgres, in its own `knowledge` schema, and `docker compose up` runs the
  service next to the app.
- **Validation:** a testbench with 10 kinds of simulated learner and 4
  logging schedules, compared against 4 baselines. The defaults were tuned on
  it.

```bash
uv sync
DATABASE_URL=postgres://stride:stride@localhost:5432/stride uv run uvicorn knowledge.api:app --reload
# → http://localhost:8000/docs
uv run pytest                     # API tests run too if DATABASE_URL is set (throwaway schema)
uv run python -m bench            # testbench, ~10 s → bench/out/report.md
uv run ruff check && uv run ruff format --check
```

**Key takeaways**

1. **Damping the trend matters most.** A straight-line trend extrapolates the
   fast early gains and misses the day-10 exam forecast by about 22 points,
   against 12 for the damped trend.
2. **Log points and topic weights.** A 5-point quiz should count far less
   than a 60-point mock. A mixed sheet should say which topics it covered.
   The filter splits the blame for a surprising score by weight and
   uncertainty.
3. **Do a mock early.** Mocks and exams are the anchors that tell practice
   bias apart from ability. Without them, biases rest on their priors.
4. **The fit only judges next-day predictions.** It recovers measurement
   noise and bias well. The settings that shape long-range forecasts
   (process noise, half-life) are tuned on the testbench instead.
5. **Topic-level estimates are reasonably calibrated; picking the single
   weakest topic is hard.** Exam intervals cover about 90% on average, but
   only 68–72% for crammers and forgetters. The weakest topic is found
   reliably only when the gap is large: 95% for specialists, 33–51% overall.

## How the model works

Scores and levels are fractions correct (0–1). Time is measured in days.

### State per learner

| Part | Meaning |
| ---- | ------- |
| level ℓₖ, per topic | current ability on topic k |
| slope sₖ, per topic | current learning rate. It fades with a half-life, so fast early gains level off instead of being extrapolated |
| bias bⱼ, per non-anchor assessment type | this learner's offset, e.g. practice done with notes |

### Between scores

For a gap of dt days, with τ = half-life / ln 2:

- ℓ ← ℓ + s·τ·(1 − e^(−dt/τ))
- s ← s·e^(−dt/τ)

Process noise lets both the levels (`qLevel`) and the slopes (`qSlope`)
wander, correlated across related topics. The wandering slope is what lets
the model follow late surges or declines.

### A score

A score has topic weights h, normalised to sum 1. A sheet that is 10% limits
and 90% series is `{"limits": 10, "series": 90}`. It measures

  y = hᵀℓ + bⱼ + ε,  with noise variance c·p(1−p)/n + τ²

- **n** is the number of points, so few points means a noisy score.
- **c** is the type's overdispersion: how much noisier it is than pure
  binomial sampling, e.g. because of copying, time pressure or open notes.
- **Blame for a surprise** is split by weight × uncertainty. After a mixed
  sheet, its topics become anti-correlated ("one of them is weak"). A later
  single-topic quiz settles which one.

### Priors and anchors

- **Topic priors:** each topic starts at its `priorMean ± priorSd`. Siblings
  and parent/child topics are correlated (`rhoSibling`); all other topics
  weakly (`rhoGlobal`).
- **Anchors:** types with `biasFixed` (mock, exam) set the scale. Every other
  type has a population bias plus a per-learner deviation. These biases can
  only be learned because the anchors exist.

## Fitting (`POST /plans/:planId/fit`)

**What it optimises.** MAP over the shared parameters, pooling every learner
in the plan. The filter replays each learner's scores in order. Before each
score yₜ, it predicts a mean ŷₜ and a variance Sₜ (state uncertainty plus
measurement noise) from earlier scores only. The fit maximises

```
Σ_learners Σ_scores  −½ [ log(2π·Sₜ) + (yₜ − ŷₜ)² / Sₜ ]   +   log prior(θ)
```

This is the exact marginal likelihood. Each learner's levels and slopes are
integrated out by the filter rather than point-estimated, so they act as
random effects. The objective scores the whole predictive distribution, not
just the mean:

- the squared-error term rewards a good ŷ, which is what pins down biases
  and the starting slope;
- the log Sₜ term penalises over-wide predictions. That is the only thing
  that pins down c, which never moves the mean.

**What gets fitted:**

| Parameter | Prior | Fitted? |
| --------- | ----- | ------- |
| c, per type | log c ~ N(log cPrior, 0.5) | yes |
| bias, per non-anchor type | N(biasPrior, 0.05) | yes |
| mean starting slope | N(slopePriorMean, slopePriorSd) | yes |
| half-life | log ~ N(log configured, 0.7) | **no by default** (`Priors(fit_half_life=True)` to enable) |
| qLevel, qSlope | – | **no**: tuned with `bench.sweep` |

**Why the half-life and process noise are not fitted.** The likelihood only
scores one-step-ahead predictions, usually the next day. A wrong long-range
curve costs little there, because the filter keeps correcting itself. When
the slope is allowed to wander, fitting the half-life shrinks it to about 2
days. The model then loses the long-range trend, and early exam forecasts
degrade. The same blind spot means the per-score calibration check can look
perfect while exam intervals are too narrow.

**How the optimisation runs:**
- L-BFGS-B from three starts, in prior-standardised units, so parameter
  scales from about 1 (log c) down to about 0.003 (slope) don't hurt the
  finite differences.
- sds come from the Laplace approximation.
- A type with fewer than 5 scores keeps its prior and is reported as
  `priorOnly`.
- Later state requests use the stored fit; a refit replaces it.
- It takes 1–5 s for 60 learners × ~50 scores, thanks to a filter batched
  across learners.

## Defaults and where they come from

| Setting | Default | Source |
| ------- | ------- | ------ |
| `halfLifeDays` | 20 | testbench sweep |
| `qSlope` | 3e-6 | testbench sweep: covers surges and declines without wrecking early forecasts |
| `qLevel` | 1e-4 | judgement; barely matters |
| `slopePriorMean` / `slopePriorSd` | 0.005 / 0.005 per day | prior belief: about +3.5 ± 3.5 points per week |
| `learnerBiasSd` | 0.04 | the original analysis: practice bias about ±4 points per learner |
| `rhoSibling` / `rhoGlobal` | 0.5 / 0.15 | judgement |
| Seeded types | practice c 3, bias +5 pts · quiz c 1.5 · mock c 1, anchor · exam c 1, anchor | prior belief, replaced by the fit once there is data |

The process-noise sweep on the rich schedule:

| qSlope | half-life | exam RMSE, days 10 / 24 / 42 | 90% coverage, days 10 / 24 / 42 |
| ------ | --------- | ---------------------------- | ------------------------------- |
| 1e-7 | fitted (→ 10 days) | 10.8 / 9.8 / 6.5 | 66% / 65% / 72% |
| 1e-4 | fitted (→ 2 days) | 15.4 / 11.9 / 5.6 | 51% / 62% / 89% |
| **3e-6** | **20 days, fixed** | 11.7 / 10.8 / 5.2 | 88% / 83% / 92% |

## Testbench

`tests/` checks the math against the model's own assumptions, which is the
best case. `bench/` checks it against learners who **don't** follow them.

```bash
uv run python -m bench                 # all schedules → bench/out/report.md, results.json
uv run python -m bench --quick
uv run python -m bench --schedules rich --archetypes crammer forgetter --learners 100
uv run python -m bench.sweep --q-slope 1e-6 3e-6 1e-5 [--half-life 10] [--fit-half-life] [--schedule sparse]
uv run python -m bench.trace           # interactive replay → bench/out/forecast.html
```

`bench.trace` records how the filter's distributions move with every data
point for four showcase learners: catch-up, notes-heavy, specialist and
crammer. Each is the median of 15 random learners of its type, ranked by
final forecast error. It renders `bench/out/forecast.html` from
`bench/forecast_template.html`, a self-contained page for presenting:

- the exam-score distribution after each data point, with bell-curve
  snapshots;
- the distribution before and after the selected data point;
- each logged score drawn as its own measurement distribution;
- a topic profile: a spider chart of every topic's distribution, plus a
  per-topic progress list compared with 7 days earlier or the exam-day
  projection, flagging the weakest, least certain and fastest-moving topic.

### Setup

**Ground truth** (`bench/truth.py`) has 10 archetypes, each with variation
between learners. Scores are beta-binomial with the true overdispersion
(practice 2.5, quiz 1.5, mock 1.2), so they are capped at 0–100% like real
scores.

| Archetype | Curve |
| --------- | ----- |
| steady | slow, near-linear gains |
| fast_plateau | prior knowledge, flat after week one |
| catch_up | starts low, levels off after ~3 weeks |
| crammer | flat, then a late surge |
| forgetter | per-topic peaks, then decay |
| specialist | one topic near mastery, one barely started |
| stalled | no progress |
| erratic | large day-to-day swings |
| notes_heavy | practice ~15 points above ability |
| ceiling | scores near 100% |

**Schedules** (`bench/schedules.py`) cover 42 days, with the exam on day 45:

| Schedule | What gets logged |
| -------- | ---------------- |
| rich | daily 2-topic practice, weekly 1-topic quiz, mocks on days 10, 24 and 38 |
| sparse | practice every 3 days, 1 mock |
| no_mocks | like rich, without mocks |
| mixed_only | every assessment covers 3 topics |

**How a run works.** For each schedule, MAP is fitted on 60 training
learners mixed across archetypes. Then 40 new learners per archetype are
scored at days 10, 24 and 42 with five estimators:

| Estimator | What it is |
| --------- | ---------- |
| fitted | the model with fitted parameters |
| default | the model with seeded priors, no fit |
| linear | no slope decay |
| no_trend | slope fixed at 0 |
| naive | recency-weighted mean score per topic |

**Metrics:**
- exam-forecast RMSE and 90% interval coverage;
- per-topic level RMSE and coverage;
- whether the estimated weakest topic is the true weakest one;
- fit vs truth for the noise parameters;
- innovation calibration.

`tests/test_bench.py` runs a small version as a regression guard in CI.

### Results (current defaults, seed 0)

Exam-forecast RMSE in points at days 10 / 24 / 42, with 90% coverage at day
42:

| Schedule | fitted | default | linear | no_trend | naive |
| -------- | ------ | ------- | ------ | -------- | ----- |
| rich | **11.7 / 10.8 / 5.2** (92%) | 12.3 / 11.1 / 5.3 | 22.2 / 15.6 / 5.6 | 16.0 / 11.7 / 5.3 | 14.9 / 10.9 / 6.9 |
| sparse | **10.7 / 10.4 / 8.4** (90%) | 11.6 / 11.1 / 8.8 | 19.5 / 16.3 / 10.4 | 19.6 / 12.1 / 9.4 | 17.4 / 11.9 / 9.7 |
| no_mocks | 11.2 / 11.4 / 6.9 (89%) | 11.1 / 10.8 / 6.3 | 14.4 / 15.0 / 7.2 | 19.2 / 14.3 / 7.6 | 14.7 / 11.0 / 7.0 |
| mixed_only | **11.7 / 11.2 / 5.5** (90%) | 12.4 / 11.4 / 5.6 | 23.0 / 16.4 / 6.1 | 16.6 / 11.9 / 5.6 | 15.0 / 10.7 / 6.8 |

Per archetype (rich schedule, fitted model, day 42):

| Archetype | exam RMSE | exam bias | exam cov90 | topic cov90 | weakest found |
| --------- | --------- | --------- | ---------- | ----------- | ------------- |
| steady | 4.4 | −2.0 | 98% | 98% | 42% |
| fast_plateau | 3.8 | +1.4 | 98% | 95% | 28% |
| catch_up | 3.9 | +0.7 | 98% | 96% | 52% |
| crammer | 8.2 | −7.0 | **68%** | 92% | 18% |
| forgetter | 7.9 | +6.6 | **72%** | 92% | 45% |
| specialist | 3.2 | +0.8 | 100% | 98% | **95%** |
| stalled | 5.0 | +1.7 | 95% | 98% | 35% |
| erratic | 5.8 | −1.4 | 92% | 90% | 40% |
| notes_heavy | 4.2 | +0.6 | 98% | 95% | 45% |
| ceiling | 2.5 | +0.3 | 100% | 97% | 32% |

Fit vs truth for the noise parameters:

| Schedule | c practice (2.5) | c quiz (1.5) | c mock (1.2) | practice bias (+5 pts) |
| -------- | ---------------- | ------------ | ------------ | ---------------------- |
| rich | 2.58 ± 0.08 | 1.51 ± 0.15 | 1.16 ± 0.17 | +4.8 ± 0.8 |
| sparse | 2.25 ± 0.13 | (no quizzes) | 1.68 ± 0.43 | +6.7 ± 1.2 |
| no_mocks | 2.43 ± 0.07 | 1.53 ± 0.15 | (no mocks) | +7.9 ± 1.8 |
| mixed_only | 2.45 ± 0.07 | 1.69 ± 0.15 | 1.10 ± 0.16 | +6.1 ± 0.7 |

**What the results say:**

- **The damped trend is the big win.** The straight-line trend is up to 2×
  worse early on. No trend at all and the naive average are clearly worse
  until the final days.
- **The fitted and default models are close.** The seeded priors happen to be
  near the simulated truth. On real data, where they won't be, fitting
  matters more.
- **Noise parameters are recovered well wherever they are measured.** Without
  mocks, practice bias drifts to +7.9 with a wide sd: there is no anchor.
- **Late surges and forgetting remain the weak spot.** The model assumes
  gains fade smoothly, so crammers are under-forecast and forgetters
  over-forecast, with about 70% coverage.
- **Finding the weakest topic is unreliable when topics are close.** A
  scheduler should therefore rank by expected gain and uncertainty together,
  not just by argmin.

## API

JSON is camelCase. Errors are `{ error, details? }`: 400 for invalid input or
unknown references, 404 for a missing resource, 409 for duplicates. The
interactive docs are at `/docs`.

| Method | Path | Body / query | Response |
| ------ | ---- | ------------ | -------- |
| GET | `/health` | – | `{ status, database, … }` (503 if the DB is down) |
| GET / PUT | `/plans/:planId/topics` | `{ topics: [{ id, name, parentId?, priorMean?, priorSd?, position? }] }` (upsert) | `{ topics }` |
| GET / PUT | `/plans/:planId/params` | `{ halfLifeDays?, slopePriorMean?, slopePriorSd?, qLevel?, qSlope?, learnerBiasSd?, rhoSibling?, rhoGlobal? }` | params |
| GET | `/assessment-types` | – | `{ types }` (seeded: practice, quiz, mock, exam) |
| GET / PUT | `/assessment-types/:id` | `{ name, nDefault, cPrior, tau2?, biasPrior?, biasFixed? }` | type |
| POST | `/observations` | `{ userId, planId, type, observedAt, score, weights, nPoints?, sourceRef? }` | `201` observation |
| GET | `/observations` | `?userId=&planId=&from=&to=&limit=&offset=` | `{ observations }` |
| DELETE | `/observations/:id` | – | `204` |
| GET | `/users/:userId/plans/:planId/state` | `?at=` (ISO time, default now) | levels, slopes (per week), correlations, learner biases, diagnostics |
| POST | `/plans/:planId/fit` | – | estimates with sds and `priorOnly` flags |
| GET | `/plans/:planId/fit` | – | the stored fit |

Notes on the fields:

- `score` is a fraction (0–1).
- `nPoints` is what the score is out of, and defaults to the type's
  `nDefault`.
- `weights` can be in any units and are normalised.
- `sourceRef` (e.g. the app's session id) is unique per plan and user, so
  logging the same item twice returns 409.
- `state?at=` replays only scores up to `at` and projects forward to it, so
  `at` = exam day gives the exam forecast.
- `diagnostics.calibration` reports, per type, the mean and sd of the
  normalised innovations. On real data they should be about 0 and 1.

```bash
curl -X PUT localhost:8000/plans/analysis-exam/topics -H 'content-type: application/json' \
  -d '{"topics":[{"id":"analysis","name":"Analysis"},{"id":"series","name":"Series","parentId":"analysis"},{"id":"linalg","name":"Linear algebra"}]}'
curl -X POST localhost:8000/observations -H 'content-type: application/json' \
  -d '{"userId":"<uuid>","planId":"analysis-exam","type":"practice","observedAt":"2026-10-12T09:00:00+02:00","score":0.6,"nPoints":12,"weights":{"series":70,"linalg":30}}'
curl localhost:8000/users/<uuid>/plans/analysis-exam/state
curl -X POST localhost:8000/plans/analysis-exam/fit
```

## Limitations and next steps

**Limitations:**
- **Ceiling and floor are ignored.** Scores are capped at 0 and 1, which the
  Gaussian model doesn't account for. Very noisy types near the ceiling bias
  c low.
- **Evidence is synthetic.** All the numbers above are from simulations. The
  first real check is calibration: do 90% intervals contain 90% of later
  mock scores, and are the innovations per type about N(0, 1)?
- **Long-range blind spot.** The fit can't see long-range forecast error. A
  multi-step term, such as scoring each mock from the state 14 days earlier,
  would let the data tune the half-life and qSlope directly.
- **Not modelled yet:** learner-type mixtures (needs about 150 learners and
  many restarts) and forgetting of untouched topics toward a baseline.

**Next steps:**
- A scheduler endpoint that ranks topics by exam weight × expected gain plus
  β × variance reduction (closed form from the filter), with spacing
  constraints, or Thompson sampling.
- Hook the app's session logging up to `POST /observations` via
  `KNOWLEDGE_URL`.

## Layout

```
knowledge/
  model.py      the filter (pure NumPy): prior, predict, update, batched likelihood
  fit.py        MAP fitting over many learners
  api.py        FastAPI routes; schemas.py holds request/response models
  repo.py       SQL; db.py holds the pool and migration runner (migrations/*.sql, applied on startup)
bench/
  truth.py      learner archetypes and beta-binomial scoring
  schedules.py  logging schedules
  evaluate.py   estimators, baselines, metrics
  __main__.py   report;  sweep.py: process-noise / half-life sweep
tests/
  sim.py        learners simulated from the model itself (best case)
  test_model.py, test_fit.py, test_api.py, test_bench.py
```
