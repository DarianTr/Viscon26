"""Ground-truth learners, deliberately *not* drawn from the filter's model family.

Each archetype is a parametric learning curve per topic, with its own
per-learner jitter. Scores are beta-binomial (real overdispersion over real
point counts) and so naturally live in [0, 1] — including the ceiling and
floor effects the filter ignores.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from knowledge.model import Topic

#: Five leaf topics in two groups. Group names are only used for correlation.
TOPICS = [
    Topic("limits", "analysis"),
    Topic("series", "analysis"),
    Topic("integrals", "analysis"),
    Topic("matrices", "linalg"),
    Topic("eigen", "linalg"),
]
K = len(TOPICS)
TOPIC_IDS = [t.id for t in TOPICS]

#: True measurement properties of each assessment type.
#: c is the variance multiplier over binomial; bias is the population average offset.
TRUE_C = {"practice": 2.5, "quiz": 1.5, "mock": 1.2}
POPULATION_BIAS = {"practice": 0.05, "quiz": 0.0, "mock": 0.0}


@dataclass
class Curve:
    """level_k(t) = start + gain·(1 − e^(−t/τ)) + surge·σ((t − t_s)/w) − forget·max(0, t − peak)."""

    start: np.ndarray
    gain: np.ndarray
    tau: np.ndarray
    surge: np.ndarray = field(default_factory=lambda: np.zeros(K))
    surge_at: float = 1e9
    surge_width: float = 2.0
    forget: np.ndarray = field(default_factory=lambda: np.zeros(K))
    peak: np.ndarray = field(default_factory=lambda: np.full(K, 1e9))

    def __call__(self, t: float) -> np.ndarray:
        level = self.start + self.gain * (1 - np.exp(-t / self.tau))
        level = level + self.surge * 0.5 * (
            1 + math.tanh((t - self.surge_at) / (2 * self.surge_width))
        )
        level = level - self.forget * np.maximum(0.0, t - self.peak)
        return np.clip(level, 0.0, 1.0)


@dataclass
class TrueLearner:
    archetype: str
    curve: Curve
    #: This learner's actual offset per assessment type.
    bias: dict[str, float]
    #: Extra day-to-day noise on every assessment (sd, as a fraction).
    form_sd: float = 0.0

    def level(self, t: float) -> np.ndarray:
        return self.curve(t)

    def score(self, rng: np.random.Generator, t: float, type_id: str, weights: dict, n: int):
        h = np.array([weights.get(tid, 0.0) for tid in TOPIC_IDS], dtype=float)
        h /= h.sum()
        p = float(h @ self.level(t)) + self.bias[type_id] + rng.normal(0, self.form_sd)
        return beta_binomial(rng, n, min(max(p, 0.005), 0.995), TRUE_C[type_id]) / n


def beta_binomial(rng: np.random.Generator, n: int, p: float, c: float) -> int:
    """Successes out of n with variance c·n·p(1−p) (c ≥ 1)."""
    if n <= 1 or c <= 1.0:
        return int(rng.binomial(n, p))
    rho = min((c - 1) / (n - 1), 0.99)  # intra-class correlation
    a = p * (1 - rho) / rho
    b = (1 - p) * (1 - rho) / rho
    return int(rng.binomial(n, rng.beta(a, b)))


def _u(rng, lo, hi, size=K):
    return rng.uniform(lo, hi, size)


def _biases(rng, practice_extra=0.0) -> dict[str, float]:
    return {
        "practice": POPULATION_BIAS["practice"] + practice_extra + rng.normal(0, 0.03),
        "quiz": POPULATION_BIAS["quiz"] + rng.normal(0, 0.02),
        "mock": 0.0,
    }


def _jitter(rng, x, sd=0.04):
    return x + rng.normal(0, sd, K)


# --- Archetypes -------------------------------------------------------------
# Each returns one random learner of that kind.


def steady(rng):
    """Slow, almost linear improvement all the way to the exam."""
    return TrueLearner(
        "steady", Curve(_jitter(rng, _u(rng, 0.35, 0.5)), _u(rng, 0.45, 0.6), _u(rng, 50, 80)),
        _biases(rng),
    )  # fmt: skip


def fast_plateau(rng):
    """Prior knowledge: quick early gains, flat after the first week."""
    return TrueLearner(
        "fast_plateau", Curve(_u(rng, 0.55, 0.65), _u(rng, 0.12, 0.2), _u(rng, 3, 6)), _biases(rng)
    )


def catch_up(rng):
    """Starts low, learns fast, levels off after ~3 weeks."""
    return TrueLearner(
        "catch_up", Curve(_u(rng, 0.2, 0.35), _u(rng, 0.4, 0.5), _u(rng, 10, 15)), _biases(rng)
    )


def crammer(rng):
    """Barely moves, then a steep surge in the last ten days."""
    curve = Curve(
        _u(rng, 0.35, 0.45), _u(rng, 0.03, 0.06), np.full(K, 20.0),
        surge=_u(rng, 0.2, 0.3), surge_at=rng.uniform(32, 36),
    )  # fmt: skip
    return TrueLearner("crammer", curve, _biases(rng))


def forgetter(rng):
    """Rotates focus: each topic peaks at a different time, then decays."""
    curve = Curve(
        _u(rng, 0.35, 0.45), _u(rng, 0.3, 0.4), _u(rng, 5, 8),
        forget=_u(rng, 0.004, 0.008), peak=rng.permutation(np.linspace(8, 30, K)),
    )  # fmt: skip
    return TrueLearner("forgetter", curve, _biases(rng))


def specialist(rng):
    """Very uneven: one topic near mastery, one barely started."""
    start = np.full(K, 0.5) + rng.normal(0, 0.03, K)
    strong, weak = rng.choice(K, 2, replace=False)
    start[strong], start[weak] = rng.uniform(0.78, 0.85), rng.uniform(0.15, 0.22)
    return TrueLearner(
        "specialist", Curve(start, _u(rng, 0.1, 0.15), np.full(K, 20.0)), _biases(rng)
    )


def stalled(rng):
    """No real progress at all."""
    return TrueLearner(
        "stalled", Curve(_jitter(rng, _u(rng, 0.45, 0.55)), np.zeros(K), np.ones(K)), _biases(rng)
    )


def erratic(rng):
    """Steady learner with large day-to-day swings in form."""
    learner = steady(rng)
    learner.archetype, learner.form_sd = "erratic", 0.08
    return learner


def notes_heavy(rng):
    """Does practice with notes: practice runs ~15 points above real ability."""
    learner = steady(rng)
    learner.archetype, learner.bias = "notes_heavy", _biases(rng, practice_extra=0.10)
    return learner


def ceiling(rng):
    """Already strong; scores pile up near 100%."""
    return TrueLearner(
        "ceiling", Curve(_u(rng, 0.8, 0.88), _u(rng, 0.05, 0.1), _u(rng, 8, 12)), _biases(rng)
    )


ARCHETYPES: dict[str, Callable[[np.random.Generator], TrueLearner]] = {
    f.__name__: f
    for f in (
        steady,
        fast_plateau,
        catch_up,
        crammer,
        forgetter,
        specialist,
        stalled,
        erratic,
        notes_heavy,
        ceiling,
    )  # fmt: skip
}
