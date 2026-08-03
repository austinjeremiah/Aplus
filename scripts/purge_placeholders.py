"""Remove placeholder runs so only real model output remains.

The local renderer exists so the queue degrades instead of hard-failing when
every hosted provider is down, and so the rubric can be tested against known
violations without spending anything. Both are development concerns — those
assets are Pillow drawings, not model output, and they should never sit in the
gallery next to real generations.

    .venv/bin/python -m scripts.purge_placeholders --dry-run
    .venv/bin/python -m scripts.purge_placeholders

Deletes the DB rows and the B2 objects behind them. Manifests carry a
GOVERNANCE-mode Object Lock, so removing those needs the bypass capability on
the application key; when that is unavailable the manifest is left in place and
reported rather than failing the purge.
"""

from __future__ import annotations

import argparse
import sys

from app import db
from app.services.storage import get_backend

# Providers that never produce real model output.
PLACEHOLDER_PROVIDERS = {"local-mock", "sim-primary", "sim-fallback", "sim-last-resort"}

# A run that failed because the account had no credit says nothing about the
# provider's reliability — it says the card wasn't topped up. Keeping those
# rows misreports a billing state as an outage in the analytics table.
BILLING_FAILURE_MARKERS = ("402", "insufficient", "no credit", "429", "daily free allocation", "quota")


def _delete_object(key: str, *, bypass: bool = False) -> str:
    """Delete one B2 object. Returns 'ok', 'locked' or an error string."""
    backend = get_backend()
    client = getattr(backend, "_client", None) or getattr(backend, "client", None)
    bucket = getattr(backend, "_bucket", None) or getattr(backend, "bucket", None)

    if bypass and client is not None and bucket:
        try:
            client.delete_object(Bucket=bucket, Key=key, BypassGovernanceRetention=True)
            return "ok"
        except Exception as exc:
            if "AccessDenied" in str(exc) or "Retention" in str(exc):
                return "locked"
            return f"error: {exc}"[:120]
    try:
        backend.delete(key)
        return "ok"
    except Exception as exc:
        if "Retention" in str(exc) or "AccessDenied" in str(exc):
            return "locked"
        return f"error: {exc}"[:120]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    args = ap.parse_args()

    rows = db.list_runs(limit=5000)
    def is_billing_failure(r: dict) -> bool:
        if r.get("status") != "provider_failed":
            return False
        err = (r.get("error") or "").lower()
        return any(m in err for m in BILLING_FAILURE_MARKERS)

    def drop(r: dict) -> bool:
        return (r.get("provider") or "") in PLACEHOLDER_PROVIDERS or is_billing_failure(r)

    targets = [r for r in rows if drop(r)]
    keepers = [r for r in rows if not drop(r)]

    print(f"{len(rows)} runs total")
    print(f"  {len(targets)} placeholder / billing-failure runs to purge")
    print(f"  {len(keepers)} real runs to keep\n")

    if not targets:
        print("nothing to do.")
        return 0

    if args.dry_run:
        for r in targets[:15]:
            print(f"  would delete {r['run_id'][:8]}  {r['provider']:<18} {r['asin']}")
        if len(targets) > 15:
            print(f"  … and {len(targets) - 15} more")
        return 0

    assets = manifests = locked = errors = 0
    for r in targets:
        if r.get("asset_key"):
            res = _delete_object(r["asset_key"])
            if res == "ok":
                assets += 1
            elif res == "locked":
                locked += 1
            else:
                errors += 1
                print(f"  ! asset {r['run_id'][:8]}: {res}")

        uri = r.get("manifest_uri") or ""
        if uri:
            try:
                key = get_backend().key_from_url(uri)
            except Exception:
                key = None
            if key:
                res = _delete_object(key, bypass=True)
                if res == "ok":
                    manifests += 1
                elif res == "locked":
                    locked += 1
                else:
                    errors += 1

    # Children reference parents, so clear the link before deleting rows.
    ids = {r["run_id"] for r in targets}
    with db.connect() as conn:
        for rid in ids:
            conn.execute("UPDATE runs SET parent_run_id = NULL WHERE parent_run_id = ?", (rid,))
        conn.executemany("DELETE FROM runs WHERE run_id = ?", [(rid,) for rid in ids])
        # Jobs whose every run is gone are noise in the review queue.
        conn.execute(
            "DELETE FROM jobs WHERE job_id NOT IN (SELECT DISTINCT job_id FROM runs WHERE job_id IS NOT NULL)"
        )

    print(f"\ndeleted {len(ids)} run rows")
    print(f"  {assets} assets removed from B2")
    print(f"  {manifests} manifests removed from B2")
    if locked:
        print(f"  {locked} objects left in place (Object Lock retention still active)")
    if errors:
        print(f"  {errors} errors")

    remaining = db.list_runs(limit=5000)
    print(f"\n{len(remaining)} runs remain — all real model output")
    return 0


if __name__ == "__main__":
    sys.exit(main())
