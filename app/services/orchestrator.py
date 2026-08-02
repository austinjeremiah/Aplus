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


def _corrective_prompt(
    module_id: str, brief: str, report: ComplianceReport
) -> tuple[str, str]:
    """Turn a rejection into a corrected (positive_prompt, extra_negatives).

    Repeating an identical prompt and hoping for different sampling is what
    makes naive retry loops burn budget, so the violation must feed back. But
    it must feed back into the NEGATIVE prompt, never the positive one:
    "remove the brand mark amazon" puts the token "amazon" straight back in
    front of a model that cannot process negation, which reproduces the exact
    violation being corrected. Positive text only ever gains *additive*
    descriptions of what should be there instead.
    """
    spec = get_module(module_id)
    positive_additions: list[str] = []
    negatives: list[str] = []

    for v in report.errors:
        evidence = v.evidence.strip()
        # The offending text itself is the single most valuable negative token.
        if evidence and len(evidence) < 60:
            negatives.append(evidence)

        if v.rule == "pricing":
            negatives += ["price", "discount", "percent off", "sale badge"]
        elif v.rule == "superlative":
            negatives += ["award badge", "ranking badge", "best seller label"]
        elif v.rule == "competitor":
            negatives += ["brand name", "brand logo", "engraved logo", "printed label"]
            positive_additions.append("completely unbranded plain product surface")
        elif v.rule == "contact_info":
            negatives += ["website url", "phone number", "QR code", "email address"]
        elif v.rule == "warranty":
            negatives += ["warranty badge", "guarantee seal", "shipping banner"]
        elif v.rule.startswith("safe_zone"):
            negatives += ["text at bottom", "label at bottom", "caption at bottom"]
            positive_additions.append(
                f"the lower {spec['safe_zone_pct']}% of the frame is empty "
                "seamless background with nothing in it"
            )

    prompt = build_prompt(module_id, brief)
    if positive_additions:
        prompt = f"{prompt} {'. '.join(dict.fromkeys(positive_additions))}."
    return prompt, ", ".join(dict.fromkeys(negatives))


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
    negative_extra: str = ""

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
            negative_extra=negative_extra,
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
            status=report.status,
            compliance=report.as_dict(),
        )

        if report.status == "needs_review":
            # Regenerating cannot fix an unreachable judge; escalate instead.
            logger.warning(
                "%s/%s attempt %d could not be fully audited (%s) — routing to review",
                asin, module_id, attempt_no, report.notes,
            )
            break

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
        prompt_override, negative_extra = _corrective_prompt(module_id, brief, report)

    return result
