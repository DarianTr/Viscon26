"""Sweep process-noise settings and see what they do to forecasts.

    uv run python -m bench.sweep                     # q_slope grid on `rich`
    uv run python -m bench.sweep --schedule sparse --q-level 1e-4 4e-4
    uv run python -m bench.sweep --half-life 10 --fit-half-life

The fit can't choose these: its likelihood only scores one-step-ahead
predictions. This picks them by held-out exam-forecast accuracy and coverage.
The chosen defaults (q_slope 3e-6, half-life 20 days, not fitted) came from here.
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


def run_one(q, *, schedule, n_train, n_eval, seed, half_life, fit_half_life):
    q_level, q_slope = q
    params = replace(DEFAULT_PARAMS, q_level=q_level, q_slope=q_slope, half_life_days=half_life)
    priors = Priors(fit_half_life=fit_half_life)
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
    p.add_argument("--half-life", type=float, default=DEFAULT_PARAMS.half_life_days)
    p.add_argument("--fit-half-life", action="store_true", help="MAP-fit it (prior: --half-life)")
    args = p.parse_args()

    grid = list(itertools.product(args.q_level, args.q_slope))
    run = partial(run_one, schedule=args.schedule, n_train=args.train,
                  n_eval=args.learners, seed=args.seed,
                  half_life=args.half_life, fit_half_life=args.fit_half_life)  # fmt: skip
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
