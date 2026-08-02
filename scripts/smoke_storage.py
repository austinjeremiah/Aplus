"""Phase 1 smoke test — prove the storage layer end to end.

Runs a real Pipeline through MockProvider (no API keys, no cost, no network)
into both sink layouts, then reads the manifest back and verifies its hash.

    .venv/bin/python -m scripts.smoke_storage

Definition of Done: asset + manifest land in storage, manifest verifies, and
a durable URL resolves.
"""

from __future__ import annotations

import sys

from genblaze_core import Modality, Pipeline

from app.config import settings
from app.db import init_db
from app.services.mock_image import local_image_provider
from app.services.storage import (
    content_addressable_sink,
    get_backend,
    hierarchical_sink,
    verify_manifest,
)

ASIN = "B0SMOKE001"


def banner(text: str) -> None:
    print(f"\n{'=' * 68}\n{text}\n{'=' * 68}")


def run_once(sink, label: str) -> bool:
    print(f"\n--- {label} ---")
    result = (
        Pipeline(f"smoke-{label}", tenant_id=ASIN)
        .step(
            local_image_provider(),
            model="local-mock-v1",
            prompt="a matte black stainless steel water bottle on a marble surface",
            modality=Modality.IMAGE,
            aspect_ratio="16:9",
            metadata={"module_id": "header_970x600", "asin": ASIN},
        )
        .run(sink=sink, raise_on_failure=True)
    )

    run, manifest = result.run, result.manifest
    print(f"run_id         : {run.run_id}")
    print(f"canonical_hash : {manifest.canonical_hash[:32]}...")

    assets = [a for step in run.steps for a in step.assets]
    if not assets:
        print("FAIL: no output assets")
        return False

    asset = assets[0]
    print(f"asset url      : {asset.url}")
    print(f"asset sha256   : {(asset.sha256 or '')[:32]}...")

    report = verify_manifest(manifest)
    print(f"manifest valid : {report['valid']}  (hash_ok={report['hash_ok']})")
    if not report["valid"]:
        print(f"  unverified={report['unverified_assets']} invalid={report['invalid_metadata']}")

    backend = get_backend()
    key = backend.key_from_url(asset.url) if hasattr(backend, "key_from_url") else None
    if key:
        print(f"object key     : {key}")
        print(f"exists in store: {backend.exists(key)}")
        print(f"durable url    : {backend.get_durable_url(key)}")

    return bool(report["valid"])


def main() -> int:
    banner("A++ — Phase 1 storage smoke test")
    for k, v in settings.describe().items():
        print(f"  {k:18}: {v}")

    init_db()
    print("\n  sqlite schema     : initialised")

    ok = run_once(hierarchical_sink(tenant_id=ASIN), "HIERARCHICAL (by ASIN)")
    ok &= run_once(content_addressable_sink(), "CONTENT_ADDRESSABLE (dedup)")

    banner("PASS — storage layer verified" if ok else "FAIL — see errors above")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
