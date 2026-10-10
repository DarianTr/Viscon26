"""Multivariate damped-trend Kalman filter over mixed-topic assessments.

Pure math, no I/O. Scores and abilities are fractions correct (0..1); time is
in days.

State x = [levels (K), slopes (K), learner biases (M)]:

- level ℓ_k: ability on topic k.
- slope s_k: current learning rate on topic k. It decays with a half-life, so
  fast early gains level off instead of being extrapolated forever.
- bias b_j: this learner's offset on assessment type j (e.g. practice sheets
  done with notes). Only types whose bias is not fixed get one; fixed types
  (mocks, exams) are the anchors that make the biases identifiable.

An observation of type j with topic weights h (summing to 1) measures
    y = hᵀℓ + b_j + ε,   ε ~ N(0, c_j·p(1−p)/n + τ²_j),
so a score from few points is noisier than one from many, and c_j is the
overdispersion on top of the binomial floor.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import numpy as np

LOG_2PI = math.log(2 * math.pi)
P_CLIP = (0.05, 0.95)


@dataclass(frozen=True)
class Topic:
    id: str
    parent_id: str | None = None
    prior_mean: float = 0.5
    prior_sd: float = 0.2


@dataclass(frozen=True)
class AssessmentType:
    id: str
    #: Overdispersion multiplier on the binomial variance.
    c: float = 1.5
    #: Variance floor, e.g. day-to-day form.
    tau2: float = 1e-4
    #: Population-average score offset versus true ability.
    bias: float = 0.0
    #: Fixed types are anchors: no per-learner bias state.
    bias_fixed: bool = False


@dataclass(frozen=True)
class PlanParams:
    #: Half-life of the learning slope; math.inf gives a straight-line trend.
    half_life_days: float = 20.0
    slope_prior_mean: float = 0.005
    slope_prior_sd: float = 0.005
    q_level: float = 1e-4
    #: Lets the learning rate wander (surges, declines); tuned with bench.sweep.
    q_slope: float = 3e-6
    learner_bias_sd: float = 0.04
    rho_sibling: float = 0.5
    rho_global: float = 0.15


@dataclass(frozen=True)
class Observation:
    #: Days since some fixed origin; only differences matter.
    t: float
    type_id: str
    score: float
    n_points: float
    weights: Mapping[str, float]
    id: str | None = None


@dataclass
class State:
    x: np.ndarray
    P: np.ndarray
    t: float | None = None


@dataclass(frozen=True)
class ObsDiagnostic:
    id: str | None
    t: float
    type_id: str
    predicted: float
    #: Predictive variance of y (state uncertainty plus measurement noise).
    S: float
    innovation: float
    #: Normalised innovation; ~N(0, 1) when the model is calibrated.
    z: float
    loglik: float


@dataclass
class FilterResult:
    state: State
    diagnostics: list[ObsDiagnostic] = field(default_factory=list)
    #: Observations skipped because none of their topics are known.
    skipped: list[str | None] = field(default_factory=list)

    @property
    def loglik(self) -> float:
        return sum(d.loglik for d in self.diagnostics)


@dataclass
class Batch:
    """Several learners' observations, padded to the same length."""

    type_ids: list[str]
    t: np.ndarray  # (B, L) days
    H: np.ndarray  # (B, L, n) design rows
    type_idx: np.ndarray  # (B, L) index into type_ids
    n_points: np.ndarray  # (B, L)
    y: np.ndarray  # (B, L) scores
    mask: np.ndarray  # (B, L) real observation vs padding


def _nearest_psd(A: np.ndarray, floor: float = 1e-10) -> np.ndarray:
    A = (A + A.T) / 2
    w, V = np.linalg.eigh(A)
    if w.min() >= floor:
        return A
    return (V * np.maximum(w, floor)) @ V.T


