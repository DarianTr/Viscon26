"""SQL for the service. Every function takes an open connection (dict rows)."""

from __future__ import annotations

import dataclasses
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, date, datetime, time
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.types.json import Jsonb

from .fit import FitResult, TypePrior
from .model import AssessmentType, Model, Observation, PlanParams, Topic

SECONDS_PER_DAY = 86_400.0

PLAN_PARAM_FIELDS = [f.name for f in dataclasses.fields(PlanParams)]


def to_days(ts: datetime) -> float:
    return ts.timestamp() / SECONDS_PER_DAY


def from_days(days: float) -> datetime:
    return datetime.fromtimestamp(days * SECONDS_PER_DAY, UTC)


def exam_datetime(day: date) -> datetime:
    """Exams are assumed to be in the morning: 09:00 UTC on the exam date."""
    return datetime.combine(day, time(9), UTC)


# --- Topics ------------------------------------------------------------------


def list_topics(conn: Connection, plan_id: str) -> list[dict[str, Any]]:
    return conn.execute(
        "select id, parent_id, name, prior_mean, prior_sd, position, exam_date from topics"
        " where plan_id = %s order by position, id",
        [plan_id],
    ).fetchall()


def upsert_topics(
    conn: Connection, plan_id: str, topics: Iterable[dict[str, Any]], prune: bool = False
) -> None:
    """Insert or update topics; parents may be given in the same call, in any order.

    With `prune`, the plan's topics not in `topics` are deleted. Observations
    keep their weights; the model ignores weights on topics that no longer exist.
    """
    topics = list(topics)
    with conn.transaction():
        if prune:
            conn.execute(
                "delete from topics where plan_id = %s and not (id = any(%s))",
                [plan_id, [t["id"] for t in topics]],
            )
        # Insert without parents first so the self-reference holds in any order.
        for t in topics:
            conn.execute(
                "insert into topics (plan_id, id, name, prior_mean, prior_sd, position, exam_date)"
                " values (%(plan_id)s, %(id)s, %(name)s, %(prior_mean)s, %(prior_sd)s,"
                " %(position)s, %(exam_date)s)"
                " on conflict (plan_id, id) do update set name = excluded.name,"
                " prior_mean = excluded.prior_mean, prior_sd = excluded.prior_sd,"
                " position = excluded.position, exam_date = excluded.exam_date",
                {"exam_date": None, **t, "plan_id": plan_id},
            )
        for t in topics:
            conn.execute(
                "update topics set parent_id = %s where plan_id = %s and id = %s",
                [t.get("parent_id"), plan_id, t["id"]],
            )


def known_topic_ids(conn: Connection, plan_id: str) -> set[str]:
    rows = conn.execute("select id from topics where plan_id = %s", [plan_id]).fetchall()
    return {r["id"] for r in rows}


# --- Plan params and fits ----------------------------------------------------


def get_plan_params(conn: Connection, plan_id: str) -> PlanParams:
    row = conn.execute("select * from plan_params where plan_id = %s", [plan_id]).fetchone()
    if row is None:
        return PlanParams()
    return PlanParams(**{k: row[k] for k in PLAN_PARAM_FIELDS})


def put_plan_params(conn: Connection, plan_id: str, params: PlanParams) -> None:
    values = dataclasses.asdict(params)
    cols = ", ".join(PLAN_PARAM_FIELDS)
    placeholders = ", ".join(f"%({k})s" for k in PLAN_PARAM_FIELDS)
    updates = ", ".join(f"{k} = excluded.{k}" for k in PLAN_PARAM_FIELDS)
    conn.execute(
        f"insert into plan_params (plan_id, {cols}) values (%(plan_id)s, {placeholders})"
        f" on conflict (plan_id) do update set {updates}",
        {**values, "plan_id": plan_id},
    )


def get_fit(conn: Connection, plan_id: str) -> dict[str, Any] | None:
    fit = conn.execute("select * from plan_fits where plan_id = %s", [plan_id]).fetchone()
    if fit is None:
        return None
    fit["types"] = conn.execute(
        "select type_id, c, c_sd, bias, bias_sd from type_fits where plan_id = %s order by type_id",
        [plan_id],
    ).fetchall()
    return fit


def save_fit(conn: Connection, plan_id: str, r: FitResult) -> None:
    """Replace the plan's fit; parameters that kept their prior are stored as null."""

    def fitted(e):
        return (None, None) if e is None or e.prior_only else (e.value, e.sd)

    hl, hl_sd = fitted(r.half_life_days)
    slope, slope_sd = fitted(r.slope_prior_mean)
    with conn.transaction():
        conn.execute("delete from plan_fits where plan_id = %s", [plan_id])
        conn.execute(
            "insert into plan_fits (plan_id, half_life_days, half_life_sd, slope_prior_mean,"
            " slope_prior_sd, objective, converged, starts_agree, n_observations, n_learners)"
            " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [plan_id, hl, hl_sd, slope, slope_sd, r.objective, r.converged, r.starts_agree,
             r.n_observations, r.n_learners],
        )  # fmt: skip
        for type_id in r.c.keys() | r.bias.keys():
            c, c_sd = fitted(r.c.get(type_id))
            bias, bias_sd = fitted(r.bias.get(type_id))
            if c is None and bias is None:
                continue
            conn.execute(
                "insert into type_fits (plan_id, type_id, c, c_sd, bias, bias_sd)"
                " values (%s, %s, %s, %s, %s, %s)",
                [plan_id, type_id, c, c_sd, bias, bias_sd],
            )


