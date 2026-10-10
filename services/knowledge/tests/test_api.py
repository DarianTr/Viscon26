"""End-to-end tests against a real Postgres, in a throwaway schema.

Skipped unless DATABASE_URL is set, e.g.
    DATABASE_URL=postgres://stride:stride@localhost:5432/stride uv run pytest
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

if not os.environ.get("DATABASE_URL"):
    pytest.skip("DATABASE_URL not set", allow_module_level=True)

import psycopg
from fastapi.testclient import TestClient

from knowledge.api import create_app

from .sim import simulate_learner

SCHEMA = f"knowledge_test_{uuid.uuid4().hex[:8]}"
PLAN = "analysis-exam"
DAY0 = datetime(2026, 9, 1, tzinfo=UTC)


@pytest.fixture(scope="module")
def client():
    os.environ["KNOWLEDGE_SCHEMA"] = SCHEMA
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        del os.environ["KNOWLEDGE_SCHEMA"]
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
            conn.execute(f"drop schema if exists {SCHEMA} cascade")


@pytest.fixture(scope="module")
def topics(client):
    res = client.put(
        f"/plans/{PLAN}/topics",
        json={
            "topics": [
                # Children before parents is fine.
                {"id": "analysis.limits", "name": "Limits", "parentId": "analysis"},
                {"id": "analysis.series", "name": "Series", "parentId": "analysis", "priorSd": 0.3},
                {"id": "analysis", "name": "Analysis"},
                {"id": "linalg", "name": "Linear algebra"},
            ]
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["topics"]


def observe(client, user, day, type_, score, weights, **extra):
    return client.post(
        "/observations",
        json={
            "userId": str(user),
            "planId": PLAN,
            "type": type_,
            "observedAt": (DAY0 + timedelta(days=day)).isoformat(),
            "score": score,
            "weights": weights,
            **extra,
        },
    )


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["database"] == "ok"


def test_topics_keep_request_order(topics):
    assert [t["id"] for t in topics] == ["analysis.limits", "analysis.series", "analysis", "linalg"]
    assert topics[0]["parentId"] == "analysis"


def test_seeded_types(client):
    types = {t["id"]: t for t in client.get("/assessment-types").json()["types"]}
    assert types["mock"]["biasFixed"] and not types["practice"]["biasFixed"]


def test_rejects_bad_observations(client, topics):
    user = uuid.uuid4()
    assert observe(client, user, 0, "practice", 0.5, {"nope": 1}).json()["details"] == ["nope"]
    assert observe(client, user, 0, "nope", 0.5, {"linalg": 1}).status_code == 400
    assert observe(client, user, 0, "practice", 1.5, {"linalg": 1}).status_code == 400
    assert observe(client, user, 0, "practice", 0.5, {"linalg": 0}).status_code == 400
    res = client.post("/observations", json={"userId": str(user)})
    assert res.status_code == 400 and res.json()["error"] == "Invalid request"


def test_source_ref_makes_logging_idempotent(client, topics):
    user = uuid.uuid4()
    first = observe(client, user, 0, "quiz", 0.7, {"linalg": 1}, sourceRef="session-1")
    assert first.status_code == 201
    assert first.json()["nPoints"] == 20  # the quiz type's default
    again = observe(client, user, 0, "quiz", 0.7, {"linalg": 1}, sourceRef="session-1")
    assert again.status_code == 409
    client.delete(f"/observations/{first.json()['id']}")


def test_state_tracks_mixed_topic_scores(client, topics):
    user = uuid.uuid4()
    prior = client.get(f"/users/{user}/plans/{PLAN}/state", params={"at": DAY0.isoformat()})
    assert prior.status_code == 200
    prior_sd = {t["id"]: t["level"]["sd"] for t in prior.json()["topics"]}

    # A sheet that is mostly series, scored low, then a pure-linalg quiz scored high.
    assert observe(client, user, 0, "mock", 0.3, {"analysis.series": 80, "linalg": 20}).is_success
    assert observe(client, user, 1, "quiz", 0.9, {"linalg": 1}).is_success

    state = client.get(
        f"/users/{user}/plans/{PLAN}/state", params={"at": (DAY0 + timedelta(days=1)).isoformat()}
    ).json()
    topics_ = {t["id"]: t for t in state["topics"]}
    assert state["observationCount"] == 2
    assert topics_["analysis.series"]["level"]["mean"] < 0.4
    assert topics_["linalg"]["level"]["mean"] > 0.6
    assert topics_["analysis.series"]["level"]["sd"] < prior_sd["analysis.series"]
    assert set(state["learnerBias"]) == {"practice", "quiz"}
    assert state["diagnostics"]["calibration"]["mock"]["n"] == 1

    # `at` before the second observation replays only the first.
    earlier = client.get(
        f"/users/{user}/plans/{PLAN}/state", params={"at": DAY0.isoformat()}
    ).json()
    assert earlier["observationCount"] == 1


def test_fit_uses_all_learners_and_feeds_back_into_state(client, topics):
    rng = np.random.default_rng(7)
    for _ in range(12):
        user = uuid.uuid4()
        obs, _ = simulate_learner(rng, days=30)
        for o in obs:
            assert observe(client, user, o.t, o.type_id, o.score, dict(o.weights),
                           nPoints=o.n_points).is_success  # fmt: skip

    res = client.post(f"/plans/{PLAN}/fit")
    assert res.status_code == 200, res.text
    fit = res.json()
    assert fit["nLearners"] >= 12
    assert not fit["types"]["practice"]["c"]["priorOnly"]
    assert fit["types"]["exam"]["c"]["priorOnly"]
    assert fit["types"]["mock"]["bias"] is None

    stored = client.get(f"/plans/{PLAN}/fit").json()
    by_type = {t["typeId"]: t for t in stored["types"]}
    assert by_type["practice"]["c"] == pytest.approx(fit["types"]["practice"]["c"]["value"])
    assert "exam" not in by_type


def test_timeline_forecasts_for_exam_dates(client):
    plan = "timeline-plan"
    res = client.put(
        f"/plans/{plan}/topics",
        json={"topics": [
            {"id": "analysis", "name": "Analysis", "examDate": "2026-10-20"},
            {"id": "linalg", "name": "Linear algebra", "examDate": "2026-10-25"},
        ]},
    )  # fmt: skip
    assert res.status_code == 200 and res.json()["topics"][0]["examDate"] == "2026-10-20"
    user = uuid.uuid4()
    for day, score in ((0, 0.6), (2, 0.7)):
        r = client.post("/observations", json={
            "userId": str(user), "planId": plan, "type": "quiz",
            "observedAt": (DAY0 + timedelta(days=day)).isoformat(),
            "score": score, "weights": {"analysis": 1},
        })  # fmt: skip
        assert r.status_code == 201, r.text

    at = (DAY0 + timedelta(days=5)).isoformat()
    tl = client.get(f"/users/{user}/plans/{plan}/timeline", params={"at": at}).json()
    assert [t["id"] for t in tl["topics"]] == ["analysis", "linalg"]
    assert len(tl["steps"]) == 3 and tl["steps"][0]["observation"] is None
    assert tl["steps"][1]["observation"]["type"] == "quiz"
    assert tl["projection"][0]["at"].startswith((DAY0 + timedelta(days=5)).date().isoformat())
    assert tl["projection"][-1]["at"].startswith("2026-10-25")
    assert set(tl["current"]) >= {"levels", "forecasts", "groupLevels", "groupForecasts", "overall"}
    assert [g["id"] for g in tl["groups"]] == ["analysis", "linalg"]


def test_recommended_topics_ranks_by_gap_and_uncertainty(client, topics):
    user = uuid.uuid4()

    # Prior only — no observations yet. All topics start ~equal; just check shape.
    res = client.post(
        f"/users/{user}/plans/{PLAN}/recommended-topics",
        json={"targets": {}},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert {t["topicId"] for t in data["topics"]} == {"analysis.limits", "analysis.series", "analysis", "linalg"}
    assert abs(sum(t["allocation"] for t in data["topics"]) - 100) < 0.5

    # Log a strong linalg score so it rises close to the 0.75 default target.
    for day in (0, 3, 7):
        observe(client, user, day, "quiz", 0.9, {"linalg": 1})
    # Leave analysis.series weak (no observations).

    res2 = client.post(
        f"/users/{user}/plans/{PLAN}/recommended-topics",
        json={"targets": {"analysis.limits": 0.75, "analysis.series": 0.75, "analysis": 0.75, "linalg": 0.75}},
    )
    assert res2.status_code == 200, res2.text
    ranked = res2.json()["topics"]

    # linalg is now strong — it should rank lower than the weak analysis topics.
    linalg_alloc = next(t["allocation"] for t in ranked if t["topicId"] == "linalg")
    series_alloc = next(t["allocation"] for t in ranked if t["topicId"] == "analysis.series")
    assert series_alloc > linalg_alloc, "weak topic should outrank strong one"

    # "weakest" tag must appear exactly once.
    tagged_weakest = [t for t in ranked if "weakest" in t["tags"]]
    assert len(tagged_weakest) == 1

    # Allocations still sum to 100.
    assert abs(sum(t["allocation"] for t in ranked) - 100) < 0.5


def test_recommended_topics_exam_urgency(client):
    plan = "focus-plan"
    client.put(
        f"/plans/{plan}/topics",
        json={"topics": [
            {"id": "focus.near", "name": "Near topic", "parentId": "focus", "examDate": "2026-10-15"},
            {"id": "focus.far",  "name": "Far topic",  "parentId": "focus", "examDate": "2027-06-01"},
        ]},
    )
    user = uuid.uuid4()
    # Both topics equally weak — exam urgency should push the near one higher.
    res = client.post(
        f"/users/{user}/plans/{plan}/recommended-topics",
        json={"targets": {"focus.near": 0.75, "focus.far": 0.75}},
    )
    assert res.status_code == 200, res.text
    ranked = res.json()["topics"]
    near_alloc = next(t["allocation"] for t in ranked if t["topicId"] == "focus.near")
    far_alloc  = next(t["allocation"] for t in ranked if t["topicId"] == "focus.far")
    assert near_alloc > far_alloc, "closer exam should rank higher when gap is equal"
    assert any("exam soon" in t["tags"] for t in ranked)


def test_parent_may_be_a_group_that_is_not_a_topic(client):
    res = client.put(
        "/plans/group-plan/topics",
        json={"topics": [
            {"id": "physics.mechanics", "name": "Mechanics", "parentId": "physics"},
            {"id": "physics.waves", "name": "Waves", "parentId": "physics"},
        ]},
    )  # fmt: skip
    assert res.status_code == 200, res.text
    assert {t["parentId"] for t in res.json()["topics"]} == {"physics"}


def test_prune_replaces_placeholder_topics(client):
    plan = "prune-plan"
    placeholders = [
        {"id": f"linalg.{x}", "name": x, "parentId": "linalg"}
        for x in ("systems", "spaces", "eigen")
    ]
    assert client.put(f"/plans/{plan}/topics", json={"topics": placeholders}).status_code == 200
    user = uuid.uuid4()
    assert observe_in(client, plan, user, 0, {"linalg.systems": 1}).status_code == 201

    real = [
        {"id": f"lineare-algebra.{x}", "name": x, "parentId": "linalg"}
        for x in ("vectors", "determinants", "svd", "linear-maps")
    ]
    # A plain PUT only adds...
    res = client.put(f"/plans/{plan}/topics", json={"topics": real[:1]})
    assert len(res.json()["topics"]) == 4
    # ...prune leaves exactly the given topics.
    res = client.put(f"/plans/{plan}/topics", params={"prune": "true"}, json={"topics": real})
    assert [t["id"] for t in res.json()["topics"]] == [t["id"] for t in real]

    tl = client.get(f"/users/{user}/plans/{plan}/timeline").json()
    assert tl["groups"] == [{"id": "linalg", "topicIds": [t["id"] for t in real], "examDate": None}]
    # The data point on a removed placeholder topic no longer counts.
    assert len(tl["skipped"]) == 1 and len(tl["steps"]) == 1


def observe_in(client, plan, user, day, weights):
    return client.post(
        "/observations",
        json={
            "userId": str(user),
            "planId": plan,
            "type": "quiz",
            "observedAt": (DAY0 + timedelta(days=day)).isoformat(),
            "score": 0.7,
            "weights": weights,
        },
    )
