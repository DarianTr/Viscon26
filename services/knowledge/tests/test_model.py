import math

import numpy as np
import pytest

from knowledge.model import AssessmentType, Model, Observation, PlanParams, Topic

from .sim import TOPICS, TRUE_TYPES, simulate_learner, truth_model

ANCHOR = AssessmentType("mock", c=1.0, tau2=0.0, bias_fixed=True)
STATIC = PlanParams(slope_prior_mean=0.0, slope_prior_sd=1e-9, q_level=0.0, q_slope=0.0)


def test_scalar_update_matches_hand_calculation():
    model = Model([Topic("a", prior_mean=0.5, prior_sd=0.2)], [ANCHOR], STATIC)
    res = model.run([Observation(0, "mock", 0.7, 50, {"a": 1})])

    r = 1.0 * 0.5 * 0.5 / 50  # binomial variance at the predicted score
    S = 0.04 + r
    mean, sd = model.levels(res.state)
    assert mean[0] == pytest.approx(0.5 + 0.04 / S * 0.2)
    assert sd[0] ** 2 == pytest.approx(0.04 - 0.04**2 / S)
    assert res.loglik == pytest.approx(-0.5 * (math.log(2 * math.pi * S) + 0.04 / S))


def test_mixed_observation_splits_blame_by_weight_and_uncertainty():
    """The chat's example: a sheet that is 10% A, 50% B, 40% C, scored low."""
    topics = [Topic(x, prior_mean=0.6, prior_sd=0.2) for x in "ABC"]
    params = PlanParams(rho_global=0.25, slope_prior_sd=1e-9, slope_prior_mean=0)
    model = Model(topics, [AssessmentType("sheet", c=1.0, tau2=0.01, bias_fixed=True)], params)
    before = model.prior(0)

    sheet = Observation(0, "sheet", 0.45, 1e9, {"A": 0.1, "B": 0.5, "C": 0.4})
    after, _ = model.update(before, sheet)

    drop = model.levels(before)[0] - model.levels(after)[0]
    assert drop[1] > drop[2] > drop[0] > 0
    # "One of B and C is weak, but we can't yet say which."
    assert model.level_correlation(after)[1, 2] < 0


def test_few_points_move_the_estimate_less_than_many():
    model = Model([Topic("a")], [ANCHOR], STATIC)
    small = model.run([Observation(0, "mock", 0.9, 5, {"a": 1})])
    large = model.run([Observation(0, "mock", 0.9, 60, {"a": 1})])
    assert model.levels(small.state)[0][0] < model.levels(large.state)[0][0]


def test_damped_trend_levels_off_instead_of_growing_linearly():
    params = PlanParams(half_life_days=10, slope_prior_mean=0.01, q_level=0, q_slope=0)
    model = Model([Topic("a")], [ANCHOR], params)
    s0 = model.prior(0)
    tau = 10 / math.log(2)

    gain_100 = model.levels(model.predict(s0, 100))[0][0] - 0.5
    gain_1000 = model.levels(model.predict(s0, 1000))[0][0] - 0.5
    assert gain_1000 == pytest.approx(0.01 * tau, rel=1e-6)
    assert gain_100 == pytest.approx(0.01 * tau * (1 - math.exp(-100 / tau)))
    assert model.slopes(model.predict(s0, 100))[0][0] == pytest.approx(0.01 * 2**-10)


def test_unknown_topics_are_skipped():
    model = Model([Topic("a")], [ANCHOR], STATIC)
    res = model.run([Observation(0, "mock", 0.9, 60, {"zzz": 1}, id="x")])
    assert res.skipped == ["x"] and not res.diagnostics


def test_damped_trend_forecasts_a_plateau_better_than_a_straight_line():
    """Fast early gains: a straight line extrapolates them, the damped trend doesn't."""
    rng = np.random.default_rng(1)
    truth = truth_model(half_life_days=7, slope_prior_mean=0.02)
    damped = Model(TOPICS, TRUE_TYPES, PlanParams(half_life_days=7, slope_prior_mean=0.02))
    linear = Model(TOPICS, TRUE_TYPES, PlanParams(half_life_days=math.inf, slope_prior_mean=0.02))

    errors = {"damped": [], "linear": []}
    for _ in range(20):
        obs, final = simulate_learner(rng, truth, days=60, mocks=(7, 14))
        history = [o for o in obs if o.t <= 14]
        for name, model in (("damped", damped), ("linear", linear)):
            state = model.run(history, until=60).state
            errors[name].append(model.levels(state)[0].mean() - final.mean())

    rmse = {k: float(np.sqrt(np.mean(np.square(v)))) for k, v in errors.items()}
    assert rmse["damped"] < 0.04
    assert rmse["linear"] > 2 * rmse["damped"]


def test_learner_practice_bias_absorbs_inflated_practice_scores():
    """Practice runs 8 points above mocks for this learner (6 for the average learner).

    With a per-learner bias state that shows up as bias; without one, as ability.
    """
    topic = Topic("a", prior_mean=0.5, prior_sd=0.2)
    mock = AssessmentType("mock", c=1.0, bias_fixed=True)
    obs = [Observation(d, "practice", 0.68, 20, {"a": 1}) for d in range(20)]
    obs += [Observation(d, "mock", 0.60, 60, {"a": 1}) for d in (5, 15)]

    model = Model([topic], [AssessmentType("practice", c=1.0, bias=0.06), mock], STATIC)
    state = model.run(obs).state
    assert model.levels(state)[0][0] == pytest.approx(0.60, abs=0.015)
    assert model.learner_biases(state)["practice"][0] == pytest.approx(0.08, abs=0.015)

    naive = Model([topic], [AssessmentType("practice", c=1.0, bias_fixed=True), mock], STATIC)
    assert naive.levels(naive.run(obs).state)[0][0] > 0.65


def test_batched_loglik_matches_per_learner_filter():
    rng = np.random.default_rng(3)
    learners = [simulate_learner(rng, days=12)[0] for _ in range(4)]
    learners.append(learners[0][:3])  # ragged lengths
    model = Model(TOPICS, TRUE_TYPES, PlanParams())
    expected = sum(model.run(obs).loglik for obs in learners)
    assert model.loglik(model.prepare(learners)) == pytest.approx(expected, rel=1e-9)
