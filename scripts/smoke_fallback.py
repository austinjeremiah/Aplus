"""Phase 2 smoke test — fallback chain + lineage.

    .venv/bin/python -m scripts.smoke_fallback

Definition of Done: intentionally breaking the primary provider still yields a
completed, stored, verified image from the next provider, and parent_run_id
correctly links the attempt chain.
"""

from __future__ import annotations

import sys

from app import db
from app.config import settings
from app.services.pipeline import generate_module
from app.services.providers import chain_summary, provider_chain, simulated_chain
from app.services.storage import verify_manifest

ASIN = "B0FALLBK01"
MODULE = "header_970x600"
BRIEF = "insulated matte-black stainless steel water bottle, 32oz, outdoorsy"


def banner(text: str) -> None:
    print(f"\n{'=' * 70}\n{text}\n{'=' * 70}")


def show_chain() -> None:
    print("\nProvider chain:")
    for slot in chain_summary():
        print(
            f"  {slot['position']}. {slot['provider']:<12} {slot['model']:<34} "
            f"${slot['est_cost_usd']:.4f}/img  ({slot['role']})"
        )


def main() -> int:
    banner("A++ — Phase 2: provider fallback + lineage")
    for k, v in settings.describe().items():
        print(f"  {k:18}: {v}")
    show_chain()

    db.init_db()

    # --- 1. Happy path -------------------------------------------------
    banner("1/3  Normal generation (primary provider succeeds)")
    first = generate_module(asin=ASIN, module_id=MODULE, brief=BRIEF)
    if not first.ok:
        print("FAIL: baseline generation did not succeed")
        for f in first.failures:
            print(f"   {f.provider}/{f.model}: {f.error[:160]}")
        return 1
    print(f"  provider   : {first.slot.label}")
    print(f"  run_id     : {first.run_id}")
    print(f"  asset      : {first.asset_url}")
    print(f"  cost       : ${first.cost_usd:.4f}   in {first.duration_sec:.2f}s")
    print(f"  manifest   : {verify_manifest(first.result.manifest)['valid']}")

    # --- 2. Forced primary failure -------------------------------------
    banner("2/3  Primary provider sabotaged (bad model slug) — must fall through")
    # A real multi-provider chain needs credentials we may not have, but the
    # logic under test — chain walk, failure bookkeeping, lineage link — is
    # credential-independent. Use the simulated chain when the real one is
    # too short, so this assertion always actually runs.
    real_chain = provider_chain()
    if len(real_chain) >= 2:
        chain, origin = real_chain, "real providers"
    else:
        chain, origin = simulated_chain(), "simulated chain (no multi-provider creds yet)"
    print(f"  using        : {origin}")
    print(f"  chain        : {' -> '.join(s.key for s in chain)}")

    fallback = generate_module(
        asin=ASIN,
        module_id=MODULE,
        brief=BRIEF,
        parent_run=first.result,
        attempt=2,
        force_fail_first=(chain is real_chain),
        chain=chain,
    )
    if not fallback.ok:
        print("FAIL: chain exhausted instead of falling back")
        for f in fallback.failures:
            print(f"   {f.provider}/{f.model}: {f.error[:160]}")
        return 1
    if not fallback.failures:
        print("FAIL: expected the primary provider to fail, but nothing did")
        return 1
    print(f"  failed first : {[f.provider for f in fallback.failures]}")
    print(f"  succeeded on : {fallback.slot.label}")
    print(f"  run_id       : {fallback.run_id}")
    print(f"  parent_run_id: {fallback.parent_run_id}")
    if fallback.parent_run_id != first.run_id:
        print("FAIL: parent_run_id does not point at the previous run")
        return 1
    if fallback.slot.key == chain[0].key:
        print("FAIL: the sabotaged primary appears to have succeeded")
        return 1
    print("  lineage link : OK")

    # --- 3. Lineage walk ------------------------------------------------
    banner("3/3  Lineage chain (walks parent_run_id backwards)")
    tip = (fallback or first).run_id
    lineage = db.get_lineage(tip)
    for entry in lineage:
        marker = "✓" if entry["status"] == "generated" else "✗"
        print(
            f"  {marker} v{entry['version']}  {entry['status']:<16} "
            f"{(entry['provider'] or '-'):<12} {(entry['model'] or '-'):<38} "
            f"{entry['run_id'][:8]}"
        )

    attempts = db.list_runs(asin=ASIN, limit=50)
    failed = [r for r in attempts if r["status"] == "provider_failed"]
    print(f"\n  total attempts persisted : {len(attempts)}")
    print(f"  provider failures logged : {len(failed)}")
    if not failed:
        print("FAIL: sabotaged provider was not recorded as a failed attempt")
        return 1

    banner("PASS — fallback chain and lineage verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
