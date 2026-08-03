"""Backfill the content-addressable layout from existing hierarchical runs.

generate_module() only started mirroring into ``assets/{ab}/{cd}/{sha256}``
recently, so every run made before that exists solely under
``runs/{asin}/{date}/{run_id}/``. This walks those and server-side copies each
asset to its content-addressed key.

Additive and idempotent: the destination key is derived from the bytes, so
re-running copies over identical content and never produces duplicates.
Nothing is deleted, and the hierarchical tree is left untouched.

    .venv/bin/python scripts/backfill_content_addressable.py [--dry-run]
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import PurePosixPath

import boto3

from app.config import settings


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{settings.b2_region}.backblazeb2.com",
        aws_access_key_id=settings.b2_key_id,
        aws_secret_access_key=settings.b2_app_key,
        region_name=settings.b2_region,
    )
    bucket = settings.b2_bucket
    prefix = settings.storage_prefix

    keys: list[str] = []
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        keys += [o["Key"] for o in page.get("Contents", [])]

    existing = {k for k in keys if f"{prefix}/assets/" in k and "/runs/" not in k}
    sources = [
        k
        for k in keys
        if "/runs/" in k and "/assets/" in k and not k.endswith("manifest.json")
    ]

    print(f"bucket            : {bucket}")
    print(f"run assets found  : {len(sources)}")
    print(f"already mirrored  : {len(existing)}")
    print()

    copied = skipped = failed = 0
    for src in sources:
        try:
            # The stored sha256 is not in the key, so hash the object. These are
            # ~100KB images; reading them is cheaper than getting this wrong.
            body = client.get_object(Bucket=bucket, Key=src)["Body"].read()
            sha = hashlib.sha256(body).hexdigest()
            ext = PurePosixPath(src).suffix or ".png"
            dest = f"{prefix}/assets/{sha[:2]}/{sha[2:4]}/{sha}{ext}"

            if dest in existing:
                skipped += 1
                continue

            if dry_run:
                print(f"  would copy  {src.rsplit('/', 1)[-1]}  ->  {dest}")
            else:
                client.copy_object(
                    Bucket=bucket, Key=dest, CopySource={"Bucket": bucket, "Key": src}
                )
            existing.add(dest)
            copied += 1
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"  FAILED {src}: {type(exc).__name__}: {exc}")
            failed += 1

    verb = "would copy" if dry_run else "copied"
    print()
    print(f"{verb}: {copied}   already present: {skipped}   failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
