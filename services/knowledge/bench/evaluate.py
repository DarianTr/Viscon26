"""Run estimators on simulated learners and score them against the truth."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field, replace

import numpy as np

from knowledge.fit import FitResult, Priors, TypePrior, fit_map
from knowledge.model import AssessmentType, Model, Observation, PlanParams

from .schedules import EXAM_DAY, LAST_DAY, N_POINTS, SCHEDULES
from .truth import ARCHETYPES, TOPICS, K, TrueLearner

CHECKPOINTS = (10, 24, LAST_DAY)
Z90 = 1.6449
#: What the platform would ship with before seeing any data (as seeded in the DB).
TYPE_PRIORS = [
    TypePrior("practice", c_prior=3.0, bias_prior=0.05),
    TypePrior("quiz", c_prior=1.5),
    TypePrior("mock", c_prior=1.0, bias_fixed=True),
]
DEFAULT_PARAMS = PlanParams()
EXAM_WEIGHTS = np.full(K, 1 / K)


@dataclass
class Learner:
    truth: TrueLearner
    obs: list[Observation]


def simulate(rng: np.random.Generator, archetype: str, schedule: str) -> Learner:
    truth = ARCHETYPES[archetype](rng)
    obs = [
        Observation(t, tid, truth.score(rng, t, tid, w, N_POINTS[tid]), N_POINTS[tid], w)
        for t, tid, w in sorted(SCHEDULES[schedule](rng), key=lambda p: p[0])
    ]
    return Learner(truth, obs)


# --- Estimators --------------------------------------------------------------


@dataclass
class Estimate:
    """Per-topic levels now, and the exam forecast; sds are None if the method has none."""

    level: np.ndarray
    level_sd: np.ndarray | None
    exam: float
    exam_sd: float | None
    z: list[tuple[str, float]] = field(default_factory=list)


class KalmanEstimator:
    def __init__(self, model: Model):
        self.model = model

    def __call__(self, obs: Sequence[Observation], t: float) -> Estimate:
        m = self.model
        result = m.run(obs, until=t)
        level, level_sd = m.levels(result.state)
        ahead = m.predict(result.state, EXAM_DAY)
        P = ahead.P[:K, :K]
        return Estimate(
            level,
            level_sd,
            float(EXAM_WEIGHTS @ ahead.x[:K]),
            float(math.sqrt(EXAM_WEIGHTS @ P @ EXAM_WEIGHTS)),
            [(d.type_id, d.z) for d in result.diagnostics],
        )


def naive(obs: Sequence[Observation], t: float, half_life: float = 7.0) -> Estimate:
    """Recency-weighted average of raw scores per topic; forecast = today's level."""
    num, den = np.zeros(K), np.zeros(K)
    index = {tp.id: i for i, tp in enumerate(TOPICS)}
    for o in obs:
        if o.t > t:
            continue
        decay = 0.5 ** ((t - o.t) / half_life)
        total = sum(o.weights.values())
        for tid, w in o.weights.items():
            num[index[tid]] += decay * w / total * o.score
            den[index[tid]] += decay * w / total
    level = np.where(den > 0, num / np.maximum(den, 1e-12), 0.5)
    return Estimate(level, None, float(EXAM_WEIGHTS @ level), None)


def model_from_fit(fit: FitResult, params: PlanParams = DEFAULT_PARAMS) -> Model:
    types = [
        AssessmentType(
            tp.id,
            fit.c[tp.id].value,
            tp.tau2,
            fit.bias[tp.id].value if tp.id in fit.bias else tp.bias_prior,
            tp.bias_fixed,
        )
        for tp in TYPE_PRIORS
    ]
    params = replace(
        params,
        half_life_days=fit.half_life_days.value,
        slope_prior_mean=fit.slope_prior_mean.value,
    )
    return Model(TOPICS, types, params)


def default_model(params: PlanParams = DEFAULT_PARAMS) -> Model:
    types = [AssessmentType(tp.id, tp.c_prior, tp.tau2, tp.bias_prior, tp.bias_fixed)
             for tp in TYPE_PRIORS]  # fmt: skip
    return Model(TOPICS, types, params)


