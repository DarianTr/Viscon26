"""How often a learner logs what. Each schedule is a list of planned assessments.

The exam is on EXAM_DAY. Scores are only ever observed before it.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

from .truth import TOPIC_IDS, K

EXAM_DAY = 45
LAST_DAY = 42
#: Points per assessment of each type.
N_POINTS = {"practice": 12, "quiz": 20, "mock": 60}

Plan = list[tuple[float, str, dict[str, float]]]


def _mix(rng: np.random.Generator, k: int) -> dict[str, float]:
    """A sheet covering k random topics with random shares."""
    idx = rng.choice(K, k, replace=False)
    w = rng.dirichlet(np.ones(k))
    return {TOPIC_IDS[i]: float(x) for i, x in zip(idx, w, strict=True)}


def _mock() -> dict[str, float]:
    return dict.fromkeys(TOPIC_IDS, 1.0)


def rich(rng) -> Plan:
    """Daily two-topic practice, a weekly single-topic quiz, three mocks."""
    plan: Plan = [(d, "practice", _mix(rng, 2)) for d in range(LAST_DAY + 1)]
    plan += [(d, "quiz", _mix(rng, 1)) for d in range(3, LAST_DAY + 1, 7)]
    plan += [(d, "mock", _mock()) for d in (10, 24, 38)]
    return plan


def sparse(rng) -> Plan:
    """Practice every third day, one mock."""
    plan: Plan = [(d, "practice", _mix(rng, 2)) for d in range(0, LAST_DAY + 1, 3)]
    plan.append((24, "mock", _mock()))
    return plan


def no_mocks(rng) -> Plan:
    """Like rich, but nothing exam-like: practice bias has no anchor."""
    return [p for p in rich(rng) if p[1] != "mock"]


def mixed_only(rng) -> Plan:
    """Every sheet mixes three topics; no single-topic signal at all."""
    plan: Plan = [(d, "practice", _mix(rng, 3)) for d in range(LAST_DAY + 1)]
    plan += [(d, "quiz", _mix(rng, 3)) for d in range(3, LAST_DAY + 1, 7)]
    plan += [(d, "mock", _mock()) for d in (10, 24, 38)]
    return plan


SCHEDULES: dict[str, Callable[[np.random.Generator], Plan]] = {
    f.__name__: f for f in (rich, sparse, no_mocks, mixed_only)
}
