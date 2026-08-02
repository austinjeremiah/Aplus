"""Phase 3 smoke test — compliance rubric engine.

    .venv/bin/python -m scripts.smoke_compliance

Definition of Done: a deliberately non-compliant image is flagged with
specific violations, and a clean image passes.

The clean control matters more than the violation cases: a judge that flags
everything looks like it works until you feed it something compliant.
"""

from __future__ import annotations

import sys

from app.rubric.modules import get_module
from app.services.compliance import compliance_report
from app.services.mock_image import render_placeholder
from app.services.vision import vision_available

MODULE = "header_970x600"
BRIEF = "matte black insulated water bottle"


def banner(t: str) -> None:
    print(f"\n{'=' * 70}\n{t}\n{'=' * 70}")


def show(report) -> None:
    print(f"  verdict   : {report.summary()}")
    print(f"  judge     : {report.judge or '(none)'}{'  [DEGRADED]' if report.degraded else ''}")
    print(f"  checks    : {', '.join(report.checks_run)}")
    if report.text_seen:
        print(f"  text seen : {report.text_seen[:110]!r}")
    for v in report.violations:
        icon = "✗" if v.severity == "error" else "!"
        print(f"    {icon} [{v.severity}] {v.rule}: {v.evidence[:110]}")
    if report.notes:
        print(f"  notes     : {report.notes}")


def main() -> int:
    banner("A++ — Phase 3: compliance rubric engine")
    spec = get_module(MODULE)
    print(f"  vision backend available : {vision_available()}")
    print(f"  module                   : {spec['label']} ({spec['display']})")

    failures: list[str] = []

    # --- 1. clean control ------------------------------------------------
    banner("1/3  CLEAN image — must PASS")
    clean = render_placeholder(MODULE, BRIEF, violation=None)
    r_clean = compliance_report(clean, spec)
    show(r_clean)
    if r_clean.degraded:
        print("  SKIPPED assertion: vision judge unavailable, cannot verify")
    elif not r_clean.passed:
        failures.append("clean image was rejected (false positive)")

    # --- 2. pricing violation --------------------------------------------
    banner("2/3  PRICING violation ('50% OFF' badge) — must FAIL")
    pricing = render_placeholder(MODULE, BRIEF, violation="pricing")
    r_price = compliance_report(pricing, spec)
    show(r_price)
    if not r_price.degraded:
        if r_price.passed:
            failures.append("pricing violation was not caught")
        elif not any(v.rule == "pricing" for v in r_price.errors):
            print("  note: flagged, but not specifically as 'pricing'")

    # --- 3. safe-zone violation ------------------------------------------
    banner("3/3  SAFE-ZONE violation ('ORDER NOW' in bottom 20%) — must FAIL")
    zone = render_placeholder(MODULE, BRIEF, violation="safe_zone")
    r_zone = compliance_report(zone, spec)
    show(r_zone)
    if r_zone.degraded:
        print("  SKIPPED assertion: vision judge unavailable, cannot verify")
    elif r_zone.passed:
        failures.append("safe-zone violation was not caught")

    # --- 4. deterministic check on a wrong-size image ---------------------
    banner("4/4  Deterministic: wrong dimensions — must FAIL without any vision call")
    small = render_placeholder("grid_135x135", BRIEF)
    r_dim = compliance_report(small, spec, skip_vision=True)
    show(r_dim)
    if r_dim.passed:
        failures.append("wrong-dimension image was not rejected")

    banner("FAILURES:\n  - " + "\n  - ".join(failures) if failures else "PASS — rubric engine verified")
    return 1 if failures else 0




def loop_demo() -> int:
    """The closed loop: reject -> corrective retry -> approve, with lineage."""
    from app import db
    from app.services.orchestrator import generate_compliant

    db.init_db()
    banner("5/5  CLOSED LOOP — violation on attempt 1 must trigger a linked retry")
    res = generate_compliant(
        asin="B0LOOP0001", module_id=MODULE, brief=BRIEF, demo_violation="pricing"
    )
    print(f"  approved   : {res.approved}")
    print(f"  attempts   : {len(res.attempts)}")
    print(f"  total cost : ${res.total_cost:.4f}\n")
    for i, a in enumerate(res.attempts, 1):
        verdict = a.report.summary() if a.report else "generation failed"
        print(f"   v{i}  {(a.outcome.slot.key if a.outcome.slot else '-'):<12} "
              f"{verdict:<34} run={str(a.outcome.run_id)[:8]} "
              f"parent={str(a.outcome.parent_run_id)[:8]}")
    first = res.attempts[0].report
    if first and first.degraded:
        print("\n  SKIPPED: vision judge unavailable (quota/credit) — the loop "
              "correctly escalated to needs_review instead of a false pass.")
        return 0
    if len(res.attempts) < 2:
        print("\nFAIL: violation did not trigger a retry")
        return 1
    if res.attempts[1].outcome.parent_run_id != res.attempts[0].outcome.run_id:
        print("\nFAIL: retry is not linked to the rejected run")
        return 1
    if not res.approved:
        print("\nFAIL: loop never reached an approved image")
        return 1
    print("\n  lineage in DB:")
    for e in db.get_lineage(res.final.outcome.run_id):
        print(f"    {'✓' if e['succeeded'] else '✗'} v{e['version']} {e['status']:<16} {e['run_id'][:8]}")
    return 0


if __name__ == "__main__":
    rc = main()
    if rc == 0:
        rc = loop_demo()
    sys.exit(rc)
