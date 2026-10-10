"""Connection pool and a minimal migration runner.

All tables live in one Postgres schema (KNOWLEDGE_SCHEMA, default
`knowledge`), selected through the connection's search_path.
"""

from __future__ import annotations

import os
import re
from importlib import resources

from psycopg import Connection, sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DEFAULT_SCHEMA = "knowledge"
_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
# Any constant works; it only serialises concurrent migration runs.
_MIGRATION_LOCK = 0x6B6E6F77


def schema_name() -> str:
    schema = os.environ.get("KNOWLEDGE_SCHEMA", DEFAULT_SCHEMA)
    if not _IDENTIFIER.match(schema):
        raise ValueError(f"Invalid KNOWLEDGE_SCHEMA: {schema!r}")
    return schema


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def open_pool(url: str | None = None, schema: str | None = None) -> ConnectionPool:
    schema = schema or schema_name()
    return ConnectionPool(
        url or database_url(),
        kwargs={"row_factory": dict_row, "options": f"-c search_path={schema}"},
        min_size=1,
        max_size=10,
        open=True,
    )


def migrate(conn: Connection, schema: str | None = None) -> list[str]:
    """Apply pending migrations in name order; returns the ones applied."""
    schema = schema or schema_name()
    applied: list[str] = []
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(%s)", [_MIGRATION_LOCK])
        conn.execute(sql.SQL("create schema if not exists {}").format(sql.Identifier(schema)))
        conn.execute(sql.SQL("set local search_path to {}").format(sql.Identifier(schema)))
        conn.execute(
            "create table if not exists schema_migrations ("
            " name text primary key, applied_at timestamptz not null default now())"
        )
        done = {r["name"] for r in conn.execute("select name from schema_migrations").fetchall()}
        migrations = resources.files("knowledge.migrations").iterdir()
        files = sorted((f for f in migrations if f.name.endswith(".sql")), key=lambda f: f.name)
        for f in files:
            if f.name in done:
                continue
            conn.execute(f.read_text())
            conn.execute("insert into schema_migrations (name) values (%s)", [f.name])
            applied.append(f.name)
    return applied
