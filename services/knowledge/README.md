# Knowledge service

Estimates each learner's level on every topic of a plan from logged scores,
with uncertainty, so that a scheduler can later target weak or uncertain
topics. Python 3.12, FastAPI, NumPy and SciPy, with storage in the app's
Postgres (schema `knowledge`).

```bash
uv sync
DATABASE_URL=postgres://stride:stride@localhost:5432/stride uv run uvicorn knowledge.api:app --reload
uv run pytest            # API tests also run if DATABASE_URL is set (throwaway schema)
uv run ruff check && uv run ruff format --check
```

## The model

Scores and levels are fractions correct (0–1), and time is in days. Each
learner has the state

| Part | Meaning |
| ---- | ------- |
| level ℓₖ per topic | current ability on topic k |
| slope sₖ per topic | current learning rate. It decays with a half-life, so fast early gains level off instead of being extrapolated |
| bias bⱼ per non-anchor assessment type | this learner's offset, e.g. practice done with notes |

**Between observations** (dt days, τ = half-life / ln 2):
ℓ ← ℓ + s·τ(1 − e^(−dt/τ)), s ← s·e^(−dt/τ). Process noise is correlated
across related topics.

**An observation** has topic weights h, normalised to sum 1. A sheet that is
10% limits and 90% series is simply `{"limits": 10, "series": 90}`. The
observation measures y = hᵀℓ + bⱼ + ε, with noise c·p(1−p)/n + τ². This means:

- a score from 5 points counts much less than one from 60;
- c, the overdispersion, says how much noisier a type is than pure
  binomial sampling;
- blame for a surprising score is split by weight × uncertainty. After a
  mixed sheet, the topics involved become anti-correlated ("one of them is
  weak"), and a single-topic quiz later resolves which one.

**Priors.** Topic levels start at the topic's `priorMean ± priorSd`.
Siblings and parent/child topics are correlated (`rhoSibling`), and all
other topics weakly so (`rhoGlobal`).

**Anchors.** Types with `biasFixed` (mock, exam) define the scale. Every
other type has a population bias plus a per-learner deviation, which is
learned only because anchors exist. One early mock is worth more than any
modelling detail.

The observation log is the source of truth: a learner's state is recomputed
by replaying their observations on each request, so there is no cache to go
stale.

### Fitting (`POST /plans/:id/fit`)

MAP over all learners of the plan, using the filter's exact likelihood plus
priors:

- per type: log c ~ N(log c_prior, 0.5), and bias ~ N(bias_prior, 0.05) for
  non-anchor types;
- half-life: log ~ N(log configured, 0.7);
- mean starting slope: ~ N(configured, slope_prior_sd).

Process noise is not fitted: it isn't identifiable from realistic data.
Optimisation is L-BFGS-B from three starts, in prior-standardised units. sds
come from the Laplace approximation. Types (or the trend) with fewer than 5
observations keep their prior and are reported as `priorOnly`. A fit is used
by later state requests; a refit replaces it.

Known limitations:

- **Censoring is ignored.** Real scores are clipped at 0 and 1. With very
  noisy types near the ceiling, the fitted c and half-life come out low (see
  the clipping note in `tests/sim.py`).
- **Model-family tests.** The recovery tests simulate from the same model
  family. On real data, check `diagnostics.calibration` in the state
  response: per type, `zMean` should be near 0 and `zSd` near 1.
- **No learner types or forgetting yet.** Learner-type mixtures and
  forgetting toward a baseline are not modelled.

## API

JSON is camelCase. Errors are `{ error, details? }`: 400 for invalid input or
unknown references, 404 for a missing resource, 409 for duplicates.
Interactive docs are at `/docs`.

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
- `sourceRef` (e.g. a session id) is unique per plan and user, so logging
  the same item twice returns 409.

```bash
curl -X PUT localhost:8000/plans/analysis-exam/topics -H 'content-type: application/json' \
  -d '{"topics":[{"id":"analysis","name":"Analysis"},{"id":"series","name":"Series","parentId":"analysis"},{"id":"linalg","name":"Linear algebra"}]}'
curl -X POST localhost:8000/observations -H 'content-type: application/json' \
  -d '{"userId":"<uuid>","planId":"analysis-exam","type":"practice","observedAt":"2026-10-12T09:00:00+02:00","score":0.6,"nPoints":12,"weights":{"series":70,"linalg":30}}'
curl localhost:8000/users/<uuid>/plans/analysis-exam/state
```

## Layout

```
knowledge/
  model.py     the filter (pure NumPy): prior, predict, update, batched likelihood
  fit.py       MAP fitting over many learners
  api.py       FastAPI routes; schemas.py holds request/response models
  repo.py      SQL; db.py holds the pool and migration runner (migrations/*.sql, applied on startup)
tests/
  sim.py       simulates learners from a "true" model
  test_model.py, test_fit.py, test_api.py
```
