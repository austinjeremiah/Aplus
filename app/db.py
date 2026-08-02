"""SQLite app database — thin pointer store, not a media store.

The manifests in B2 are the source of truth for provenance. This DB only
holds what B2 can't answer cheaply: the *attempt graph*. Every generation
attempt — including the ones that failed or were rejected by compliance —
gets a row, linked to its predecessor by ``parent_run_id``. Walking that
chain backwards is what produces the lineage timeline.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from app.config import settings

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id          TEXT PRIMARY KEY,
    parent_run_id   TEXT REFERENCES runs(run_id),
    job_id          TEXT,
    asin            TEXT NOT NULL,
    module_id       TEXT NOT NULL,
    attempt         INTEGER NOT NULL DEFAULT 1,
    provider        TEXT,
    model           TEXT,
    status          TEXT NOT NULL,
    prompt          TEXT,
    asset_url       TEXT,
    asset_key       TEXT,
    asset_sha256    TEXT,
    manifest_uri    TEXT,
    canonical_hash  TEXT,
    cost_usd        REAL DEFAULT 0,
    duration_sec    REAL,
    error           TEXT,
    compliance      TEXT,           -- JSON blob: verdict + violations
    review_decision TEXT,           -- human override: approved | rejected
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_asin     ON runs(asin);
CREATE INDEX IF NOT EXISTS idx_runs_job      ON runs(job_id);
CREATE INDEX IF NOT EXISTS idx_runs_parent   ON runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_status   ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_sha      ON runs(asset_sha256);

CREATE TABLE IF NOT EXISTS jobs (
    job_id      TEXT PRIMARY KEY,
    asin        TEXT NOT NULL,
    module_id   TEXT NOT NULL,
    prompt      TEXT,
    status      TEXT NOT NULL,      -- queued | in_progress | complete | failed
    result      TEXT,               -- JSON
    error       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with _lock, connect() as conn:
        conn.executescript(SCHEMA)


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------
def insert_run(**fields: Any) -> None:
    fields.setdefault("created_at", utcnow())
    if isinstance(fields.get("compliance"), (dict, list)):
        fields["compliance"] = json.dumps(fields["compliance"])
    cols = ", ".join(fields)
    marks = ", ".join(f":{k}" for k in fields)
    with _lock, connect() as conn:
        conn.execute(f"INSERT INTO runs ({cols}) VALUES ({marks})", fields)


def update_run(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    if isinstance(fields.get("compliance"), (dict, list)):
        fields["compliance"] = json.dumps(fields["compliance"])
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    with _lock, connect() as conn:
        conn.execute(f"UPDATE runs SET {sets} WHERE run_id = :run_id", {**fields, "run_id": run_id})


def get_run(run_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    return _row_to_dict(row) if row else None


def get_lineage(run_id: str) -> list[dict]:
    """Walk ``parent_run_id`` back to the root, then return oldest-first.

    This is the retry story: v1 rejected → v2 rejected → v3 approved.
    """
    chain: list[dict] = []
    seen: set[str] = set()
    cursor: str | None = run_id
    with connect() as conn:
        while cursor and cursor not in seen:
            seen.add(cursor)
            row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (cursor,)).fetchone()
            if row is None:
                break
            record = _row_to_dict(row)
            chain.append(record)
            cursor = record.get("parent_run_id")
    chain.reverse()
    for i, record in enumerate(chain, start=1):
        record["version"] = i
    return chain


def list_runs(
    *,
    asin: str | None = None,
    module_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    clauses, params = [], {}
    if asin:
        clauses.append("asin = :asin")
        params["asin"] = asin
    if module_id:
        clauses.append("module_id = :module_id")
        params["module_id"] = module_id
    if status:
        clauses.append("status = :status")
        params["status"] = status
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.update(limit=limit, offset=offset)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM runs {where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset",
            params,
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def find_run_by_sha256(sha256: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM runs WHERE asset_sha256 = ? ORDER BY created_at DESC LIMIT 1",
            (sha256,),
        ).fetchone()
    return _row_to_dict(row) if row else None


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
def insert_job(job_id: str, asin: str, module_id: str, prompt: str) -> None:
    now = utcnow()
    with _lock, connect() as conn:
        conn.execute(
            "INSERT INTO jobs (job_id, asin, module_id, prompt, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, 'queued', ?, ?)",
            (job_id, asin, module_id, prompt, now, now),
        )


def update_job(job_id: str, **fields: Any) -> None:
    if isinstance(fields.get("result"), (dict, list)):
        fields["result"] = json.dumps(fields["result"])
    fields["updated_at"] = utcnow()
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    with _lock, connect() as conn:
        conn.execute(f"UPDATE jobs SET {sets} WHERE job_id = :job_id", {**fields, "job_id": job_id})


def get_job(job_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    if row is None:
        return None
    job = dict(row)
    job["result"] = json.loads(job["result"]) if job.get("result") else None
    return job


# ---------------------------------------------------------------------------
def _row_to_dict(row: sqlite3.Row) -> dict:
    record = dict(row)
    raw = record.get("compliance")
    if raw:
        try:
            record["compliance"] = json.loads(raw)
        except (TypeError, ValueError):
            record["compliance"] = None
    return record
