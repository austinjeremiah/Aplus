"""Generation service — multi-provider fallback with full attempt lineage.

Two layers of resilience, deliberately kept distinct:

* **Fallback (this module, horizontal)** — provider A is down or the model
  slug is wrong, so try provider B. The user still gets an image.
* **Retry (compliance layer, vertical)** — the image generated fine but broke
  an Amazon rule, so generate a *new* run linked to the rejected one via
  ``parent_run_id``. The user gets a compliant image and an audit trail of
  why the first attempt was thrown away.

Every attempt is persisted before the outcome is known, so a crash mid-run
still leaves a queryable record. That is the difference between "we retry"
and "we can prove what we retried and why".
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from genblaze_core import Modality, Pipeline
from genblaze_core.exceptions import GenblazeError
from genblaze_core.pipeline.result import PipelineResult

from app import db
from app.rubric.modules import get_module
from app.services.providers import ProviderSlot, provider_chain
from app.services.storage import hierarchical_sink

logger = logging.getLogger(__name__)


@dataclass
class AttemptError:
    """One failed link in the chain — kept for the run-detail error panel."""

    provider: str
    model: str
    error: str

    def as_dict(self) -> dict[str, str]:
        return {"provider": self.provider, "model": self.model, "error": self.error}


@dataclass
class GenerationOutcome:
    """Result of one generate_module() call, successful or not."""

    run_id: str | None
    result: PipelineResult | None
    slot: ProviderSlot | None
    asset_url: str | None
    asset_key: str | None
    asset_sha256: str | None
    manifest_uri: str | None
    canonical_hash: str | None
    cost_usd: float
    duration_sec: float
    attempt: int
    parent_run_id: str | None
    failures: list[AttemptError] = field(default_factory=list)
    export_path: str | None = None

    @property
    def ok(self) -> bool:
        return self.result is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "parent_run_id": self.parent_run_id,
            "attempt": self.attempt,
            "provider": self.slot.key if self.slot else None,
            "model": self.slot.model if self.slot else None,
            "asset_url": self.asset_url,
            "asset_sha256": self.asset_sha256,
            "manifest_uri": self.manifest_uri,
            "canonical_hash": self.canonical_hash,
            "cost_usd": self.cost_usd,
            "duration_sec": round(self.duration_sec, 2),
            "fallbacks_tried": [f.as_dict() for f in self.failures],
        }


def build_prompt(module_id: str, brief: str) -> str:
    """Compose the brief into a module-aware, rule-aware prompt.

    The negative constraints are not decoration — they front-load the same
    rules the compliance engine scores against, so the first attempt has a
    fair chance of passing rather than being set up to fail.
    """
    spec = get_module(module_id)
    return (
        f"Professional Amazon A+ Content {spec['label'].lower()} image, "
        f"{spec['aspect_ratio']} aspect ratio.\n"
        f"Product brief: {brief.strip()}\n"
        "Style: clean commercial product photography, even studio lighting, "
        "uncluttered composition, high detail, neutral background.\n"
        "Strict constraints: no pricing, no discount badges, no percentage-off "
        "text, no promotional claims, no competitor logos or brand marks, no "
        "URLs, no contact details, no award or best-seller badges. "
        f"Keep all text and faces out of the bottom {spec['safe_zone_pct']}% of "
        "the frame."
    )


def _step_params(slot: ProviderSlot, spec: dict) -> dict[str, Any]:
    """Translate the module spec into whichever params this provider takes."""
    if slot.wants_dimensions:
        # Workers AI caps generated images at 1024px per side. Clamping each
        # axis independently would silently change the aspect ratio (a
        # 1940x1200 request became a 1024x1024 square), so scale both axes by
        # one factor and let export resample up to the module canvas.
        w, h = spec["width"], spec["height"]
        scale = min(1.0, 1024 / max(w, h))
        return {
            "width": max(64, int(round(w * scale / 8)) * 8),
            "height": max(64, int(round(h * scale / 8)) * 8),
        }
    return {"aspect_ratio": spec["aspect_ratio"]}


def _extract_asset(result: PipelineResult) -> tuple[str | None, str | None, str | None]:
    """Return (url, sha256, key) of the first output asset."""
    for step in result.run.steps:
        for asset in step.assets:
            key = None
            try:
                from app.services.storage import get_backend

                key = get_backend().key_from_url(asset.url)
            except Exception:  # pragma: no cover - backend without key_from_url
                key = None
            return asset.url, asset.sha256, key
    return None, None, None


def _run_cost(result: PipelineResult, slot: ProviderSlot) -> float:
    """Prefer provider-reported spend; fall back to the chain's estimate."""
    reported = sum(float(s.cost_usd or 0) for s in result.run.steps)
    return reported if reported > 0 else slot.est_cost_usd


