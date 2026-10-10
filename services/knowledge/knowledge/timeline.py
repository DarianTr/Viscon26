"""How a learner's estimates evolved, for charts: one entry per data point.

For every step (the prior, then after each observation) it records, per
topic, the level then and the forecast for the topic's exam day.

Topics sharing a `parent_id` form a group, e.g. the topics of one subject.
Until exams are split by weight, a group's exam covers its topics equally, so
each group also gets a level and an exam forecast: the equally weighted
average of its topics, with the exact variance from the joint covariance.
The plan-wide forecast weights every group equally, at the last exam day.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

from .model import Model, Observation, State

#: How far a projection may reach when exams are far away or unknown.
MAX_PROJECTION_DAYS = 365


@dataclass(frozen=True)
class MeanSd:
    mean: float
    sd: float


@dataclass(frozen=True)
class Group:
    id: str
    #: Indices into the model's topics.
    members: tuple[int, ...]
    #: The latest exam day of its topics, or None if none has one.
    exam_day: float | None


@dataclass
class Step:
    t: float
    #: None for the prior step.
    observation: Observation | None
    levels: list[MeanSd]
    #: Per topic, the forecast for its exam day (the level now if it has none or it passed).
    forecasts: list[MeanSd]
    group_levels: list[MeanSd]
    group_forecasts: list[MeanSd]
    #: Every group weighted equally, at the last exam day.
    overall: MeanSd
    predicted: float | None = None
    z: float | None = None
    #: sd of the measurement noise alone: how precisely the observation measures ability.
    noise_sd: float | None = None


@dataclass
class Timeline:
    groups: list[Group] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    #: The state as of `as_of`, the same shape as a step.
    current: Step | None = None
    #: Daily from `as_of` to the last exam day: (day, topic levels, group levels).
    projection: list[tuple[float, list[MeanSd], list[MeanSd]]] = field(default_factory=list)
    skipped: list[str | None] = field(default_factory=list)


def groups_of(model: Model, exam_days: Sequence[float | None]) -> list[Group]:
    """Groups in order of first appearance; a topic without a parent is its own group."""
    order: dict[str, list[int]] = {}
    for i, topic in enumerate(model.topics):
        order.setdefault(topic.parent_id or topic.id, []).append(i)
    groups = []
    for gid, members in order.items():
        days = [exam_days[i] for i in members if exam_days[i] is not None]
        groups.append(Group(gid, tuple(members), max(days) if days else None))
    return groups


def _ahead(model: Model, state: State, t: float | None) -> State:
    """The state predicted to t, or unchanged if t is unknown or already past."""
    if t is None or state.t is None or t <= state.t:
        return state
    return model.predict(state, t)


def _combo(state: State, w: np.ndarray) -> MeanSd:
    K = len(w)
    return MeanSd(float(w @ state.x[:K]), math.sqrt(max(float(w @ state.P[:K, :K] @ w), 0.0)))


def _weights(K: int, members: Sequence[int]) -> np.ndarray:
    w = np.zeros(K)
    w[list(members)] = 1 / len(members)
    return w


def _levels(model: Model, state: State, groups: list[Group]):
    K = model.K
    topics = [_combo(state, _weights(K, [k])) for k in range(K)]
    return topics, [_combo(state, _weights(K, g.members)) for g in groups]


def _step(model, state, exam_days, groups, obs=None, diag=None) -> Step:
    K = model.K
    levels, group_levels = _levels(model, state, groups)
    forecasts = [
        _combo(_ahead(model, state, day), _weights(K, [k])) for k, day in enumerate(exam_days)
    ]
    group_forecasts = [
        _combo(_ahead(model, state, g.exam_day), _weights(K, g.members)) for g in groups
    ]
    known = [g.exam_day for g in groups if g.exam_day is not None]
    w = sum(_weights(K, g.members) for g in groups) / len(groups)
    overall = _combo(_ahead(model, state, max(known) if known else None), w)
    return Step(
        t=float(state.t),
        observation=obs,
        levels=levels,
        forecasts=forecasts,
        group_levels=group_levels,
        group_forecasts=group_forecasts,
        overall=overall,
        predicted=None if diag is None else diag.predicted,
        z=None if diag is None else diag.z,
        noise_sd=None
        if diag is None
        else math.sqrt(model.noise(obs.type_id, diag.predicted, obs.n_points)),
    )


def build_timeline(
    model: Model,
    observations: Sequence[Observation],
    exam_days: Sequence[float | None],
    as_of: float,
) -> Timeline:
    """`exam_days` is per topic (in model order), in the same day units as observations."""
    if len(exam_days) != model.K:
        raise ValueError("exam_days needs one entry per topic")
    groups = groups_of(model, exam_days)
    obs = sorted((o for o in observations if o.t <= as_of), key=lambda o: o.t)
    state = model.prior(obs[0].t if obs else as_of)
    out = Timeline(groups=groups)
    out.steps.append(_step(model, state, exam_days, groups))

    for o in obs:
        state = model.predict(state, o.t)
        updated = model.update(state, o)
        if updated is None:
            out.skipped.append(o.id)
            continue
        state, diag = updated
        out.steps.append(_step(model, state, exam_days, groups, o, diag))

    now = model.predict(state, as_of)
    out.current = _step(model, now, exam_days, groups)

    known = [d for d in exam_days if d is not None and d > as_of]
    end = min(max(known), as_of + MAX_PROJECTION_DAYS) if known else as_of
    day = as_of
    while True:
        topics, group_levels = _levels(model, model.predict(now, day), groups)
        out.projection.append((day, topics, group_levels))
        if day >= end:
            break
        day = min(day + 1.0, end)
    return out