def estimators(fit: FitResult, params: PlanParams = DEFAULT_PARAMS) -> dict:
    fitted = model_from_fit(fit, params)
    return {
        "fitted": KalmanEstimator(fitted),
        "default": KalmanEstimator(default_model(params)),
        "linear": KalmanEstimator(
            Model(
                TOPICS, list(fitted.types.values()), replace(fitted.params, half_life_days=math.inf)
            )
        ),
        "no_trend": KalmanEstimator(
            Model(
                TOPICS,
                list(fitted.types.values()),
                replace(fitted.params, slope_prior_mean=0.0, slope_prior_sd=1e-6),
            )
        ),
        "naive": naive,
    }


VARIANTS = ("fitted", "default", "linear", "no_trend", "naive")


# --- Running -----------------------------------------------------------------


@dataclass
class Cell:
    """Accumulated errors for one (schedule, archetype, variant, checkpoint)."""

    exam_err: list[float] = field(default_factory=list)
    exam_cov: list[bool] = field(default_factory=list)
    topic_err: list[float] = field(default_factory=list)
    topic_cov: list[bool] = field(default_factory=list)
    weakest_hit: list[bool] = field(default_factory=list)

    def summary(self) -> dict:
        def rms(x):
            return float(np.sqrt(np.mean(np.square(x)))) * 100 if x else math.nan

        def mean(x):
            return float(np.mean(x)) if x else math.nan

        return {
            "exam_rmse": rms(self.exam_err),
            "exam_bias": mean(self.exam_err) * 100,
            "exam_cov90": mean(self.exam_cov),
            "topic_rmse": rms(self.topic_err),
            "topic_cov90": mean(self.topic_cov),
            "weakest_hit": mean(self.weakest_hit),
            "n": len(self.exam_err),
        }


@dataclass
class ScheduleResult:
    schedule: str
    fit: FitResult
    cells: dict = field(default_factory=lambda: defaultdict(Cell))
    #: z-scores per assessment type for the fitted model at the last checkpoint.
    z: dict = field(default_factory=lambda: defaultdict(list))
    seconds_fit: float = 0.0


def run_schedule(
    schedule: str,
    *,
    archetypes: Sequence[str],
    n_train: int,
    n_eval: int,
    seed: int,
    params: PlanParams = DEFAULT_PARAMS,
    priors: Priors | None = None,
) -> ScheduleResult:
    import time

    rng = np.random.default_rng(seed)
    # A platform's training data: a mixed population of every archetype.
    train = [simulate(rng, archetypes[i % len(archetypes)], schedule) for i in range(n_train)]
    t0 = time.perf_counter()
    fit = fit_map(TOPICS, TYPE_PRIORS, params, [lr.obs for lr in train], priors)
    result = ScheduleResult(schedule, fit, seconds_fit=time.perf_counter() - t0)
    methods = estimators(fit, params)

    for archetype in archetypes:
        for _ in range(n_eval):
            learner = simulate(rng, archetype, schedule)
            exam_truth = float(EXAM_WEIGHTS @ learner.truth.level(EXAM_DAY))
            for cp in CHECKPOINTS:
                truth_now = learner.truth.level(cp)
                for name, method in methods.items():
                    est = method(learner.obs, cp)
                    cell = result.cells[(archetype, name, cp)]
                    err = est.exam - exam_truth
                    cell.exam_err.append(err)
                    cell.topic_err.extend(est.level - truth_now)
                    cell.weakest_hit.append(int(np.argmin(est.level)) == int(np.argmin(truth_now)))
                    if est.exam_sd is not None:
                        cell.exam_cov.append(abs(err) <= Z90 * est.exam_sd)
                        cell.topic_cov.extend(np.abs(est.level - truth_now) <= Z90 * est.level_sd)
                    if name == "fitted" and cp == CHECKPOINTS[-1]:
                        for tid, z in est.z:
                            result.z[tid].append(z)
    return result
