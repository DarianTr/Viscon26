"""Testbench: simulate many kinds of learners, run every estimator, report.

    uv run python -m bench                      # full run, writes bench/out/report.md
    uv run python -m bench --quick              # small smoke run
    uv run python -m bench --schedules rich --archetypes crammer forgetter

Per schedule, a MAP fit is trained on a mixed population of all archetypes,
then each estimator is scored on fresh learners of each archetype at several
checkpoints:

- exam RMSE: error of the forecast exam score (true ability on exam day), in points;
- cov90: how often the 90% interval contains the truth (should be ~90%);
- topic RMSE: error of today's per-topic levels, in points;
- weakest: how often the estimated weakest topic is the true weakest one
  (what a scheduler would act on).
"""

from __future__ import annotations

import argparse
import json
import math
import time
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from pathlib import Path

import numpy as np

from .evaluate import CHECKPOINTS, VARIANTS, ScheduleResult, run_schedule
from .truth import ARCHETYPES, POPULATION_BIAS, TRUE_C

OUT = Path(__file__).parent / "out"


def fmt(x: float, pct: bool = False) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    return f"{100 * x:.0f}%" if pct else f"{x:.1f}"


def pooled(res: ScheduleResult, variant: str, cp: int) -> dict:
    """Summary over all archetypes, each weighted equally."""
    rows = [c.summary() for (a, v, p), c in res.cells.items() if v == variant and p == cp]
    keys = ("exam_rmse", "exam_cov90", "topic_rmse", "topic_cov90", "weakest_hit")
    out = {}
    for k in keys:
        vals = [r[k] for r in rows if not math.isnan(r[k])]
        if not vals:
            out[k] = math.nan
        elif k.endswith("rmse"):
            out[k] = float(np.sqrt(np.mean(np.square(vals))))
        else:
            out[k] = float(np.mean(vals))
    return out


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def report(results: list[ScheduleResult], archetypes: list[str], args) -> str:
    cps = "/".join(str(c) for c in CHECKPOINTS)
    last = CHECKPOINTS[-1]
    parts = [
        "# Knowledge model testbench",
        "",
        f"{args.train} training learners (mixed archetypes) and {args.learners} test learners "
        f"per archetype, per schedule; seed {args.seed}. Checkpoints on days {cps}, exam on "
        f"day 45. Errors are in points (0–100).",
        "",
        "## Summary: every estimator, pooled over archetypes",
    ]
    for res in results:
        rows = []
        for v in VARIANTS:
            per_cp = [pooled(res, v, cp) for cp in CHECKPOINTS]
            rows.append([
                f"**{v}**" if v == "fitted" else v,
                " / ".join(fmt(p["exam_rmse"]) for p in per_cp),
                fmt(per_cp[-1]["exam_cov90"], True),
                fmt(per_cp[-1]["topic_rmse"]),
                fmt(per_cp[-1]["topic_cov90"], True),
                fmt(per_cp[-1]["weakest_hit"], True),
            ])  # fmt: skip
        parts += [
            "", f"### Schedule `{res.schedule}`", "",
            table(["estimator", f"exam RMSE @ {cps}", f"exam cov90 @ {last}",
                   f"topic RMSE @ {last}", f"topic cov90 @ {last}", f"weakest @ {last}"], rows),
        ]  # fmt: skip

    parts += ["", "## Fitted model per archetype"]
    for res in results:
        rows = []
        for a in archetypes:
            s = [res.cells[(a, "fitted", cp)].summary() for cp in CHECKPOINTS]
            best_other = min(
                (res.cells[(a, v, last)].summary()["exam_rmse"], v)
                for v in VARIANTS if v != "fitted"
            )  # fmt: skip
            rows.append([
                a,
                " / ".join(fmt(x["exam_rmse"]) for x in s),
                f"{s[-1]['exam_bias']:+.1f}",
                fmt(s[-1]["exam_cov90"], True),
                fmt(s[-1]["topic_rmse"]),
                fmt(s[-1]["topic_cov90"], True),
                fmt(s[-1]["weakest_hit"], True),
                f"{best_other[1]} {fmt(best_other[0])}",
            ])  # fmt: skip
        parts += [
            "", f"### Schedule `{res.schedule}`", "",
            table(["archetype", f"exam RMSE @ {cps}", "exam bias", "cov90", "topic RMSE",
                   "topic cov90", "weakest", f"best other @ {last}"], rows),
        ]  # fmt: skip

    parts += ["", "## Fit vs truth", ""]
    rows = []
    for res in results:
        f = res.fit

        def est(e, scale=1.0):
            if e is None:
                return "–"
            sd = "" if e.sd is None else f" ± {e.sd * scale:.2g}"
            return f"{e.value * scale:.3g}{sd}" + (" (prior)" if e.prior_only else "")

        rows.append([
            res.schedule,
            est(f.c["practice"]), est(f.c["quiz"]), est(f.c["mock"]),
            est(f.bias.get("practice"), 100), est(f.bias.get("quiz"), 100),
            est(f.half_life_days), "yes" if f.starts_agree else "**no**",
            f"{res.seconds_fit:.1f}s",
        ])  # fmt: skip
    truth = [
        "*truth*", f"{TRUE_C['practice']}", f"{TRUE_C['quiz']}", f"{TRUE_C['mock']}",
        f"{100 * POPULATION_BIAS['practice']:.0f}", f"{100 * POPULATION_BIAS['quiz']:.0f}",
        "no single value", "", "",
    ]  # fmt: skip
    parts.append(
        table(["schedule", "c practice", "c quiz", "c mock", "bias practice (pts)",
               "bias quiz (pts)", "half-life (days)", "starts agree", "fit time"],
              [truth, *rows])
    )  # fmt: skip

    parts += [
        "", "## Calibration of the fitted model",
        "",
        "Normalised innovations at the last checkpoint: mean should be ≈ 0, sd ≈ 1.",
        "",
    ]  # fmt: skip
    rows = []
    for res in results:
        for tid, z in sorted(res.z.items()):
            rows.append([res.schedule, tid, str(len(z)), f"{np.mean(z):+.2f}", f"{np.std(z):.2f}"])
    parts.append(table(["schedule", "type", "n", "z mean", "z sd"], rows))
    return "\n".join(parts) + "\n"


