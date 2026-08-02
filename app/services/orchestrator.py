"""The closed loop: generate → score → retry → lineage.

This is the module the whole system exists for. Everything else is a
component; this is the policy that connects them:

    generate ──► compliance ──► pass? ──► approved
                     │                      ▲
                     └── fail ──► regenerate with a corrective prompt,
                                  linked to the rejected run via
                                  parent_run_id ─────────────────────┘

Each retry is a *new run* rather than an overwrite, so the rejected image and
the reason it was rejected both survive. That is what makes the lineage
auditable rather than merely a status field that flipped.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from app import db
from app.config import settings
from app.rubric.modules import get_module
from app.services.compliance import ComplianceReport, compliance_report
from app.services.export import normalize_to_canvas
from app.services.pipeline import GenerationOutcome, build_prompt, generate_module

logger = logging.getLogger(__name__)


@dataclass
class Attempt:
    outcome: GenerationOutcome
    report: ComplianceReport | None

    def as_dict(self) -> dict[str, Any]:
        return {
            **self.outcome.as_dict(),
            "compliance": self.report.as_dict() if self.report else None,
        }


@dataclass
class LoopResult:
    asin: str
    module_id: str
    approved: bool
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def final(self) -> Attempt | None:
        return self.attempts[-1] if self.attempts else None

    @property
    def total_cost(self) -> float:
        return sum(a.outcome.cost_usd for a in self.attempts)

    def as_dict(self) -> dict[str, Any]:
        final = self.final
        return {
            "asin": self.asin,
            "module_id": self.module_id,
            "approved": self.approved,
            "attempts": len(self.attempts),
            "total_cost_usd": round(self.total_cost, 4),
            "run_id": final.outcome.run_id if final else None,
            "asset_url": final.outcome.asset_url if final else None,
            "manifest_uri": final.outcome.manifest_uri if final else None,
            "compliance": final.report.as_dict() if final and final.report else None,
            "lineage": [a.as_dict() for a in self.attempts],
        }


def _corrective_prompt(module_id: str, brief: str, report: ComplianceReport) -> str:
    """Re-prompt that names the specific failure instead of retrying blindly.

    Repeating an identical prompt and hoping for different sampling is what
    makes naive retry loops burn budget. Feeding the violation back turns the
    retry into a correction.
    """
    base = build_prompt(module_id, brief)
    fixes = []
    for v in report.errors:
        if v.rule == "pricing":
            fixes.append(
                f'remove all pricing and discount text (the previous attempt showed "{v.evidence}")'
            )
        elif v.rule == "superlative":
            fixes.append(f'remove ranking or award claims (previously "{v.evidence}")')
        elif v.rule == "competitor":
            fixes.append(f'remove the third-party brand mark "{v.evidence}"')
        elif v.rule == "contact_info":
            fixes.append(f'remove contact details or URLs (previously "{v.evidence}")')
        elif v.rule == "warranty":
            fixes.append(f'remove warranty or shipping claims (previously "{v.evidence}")')
        elif v.rule.startswith("safe_zone"):
            spec = get_module(module_id)
            fixes.append(
                f"keep the bottom {spec['safe_zone_pct']}% of the frame completely free of "
                "text and faces — use empty background there"
            )
        elif v.rule == "dimensions":
            fixes.append("render at the exact module canvas size")

    if not fixes:
        return base
    return (
        f"{base}\n\nThe previous attempt was REJECTED for Amazon A+ policy violations. "
        f"You must fix all of the following: {'; '.join(fixes)}. "
        "Produce a clean image with no overlaid promotional text of any kind."
    )


def _local_copy(outcome: GenerationOutcome) -> Path | None:
    """Fetch the stored asset locally so Pillow and the vision judge can read it."""
    url = outcome.asset_url
    if not url:
        return None
    try:
        if url.startswith("file://"):
            return Path(url[7:])
        if outcome.asset_key:
            from app.services.storage import get_backend

            data = get_backend().get(outcome.asset_key)
        else:
            data = httpx.get(url, timeout=60, follow_redirects=True).content
        out = Path(tempfile.mkdtemp(prefix="aplusplus-score-")) / "asset.png"
        out.write_bytes(data)
        return out
    except Exception:
        logger.exception("could not fetch asset for scoring: %s", url)
        return None


def generate_compliant(
    *,
    asin: str,
    module_id: str,
    brief: str,
    job_id: str | None = None,
    max_retries: int | None = None,
    force_fail_first: bool = False,
    demo_violation: str | None = None,
) -> LoopResult:
    """Generate until the asset passes the rubric or the retry budget runs out.

    ``demo_violation`` makes the local mock provider emit a deliberately
    non-compliant image on the first attempt, so the reject-and-retry path can
    be demonstrated on cue rather than hoped for.
    """
    spec = get_module(module_id)
    budget = settings.max_compliance_retries if max_retries is None else max_retries
    result = LoopResult(asin=asin, module_id=module_id, approved=False)

    parent_outcome: GenerationOutcome | None = None
    prompt_override: str | None = None

    for attempt_no in range(1, budget + 2):  # first attempt + retries
        if demo_violation and attempt_no == 1:
            from app.services.providers import ProviderSlot
            from app.services.mock_image import local_image_provider

            chain = (
                ProviderSlot(
                    key="local-mock",
                    provider=local_image_provider(violation=demo_violation),
                    model="local-mock-v1",
                    est_cost_usd=0.0,
                ),
            )
        else:
            chain = None

        outcome = generate_module(
            asin=asin,
            module_id=module_id,
            brief=brief,
            job_id=job_id,
            parent_run=parent_outcome.result if parent_outcome else None,
            attempt=attempt_no,
            prompt_override=prompt_override,
            force_fail_first=force_fail_first and attempt_no == 1,
            chain=chain,
        )

        if not outcome.ok:
            result.attempts.append(Attempt(outcome, None))
            logger.error("all providers failed on attempt %d for %s", attempt_no, asin)
            break

        local = _local_copy(outcome)
        if local is None:
            report = ComplianceReport(
                passed=False,
                degraded=True,
                notes="asset could not be retrieved for scoring",
            )
        else:
            # Score the normalised export, not the provider's native output:
            # the export is what would actually be published to the listing,
            # and no provider emits Amazon's exact canvas on its own.
            try:
                scored = normalize_to_canvas(local, spec)
            except Exception:
                logger.exception("canvas normalisation failed; scoring raw output")
                scored = local
            report = compliance_report(scored, spec)
            outcome.export_path = str(scored)

        result.attempts.append(Attempt(outcome, report))
        db.update_run(
            outcome.run_id,
            status="passed" if report.passed else "failed",
            compliance=report.as_dict(),
        )

        if report.passed:
            result.approved = True
            logger.info(
                "%s/%s approved on attempt %d via %s",
                asin,
                module_id,
                attempt_no,
                outcome.slot.label if outcome.slot else "?",
            )
            break

        logger.info(
            "%s/%s attempt %d rejected: %s",
            asin,
            module_id,
            attempt_no,
            report.summary(),
        )
        parent_outcome = outcome
        prompt_override = _corrective_prompt(module_id, brief, report)

    return result
