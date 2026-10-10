"""HTTP API. Errors share the Next.js app's shape: {"error": str, "details"?: any}."""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import Connection, errors
from pydantic.alias_generators import to_camel

from . import db, repo
from .fit import Estimate, fit_map
from .model import PlanParams
from .schemas import (
    AssessmentTypeIn,
    AssessmentTypeOut,
    AssessmentTypesOut,
    Calibration,
    Diagnostics,
    EstimateOut,
    FitOut,
    MeanSd,
    ObservationFit,
    ObservationIn,
    ObservationOut,
    ObservationsOut,
    PlanParamsBody,
    Slope,
    StateOut,
    TopicsIn,
    TopicsOut,
    TopicState,
    TypeFitOut,
)

STARTED = time.monotonic()


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool = db.open_pool()
        with pool.connection() as conn:
            db.migrate(conn)
        app.state.pool = pool
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(title="Knowledge state", version="0.1.0", lifespan=lifespan)
    _install_error_handlers(app)
    _routes(app)
    return app


def _error(status: int, error: str, details: object = None) -> JSONResponse:
    body = {"error": error}
    if details is not None:
        body["details"] = jsonable_encoder(details)
    return JSONResponse(body, status_code=status)


def _install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError):
        return _error(400, "Invalid request", exc.errors())

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            return _error(exc.status_code, exc.detail["error"], exc.detail.get("details"))
        return _error(exc.status_code, str(exc.detail))

    # Constraint violations are the caller's fault, not the server's.
    @app.exception_handler(errors.UniqueViolation)
    async def conflict(_: Request, exc: errors.UniqueViolation):
        return _error(409, "Already exists", exc.diag.message_detail)

    @app.exception_handler(errors.ForeignKeyViolation)
    async def missing_ref(_: Request, exc: errors.ForeignKeyViolation):
        return _error(400, "Referenced record does not exist", exc.diag.message_detail)


def bad_request(error: str, details: object = None) -> HTTPException:
    return HTTPException(400, {"error": error, "details": details})


def get_conn(request: Request) -> Iterator[Connection]:
    """One transaction per request: committed on success, rolled back on error."""
    with request.app.state.pool.connection() as conn:
        yield conn


Conn = Annotated[Connection, Depends(get_conn)]


