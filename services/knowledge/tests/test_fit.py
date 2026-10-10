import numpy as np
import pytest

from knowledge.fit import Priors, TypePrior, fit_map
from knowledge.model import PlanParams

from .sim import TOPICS, TRUE_PARAMS, TRUE_TYPES, simulate_learner

# Priors deliberately off the truth (c 3/1.5/1.2, practice bias +0.06, half-life 20).
TYPE_PRIORS = [
    TypePrior("practice", c_prior=2.0, bias_prior=0.03),
    TypePrior("quiz", c_prior=2.0),
    TypePrior("mock", c_prior=2.0, bias_fixed=True),
    TypePrior("exam", c_prior=1.0, bias_fixed=True),
]
PARAMS = PlanParams(half_life_days=15, slope_prior_sd=0.003, learner_bias_sd=0.03)


def within(estimate, truth, n_sd=3.0):
    assert not estimate.prior_only and estimate.sd is not None
    return abs(estimate.value - truth) <= n_sd * estimate.sd


def test_map_recovers_measurement_model_and_trend():
    rng = np.random.default_rng(2)
    learners = [simulate_learner(rng, clip=False)[0] for _ in range(30)]

    result = fit_map(TOPICS, TYPE_PRIORS, PARAMS, learners)

    assert result.converged and result.starts_agree
    truth = {t.id: t for t in TRUE_TYPES}
    for tid in ("practice", "quiz", "mock"):
        assert within(result.c[tid], truth[tid].c), tid
    assert within(result.bias["practice"], 0.06)
    assert within(result.bias["quiz"], 0.0)
    assert within(result.half_life_days, TRUE_PARAMS.half_life_days)
    assert within(result.slope_prior_mean, TRUE_PARAMS.slope_prior_mean)
    # Practice noise is the best measured: 1200 observations.
    assert result.c["practice"].sd < 0.2


def test_types_without_enough_data_keep_their_prior():
    rng = np.random.default_rng(0)
    learners = [simulate_learner(rng, days=10, mocks=())[0] for _ in range(3)]

    result = fit_map(TOPICS, TYPE_PRIORS, PARAMS, learners, Priors(min_obs=5))

    assert result.c["mock"].prior_only and result.c["mock"].value == 2.0
    assert result.c["exam"].prior_only
    assert not result.c["practice"].prior_only
    assert "mock" not in result.bias  # anchors have no bias to fit


def test_no_data_returns_priors():
    result = fit_map(TOPICS, TYPE_PRIORS, PARAMS, [])
    assert all(e.prior_only for e in result.c.values())
    assert result.half_life_days.value == pytest.approx(15)
    assert result.n_observations == 0
