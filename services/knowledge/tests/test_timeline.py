import math

import numpy as np
import pytest

from knowledge.model import AssessmentType, Model, Observation, PlanParams, Topic
from knowledge.timeline import build_timeline

TOPICS = [Topic("analysis"), Topic("linalg")]
TYPES = [AssessmentType("quiz", c=1.5), AssessmentType("mock", c=1.0, bias_fixed=True)]
MODEL = Model(TOPICS, TYPES, PlanParams())


def test_one_step_per_observation_plus_prior():
    obs = [
        Observation(1, "quiz", 0.7, 20, {"analysis": 1}, id="a"),
        Observation(3, "mock", 0.6, 60, {"analysis": 1, "linalg": 1}, id="b"),
        Observation(4, "quiz", 0.5, 20, {"nope": 1}, id="c"),
    ]
    tl = build_timeline(MODEL, obs, [20.0, 30.0], as_of=10.0)

    assert [s.observation.id if s.observation else None for s in tl.steps] == [None, "a", "b"]
    assert tl.skipped == ["c"]
    assert tl.current.t == 10.0
    # Evidence narrows the analysis forecast.
    assert tl.steps[-1].forecasts[0].sd < tl.steps[0].forecasts[0].sd


def test_forecasts_project_each_topic_to_its_own_exam_day():
    tl = build_timeline(MODEL, [], [20.0, None], as_of=0.0)
    now = tl.current
    # Learning continues until the exam, so the forecast is above today's level...
    assert now.forecasts[0].mean > now.levels[0].mean
    # ...unless the topic has no exam day, when the forecast is the level now.
    assert now.forecasts[1] == now.levels[1]


def test_overall_is_the_equal_average_at_the_last_exam():
    tl = build_timeline(MODEL, [], [20.0, 30.0], as_of=0.0)
    s = MODEL.predict(MODEL.prior(0.0), 30.0)
    assert tl.current.overall.mean == pytest.approx(s.x[:2].mean())
    assert tl.current.overall.sd == pytest.approx(math.sqrt(s.P[:2, :2].sum() / 4))
    # Topics without a parent are groups of one.
    assert tl.current.group_forecasts == tl.current.forecasts


def test_projection_runs_daily_to_the_last_exam():
    tl = build_timeline(MODEL, [], [5.5, 3.0], as_of=0.0)
    days = [t for t, *_ in tl.projection]
    assert days == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 5.5]


def test_exam_in_the_past_keeps_the_last_level():
    obs = [Observation(10, "quiz", 0.8, 20, {"analysis": 1})]
    tl = build_timeline(MODEL, obs, [5.0, 5.0], as_of=12.0)
    assert tl.steps[-1].forecasts[0] == tl.steps[-1].levels[0]
    assert [t for t, *_ in tl.projection] == [12.0]


def test_groups_average_their_topics_with_the_joint_covariance():
    topics = [
        Topic("an.series", "analysis"),
        Topic("an.integrals", "analysis"),
        Topic("an.diff", "analysis"),
        Topic("linalg"),
    ]
    model = Model(topics, TYPES, PlanParams())
    tl = build_timeline(model, [], [20.0, 20.0, 20.0, 30.0], as_of=0.0)

    assert [(g.id, g.members, g.exam_day) for g in tl.groups] == [
        ("analysis", (0, 1, 2), 20.0),
        ("linalg", (3,), 30.0),
    ]
    s = model.predict(model.prior(0.0), 20.0)
    w = np.array([1 / 3, 1 / 3, 1 / 3, 0])
    f = tl.current.group_forecasts[0]
    assert f.mean == pytest.approx(w @ s.x[:4])
    assert f.sd == pytest.approx(math.sqrt(w @ s.P[:4, :4] @ w))
    # Correlated siblings: the average is less certain than independent topics would suggest.
    assert f.sd > math.sqrt(sum(s.P[i, i] for i in range(3))) / 3
    assert tl.current.group_levels[1] == tl.current.levels[3]
    # Plan-wide: each group counts equally, whatever its number of topics.
    s30 = model.predict(model.prior(0.0), 30.0)
    w_all = np.array([1 / 6, 1 / 6, 1 / 6, 1 / 2])
    assert tl.current.overall.mean == pytest.approx(w_all @ s30.x[:4])
    assert len(tl.projection[0][2]) == 2
