"""MAP estimates of the measurement model, pooled over all learners in a plan.

The Kalman filter gives the marginal likelihood of each learner's scores for
free (prediction-error decomposition), so the posterior over the few shared
parameters can be optimised directly, with no EM:

- per assessment type: log c (overdispersion) and, unless fixed, the
  population bias;
- per plan: the mean starting slope, and optionally the log half-life.

The likelihood only scores one-step-ahead predictions, so it can't judge the
settings that shape long-range forecasts. Process noise and, by default, the
half-life therefore stay fixed; tune them by held-out forecast accuracy
(`python -m bench.sweep`). Fitting the half-life collapses it towards a few
days once slopes are allowed to wander, which ruins early exam forecasts.
Priors keep every scale away from zero, where plain maximum likelihood tends
to collapse with little data.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace

import numpy as np
from scipy.optimize import minimize

from .model import AssessmentType, Model, Observation, PlanParams, Topic


@dataclass(frozen=True)
class TypePrior:
    id: str
    c_prior: float
    bias_prior: float = 0.0
    bias_fixed: bool = False
    tau2: float = 1e-4


@dataclass(frozen=True)
class Priors:
    c_log_sd: float = 0.5
    bias_sd: float = 0.05
    half_life_log_sd: float = 0.7
    #: Off by default: see the module docstring.
    fit_half_life: bool = False
    #: A type (or the trend) needs this many observations before it is fitted.
    min_obs: int = 5


@dataclass(frozen=True)
class Estimate:
    value: float
    #: Laplace approximation; None if the curvature could not be estimated.
    sd: float | None
    prior_only: bool


@dataclass
class FitResult:
    c: dict[str, Estimate] = field(default_factory=dict)
    bias: dict[str, Estimate] = field(default_factory=dict)
    half_life_days: Estimate | None = None
    slope_prior_mean: Estimate | None = None
    n_observations: int = 0
    n_learners: int = 0
    #: Negative log posterior at the optimum.
    objective: float | None = None
    converged: bool = True
    #: Whether all optimiser starts reached the same optimum.
    starts_agree: bool = True
    message: str = ""


@dataclass(frozen=True)
class _Param:
    kind: str  # "c" | "bias" | "half_life" | "slope"
    type_id: str | None
    mu: float  # prior mean, in the optimised (transformed) space
    sd: float
    lo: float
    hi: float


def fit_map(
    topics: Sequence[Topic],
    type_priors: Sequence[TypePrior],
    params: PlanParams,
    learners: Sequence[Sequence[Observation]],
    priors: Priors | None = None,
) -> FitResult:
    priors = priors or Priors()
    learners = [list(obs) for obs in learners if obs]
    counts = Counter(o.type_id for obs in learners for o in obs)
    n_obs = sum(counts.values())
    result = FitResult(n_observations=n_obs, n_learners=len(learners))

    spec: list[_Param] = []
    for tp in type_priors:
        if counts[tp.id] < priors.min_obs:
            continue
        spec.append(
            _Param("c", tp.id, math.log(tp.c_prior), priors.c_log_sd, math.log(0.05), math.log(50))
        )
        if not tp.bias_fixed:
            spec.append(_Param("bias", tp.id, tp.bias_prior, priors.bias_sd, -0.4, 0.4))
    fit_trend = n_obs >= 2 * priors.min_obs
    if fit_trend and priors.fit_half_life and math.isfinite(params.half_life_days):
        spec.append(
            _Param(
                "half_life",
                None,
                math.log(params.half_life_days),
                priors.half_life_log_sd,
                0.0,
                math.log(730),
            )
        )
    if fit_trend:
        spec.append(
            _Param(
                "slope",
                None,
                params.slope_prior_mean,
                max(params.slope_prior_sd, 1e-4),
                -0.05,
                0.05,
            )
        )

    def build(theta: np.ndarray) -> Model:
        c = {tp.id: tp.c_prior for tp in type_priors}
        bias = {tp.id: tp.bias_prior for tp in type_priors}
        p = params
        for v, s in zip(theta, spec, strict=True):
            if s.kind == "c":
                c[s.type_id] = math.exp(v)
            elif s.kind == "bias":
                bias[s.type_id] = v
            elif s.kind == "half_life":
                p = replace(p, half_life_days=math.exp(v))
            else:
                p = replace(p, slope_prior_mean=v)
        types = [
            AssessmentType(tp.id, c[tp.id], tp.tau2, bias[tp.id], tp.bias_fixed)
            for tp in type_priors
        ]
        return Model(topics, types, p)

    mu = np.array([s.mu for s in spec])
    sd = np.array([s.sd for s in spec])

    # The batch depends only on model structure, which no parameter changes.
    batch = build(mu).prepare(learners)

    def objective(theta: np.ndarray) -> float:
        ll = build(theta).loglik(batch)
        log_prior = -0.5 * np.sum(((theta - mu) / sd) ** 2)
        return -(ll + log_prior)

    # Report priors for everything that is not fitted.
    def fill(theta: np.ndarray, sds: np.ndarray | None) -> None:
        fitted = {(s.kind, s.type_id): i for i, s in enumerate(spec)}
        for tp in type_priors:
            i = fitted.get(("c", tp.id))
            if i is None:
                result.c[tp.id] = Estimate(tp.c_prior, None, True)
            else:
                v = math.exp(theta[i])
                result.c[tp.id] = Estimate(v, _scaled(sds, i, v), False)
            if tp.bias_fixed:
                continue
            i = fitted.get(("bias", tp.id))
            if i is None:
                result.bias[tp.id] = Estimate(tp.bias_prior, None, True)
            else:
                result.bias[tp.id] = Estimate(float(theta[i]), _sd(sds, i), False)
        i = fitted.get(("half_life", None))
        if i is None:
            result.half_life_days = Estimate(params.half_life_days, None, True)
        else:
            v = math.exp(theta[i])
            result.half_life_days = Estimate(v, _scaled(sds, i, v), False)
        i = fitted.get(("slope", None))
        if i is None:
            result.slope_prior_mean = Estimate(params.slope_prior_mean, None, True)
        else:
            result.slope_prior_mean = Estimate(float(theta[i]), _sd(sds, i), False)

    if not spec:
        result.message = "Not enough observations to fit anything; priors kept."
        fill(mu, None)
        return result

    # Optimise in prior-standardised units z = (θ − μ)/sd: parameters live on
    # very different scales (log c ~ 1, slope ~ 0.003), which otherwise ruins
    # the finite-difference gradients and Hessian.
    z_bounds = [((s.lo - s.mu) / s.sd, (s.hi - s.mu) / s.sd) for s in spec]

    def objective_z(z: np.ndarray) -> float:
        return objective(mu + sd * z)

    n = len(spec)
    starts = [np.zeros(n), np.full(n, 0.7), np.full(n, -0.7)]
    lo, hi = np.array(z_bounds).T
    starts = [np.clip(z0, lo, hi) for z0 in starts]
    runs = [minimize(objective_z, z0, method="L-BFGS-B", bounds=z_bounds) for z0 in starts]
    runs.sort(key=lambda r: r.fun)
    best = runs[0]

    result.objective = float(best.fun)
    result.converged = bool(best.success)
    # Starts may stop at slightly different points along flat directions;
    # different optima would differ in objective or lie far apart.
    result.starts_agree = all(
        abs(r.fun - best.fun) < 0.5 and np.max(np.abs(r.x - best.x)) < 1.0 for r in runs
    )
    result.message = str(best.message)
    z_sd = _laplace_sd(objective_z, best.x, z_bounds)
    fill(mu + sd * best.x, None if z_sd is None else sd * z_sd)
    return result


def _sd(sds: np.ndarray | None, i: int) -> float | None:
    if sds is None or not math.isfinite(sds[i]):
        return None
    return float(sds[i])


def _scaled(sds: np.ndarray | None, i: int, value: float) -> float | None:
    """sd of exp(θ) by the delta method."""
    s = _sd(sds, i)
    return None if s is None else s * value


def _laplace_sd(
    f: Callable[[np.ndarray], float],
    x: np.ndarray,
    bounds: Sequence[tuple[float, float]],
    step: float = 1e-2,
) -> np.ndarray | None:
    """Marginal sds from the inverse of a central finite-difference Hessian."""
    n = len(x)
    # Step inwards from a bound rather than across it.
    lo, hi = np.array(bounds).T
    x = np.clip(x, lo + 2 * step, hi - 2 * step)
    f0 = f(x)
    e = np.eye(n) * step
    fp = np.array([f(x + e[i]) for i in range(n)])
    fm = np.array([f(x - e[i]) for i in range(n)])
    H = np.empty((n, n))
    for i in range(n):
        H[i, i] = (fp[i] - 2 * f0 + fm[i]) / step**2
        for j in range(i + 1, n):
            v = (
                f(x + e[i] + e[j]) - f(x + e[i] - e[j]) - f(x - e[i] + e[j]) + f(x - e[i] - e[j])
            ) / (4 * step**2)
            H[i, j] = H[j, i] = v
    try:
        cov = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return None
    var = np.diag(cov)
    return np.where(var > 0, np.sqrt(np.abs(var)), np.nan)