# --- Assessment types --------------------------------------------------------


def list_types(conn: Connection) -> list[dict[str, Any]]:
    return conn.execute("select * from assessment_types order by id").fetchall()


def get_type(conn: Connection, type_id: str) -> dict[str, Any] | None:
    return conn.execute("select * from assessment_types where id = %s", [type_id]).fetchone()


def put_type(conn: Connection, type_id: str, t: dict[str, Any]) -> dict[str, Any]:
    return conn.execute(
        "insert into assessment_types (id, name, n_default, c_prior, tau2, bias_prior, bias_fixed)"
        " values (%(id)s, %(name)s, %(n_default)s, %(c_prior)s, %(tau2)s, %(bias_prior)s,"
        " %(bias_fixed)s)"
        " on conflict (id) do update set name = excluded.name, n_default = excluded.n_default,"
        " c_prior = excluded.c_prior, tau2 = excluded.tau2, bias_prior = excluded.bias_prior,"
        " bias_fixed = excluded.bias_fixed returning *",
        {**t, "id": type_id},
    ).fetchone()


def type_priors(conn: Connection) -> list[TypePrior]:
    return [
        TypePrior(r["id"], r["c_prior"], r["bias_prior"], r["bias_fixed"], r["tau2"])
        for r in list_types(conn)
    ]


# --- Observations ------------------------------------------------------------


def insert_observation(conn: Connection, o: dict[str, Any]) -> dict[str, Any]:
    return conn.execute(
        "insert into observations"
        " (user_id, plan_id, type_id, observed_at, score, n_points, weights, source_ref)"
        " values (%(user_id)s, %(plan_id)s, %(type_id)s, %(observed_at)s, %(score)s,"
        " %(n_points)s, %(weights)s, %(source_ref)s) returning *",
        {**o, "weights": Jsonb(o["weights"])},
    ).fetchone()


def list_observations(
    conn: Connection,
    *,
    plan_id: str | None = None,
    user_id: UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, Any]]:
    where, args = [], []
    for clause, value in (
        ("plan_id = %s", plan_id),
        ("user_id = %s", user_id),
        ("observed_at >= %s", start),
        ("observed_at <= %s", end),
    ):
        if value is not None:
            where.append(clause)
            args.append(value)
    query = "select * from observations"
    if where:
        query += " where " + " and ".join(where)
    query += " order by observed_at, created_at, id"
    if limit is not None:
        query += " limit %s offset %s"
        args += [limit, offset]
    return conn.execute(query, args).fetchall()


def delete_observation(conn: Connection, obs_id: UUID) -> str | None:
    """Delete an observation; returns its plan's id, or None if it didn't exist."""
    row = conn.execute(
        "delete from observations where id = %s returning plan_id", [obs_id]
    ).fetchone()
    return row["plan_id"] if row else None


def to_observation(row: dict[str, Any]) -> Observation:
    return Observation(
        t=to_days(row["observed_at"]),
        type_id=row["type_id"],
        score=row["score"],
        n_points=row["n_points"],
        weights=row["weights"],
        id=str(row["id"]),
    )


def observations_by_learner(conn: Connection, plan_id: str) -> list[list[Observation]]:
    by_user: dict[UUID, list[Observation]] = defaultdict(list)
    for row in list_observations(conn, plan_id=plan_id):
        by_user[row["user_id"]].append(to_observation(row))
    return list(by_user.values())


# --- The model for a plan ----------------------------------------------------


def load_model(conn: Connection, plan_id: str) -> Model | None:
    """The plan's filter, using fitted values where a fit exists and priors elsewhere."""
    topic_rows = list_topics(conn, plan_id)
    if not topic_rows:
        return None
    topics = [Topic(r["id"], r["parent_id"], r["prior_mean"], r["prior_sd"]) for r in topic_rows]

    params = get_plan_params(conn, plan_id)
    fit = get_fit(conn, plan_id)
    type_fit = {}
    if fit is not None:
        type_fit = {t["type_id"]: t for t in fit["types"]}
        if fit["half_life_days"] is not None:
            params = dataclasses.replace(params, half_life_days=fit["half_life_days"])
        if fit["slope_prior_mean"] is not None:
            params = dataclasses.replace(params, slope_prior_mean=fit["slope_prior_mean"])

    types = []
    for r in list_types(conn):
        f = type_fit.get(r["id"], {})
        c = f.get("c") if f.get("c") is not None else r["c_prior"]
        bias = f.get("bias") if f.get("bias") is not None else r["bias_prior"]
        types.append(AssessmentType(r["id"], c, r["tau2"], bias, r["bias_fixed"]))
    return Model(topics, types, params)
