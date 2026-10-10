"""Simulate learners from the exact model the filter assumes.

Drawing a learner's starting state from the model's own prior matters: when
the simulated population differs from the prior (e.g. independent rather than
correlated slopes), the fitted half-life is visibly biased.
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np

from knowledge.model import AssessmentType, Model, Observation, PlanParams, Topic

TOPICS = [
    Topic("analysis", None, 0.5, 0.15),
    Topic("analysis.limits", "analysis", 0.5, 0.15),
    Topic("analysis.series", "analysis", 0.45, 0.15),
    Topic("linalg", None, 0.5, 0.15),
]

#: Points per assessment of each type.
N_POINTS = {"practice": 10, "quiz": 20, "mock": 60, "exam": 100}

TRUE_TYPES = [
    AssessmentType("practice", c=3.0, bias=0.06),
    AssessmentType("quiz", c=1.5, bias=0.0),
    AssessmentType("mock", c=1.2, bias_fixed=True),
    AssessmentType("exam", c=1.0, bias_fixed=True),
]

TRUE_PARAMS = PlanParams(
    half_life_days=20,
    slope_prior_mean=0.008,
    slope_prior_sd=0.003,
    q_level=0.0,
    q_slope=0.0,
    learner_bias_sd=0.03,
)


def truth_model(*, types: list[AssessmentType] = TRUE_TYPES, **params) -> Model:
    return Model(TOPICS, types, replace(TRUE_PARAMS, **params))


def schedule(
    rng: np.random.Generator, topic_ids: list[str], *, days: int, mocks: tuple[int, ...]
) -> list[tuple[float, str, dict[str, float]]]:
    """Daily two-topic practice, a weekly single-topic quiz, all-topic mocks."""
    K = len(topic_ids)
    plan = []
    for day in range(days + 1):
        a, b = rng.choice(K, 2, replace=False)
        w = float(rng.uniform(0.2, 0.8))
        plan.append((day, "practice", {topic_ids[a]: w, topic_ids[b]: 1 - w}))
        if day % 7 == 3:
            plan.append((day, "quiz", {topic_ids[rng.integers(K)]: 1.0}))
        if day in mocks:
            plan.append((day, "mock", dict.fromkeys(topic_ids, 1.0)))
    return plan


def simulate_learner(
    rng: np.random.Generator,
    truth: Model | None = None,
    *,
    days: int = 40,
    mocks: tuple[int, ...] = (7, 21, 35),
    clip: bool = True,
) -> tuple[list[Observation], np.ndarray]:
    """One learner's observations, and their true topic levels on the last day."""
    truth = truth or truth_model()
    prior = truth.prior(0)
    x0 = rng.multivariate_normal(prior.x, prior.P)
    state = replace(prior, x=x0, P=np.zeros_like(prior.P))

    obs = []
    topic_ids = [tp.id for tp in truth.topics]
    for t, type_id, weights in schedule(rng, topic_ids, days=days, mocks=mocks):
        state = truth.predict(state, t)
        n = N_POINTS[type_id]
        o = Observation(t, type_id, 0.0, n, weights, id=f"{type_id}-{t}")
        H, offset = truth.design(o)
        mean = float(H @ state.x + offset)
        score = mean + rng.normal(0, math.sqrt(truth.noise(type_id, mean, n)))
        if clip:  # real scores are censored at 0 and 1, which the filter ignores
            score = min(max(score, 0.0), 1.0)
        obs.append(replace(o, score=score))

    state = truth.predict(state, days)
    return obs, truth.levels(state)[0]
