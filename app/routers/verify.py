"""Public provenance verification.

Three ways in, in order of strength:

1. An **embedded manifest** in the uploaded file — full provenance with no
   prior knowledge of the file.
2. The uploaded bytes' **SHA-256** matched against stored assets — works even
   when the file carries no manifest, as long as it is byte-identical to
   something we generated.
3. A **run id or hash pasted by hand** — the escape hatch when someone has a
   reference but not the file.

Deliberately unauthenticated: the entire point is that a third party (an
Amazon reviewer, a client) can check a claim without an account.
"""

from __future__ import annotations

import hashlib
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app import db
from app.models.schemas import VerifyResponse
from app.routers.runs import _shape
from app.services.manifest import extract_manifest
from app.services.storage import verify_manifest

logger = logging.getLogger(__name__)
router = APIRouter(tags=["verify"])

MAX_UPLOAD = 25 * 1024 * 1024
ALLOWED = {"image/png", "image/jpeg", "image/webp"}


@router.post("/verify", response_model=VerifyResponse)
async def verify(
    file: UploadFile | None = File(default=None),
    run_id: str | None = Form(default=None),
    sha256: str | None = Form(default=None),
) -> VerifyResponse:
    if file is None and not run_id and not sha256:
        raise HTTPException(422, "provide a file, a run_id, or a sha256")

    # --- lookup by reference, no file needed ---------------------------
    if file is None:
        row = db.get_run(run_id) if run_id else db.find_run_by_sha256((sha256 or "").lower())
        if row is None:
            return VerifyResponse(
                valid=False, found=False, source="reference",
                message="no run matches that reference",
            )
        return _respond(row, source="reference", manifest=None)

    # --- file upload ---------------------------------------------------
    data = await file.read()
    if not data:
        raise HTTPException(422, "empty upload")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, f"file exceeds {MAX_UPLOAD // 1024 // 1024}MB")
    if file.content_type and file.content_type not in ALLOWED:
        raise HTTPException(415, f"unsupported type {file.content_type}; expected PNG/JPEG/WebP")

    digest = hashlib.sha256(data).hexdigest()
    tmp_dir = Path(tempfile.mkdtemp(prefix="aplusplus-verify-"))
    tmp = tmp_dir / (file.filename or "upload.png")
    tmp.write_bytes(data)

    manifest = extract_manifest(tmp)

    if manifest is not None:
        integrity = verify_manifest(manifest)
        # Look the run up by id from the manifest, NOT by re-hashing the
        # upload: embedding a manifest rewrites the file, so the uploaded
        # bytes legitimately no longer hash to the value the manifest records
        # for the original asset.
        row = db.get_run(getattr(manifest.run, "run_id", "") or "")
        return _respond(
            row,
            source="embedded_manifest",
            manifest=manifest,
            integrity=integrity,
            upload_sha256=digest,
        )

    # No embedded manifest — fall back to matching the raw bytes.
    row = db.find_run_by_sha256(digest)
    if row is None:
        return VerifyResponse(
            valid=False,
            found=False,
            source="sha256_lookup",
            message=(
                "No manifest is embedded in this file and its SHA-256 does not match "
                "any asset we generated. If you have the run ID, paste it instead."
            ),
        )
    return _respond(row, source="sha256_lookup", manifest=None, upload_sha256=digest)


def _respond(
    row: dict | None,
    *,
    source: str,
    manifest=None,
    integrity: dict | None = None,
    upload_sha256: str | None = None,
) -> VerifyResponse:
    manifest_dict = None
    if manifest is not None:
        try:
            manifest_dict = manifest.model_dump(mode="json")
        except Exception:
            manifest_dict = {"canonical_hash": getattr(manifest, "canonical_hash", None)}

    lineage: list[dict] = []
    if row is not None:
        lineage = [_shape(r) for r in db.get_lineage(row["run_id"])]

    if integrity is None and manifest is None and row is not None:
        # Reference/hash lookups have no manifest object to recompute, but the
        # stored canonical hash is still meaningful provenance.
        integrity = {
            "valid": bool(row.get("canonical_hash")),
            "hash_ok": bool(row.get("canonical_hash")),
            "canonical_hash": row.get("canonical_hash"),
            "unverified_assets": [],
            "invalid_metadata": [],
            "note": "verified against the stored manifest record, not a re-computed hash",
        }

    valid = bool(integrity and integrity.get("valid")) and row is not None
    return VerifyResponse(
        valid=valid,
        found=row is not None,
        source=source,
        manifest=manifest_dict,
        integrity=integrity,
        run=_shape(row) if row else None,
        lineage=lineage,
        message=None if row is not None else "manifest found but no matching run on record",
    )
