"""In-process job queue.

ARQ + Redis was the plan, but the generation loop is synchronous and blocking
(provider HTTP, Pillow, vision calls), so what it actually needs is a worker
*thread*, not an async task. A bounded ThreadPoolExecutor plus SQLite-backed
job rows delivers the same contract the frontend polls against — enqueue
returns instantly, status transitions queued → in_progress → complete — with
no broker to install, configure or keep alive during a demo.

Job state lives in SQLite rather than a process dict so a restart doesn't
orphan the frontend's polling, and so the review queue can query it.

Set REDIS_URL if you later want to move to ARQ; the router contract does not
change.
"""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app import db
from app.config import settings
from app.services.orchestrator import generate_compliant

logger = logging.getLogger(__name__)

# Two workers: generation is IO-bound on provider APIs, but each job also
# holds a vision judge slot, and the free tiers rate-limit hard enough that
# more concurrency mostly produces 429s.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aplusplus-job")


def submit(
    *,
    asin: str,
    module_id: str,
    brief: str,
    max_retries: int | None = None,
    demo_violation: str | None = None,
    force_fail_first: bool = False,
) -> str:
    """Enqueue a generation job and return its id immediately."""
    job_id = uuid.uuid4().hex
    db.insert_job(job_id, asin, module_id, brief)
    _executor.submit(
        _run_job,
        job_id,
        asin,
        module_id,
        brief,
        max_retries,
        demo_violation,
        force_fail_first,
    )
    logger.info("queued job %s for %s/%s", job_id, asin, module_id)
    return job_id


def _run_job(
    job_id: str,
    asin: str,
    module_id: str,
    brief: str,
    max_retries: int | None,
    demo_violation: str | None,
    force_fail_first: bool,
) -> None:
    db.update_job(job_id, status="in_progress")
    try:
        result = generate_compliant(
            asin=asin,
            module_id=module_id,
            brief=brief,
            job_id=job_id,
            max_retries=max_retries,
            demo_violation=demo_violation,
            force_fail_first=force_fail_first,
        )
        payload = result.as_dict()
        db.update_job(job_id, status="complete", result=payload)
        logger.info(
            "job %s complete — approved=%s attempts=%d",
            job_id,
            result.approved,
            len(result.attempts),
        )
    except Exception as exc:  # noqa: BLE001 - a worker must never die silently
        logger.exception("job %s failed", job_id)
        db.update_job(job_id, status="failed", error=str(exc)[:2000])


def status(job_id: str) -> dict[str, Any] | None:
    return db.get_job(job_id)


def queue_depth() -> int:
    """Approximate backlog — surfaced at /health."""
    return _executor._work_queue.qsize()


def shutdown() -> None:
    _executor.shutdown(wait=False, cancel_futures=True)
