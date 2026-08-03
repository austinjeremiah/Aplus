"""HuggingFaceImageProvider — FLUX.1-schnell across four independent vendors.

This is what finally makes the fallback chain multi-vendor. Hugging Face's
Inference Providers is a broker, not a model host: a single token routes to
nscale, fal-ai, Together and WaveSpeed, each of which is a separate company
running its own hardware. So one credential yields four slots that fail
independently — which is the property a fallback chain is supposed to have and
the one a list of Pollinations models cannot provide, however long that list
gets.

Routing is left to ``huggingface_hub``. The direct REST paths are a moving
target — ``api-inference.huggingface.co`` now returns 410 "deprecated and no
longer supported by provider hf-inference", and the OpenAI-compatible
``/v1/images/generations`` route 404s — while the client tracks whatever the
current mapping is. Pinning a URL here would mean re-breaking this the next
time they migrate.
"""

from __future__ import annotations

import hashlib
import io
import tempfile
from pathlib import Path
from typing import Any

from genblaze_core import (
    Asset,
    Modality,
    ProviderCapabilities,
    ProviderError,
    ProviderErrorCode,
    SyncProvider,
)
from genblaze_core.models.step import Step
from genblaze_core.runnable.config import RunnableConfig

_OUT_DIR = Path(tempfile.gettempdir()) / "aplusfoundry-hf"

# schnell is distilled for few-step sampling; more steps cost quota and add
# nothing.
_DEFAULT_STEPS = 4

# Several routed backends reject edges that are not multiples of 16 — Together
# errors outright, fal-ai silently snaps down. Rounding *down* here matches
# what the backends already do and keeps the render inside the module canvas
# rather than overshooting it (600 -> 592, not 608).
_MULTIPLE = 16

# Substrings that mean the failure is an account/quota state rather than a
# transient one, so the circuit breaker should stop retrying this slot.
_PERMANENT_HINTS = (
    "exceeded",
    "quota",
    "credits",
    "payment",
    "subscribe",
    "402",
    "401",
    "403",
)


def _round16(value: int) -> int:
    return max(_MULTIPLE, (value // _MULTIPLE) * _MULTIPLE)


class HuggingFaceImageProvider(SyncProvider):
    """Text-to-image through one named Hugging Face inference provider."""

    def __init__(self, *, api_key: str, hf_provider: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._api_key = api_key
        self._hf_provider = hf_provider
        self.name = f"hf-{hf_provider}"  # type: ignore[assignment]
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            from huggingface_hub import InferenceClient

            self._client = InferenceClient(provider=self._hf_provider, api_key=self._api_key)
        return self._client

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supported_modalities=[Modality.IMAGE],
            supported_inputs=["text"],
            accepts_chain_input=False,
            output_formats=["image/png"],
        )

    def generate(self, step: Step, config: RunnableConfig | None = None) -> Step:
        params = step.params or {}
        width = _round16(int(params.get("width") or 1024))
        height = _round16(int(params.get("height") or 1024))

        kwargs: dict[str, Any] = {
            "model": step.model or "black-forest-labs/FLUX.1-schnell",
            "width": width,
            "height": height,
            "num_inference_steps": int(params.get("steps") or _DEFAULT_STEPS),
        }
        # Unlike the Pollinations GET endpoint, this one has a real negative
        # prompt field, so the prohibitions stay out of the positive text where
        # a diffusion model would just render them.
        if params.get("negative_prompt"):
            kwargs["negative_prompt"] = params["negative_prompt"]

        try:
            image = self._get_client().text_to_image((step.prompt or "").strip(), **kwargs)
        except Exception as exc:  # the client raises a wide range of types
            message = str(exc)
            lowered = message.lower()
            raise ProviderError(
                f"HF/{self._hf_provider} failed: {message[:200]}",
                error_code=(
                    ProviderErrorCode.AUTHENTICATION_ERROR
                    if any(h in lowered for h in _PERMANENT_HINTS)
                    else ProviderErrorCode.RATE_LIMIT
                    if "429" in lowered or "rate" in lowered
                    else ProviderErrorCode.SERVER_ERROR
                ),
            ) from exc

        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        data = buffer.getvalue()

        digest = hashlib.sha256(data).hexdigest()
        _OUT_DIR.mkdir(parents=True, exist_ok=True)
        path = _OUT_DIR / f"{digest[:24]}.png"
        path.write_bytes(data)

        step.assets.append(
            Asset(
                url=path.as_uri(),
                media_type="image/png",
                sha256=digest,
                size_bytes=len(data),
                # Report what came back, not what was asked for — some routed
                # backends quietly return their own default size.
                width=image.width,
                height=image.height,
            )
        )
        step.cost_usd = 0.0
        return step
