"""Score listing readiness for runs that predate the readiness feature.

Readiness is computed from the pixels alone — no model call, no provider, no
cost — so every asset already in B2 can be scored after the fact. Without this,
the gallery and the per-ASIN reports show a blank where the score belongs on
everything generated before the feature existed, which reads as broken rather
than as historical.

Fetches each asset from the bucket, scores it, and merges the result into the
run's stored compliance JSON. The compliance verdict itself is never touched:
readiness is a separate axis and rewriting a historical pass/fail would be
falsifying the record.

    PYTHONPATH=. .venv/bin/python scripts/backfill_readiness.py [--dry-run] [--force]
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

import boto3

from app.config import settings
from app.rubric.modules import get_module
from app.rubric.readiness import readiness_report


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    force = "--force" in sys.argv  # re-score rows that already have a score

    client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{settings.b2_region}.backblazeb2.com",
        aws_access_key_id=settings.b2_key_id,
        aws_secret_access_key=settings.b2_app_key,
        region_name=settings.b2_region,
    )

    conn = sqlite3.connect(settings.app_db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT run_id, module_id, asset_key, compliance FROM runs "
        "WHERE asset_key IS NOT NULL AND compliance IS NOT NULL"
    ).fetchall()

    print(f"candidate runs : {len(rows)}")

    tmp = Path(tempfile.mkdtemp(prefix="readiness-backfill-"))
    scored = skipped = failed = 0

    for row in rows:
        try:
            compliance = json.loads(row["compliance"] or "{}")
        except json.JSONDecodeError:
            failed += 1
            continue

        if compliance.get("readiness", {}).get("score") is not None and not force:
            skipped += 1
            continue

        try:
            key = row["asset_key"]
            local = tmp / f"{row['run_id']}{Path(key).suffix or '.png'}"
            client.download_file(settings.b2_bucket, key, str(local))

            report = readiness_report(local, get_module(row["module_id"]))
            if report.unavailable:
                print(f"  unscorable {row['run_id'][:8]}: {report.unavailable}")
                failed += 1
                continue

            compliance["readiness"] = report.as_dict()
            if dry_run:
                print(f"  would score {row['run_id'][:8]} {row['module_id']:22} -> {report.score}")
            else:
                conn.execute(
                    "UPDATE runs SET compliance = ? WHERE run_id = ?",
                    (json.dumps(compliance), row["run_id"]),
                )
            scored += 1
            local.unlink(missing_ok=True)
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"  FAILED {row['run_id'][:8]}: {type(exc).__name__}: {str(exc)[:90]}")
            failed += 1

    if not dry_run:
        conn.commit()
    conn.close()

    verb = "would score" if dry_run else "scored"
    print(f"\n{verb}: {scored}   already had one: {skipped}   failed: {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
