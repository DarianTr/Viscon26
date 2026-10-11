"""Keeping each plan's fit current as its scores change.

A fit replays every score of the plan several times, so it takes seconds and
runs in a background thread after the request. Bursts coalesce: scores logged
while a plan is being fitted cause one more fit afterwards, not one each.
"""

from __future__ import annotations

import logging
import os
import threading

from psycopg import Connection
from psycopg_pool import ConnectionPool

from . import repo
from .fit import FitResult, fit_map

log = logging.getLogger(__name__)


def auto_fit_enabled() -> bool:
    """On unless KNOWLEDGE_AUTO_FIT is "0", "false" or "off"."""
    return os.environ.get("KNOWLEDGE_AUTO_FIT", "1").strip().lower() not in {"0", "false", "off"}


def fit_plan(conn: Connection, plan_id: str) -> FitResult | None:
    """Fit the plan from all of its scores, or None if it has no topics. Does not store."""
    model = repo.load_model(conn, plan_id)
    if model is None:
        return None
    return fit_map(
        model.topics,
        repo.type_priors(conn),
        repo.get_plan_params(conn, plan_id),
        repo.observations_by_learner(conn, plan_id),
    )


def refit(conn: Connection, plan_id: str) -> FitResult | None:
    """Fit the plan and store the result; a fit that didn't settle keeps the previous one."""
    with conn.transaction():
        # Serialises fits of one plan across server processes.
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", [f"fit:{plan_id}"])
        result = fit_plan(conn, plan_id)
        if result is None:
            return None
        if not (result.converged and result.starts_agree):
            log.warning("Fit of plan %s not stored: %s", plan_id, result.message)
            return result
        repo.save_fit(conn, plan_id, result)
        return result


class Refitter:
    """Runs `refit` per plan in background threads, coalescing requests for the same plan."""

    def __init__(self, pool: ConnectionPool):
        self._pool = pool
        self._cond = threading.Condition()
        self._running: set[str] = set()
        self._again: set[str] = set()

    def request(self, plan_id: str) -> None:
        with self._cond:
            if plan_id in self._running:
                self._again.add(plan_id)
                return
            self._running.add(plan_id)
        threading.Thread(target=self._run, args=(plan_id,), daemon=True).start()

    def wait(self, timeout: float | None = None) -> bool:
        """Block until no fit is running; False on timeout."""
        with self._cond:
            return self._cond.wait_for(lambda: not self._running, timeout)

    def _run(self, plan_id: str) -> None:
        while True:
            try:
                with self._pool.connection() as conn:
                    refit(conn, plan_id)
            except Exception:
                log.exception("Fit of plan %s failed", plan_id)
            with self._cond:
                if plan_id not in self._again:
                    self._running.discard(plan_id)
                    self._cond.notify_all()
                    return
                self._again.discard(plan_id)
