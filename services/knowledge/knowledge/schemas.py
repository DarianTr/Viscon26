"""Request and response bodies. JSON is camelCase, matching the Next.js app."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

Id = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:\-]+$")]
Fraction = Annotated[float, Field(ge=0, le=1)]


class Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Topics ------------------------------------------------------------------


class TopicIn(Body):
    id: Id
    name: str = Field(min_length=1, max_length=200)
    parent_id: Id | None = None
    #: Expected score on this topic before any data, as a fraction.
    prior_mean: Fraction = 0.5
    prior_sd: float = Field(0.2, gt=0, le=1)
    #: Order in the state vector; defaults to the order in the request.
    position: int | None = None


class TopicsIn(Body):
    topics: list[TopicIn] = Field(min_length=1, max_length=500)


class TopicOut(Out):
    id: str
    name: str
    parent_id: str | None
    prior_mean: float
    prior_sd: float
    position: int


class TopicsOut(Out):
    topics: list[TopicOut]


# --- Plan params -------------------------------------------------------------


class PlanParamsBody(Body):
    """Model settings for a plan. Omitted fields take their defaults."""

    half_life_days: float = Field(20.0, gt=0, le=3650)
    slope_prior_mean: float = Field(0.005, ge=-0.1, le=0.1)
    slope_prior_sd: float = Field(0.005, gt=0, le=0.1)
    q_level: float = Field(1e-4, ge=0, le=0.01)
    q_slope: float = Field(1e-7, ge=0, le=1e-3)
    learner_bias_sd: float = Field(0.04, gt=0, le=0.5)
    rho_sibling: float = Field(0.5, ge=0, lt=1)
    rho_global: float = Field(0.15, ge=0, lt=1)


# --- Assessment types --------------------------------------------------------


class AssessmentTypeIn(Body):
    name: str = Field(min_length=1, max_length=200)
    #: Points assumed when an observation does not say.
    n_default: float = Field(gt=0)
    #: Prior overdispersion multiplier on the binomial variance.
    c_prior: float = Field(gt=0, le=100)
    tau2: float = Field(1e-4, ge=0, le=1)
    bias_prior: float = Field(0.0, ge=-0.5, le=0.5)
    #: Anchor types (mocks, exams) have their bias fixed and set the scale.
    bias_fixed: bool = False


class AssessmentTypeOut(AssessmentTypeIn):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    id: str


class AssessmentTypesOut(Out):
    types: list[AssessmentTypeOut]


# --- Observations ------------------------------------------------------------


class ObservationIn(Body):
    user_id: UUID
    plan_id: Id
    type: Id
    observed_at: AwareDatetime
    #: Fraction of points scored.
    score: Fraction
    #: Points the score is out of; defaults to the type's n_default.
    n_points: float | None = Field(None, gt=0, le=10_000)
    #: {topic id: share of the points}; normalised, so 10/50/40 or 0.1/0.5/0.4 both work.
    weights: dict[Id, Annotated[float, Field(ge=0)]] = Field(min_length=1, max_length=500)
    #: Where the score came from (e.g. a session id); unique per plan and user.
    source_ref: str | None = Field(None, max_length=200)

    @field_validator("weights")
    @classmethod
    def _some_weight(cls, v: dict[str, float]) -> dict[str, float]:
        if sum(v.values()) <= 0:
            raise ValueError("at least one weight must be positive")
        return v


class ObservationOut(Out):
    id: UUID
    user_id: UUID
    plan_id: str
    type: str
    observed_at: datetime
    score: float
    n_points: float
    weights: dict[str, float]
    source_ref: str | None
    created_at: datetime


class ObservationsOut(Out):
    observations: list[ObservationOut]


# --- State -------------------------------------------------------------------


class MeanSd(Out):
    mean: float
    sd: float


class Slope(Out):
    #: Expected gain per week right now, as a fraction (0.01 = 1 point).
    per_week: float
    per_week_sd: float


class TopicState(Out):
    id: str
    name: str
    parent_id: str | None
    level: MeanSd
    slope: Slope


class ObservationFit(Out):
    id: str | None
    observed_at: datetime
    type: str
    predicted: float
    #: sd of the predicted score (state uncertainty plus measurement noise).
    predicted_sd: float
    innovation: float
    #: Normalised innovation; ~N(0, 1) if the model is calibrated.
    z: float


class Calibration(Out):
    n: int
    z_mean: float
    z_sd: float | None


class Diagnostics(Out):
    observations: list[ObservationFit]
    #: Per assessment type; z_mean far from 0 means biased, z_sd far from 1 mis-sized noise.
    calibration: dict[str, Calibration]
    #: Observations whose topics no longer exist in the plan.
    skipped: list[str | None]


class StateOut(Out):
    user_id: UUID
    plan_id: str
    as_of: datetime
    observation_count: int
    topics: list[TopicState]
    #: Correlation between topic levels, in `topics` order.
    correlation: list[list[float]]
    #: This learner's own offset per non-anchor assessment type.
    learner_bias: dict[str, MeanSd]
    diagnostics: Diagnostics


# --- Fit ---------------------------------------------------------------------


class EstimateOut(Out):
    value: float
    sd: float | None
    #: True if there was too little data and the prior was kept.
    prior_only: bool


class TypeFitOut(Out):
    c: EstimateOut
    bias: EstimateOut | None


class FitOut(Out):
    plan_id: str
    n_observations: int
    n_learners: int
    objective: float | None
    converged: bool
    starts_agree: bool
    message: str
    half_life_days: EstimateOut
    slope_prior_mean: EstimateOut
    types: dict[str, TypeFitOut]
