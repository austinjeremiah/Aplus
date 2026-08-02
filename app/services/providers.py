"""Provider chain construction.

The chain is built from whatever credentials are present, in a deliberate
order: sponsor credits first, free tier second, paid last. Absent credentials
simply drop out of the chain rather than raising, so the system degrades to
the local mock provider instead of failing to start.

Ordering rationale:

1. ``gmicloud``   — hackathon sponsor credits; Seedream is the strongest of
                    these at rendering legible text, which A+ marketing
                    imagery actually needs.
2. ``cloudflare`` — Workers AI free tier. Costs nothing, so a live fallback
                    demo is free to run repeatedly.
3. ``replicate``  — ~$0.003/image. Real money, so it sits last among the
                    real providers.
4. ``openai``     — only if a key exists; most expensive.
5. ``local-mock`` — always appended when nothing else is configured, so the
                    pipeline is never a dead end.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from genblaze_core import BaseProvider

from app.config import settings
from app.services.mock_image import local_image_provider

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderSlot:
    """One link in the fallback chain."""

    key: str
    provider: BaseProvider
    model: str
    # Per-image estimate in USD, used for the analytics cost chart when the
    # provider does not report actual spend on the step.
    est_cost_usd: float
    # True when this slot needs explicit pixel dimensions rather than the
    # canonical aspect_ratio string.
    wants_dimensions: bool = False

    @property
    def label(self) -> str:
        return f"{self.key}:{self.model}"


def _gmicloud() -> ProviderSlot | None:
    if not settings.gmi_api_key:
        return None
    from genblaze_gmicloud import GMICloudImageProvider

    return ProviderSlot(
        key="gmicloud",
        provider=GMICloudImageProvider(api_key=settings.gmi_api_key),
        model=settings.gmi_image_model,
        est_cost_usd=0.03,
    )


def _cloudflare() -> ProviderSlot | None:
    if not (settings.cf_account_id and settings.cf_api_token):
        return None
    from app.services.cloudflare_provider import CloudflareImageProvider

    return ProviderSlot(
        key="cloudflare",
        provider=CloudflareImageProvider(
            account_id=settings.cf_account_id,
            api_token=settings.cf_api_token,
        ),
        model=settings.cf_image_model,
        est_cost_usd=0.0,
        wants_dimensions=True,
    )


def _replicate() -> ProviderSlot | None:
    if not settings.replicate_api_token:
        return None
    from genblaze_replicate import ReplicateProvider

    return ProviderSlot(
        key="replicate",
        provider=ReplicateProvider(api_token=settings.replicate_api_token),
        model=settings.replicate_image_model,
        est_cost_usd=0.003,
    )


def _openai() -> ProviderSlot | None:
    if not settings.openai_api_key:
        return None
    from genblaze_openai import DalleProvider

    return ProviderSlot(
        key="openai",
        provider=DalleProvider(api_key=settings.openai_api_key),
        model="gpt-image-1",
        est_cost_usd=0.04,
    )


def _mock(name: str = "local-mock", *, should_fail: bool = False) -> ProviderSlot:
    return ProviderSlot(
        key=name,
        provider=local_image_provider(name=name, should_fail=should_fail),
        model="local-mock-v1",
        est_cost_usd=0.0,
    )


def simulated_chain() -> tuple[ProviderSlot, ...]:
    """A three-link chain of mocks whose first link always fails.

    Exists so the fallback machinery is provable without credentials: the
    logic under test is the chain walk, the failure bookkeeping and the
    lineage link, none of which care whether the provider is real. When real
    keys are present, ``provider_chain()`` exercises the identical code path.
    """
    return (
        _mock("sim-primary", should_fail=True),
        _mock("sim-fallback"),
        _mock("sim-last-resort"),
    )


_BUILDERS = (_gmicloud, _cloudflare, _replicate, _openai)


@lru_cache(maxsize=1)
def provider_chain() -> tuple[ProviderSlot, ...]:
    """Ordered fallback chain. Cached — providers hold HTTP clients."""
    chain: list[ProviderSlot] = []
    for build in _BUILDERS:
        try:
            slot = build()
        except Exception:
            logger.exception("provider %s failed to initialise — skipping", build.__name__)
            continue
        if slot is not None:
            chain.append(slot)

    if not chain:
        logger.warning(
            "No image provider credentials configured — falling back to the local "
            "mock provider. Set GMI_API_KEY / CF_* / REPLICATE_API_TOKEN in .env."
        )
        chain.append(_mock())

    logger.info("provider chain: %s", " -> ".join(s.label for s in chain))
    return tuple(chain)


def chain_summary() -> list[dict[str, Any]]:
    """Serialisable view of the chain — surfaced at /health and in the UI."""
    return [
        {
            "position": i,
            "provider": slot.key,
            "model": slot.model,
            "est_cost_usd": slot.est_cost_usd,
            "role": ["primary", "fallback", "last resort"][min(i, 2)],
        }
        for i, slot in enumerate(provider_chain())
    ]
