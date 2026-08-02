"""Generation + job polling endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import GenerateRequest, GenerateResponse, JobStatusResponse
from app.rubric.modules import module_ids
from app.workers import jobs

router = APIRouter(tags=["generate"])


@router.post("/generate", response_model=GenerateResponse, status_code=202)
def generate(payload: GenerateRequest) -> GenerateResponse:
    """Queue one module generation. Returns immediately with a job id."""
    if payload.module_id not in module_ids():
        raise HTTPException(
            status_code=422,
            detail=f"unknown module_id {payload.module_id!r}; expected one of {module_ids()}",
        )
    job_id = jobs.submit(
        asin=payload.asin,
        module_id=payload.module_id,
        brief=payload.brief,
        max_retries=payload.max_retries,
        demo_violation=payload.demo_violation,
        force_fail_first=payload.force_fail_first,
    )
    return GenerateResponse(
        job_id=job_id, status="queued", asin=payload.asin, module_id=payload.module_id
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    job = jobs.status(job_id)
    if job is None:
        # 200 with an explicit not_found status: the frontend polls this on a
        # timer and a 404 would surface as a network error toast on every tick
        # for a job id the user simply mistyped.
        return JobStatusResponse(job_id=job_id, status="not_found")
    return JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        asin=job.get("asin"),
        module_id=job.get("module_id"),
        result=job.get("result"),
        error=job.get("error"),
        created_at=job.get("created_at"),
        updated_at=job.get("updated_at"),
    )