def to_json(results: list[ScheduleResult]) -> dict:
    return {
        res.schedule: {
            "fit": {
                "c": {k: vars(v) for k, v in res.fit.c.items()},
                "bias": {k: vars(v) for k, v in res.fit.bias.items()},
                "half_life_days": vars(res.fit.half_life_days),
                "slope_prior_mean": vars(res.fit.slope_prior_mean),
                "starts_agree": res.fit.starts_agree,
            },
            "cells": [
                {"archetype": a, "estimator": v, "day": cp, **c.summary()}
                for (a, v, cp), c in sorted(res.cells.items())
            ],
        }
        for res in results
    }


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m bench", description=__doc__.split("\n")[0])
    p.add_argument("--schedules", nargs="+", default=["rich", "sparse", "no_mocks", "mixed_only"])
    p.add_argument("--archetypes", nargs="+", default=list(ARCHETYPES))
    p.add_argument("--learners", type=int, default=40, help="test learners per archetype")
    p.add_argument("--train", type=int, default=60, help="training learners for the fit")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--quick", action="store_true", help="8 test / 20 training learners")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()
    if args.quick:
        args.learners, args.train = 8, 20

    t0 = time.perf_counter()
    run = partial(
        run_schedule,
        archetypes=args.archetypes, n_train=args.train, n_eval=args.learners, seed=args.seed,
    )  # fmt: skip
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(run, args.schedules))

    text = report(results, args.archetypes, args)
    print(text)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.md").write_text(text)
    (args.out / "results.json").write_text(json.dumps(to_json(results), indent=1))
    print(f"Wrote {args.out}/report.md and results.json in {time.perf_counter() - t0:.0f}s")


if __name__ == "__main__":
    main()
