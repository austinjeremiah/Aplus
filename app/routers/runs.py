"""Run detail, lineage, and the human-review override."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app import db
from app.models.schemas import ReviewRequest, ReviewResponse

router = APIRouter(tags=["runs"])

# Statuses a run can hold. "needs_review" is set when the rubric could not be
# fully evaluated (judge unreachable), which is deliberately distinct from
# "passed" — see ComplianceReport.status.
REVIEWABLE = {"failed", "needs_review"}


def _shape(row: dict) -> dict:
    compliance = row.get("compliance") or {}
    return {
        "run_id": row["run_id"],
        "parent_run_id": row.get("parent_run_id"),
        "job_id": row.get("job_id"),
        "asin": row["asin"],
        "module_id": row["module_id"],
        "attempt": row.get("attempt", 1),
        "version": row.get("version"),
        "succeeded": row.get("succeeded", row.get("status") != "provider_failed"),
        "provider": row.get("provider"),
        "model": row.get("model"),
        "status": row.get("status"),
        "review_decision": row.get("review_decision"),
        "asset_url": row.get("asset_url"),
        "asset_sha256": row.get("asset_sha256"),
        "manifest_uri": row.get("manifest_uri"),
        "canonical_hash": row.get("canonical_hash"),
        "cost_usd": row.get("cost_usd") or 0.0,
        "duration_sec": row.get("duration_sec"),
        "error": row.get("error"),
        "compliance": compliance or None,
        "violations": compliance.get("violations", []),
        "created_at": row.get("created_at"),
    }


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"run {run_id} not found")
    return _shape(row)


@router.get("/runs/{run_id}/lineage")
def get_lineage(run_id: str) -> list[dict]:
    """Every attempt behind this run, oldest first, failures included."""
    chain = db.get_lineage(run_id)
    if not chain:
        raise HTTPException(404, f"run {run_id} not found")
    return [_shape(r) for r in chain]


@router.get("/runs/{run_id}/export")
def export_run(run_id: str):
    """Download the listing-ready asset with its manifest embedded.

    Two transformations happen here and nowhere else:

    1. the provider's native output is normalised to the module's exact canvas
    2. the manifest is embedded into the file bytes

    Step 2 changes the file's own SHA-256, which is why /verify resolves the
    run by the manifest's run_id rather than by re-hashing the upload.
    """
    from fastapi.responses import FileResponse

    from app.rubric.modules import get_module
    from app.services.export import normalize_to_canvas
    from app.services.manifest import embed_manifest
    from app.services.storage import get_backend

    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"run {run_id} not found")
    if not row.get("asset_key") and not row.get("asset_url"):
        raise HTTPException(409, "this run produced no asset")

    import tempfile
    from pathlib import Path

    workdir = Path(tempfile.mkdtemp(prefix="aplusplus-export-"))
    raw = workdir / "raw"
    try:
        raw.write_bytes(get_backend().get(row["asset_key"]))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(502, f"could not fetch stored asset: {exc}") from exc

    spec = get_module(row["module_id"])
    out = normalize_to_canvas(raw, spec, workdir / f"{row['asin']}-{row['module_id']}.png")

    manifest = _load_manifest(row)
    if manifest is not None:
        embed_manifest(out, manifest)

    return FileResponse(
        out,
        media_type="image/png",
        filename=f"{row['asin']}-{row['module_id']}-{run_id[:8]}.png",
        headers={"X-Aplusplus-Run-Id": run_id},
    )


def _load_manifest(row: dict):
    """Read the run's manifest back out of B2 so it can be embedded."""
    from genblaze_core.models.manifest import parse_manifest

    from app.services.storage import get_backend

    uri = row.get("manifest_uri") or ""
    backend = get_backend()
    key = None
    try:
        key = backend.key_from_url(uri) if uri else None
    except Exception:
        key = None
    if key is None and uri.startswith("s3://"):
        key = uri.split("/", 3)[-1]
    if key is None:
        return None
    try:
        import json

        return parse_manifest(json.loads(backend.get(key).decode("utf-8")))
    except Exception:
        logging.getLogger(__name__).exception("could not load manifest for embedding")
        return None


@router.get("/review")
def review_queue(
    asin: str | None = None,
    module_id: str | None = None,
    limit: int = Query(50, ge=1, le=200),
) -> list[dict]:
    """Runs a human still has to decide on."""
    rows: list[dict] = []
    for status in sorted(REVIEWABLE):
        rows.extend(db.list_runs(asin=asin, module_id=module_id, status=status, limit=limit))
    # Already-decided runs stay out of the queue.
    rows = [r for r in rows if not r.get("review_decision")]
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return [_shape(r) for r in rows[:limit]]


@router.patch("/runs/{run_id}/review", response_model=ReviewResponse)
def review(run_id: str, payload: ReviewRequest) -> ReviewResponse:
    """Human override on a compliance verdict.

    The machine verdict in ``compliance`` is never rewritten — the override is
    recorded alongside it. An auditor needs to see both that the rubric
    rejected an image and that a named human shipped it anyway; collapsing
    those into one field would erase the more interesting half.
    """
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(404, f"run {run_id} not found")

    db.update_run(
        run_id,
        review_decision=payload.decision,
        status="approved" if payload.decision == "approved" else "rejected",
    )
    return ReviewResponse(run_id=run_id, status=payload.decision)
