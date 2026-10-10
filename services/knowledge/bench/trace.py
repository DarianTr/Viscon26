"""Record how the filter's estimates move with every data point, for a few
showcase learners, and render the interactive replay page.

    uv run python -m bench.trace            # → bench/out/trace.json, bench/out/forecast.html

The model is the one the testbench evaluates: MAP-fitted on a mixed cohort
(rich schedule, current defaults). Everything shown comes from the real filter.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from knowledge.fit import fit_map
from knowledge.model import Model, State

from .evaluate import (
    DEFAULT_PARAMS,
    EXAM_WEIGHTS,
    TYPE_PRIORS,
    model_from_fit,
    simulate,
)
from .schedules import EXAM_DAY, N_POINTS
from .truth import ARCHETYPES, TOPIC_IDS, TOPICS, K

OUT = Path(__file__).parent / "out"
TEMPLATE = Path(__file__).parent / "forecast_template.html"

SHOWCASE = {
    "catch_up": "Starts low and learns fast. The forecast climbs and the band narrows "
    "as evidence piles up.",
    "notes_heavy": "Practices with notes, so practice scores run high. Each mock pulls "
    "the forecast back down to real ability.",
    "specialist": "Strong in one topic, weak in another. Single-topic quizzes separate "
    "them; mixed sheets alone can't.",
    "crammer": "Barely moves, then surges just before the exam. The model's known weak "
    "spot: it expects gains to fade.",
}


def r(x: float) -> float:
    return round(float(x), 4)


def summarize(model: Model, state: State) -> dict:
    """Exam-weighted level and per-topic levels, each as [mean, sd]."""
    x, P = state.x[:K], state.P[:K, :K]
    return {
        "exam": [r(EXAM_WEIGHTS @ x), r(math.sqrt(EXAM_WEIGHTS @ P @ EXAM_WEIGHTS))],
        "topics": [[r(x[i]), r(math.sqrt(P[i, i]))] for i in range(K)],
    }


def fan(model: Model, state: State, t0: float) -> list[dict]:
    times = [t0, *[d for d in range(math.floor(t0) + 1, EXAM_DAY)], EXAM_DAY]
    return [{"t": r(t), **summarize(model, model.predict(state, t))} for t in times]


def trace_learner(model: Model, learner) -> dict:
    obs = learner.obs
    state = model.prior(0.0)
    steps = [
        {"t": 0.0, "obs": None, "post": summarize(model, state), "fan": fan(model, state, 0.0)}
    ]
    history = [{"t": 0.0, "step": 0, **summarize(model, state)}]

    for k, o in enumerate(obs, start=1):
        prev_t = state.t
        # Drift between data points (a few interpolated points for a smooth line).
        for t in np.linspace(prev_t, o.t, 5)[1:-1] if o.t > prev_t else []:
            history.append({"t": r(t), "step": k - 1, **summarize(model, model.predict(state, t))})
        state = model.predict(state, o.t)
        pre = summarize(model, state)
        history.append({"t": r(o.t), "step": k - 1, **pre})
        before = summarize(model, model.predict(state, EXAM_DAY))

        state, diag = model.update(state, o)
        post = summarize(model, state)
        history.append({"t": r(o.t), "step": k, **post})
        after = summarize(model, model.predict(state, EXAM_DAY))
        total = sum(o.weights.values())
        steps.append({
            "t": r(o.t),
            "obs": {
                "type": o.type_id,
                "score": r(o.score),
                "points": int(o.n_points),
                "weights": {tid: r(w / total) for tid, w in o.weights.items()},
                "predicted": r(diag.predicted),
                "predictedSd": r(math.sqrt(diag.S)),
                # Measurement noise alone: how precisely this score measures ability.
                "noiseSd": r(math.sqrt(model.noise(o.type_id, diag.predicted, o.n_points))),
                "z": r(diag.z),
            },
            "pre": pre,
            "post": post,
            "forecastBefore": before["exam"],
            "forecastAfter": after["exam"],
            "fan": fan(model, state, o.t),
        })  # fmt: skip

    grid = np.arange(0, EXAM_DAY + 0.01, 0.5)
    truth = [
        {"t": r(t), "exam": r(EXAM_WEIGHTS @ learner.truth.level(t)),
         "topics": [r(v) for v in learner.truth.level(t)]}
        for t in grid
    ]  # fmt: skip
    return {
        "bias": {k: r(v) for k, v in learner.truth.bias.items()},
        "steps": steps,
        "history": history,
        "truth": truth,
    }


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m bench.trace")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--learner-seed", type=int, default=1)
    p.add_argument("--candidates", type=int, default=15, help="learners drawn per archetype")
    p.add_argument("--train", type=int, default=60)
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    rng = np.random.default_rng(args.seed)
    archetypes = list(ARCHETYPES)
    train = [simulate(rng, archetypes[i % len(archetypes)], "rich") for i in range(args.train)]
    fit = fit_map(TOPICS, TYPE_PRIORS, DEFAULT_PARAMS, [lr.obs for lr in train])
    model = model_from_fit(fit)

    # Show a typical learner, not a lucky or unlucky one: of `candidates` random
    # learners per archetype, the one with the median final forecast error.
    learners = []
    lrng = np.random.default_rng(args.learner_seed)
    for archetype, story in SHOWCASE.items():
        pool = [simulate(lrng, archetype, "rich") for _ in range(args.candidates)]

        def final_error(lr):
            state = model.run(lr.obs, until=EXAM_DAY).state
            return abs(EXAM_WEIGHTS @ (state.x[:K] - lr.truth.level(EXAM_DAY)))

        median = sorted(pool, key=final_error)[len(pool) // 2]
        learners.append({"archetype": archetype, "story": story, **trace_learner(model, median)})

    data = {
        "examDay": EXAM_DAY,
        "topics": [{"id": t.id, "group": t.parent_id} for t in TOPICS],
        "examWeights": [r(w) for w in EXAM_WEIGHTS],
        "points": N_POINTS,
        "model": {
            "c": {k: r(v.value) for k, v in fit.c.items()},
            "bias": {k: r(v.value) for k, v in fit.bias.items()},
            "halfLifeDays": r(model.params.half_life_days),
            "qSlope": model.params.q_slope,
        },
        "candidates": args.candidates,
        "learners": learners,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, separators=(",", ":"))
    (args.out / "trace.json").write_text(payload)
    page = TEMPLATE.read_text().replace("/*__DATA__*/null", payload)
    (args.out / "forecast.html").write_text(
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"</head><body>\n{page}\n</body></html>\n"
    )
    print(f"Wrote {args.out}/trace.json ({len(payload) // 1024} KB) and forecast.html")
    assert TOPIC_IDS  # topic order in the page matches TOPICS


if __name__ == "__main__":
    main()
