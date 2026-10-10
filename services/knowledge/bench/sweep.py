"""Sweep process-noise settings and see what they do to forecasts.

    uv run python -m bench.sweep                     # q_slope grid on `rich`
    uv run python -m bench.sweep --schedule sparse --q-level 1e-4 4e-4

The fit can't choose these: its likelihood only scores one-step-ahead
predictions. This picks them by held-out exam-forecast accuracy and coverage.
"""

from __future__ import annotations

import argparse
import itertools
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from functools import partial

from knowledge.fit import Priors

from .__main__ import fmt, pooled, table
from .evaluate import CHECKPOINTS, DEFAULT_PARAMS, run_schedule
from .truth import ARCHETYPES

WATCH = ("steady", "crammer", "forgetter", "fast_plateau", "stalled")


def run_one(q, *, schedule, n_train, n_eval, seed, half_life=None):
    q_level, q_slope = q
    params = replace(DEFAULT_PARAMS, q_level=q_level, q_slope=q_slope)
    priors = None
    if half_life is not None:  # a near-zero prior sd pins the half-life
        params = replace(params, half_life_days=half_life)
        priors = Priors(half_life_log_sd=1e-3)
    return q, run_schedule(
        schedule, archetypes=list(ARCHETYPES), n_train=n_train, n_eval=n_eval,
        seed=seed, params=params, priors=priors,
    )  # fmt: skip


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m bench.sweep")
    p.add_argument("--schedule", default="rich")
    p.add_argument("--q-level", type=float, nargs="+", default=[DEFAULT_PARAMS.q_level])
    p.add_argument("--q-slope", type=float, nargs="+",
                   default=[1e-7, 1e-6, 3e-6, 1e-5, 3e-5, 1e-4])  # fmt: skip
    p.add_argument("--learners", type=int, default=40)
    p.add_argument("--train", type=int, default=60)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--pin-half-life", type=float, help="fix the half-life instead of fitting it")
    args = p.parse_args()

    grid = list(itertools.product(args.q_level, args.q_slope))
    run = partial(run_one, schedule=args.schedule, n_train=args.train,
                  n_eval=args.learners, seed=args.seed,
                  half_life=args.pin_half_life)  # fmt: skip
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(run, grid))

    last = CHECKPOINTS[-1]
    cps = "/".join(map(str, CHECKPOINTS))
    rows = []
    for (q_level, q_slope), res in results:
        per_cp = [pooled(res, "fitted", cp) for cp in CHECKPOINTS]
        cov = {a: res.cells[(a, "fitted", last)].summary()["exam_cov90"] for a in WATCH}
        rows.append([
            f"{q_level:g}", f"{q_slope:g}",
            " / ".join(fmt(x["exam_rmse"]) for x in per_cp),
            " / ".join(fmt(x["exam_cov90"], True) for x in per_cp),
            fmt(per_cp[-1]["topic_rmse"]), fmt(per_cp[-1]["topic_cov90"], True),
            *(fmt(cov[a], True) for a in WATCH),
            f"{res.fit.half_life_days.value:.0f}",
        ])  # fmt: skip
    print(f"Schedule `{args.schedule}`, fitted model, {args.learners} test learners per archetype.")
    print()
    print(table(
        ["q_level", "q_slope", f"exam RMSE @ {cps}", f"exam cov90 @ {cps}",
         f"topic RMSE @ {last}", f"topic cov90 @ {last}",
         *(f"cov90 {a}" for a in WATCH), "fitted half-life"],
        rows,
    ))  # fmt: skip


if __name__ == "__main__":
    main()