def _routes(app: FastAPI) -> None:
    @app.get("/health")
    def health(request: Request):
        database = "ok"
        try:
            with request.app.state.pool.connection(timeout=2) as conn:
                conn.execute("select 1")
        except Exception:
            database = "unreachable"
        return JSONResponse(
            {
                "status": "ok" if database == "ok" else "degraded",
                "database": database,
                "uptimeSeconds": round(time.monotonic() - STARTED),
                "timestamp": datetime.now(UTC).isoformat(),
            },
            status_code=200 if database == "ok" else 503,
        )

    # --- Topics --------------------------------------------------------------

    @app.get("/plans/{plan_id}/topics", response_model=TopicsOut)
    def get_topics(plan_id: str, conn: Conn):
        return {"topics": repo.list_topics(conn, plan_id)}

    @app.put("/plans/{plan_id}/topics", response_model=TopicsOut)
    def put_topics(plan_id: str, body: TopicsIn, conn: Conn):
        """Insert or update topics. Topics not in the body are kept."""
        ids = [t.id for t in body.topics]
        if len(set(ids)) != len(ids):
            raise bad_request("Duplicate topic ids")
        known = repo.known_topic_ids(conn, plan_id) | set(ids)
        missing = sorted({t.parent_id for t in body.topics if t.parent_id} - known)
        if missing:
            raise bad_request("Unknown parent topics", missing)
        rows = [
            {**t.model_dump(), "position": t.position if t.position is not None else i}
            for i, t in enumerate(body.topics)
        ]
        repo.upsert_topics(conn, plan_id, rows)
        return {"topics": repo.list_topics(conn, plan_id)}

    # --- Plan params ---------------------------------------------------------

    @app.get("/plans/{plan_id}/params", response_model=PlanParamsBody)
    def get_params(plan_id: str, conn: Conn):
        return repo.get_plan_params(conn, plan_id).__dict__

    @app.put("/plans/{plan_id}/params", response_model=PlanParamsBody)
    def put_params(plan_id: str, body: PlanParamsBody, conn: Conn):
        params = PlanParams(**body.model_dump())
        repo.put_plan_params(conn, plan_id, params)
        return params.__dict__

    # --- Assessment types ----------------------------------------------------

    @app.get("/assessment-types", response_model=AssessmentTypesOut)
    def list_types(conn: Conn):
        return {"types": repo.list_types(conn)}

    @app.get("/assessment-types/{type_id}", response_model=AssessmentTypeOut)
    def get_type(type_id: str, conn: Conn):
        row = repo.get_type(conn, type_id)
        if row is None:
            raise HTTPException(404, "Assessment type not found")
        return row

    @app.put("/assessment-types/{type_id}", response_model=AssessmentTypeOut)
    def put_type(type_id: str, body: AssessmentTypeIn, conn: Conn):
        return repo.put_type(conn, type_id, body.model_dump())

    # --- Observations --------------------------------------------------------

    @app.post("/observations", response_model=ObservationOut, status_code=201)
    def create_observation(body: ObservationIn, conn: Conn):
        atype = repo.get_type(conn, body.type)
        if atype is None:
            raise bad_request("Unknown assessment type", body.type)
        known = repo.known_topic_ids(conn, body.plan_id)
        if not known:
            raise bad_request("Plan has no topics; PUT /plans/{planId}/topics first")
        unknown = sorted(set(body.weights) - known)
        if unknown:
            raise bad_request("Unknown topics", unknown)
        row = repo.insert_observation(
            conn,
            {
                **body.model_dump(exclude={"type"}),
                "type_id": body.type,
                "n_points": body.n_points or atype["n_default"],
            },
        )
        return _observation_out(row)

    @app.get("/observations", response_model=ObservationsOut)
    def list_observations(
        conn: Conn,
        user_id: Annotated[UUID | None, Query(alias="userId")] = None,
        plan_id: Annotated[str | None, Query(alias="planId")] = None,
        start: Annotated[datetime | None, Query(alias="from")] = None,
        end: Annotated[datetime | None, Query(alias="to")] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 200,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        rows = repo.list_observations(
            conn, plan_id=plan_id, user_id=user_id, start=start, end=end, limit=limit, offset=offset
        )
        return {"observations": [_observation_out(r) for r in rows]}

    @app.delete("/observations/{obs_id}", status_code=204)
    def delete_observation(obs_id: UUID, conn: Conn):
        if not repo.delete_observation(conn, obs_id):
            raise HTTPException(404, "Observation not found")

    # --- State ---------------------------------------------------------------

    @app.get("/users/{user_id}/plans/{plan_id}/state", response_model=StateOut)
    def get_state(
        user_id: UUID,
        plan_id: str,
        conn: Conn,
        at: Annotated[datetime | None, Query(description="Defaults to now")] = None,
    ):
        """The learner's estimated levels as of `at`, replayed from their observations."""
        model = repo.load_model(conn, plan_id)
        if model is None:
            raise HTTPException(404, "Plan has no topics")
        as_of = at or datetime.now(UTC)
        if as_of.tzinfo is None:
            raise bad_request("`at` needs a time zone offset")
        rows = repo.list_observations(conn, plan_id=plan_id, user_id=user_id, end=as_of)
        result = model.run([repo.to_observation(r) for r in rows], until=repo.to_days(as_of))
        state = result.state

        topic_rows = {r["id"]: r for r in repo.list_topics(conn, plan_id)}
        level, level_sd = model.levels(state)
        slope, slope_sd = model.slopes(state)
        topics = [
            TopicState(
                id=t.id,
                name=topic_rows[t.id]["name"],
                parent_id=t.parent_id,
                level=MeanSd(mean=level[i], sd=level_sd[i]),
                slope=Slope(per_week=7 * slope[i], per_week_sd=7 * slope_sd[i]),
            )
            for i, t in enumerate(model.topics)
        ]

        by_id = {str(r["id"]): r for r in rows}
        fits = [
            ObservationFit(
                id=d.id,
                observed_at=by_id[d.id]["observed_at"],
                type=d.type_id,
                predicted=d.predicted,
                predicted_sd=float(np.sqrt(d.S)),
                innovation=d.innovation,
                z=d.z,
            )
            for d in result.diagnostics
        ]
        zs = defaultdict(list)
        for d in result.diagnostics:
            zs[d.type_id].append(d.z)
        calibration = {
            tid: Calibration(
                n=len(z),
                z_mean=float(np.mean(z)),
                z_sd=float(np.std(z, ddof=1)) if len(z) > 1 else None,
            )
            for tid, z in zs.items()
        }

        return StateOut(
            user_id=user_id,
            plan_id=plan_id,
            as_of=as_of,
            observation_count=len(result.diagnostics),
            topics=topics,
            correlation=np.round(model.level_correlation(state), 4).tolist(),
            learner_bias={
                tid: MeanSd(mean=m, sd=s) for tid, (m, s) in model.learner_biases(state).items()
            },
            diagnostics=Diagnostics(
                observations=fits, calibration=calibration, skipped=result.skipped
            ),
        )

    # --- Fit -----------------------------------------------------------------

    @app.get("/plans/{plan_id}/fit")
    def get_fit(plan_id: str, conn: Conn):
        """The plan's latest stored fit; parameters that kept their prior are null."""
        fit = repo.get_fit(conn, plan_id)
        if fit is None:
            raise HTTPException(404, "Plan has not been fitted")
        fit["types"] = [{to_camel(k): v for k, v in t.items()} for t in fit["types"]]
        return jsonable_encoder({to_camel(k): v for k, v in fit.items()})

    @app.post("/plans/{plan_id}/fit", response_model=FitOut)
    def run_fit(plan_id: str, conn: Conn):
        """MAP-fit noise, biases and the learning trend from all of the plan's observations."""
        topic_rows = repo.list_topics(conn, plan_id)
        if not topic_rows:
            raise HTTPException(404, "Plan has no topics")
        model = repo.load_model(conn, plan_id)
        result = fit_map(
            model.topics,
            repo.type_priors(conn),
            repo.get_plan_params(conn, plan_id),
            repo.observations_by_learner(conn, plan_id),
        )
        repo.save_fit(conn, plan_id, result)

        def est(e: Estimate) -> EstimateOut:
            return EstimateOut(value=e.value, sd=e.sd, prior_only=e.prior_only)

        return FitOut(
            plan_id=plan_id,
            n_observations=result.n_observations,
            n_learners=result.n_learners,
            objective=result.objective,
            converged=result.converged,
            starts_agree=result.starts_agree,
            message=result.message,
            half_life_days=est(result.half_life_days),
            slope_prior_mean=est(result.slope_prior_mean),
            types={
                tid: TypeFitOut(
                    c=est(c), bias=est(result.bias[tid]) if tid in result.bias else None
                )
                for tid, c in result.c.items()
            },
        )


def _observation_out(row: dict) -> dict:
    return {**row, "type": row["type_id"]}


app = create_app()
