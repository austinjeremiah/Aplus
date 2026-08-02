"""CloudflareImageProvider — a custom genblaze provider for Workers AI.

There is no ``genblaze-cloudflare`` package, so this implements genblaze's
``SyncProvider`` contract directly: one ``generate()`` method, and the base
class supplies the submit/poll/fetch lifecycle, retry policy, cost accounting
and manifest wiring for free.

Why bother: Workers AI gives 10,000 neurons/day at no charge, forever. A
FLUX-schnell image at 1024x1024/4 steps costs roughly 58 neurons, so this tier
absorbs a couple hundred images a day. That makes it the ideal *middle* link
in the fallback chain — the demo can kill the primary provider live and still
produce a real image without spending anything.

Wire format: Workers AI returns FLUX output as base64 JSON (newer models) or
raw binary (older ones); both are handled. Bytes are written to a temp file and
handed back as a ``file://`` asset, which AssetTransfer uploads to B2.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import tempfile
from pathlib import Path
from typing import Any

import httpx
from genblaze_core import (
    Asset,
    Modality,
    ProviderCapabilities,
    ProviderErrorCode,
    ProviderError,
    SyncProvider,
)
from genblaze_core.models.step import Step
from genblaze_core.runnable.config import RunnableConfig

_API = "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"
_OUT_DIR = Path(tempfile.gettempdir()) / "aplusplus-cf-assets"

# Workers AI bills per 512x512 tile plus per diffusion step. Four steps at
# 1024x1024 is the schnell sweet spot: schnell is distilled for 1-4 steps and
# gains nothing past that, so more steps would burn free quota for no quality.
_DEFAULT_STEPS = 4


class CloudflareImageProvider(SyncProvider):
    """Text-to-image via Cloudflare Workers AI."""

    name = "cloudflare"

    def __init__(
        self,
        *,
        account_id: str,
        api_token: str,
        timeout: float = 120.0,
        client: httpx.Client | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        if not account_id or not api_token:
            raise ValueError("CloudflareImageProvider requires account_id and api_token")
        self._account_id = account_id
        self._api_token = api_token
        self._timeout = timeout
        self._client = client

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supported_modalities=[Modality.IMAGE],
            supported_inputs=["text"],
            accepts_chain_input=False,
            output_formats=["image/png", "image/jpeg"],
        )

    # ------------------------------------------------------------------
    def generate(self, step: Step, config: RunnableConfig | None = None) -> Step:
        payload: dict[str, Any] = {"prompt": step.prompt or ""}

        params = step.params or {}
        # Workers AI takes explicit pixel dims, not an aspect_ratio string, so
        # the canonical genblaze param is translated rather than forwarded.
        if params.get("width"):
            payload["width"] = int(params["width"])
        if params.get("height"):
            payload["height"] = int(params["height"])
        if params.get("negative_prompt"):
            payload["negative_prompt"] = params["negative_prompt"]
        if params.get("seed") is not None:
            payload["seed"] = int(params["seed"])
        payload["steps"] = int(params.get("steps") or _DEFAULT_STEPS)

        url = _API.format(account=self._account_id, model=step.model)
        headers = {"Authorization": f"Bearer {self._api_token}"}

        client = self._client or httpx.Client(timeout=self._timeout)
        try:
            resp = client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"Cloudflare Workers AI request failed: {exc}",
                error_code=ProviderErrorCode.SERVER_ERROR,
            ) from exc
        finally:
            if self._client is None:
                client.close()

        data = self._decode(resp)

        path = _write_png(data)
        digest = hashlib.sha256(data).hexdigest()
        step.assets.append(
            Asset(
                url=path.as_uri(),
                media_type="image/png",
                sha256=digest,
                size_bytes=len(data),
                width=payload.get("width"),
                height=payload.get("height"),
            )
        )
        # Free tier — real spend is zero. Recorded explicitly so the analytics
        # "cost per provider" chart tells the truth instead of showing a gap.
        step.cost_usd = 0.0
        return step

    # ------------------------------------------------------------------
    def _decode(self, resp: httpx.Response) -> bytes:
        """Pull image bytes out of either response shape, or raise clearly."""
        if resp.status_code >= 400:
            raise ProviderError(
                f"Cloudflare Workers AI returned {resp.status_code}: {resp.text[:300]}",
                error_code=_classify(resp.status_code),
            )

        content_type = resp.headers.get("content-type", "")
        if content_type.startswith("image/"):
            return resp.content

        try:
            body = resp.json()
        except ValueError:
            # Not JSON and not an image content-type — trust the bytes if they
            # look like a PNG, otherwise surface the payload for debugging.
            if resp.content[:8] == b"\x89PNG\r\n\x1a\n":
                return resp.content
            raise ProviderError(
                f"Cloudflare returned unparseable response: {resp.content[:200]!r}",
                error_code=ProviderErrorCode.SERVER_ERROR,
            ) from None

        if not body.get("success", True):
            errors = body.get("errors") or [{"message": "unknown error"}]
            raise ProviderError(
                f"Cloudflare Workers AI error: {errors}",
                error_code=ProviderErrorCode.SERVER_ERROR,
            )

        result = body.get("result") or {}
        b64 = result.get("image") if isinstance(result, dict) else None
        if not b64:
            raise ProviderError(
                f"Cloudflare response contained no image field: {str(body)[:200]}",
                error_code=ProviderErrorCode.SERVER_ERROR,
            )
        try:
            return base64.b64decode(b64)
        except (binascii.Error, ValueError) as exc:
            raise ProviderError(
                f"Cloudflare returned malformed base64 image: {exc}",
                error_code=ProviderErrorCode.SERVER_ERROR,
            ) from exc


def _classify(status: int) -> ProviderErrorCode:
    if status in (401, 403):
        return ProviderErrorCode.AUTH_FAILURE
    if status == 429:
        return ProviderErrorCode.RATE_LIMIT
    if status == 404:
        return ProviderErrorCode.MODEL_ERROR
    if status >= 500:
        return ProviderErrorCode.SERVER_ERROR
    return ProviderErrorCode.SERVER_ERROR


def _write_png(data: bytes) -> Path:
    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = _OUT_DIR / f"{hashlib.sha256(data).hexdigest()[:24]}.png"
    path.write_bytes(data)
    return path
