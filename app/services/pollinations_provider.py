"""PollinationsImageProvider — keyless free image generation.

A second custom ``SyncProvider``, alongside the Cloudflare one. Pollinations
serves FLUX over a plain GET with no account, no API key and no daily neuron
budget, which makes it the one link in the chain that cannot be knocked out by
an unfunded account or an exhausted free tier.

It sits below the credentialed providers on quality/controllability, but above
the local renderer: when everything else is dry, this still returns a real
generated image rather than a placeholder.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
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

_BASE = "https://image.pollinations.ai/prompt/"
_OUT_DIR = Path(tempfile.gettempdir()) / "aplusplus-pollinations"

_MAGIC = {b"\x89PNG\r\n\x1a\n": "image/png", b"\xff\xd8\xff": "image/jpeg"}


class PollinationsImageProvider(SyncProvider):
    """Text-to-image via Pollinations' keyless endpoint."""

    name = "pollinations"

    def __init__(self, *, timeout: float = 180.0, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._timeout = timeout

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supported_modalities=[Modality.IMAGE],
            supported_inputs=["text"],
            accepts_chain_input=False,
            output_formats=["image/jpeg", "image/png"],
        )

    def generate(self, step: Step, config: RunnableConfig | None = None) -> Step:
        params = step.params or {}
        prompt = (step.prompt or "").strip()

        # The endpoint has no negative-prompt field, so the constraint has to
        # be folded into the positive text. Phrased as what the frame should
        # contain ("plain unbranded surfaces") rather than what it must not,
        # since the model ignores negation the same way any diffusion model
        # does.
        if params.get("negative_prompt"):
            prompt = f"{prompt} Plain unbranded surfaces, no overlaid graphics."

        query = {
            "width": str(params.get("width") or 1024),
            "height": str(params.get("height") or 1024),
            "nologo": "true",
            "model": step.model or "flux",
            "safe": "true",
        }
        if params.get("seed") is not None:
            query["seed"] = str(int(params["seed"]))

        url = _BASE + quote(prompt[:1800], safe="")
        try:
            resp = httpx.get(url, params=query, timeout=self._timeout, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"Pollinations request failed: {exc}",
                error_code=ProviderErrorCode.SERVER_ERROR,
            ) from exc

        if resp.status_code >= 400:
            raise ProviderError(
                f"Pollinations returned {resp.status_code}: {resp.text[:200]}",
                error_code=(
                    ProviderErrorCode.RATE_LIMIT
                    if resp.status_code == 429
                    else ProviderErrorCode.SERVER_ERROR
                ),
            )

        data = resp.content
        media_type = next((m for sig, m in _MAGIC.items() if data.startswith(sig)), None)
        if media_type is None:
            # An HTML error page returns 200 here, so sniff rather than trust.
            raise ProviderError(
                f"Pollinations returned non-image data ({resp.headers.get('content-type')})",
                error_code=ProviderErrorCode.SERVER_ERROR,
            )

        digest = hashlib.sha256(data).hexdigest()
        _OUT_DIR.mkdir(parents=True, exist_ok=True)
        ext = "png" if media_type == "image/png" else "jpg"
        path = _OUT_DIR / f"{digest[:24]}.{ext}"
        path.write_bytes(data)

        step.assets.append(
            Asset(
                url=path.as_uri(),
                media_type=media_type,
                sha256=digest,
                size_bytes=len(data),
                width=int(query["width"]),
                height=int(query["height"]),
            )
        )
        step.cost_usd = 0.0
        return step
