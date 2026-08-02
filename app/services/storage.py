"""Storage layer — dual-layout B2 sinks plus manifest read-back.

Two views over the same generated assets:

* HIERARCHICAL      ``{prefix}/runs/{asin}/{date}/{run_id}/...``  — "By ASIN"
* CONTENT_ADDRESSABLE ``{prefix}/assets/{ab}/{cd}/{sha256}.png``  — deduped library

Both are backed by the same B2 bucket. The gallery's view toggle is a real
storage-layout difference, not a UI filter.

``ObjectStorageSink`` is single-use: ``.run()`` closes it in a ``finally``
block, so a fresh sink must be constructed for every pipeline run. All
factories here return new instances for that reason.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from genblaze_core import (
    KeyStrategy,
    Manifest,
    ObjectLockConfig,
    ObjectStorageSink,
    ParquetSink,
    StorageBackend,
)

from app.config import settings
from app.services.local_backend import LocalStorageBackend

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_backend() -> StorageBackend:
    """Return the B2 backend, or a local filesystem stand-in if unconfigured.

    Cached: the backend is stateless and thread-safe, unlike the sinks that
    wrap it.
    """
    if not settings.b2_configured:
        logger.warning(
            "B2 credentials absent — using local filesystem backend at %s. "
            "Set B2_KEY_ID/B2_APP_KEY/B2_BUCKET in .env for real B2 storage.",
            settings.local_storage_path,
        )
        return LocalStorageBackend(settings.local_storage_path)

    from genblaze_s3 import S3StorageBackend

    return S3StorageBackend.for_backblaze(
        settings.b2_bucket,
        region=settings.b2_region,
        key_id=settings.b2_key_id,
        app_key=settings.b2_app_key,
        # Verify bucket + region at construction so bad credentials fail here
        # with a clear message rather than mid-upload after a paid generation.
        preflight=True,
    )


def _manifest_lock() -> ObjectLockConfig | None:
    """GOVERNANCE-mode retention for manifests only.

    Deliberately not bucket-wide COMPLIANCE retention: that would make every
    object in the bucket — including development junk — undeletable by anyone
    including the account root for the whole window. Locking just the manifest
    gives the same tamper-evidence for provenance while leaving assets
    manageable.
    """
    days = settings.manifest_retention_days
    if not settings.b2_configured or days <= 0:
        return None
    return ObjectLockConfig(
        retain_until=datetime.now(timezone.utc) + timedelta(days=days),
        mode="GOVERNANCE",
    )


def _parquet_sink() -> ParquetSink | None:
    """Structured run/step/asset tables that back the analytics endpoints."""
    try:
        settings.parquet_path.mkdir(parents=True, exist_ok=True)
        return ParquetSink(settings.parquet_path)
    except Exception:  # pragma: no cover - pyarrow missing / disk issue
        logger.exception("ParquetSink unavailable — analytics will be empty")
        return None


# ---------------------------------------------------------------------------
# Sinks — construct a fresh one per pipeline run
# ---------------------------------------------------------------------------
def hierarchical_sink(tenant_id: str) -> ObjectStorageSink:
    """Per-ASIN run folders. ``tenant_id`` is the ASIN."""
    return ObjectStorageSink(
        get_backend(),
        prefix=settings.storage_prefix,
        key_strategy=KeyStrategy.HIERARCHICAL,
        parquet_sink=_parquet_sink(),
        manifest_lock=_manifest_lock(),
    )


def content_addressable_sink() -> ObjectStorageSink:
    """SHA-256 addressed dedup library — identical bytes land on one key."""
    return ObjectStorageSink(
        get_backend(),
        prefix=settings.storage_prefix,
        key_strategy=KeyStrategy.CONTENT_ADDRESSABLE,
        manifest_lock=_manifest_lock(),
    )


# ---------------------------------------------------------------------------
# Read-back
# ---------------------------------------------------------------------------
def read_manifest(sink: ObjectStorageSink, run) -> Manifest:
    """Fetch a stored manifest, verifying its canonical hash.

    Raises ``ManifestError`` on hash mismatch — that is the tamper signal.
    """
    return sink.read_manifest(run)


def durable_url(key: str) -> str:
    """Credential-free, non-expiring URL — safe to persist in the DB."""
    return get_backend().get_durable_url(key)


def verify_manifest(manifest: Manifest) -> dict:
    """Structured integrity check, for the public /verify page.

    ``verify()`` collapses to a single bool; ``verification_report()`` keeps
    the reason apart from the verdict, which matters here — "hash was
    tampered with" and "an output is missing its sha256" are very different
    claims to put in front of someone auditing provenance.
    """
    report = manifest.verification_report()
    return {
        "valid": report.ok,
        "hash_ok": report.hash_ok,
        "canonical_hash": manifest.canonical_hash,
        "unverified_assets": list(report.unverified_sha256_ids),
        "invalid_metadata": list(report.invalid_metadata_ids),
    }
