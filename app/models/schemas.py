"""Request/response models for the public API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class GenerateRequest(BaseModel):
    asin: str = Field(min_length=1, max_length=32)
    module_id: str
    brief: str = Field(min_length=1, max_length=4000)
    max_retries: int | None = Field(default=None, ge=0, le=5)
    # Demo controls — make the failure paths reproducible on stage instead of
    # hoping a live model misbehaves at the right moment.
    demo_violation: Literal["pricing", "safe_zone"] | None = None
    force_fail_first: bool = False

    @field_validator("asin")
    @classmethod
    def _clean_asin(cls, v: str) -> str:
        return v.strip().upper()


class GenerateResponse(BaseModel):
    job_id: str
    status: str
    asin: str
    module_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "in_progress", "complete", "failed", "not_found"]
    asin: str | None = None
    module_id: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ReviewRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=1000)


class ReviewResponse(BaseModel):
    run_id: str
    status: str


class LineageEntry(BaseModel):
    run_id: str
    parent_run_id: str | None = None
    version: int
    attempt: int
    provider: str | None = None
    model: str | None = None
    status: str
    succeeded: bool
    asset_url: str | None = None
    cost_usd: float = 0.0
    error: str | None = None
    compliance: dict[str, Any] | None = None
    created_at: str | None = None


class VerifyResponse(BaseModel):
    valid: bool
    found: bool
    source: str
    manifest: dict[str, Any] | None = None
    integrity: dict[str, Any] | None = None
    run: dict[str, Any] | None = None
    lineage: list[dict[str, Any]] = []
    message: str | None = None