class Model:
    """A filter configured for one plan's topics, assessment types and params."""

    def __init__(
        self,
        topics: Sequence[Topic],
        types: Sequence[AssessmentType],
        params: PlanParams,
    ):
        if not topics:
            raise ValueError("A model needs at least one topic")
        self.topics = list(topics)
        self.types = {t.id: t for t in types}
        self.params = params

        self.K = len(self.topics)
        self.topic_index = {t.id: i for i, t in enumerate(self.topics)}
        self.bias_types = [t.id for t in types if not t.bias_fixed]
        self.bias_index = {tid: 2 * self.K + i for i, tid in enumerate(self.bias_types)}
        self.n = 2 * self.K + len(self.bias_types)

        self.R = self._correlation()

    # --- Setup ---------------------------------------------------------------

    def _correlation(self) -> np.ndarray:
        """Prior correlation between topics: siblings move together more."""
        p = self.params
        R = np.full((self.K, self.K), p.rho_global)
        for i, a in enumerate(self.topics):
            for j, b in enumerate(self.topics):
                if i == j:
                    R[i, j] = 1.0
                elif (a.parent_id is not None and a.parent_id == b.parent_id) or (
                    a.id == b.parent_id or b.id == a.parent_id
                ):
                    R[i, j] = p.rho_sibling
        return _nearest_psd(R)

    def prior(self, t: float | None = None) -> State:
        K, p = self.K, self.params
        x = np.zeros(self.n)
        P = np.zeros((self.n, self.n))

        mean = np.array([tp.prior_mean for tp in self.topics])
        sd = np.array([tp.prior_sd for tp in self.topics])
        x[:K] = mean
        P[:K, :K] = np.outer(sd, sd) * self.R

        x[K : 2 * K] = p.slope_prior_mean
        P[K : 2 * K, K : 2 * K] = p.slope_prior_sd**2 * self.R

        for tid, i in self.bias_index.items():
            x[i] = self.types[tid].bias
            P[i, i] = p.learner_bias_sd**2

        return State(x, _nearest_psd(P), t)

    # --- Time update ---------------------------------------------------------

    def _decay(self, dt: float) -> tuple[float, float]:
        """(level gain per unit slope, slope multiplier) over dt days."""
        h = self.params.half_life_days
        if not math.isfinite(h):
            return dt, 1.0
        tau = h / math.log(2)
        d = math.exp(-dt / tau)
        return tau * (1 - d), d

    def predict(self, state: State, t: float) -> State:
        if state.t is None:
            return State(state.x.copy(), state.P.copy(), t)
        dt = t - state.t
        if dt < 0:
            raise ValueError("Observations must be in time order")
        if dt == 0:
            return State(state.x.copy(), state.P.copy(), t)

        K, p = self.K, self.params
        gain, d = self._decay(dt)
        F = np.eye(self.n)
        F[:K, K : 2 * K] = gain * np.eye(K)
        F[K : 2 * K, K : 2 * K] = d * np.eye(K)

        Q = np.zeros((self.n, self.n))
        Q[:K, :K] = p.q_level * dt * self.R
        Q[K : 2 * K, K : 2 * K] = p.q_slope * dt * self.R

        x = F @ state.x
        P = F @ state.P @ F.T + Q
        return State(x, (P + P.T) / 2, t)

    # --- Measurement update --------------------------------------------------

    def design(self, obs: Observation) -> tuple[np.ndarray, float] | None:
        """Row H and constant offset with ŷ = Hx + offset, or None if no topic is known."""
        H = np.zeros(self.n)
        for topic_id, w in obs.weights.items():
            i = self.topic_index.get(topic_id)
            if i is not None and w > 0:
                H[i] += w
        total = H[: self.K].sum()
        if total <= 0:
            return None
        H[: self.K] /= total

        atype = self.types[obs.type_id]
        if obs.type_id in self.bias_index:
            H[self.bias_index[obs.type_id]] = 1.0
            return H, 0.0
        return H, atype.bias

    def noise(self, type_id: str, predicted: float, n_points: float) -> float:
        atype = self.types[type_id]
        p = min(max(predicted, P_CLIP[0]), P_CLIP[1])
        return atype.c * p * (1 - p) / n_points + atype.tau2

    def update(self, state: State, obs: Observation) -> tuple[State, ObsDiagnostic] | None:
        row = self.design(obs)
        if row is None:
            return None
        H, offset = row

        y_pred = float(H @ state.x + offset)
        r = self.noise(obs.type_id, y_pred, obs.n_points)
        PH = state.P @ H
        S = float(H @ PH + r)
        Kg = PH / S
        innov = obs.score - y_pred

        x = state.x + Kg * innov
        # Joseph form keeps P symmetric positive semi-definite.
        A = np.eye(self.n) - np.outer(Kg, H)
        P = A @ state.P @ A.T + r * np.outer(Kg, Kg)

        diag = ObsDiagnostic(
            id=obs.id,
            t=obs.t,
            type_id=obs.type_id,
            predicted=y_pred,
            S=S,
            innovation=innov,
            z=innov / math.sqrt(S),
            loglik=-0.5 * (LOG_2PI + math.log(S) + innov * innov / S),
        )
        return State(x, (P + P.T) / 2, state.t), diag

    # --- Whole history -------------------------------------------------------

    def run(self, observations: Sequence[Observation], until: float | None = None) -> FilterResult:
        """Filter a learner's observations in time order, optionally predicting on to `until`.

        The prior applies at the first observation (or at `until` if there are none).
        """
        obs = sorted(observations, key=lambda o: o.t)
        if until is not None:
            obs = [o for o in obs if o.t <= until]

        state = self.prior()
        result = FilterResult(state)
        for o in obs:
            state = self.predict(state, o.t)
            out = self.update(state, o)
            if out is None:
                result.skipped.append(o.id)
                continue
            state, diag = out
            result.diagnostics.append(diag)

        if until is not None:
            state = self.predict(state, until)
        result.state = state
        return result

    # --- Many learners at once (for fitting) ---------------------------------

    def prepare(self, learners: Sequence[Sequence[Observation]]) -> Batch:
        """Pack learners' observations into padded arrays for `loglik`.

        Depends only on the model's structure (topics, which types carry a
        learner bias), so a batch can be reused across parameter values.
        """
        type_ids = list(self.types)
        type_pos = {tid: i for i, tid in enumerate(type_ids)}
        rows = []
        for obs in learners:
            packed = []
            for o in sorted(obs, key=lambda o: o.t):
                row = self.design(o)
                if row is not None:
                    packed.append((o.t, row[0], type_pos[o.type_id], o.n_points, o.score))
            rows.append(packed)

        B, L = len(rows), max((len(r) for r in rows), default=0)
        batch = Batch(
            type_ids=type_ids,
            t=np.zeros((B, L)),
            H=np.zeros((B, L, self.n)),
            type_idx=np.zeros((B, L), dtype=int),
            n_points=np.ones((B, L)),
            y=np.zeros((B, L)),
            mask=np.zeros((B, L), dtype=bool),
        )
        for b, packed in enumerate(rows):
            for k, (t, H, ti, n, y) in enumerate(packed):
                batch.t[b, k], batch.H[b, k], batch.type_idx[b, k] = t, H, ti
                batch.n_points[b, k], batch.y[b, k], batch.mask[b, k] = n, y, True
            if packed:  # padding keeps the last time, so dt = 0
                batch.t[b, len(packed) :] = packed[-1][0]
        return batch

    def loglik(self, batch: Batch) -> float:
        """Total log-likelihood of a prepared batch, filtering all learners in lockstep.

        Equals the sum of `run(obs).loglik` over the learners.
        """
        B, L = batch.mask.shape
        if B == 0 or L == 0:
            return 0.0
        K, p = self.K, self.params
        types = [self.types[tid] for tid in batch.type_ids]
        c = np.array([t.c for t in types])[batch.type_idx]
        tau2 = np.array([t.tau2 for t in types])[batch.type_idx]
        offset = np.array([0.0 if t.id in self.bias_index else t.bias for t in types])[
            batch.type_idx
        ]

        prior = self.prior()
        x = np.broadcast_to(prior.x, (B, self.n)).copy()
        P = np.broadcast_to(prior.P, (B, self.n, self.n)).copy()
        QL = np.zeros((self.n, self.n))
        QL[:K, :K] = p.q_level * self.R
        QL[K : 2 * K, K : 2 * K] = p.q_slope * self.R

        h = p.half_life_days
        tau = h / math.log(2) if math.isfinite(h) else math.inf
        F = np.broadcast_to(np.eye(self.n), (B, self.n, self.n)).copy()
        lv, sl = np.arange(K), np.arange(K, 2 * K)

        total = 0.0
        for k in range(L):
            if k > 0:
                dt = batch.t[:, k] - batch.t[:, k - 1]
                if math.isfinite(tau):
                    d = np.exp(-dt / tau)
                    gain = tau * (1 - d)
                else:
                    d, gain = np.ones(B), dt
                x[:, :K] += gain[:, None] * x[:, K : 2 * K]
                x[:, K : 2 * K] *= d[:, None]
                F[:, lv, sl] = gain[:, None]
                F[:, sl, sl] = d[:, None]
                P = F @ P @ F.transpose(0, 2, 1) + dt[:, None, None] * QL

            m = batch.mask[:, k]
            H = batch.H[:, k]
            y_pred = np.einsum("bi,bi->b", H, x) + offset[:, k]
            pc = np.clip(y_pred, *P_CLIP)
            r = c[:, k] * pc * (1 - pc) / batch.n_points[:, k] + tau2[:, k]
            PH = np.einsum("bij,bj->bi", P, H)
            S = np.einsum("bi,bi->b", H, PH) + r
            innov = np.where(m, batch.y[:, k] - y_pred, 0.0)
            Kg = np.where(m[:, None], PH / S[:, None], 0.0)
            x += Kg * innov[:, None]
            P = P - Kg[:, :, None] * PH[:, None, :]
            total += float(np.sum(np.where(m, -0.5 * (LOG_2PI + np.log(S) + innov**2 / S), 0.0)))
        return total

    # --- Views on a state ----------------------------------------------------

    def levels(self, state: State) -> tuple[np.ndarray, np.ndarray]:
        K = self.K
        return state.x[:K].copy(), np.sqrt(np.diag(state.P)[:K])

    def slopes(self, state: State) -> tuple[np.ndarray, np.ndarray]:
        K = self.K
        return state.x[K : 2 * K].copy(), np.sqrt(np.diag(state.P)[K : 2 * K])

    def level_correlation(self, state: State) -> np.ndarray:
        P = state.P[: self.K, : self.K]
        sd = np.sqrt(np.clip(np.diag(P), 1e-300, None))
        return P / np.outer(sd, sd)

    def learner_biases(self, state: State) -> dict[str, tuple[float, float]]:
        return {
            tid: (float(state.x[i]), float(math.sqrt(state.P[i, i])))
            for tid, i in self.bias_index.items()
        }
