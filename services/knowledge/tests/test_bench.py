"""Guardrails on the testbench: realistic learners, not drawn from the model family.

Loose thresholds on a small run; `uv run python -m bench` gives the full picture.
"""

import pytest

from bench.__main__ import pooled
from bench.evaluate import CHECKPOINTS, run_schedule
from bench.truth import ARCHETYPES


@pytest.fixture(scope="module")
def rich():
    return run_schedule("rich", archetypes=list(ARCHETYPES), n_train=30, n_eval=6, seed=1)


def test_damped_trend_beats_straight_line_and_no_trend_early(rich):
    first = CHECKPOINTS[0]
    fitted = pooled(rich, "fitted", first)["exam_rmse"]
    assert fitted < 0.6 * pooled(rich, "linear", first)["exam_rmse"]
    assert fitted < pooled(rich, "no_trend", first)["exam_rmse"]
    assert fitted < pooled(rich, "naive", first)["exam_rmse"]


def test_topic_levels_are_roughly_calibrated(rich):
    last = pooled(rich, "fitted", CHECKPOINTS[-1])
    assert last["topic_rmse"] < 12
    assert 0.8 <= last["topic_cov90"] <= 0.98


def test_fit_recovers_measurement_noise_from_realistic_scores(rich):
    assert rich.fit.c["practice"].value == pytest.approx(2.5, abs=0.5)
    assert rich.fit.bias["practice"].value == pytest.approx(0.05, abs=0.03)


def test_specialists_weakest_topic_is_found(rich):
    cell = rich.cells[("specialist", "fitted", CHECKPOINTS[-1])].summary()
    assert cell["weakest_hit"] >= 0.8