def generate_module(
    *,
    asin: str,
    module_id: str,
    brief: str,
    job_id: str | None = None,
    parent_run: PipelineResult | None = None,
    parent_run_id: str | None = None,
    attempt: int = 1,
    prompt_override: str | None = None,
    force_fail_first: bool = False,
    chain: tuple[ProviderSlot, ...] | None = None,
) -> GenerationOutcome:
    """Generate one module image, walking the provider chain until one works.

    ``parent_run`` links this attempt to the run it supersedes, which is what
    populates the lineage timeline. ``force_fail_first`` sabotages the primary
    provider's model slug — used by the demo and tests to prove the fallback
    path without waiting for a real outage. ``chain`` overrides the
    credential-derived chain, so the fallback machinery can be exercised
    deterministically regardless of which API keys happen to be present.
    """
    spec = get_module(module_id)
    prompt = prompt_override or build_prompt(module_id, brief)
    chain = chain or provider_chain()
    started = time.perf_counter()
    failures: list[AttemptError] = []
    effective_parent_id = parent_run_id or (parent_run.run.run_id if parent_run else None)

    for position, slot in enumerate(chain):
        model = slot.model
        if force_fail_first and position == 0:
            model = f"{slot.model}-DOES-NOT-EXIST"

        sink = hierarchical_sink(tenant_id=asin)  # single-use: fresh per attempt
        pipeline = Pipeline(f"aplus-{module_id}", tenant_id=asin)
        if parent_run is not None:
            pipeline = pipeline.from_result(parent_run)

        pipeline = pipeline.metadata(
            asin=asin,
            module_id=module_id,
            attempt=attempt,
            chain_position=position,
        ).step(
            slot.provider,
            model=model,
            prompt=prompt,
            modality=Modality.IMAGE,
            metadata={"module_id": module_id, "asin": asin},
            **_step_params(slot, spec),
        )

        try:
            result = pipeline.run(sink=sink, raise_on_failure=True, timeout=180)
        except (GenblazeError, Exception) as exc:  # noqa: BLE001 - chain must survive anything
            logger.warning("provider %s failed (%s): %s", slot.key, model, exc)
            failures.append(AttemptError(slot.key, model, str(exc)[:500]))
            _record_failed_attempt(
                asin=asin,
                module_id=module_id,
                job_id=job_id,
                attempt=attempt,
                parent_run_id=effective_parent_id,
                slot=slot,
                model=model,
                prompt=prompt,
                error=str(exc)[:1000],
            )
            continue

        url, sha256, key = _extract_asset(result)
        outcome = GenerationOutcome(
            run_id=result.run.run_id,
            result=result,
            slot=slot,
            asset_url=url,
            asset_key=key,
            asset_sha256=sha256,
            manifest_uri=result.manifest.manifest_uri,
            canonical_hash=result.manifest.canonical_hash,
            cost_usd=_run_cost(result, slot),
            duration_sec=time.perf_counter() - started,
            attempt=attempt,
            parent_run_id=effective_parent_id,
            failures=failures,
        )
        db.insert_run(
            run_id=outcome.run_id,
            parent_run_id=effective_parent_id,
            job_id=job_id,
            asin=asin,
            module_id=module_id,
            attempt=attempt,
            provider=slot.key,
            model=model,
            status="generated",
            prompt=prompt,
            asset_url=url,
            asset_key=key,
            asset_sha256=sha256,
            manifest_uri=outcome.manifest_uri,
            canonical_hash=outcome.canonical_hash,
            cost_usd=outcome.cost_usd,
            duration_sec=outcome.duration_sec,
        )
        logger.info(
            "generated %s/%s via %s after %d failed provider(s)",
            asin,
            module_id,
            slot.label,
            len(failures),
        )
        return outcome

    # Whole chain exhausted.
    return GenerationOutcome(
        run_id=None,
        result=None,
        slot=None,
        asset_url=None,
        asset_key=None,
        asset_sha256=None,
        manifest_uri=None,
        canonical_hash=None,
        cost_usd=0.0,
        duration_sec=time.perf_counter() - started,
        attempt=attempt,
        parent_run_id=effective_parent_id,
        failures=failures,
    )


def _record_failed_attempt(
    *,
    asin: str,
    module_id: str,
    job_id: str | None,
    attempt: int,
    parent_run_id: str | None,
    slot: ProviderSlot,
    model: str,
    prompt: str,
    error: str,
) -> None:
    """Persist a provider failure.

    A failed provider produces no genblaze run_id, but the attempt still has
    to appear in the lineage — "we tried GMICloud and it 404'd" is exactly the
    reliability evidence this system exists to capture. A synthetic id keeps
    it addressable without colliding with real run ids.
    """
    synthetic_id = f"failed-{slot.key}-{attempt}-{int(time.time() * 1000)}"
    try:
        db.insert_run(
            run_id=synthetic_id,
            parent_run_id=parent_run_id,
            job_id=job_id,
            asin=asin,
            module_id=module_id,
            attempt=attempt,
            provider=slot.key,
            model=model,
            status="provider_failed",
            prompt=prompt,
            error=error,
            cost_usd=0.0,
        )
    except Exception:  # pragma: no cover - never let bookkeeping kill a run
        logger.exception("failed to persist provider failure for %s", slot.key)
