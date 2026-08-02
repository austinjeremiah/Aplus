"""Vision judge — pluggable backends for looking at an image.

Backends are tried in order of availability. Each must genuinely accept image
input; a text-only model is never acceptable here, because it will answer
questions about an image it cannot see with complete confidence, producing a
compliance record that looks rigorous and is entirely fabricated. That failure
mode is worse than having no judge at all, so ``available()`` gates on real
vision support rather than mere reachability.

Backends, in preference order:

1. ``gmicloud``   — sponsor credits; hosts gpt-4o and gemini-flash. Best
                    quality, but 402s when the account has no balance.
2. ``google``     — Gemini via the OpenAI-compatible endpoint. Free tier
                    covers vision *input*, and unlike Workers AI it has no
                    daily neuron budget to exhaust.
3. ``cloudflare`` — llama-3.2-11b-vision on the free tier. Verified to read
                    rendered text correctly (~15 neurons/call, so roughly 600
                    calls/day free) until the shared 10k/day runs out.
4. ``openai``     — only when a key exists.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

# Vision models degrade little below ~900px for text detection but cost far
# fewer tokens, so inputs are downscaled before upload.
_MAX_EDGE = 896


@dataclass
class VisionReply:
    backend: str
    model: str
    text: str
    raw: dict[str, Any] | None = None


def _prepare(path: str | Path) -> tuple[bytes, str]:
    """Downscale and re-encode to PNG. Returns (bytes, base64)."""
    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((_MAX_EDGE, _MAX_EDGE))
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    return data, base64.b64encode(data).decode()


def extract_json(text: str) -> dict[str, Any] | None:
    """Best-effort JSON recovery from a chatty model reply.

    Vision models frequently ignore "JSON only" and wrap the object in prose
    or a ``` fence — observed on 2 of 3 calls during backend selection. The
    caller still needs a verdict, so parse defensively instead of discarding
    an otherwise-good answer.
    """
    if not text:
        return None
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except ValueError:
        pass
    # Fall back to the first balanced {...} block.
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(text[start : i + 1])
                        if isinstance(parsed, dict):
                            return parsed
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    return None


# ---------------------------------------------------------------------------
class VisionBackend:
    key = "base"

    def available(self) -> bool:
        raise NotImplementedError

    def ask(self, path: str | Path, prompt: str, *, max_tokens: int = 500) -> VisionReply:
        raise NotImplementedError


class CloudflareVision(VisionBackend):
    key = "cloudflare"
    # Requires a one-time acceptance of Meta's community licence per account;
    # sending the literal prompt "agree" registers it. Handled automatically
    # on first 403 rather than failing the run.
    model = "@cf/meta/llama-3.2-11b-vision-instruct"

    def __init__(self) -> None:
        self._licence_accepted = False

    def available(self) -> bool:
        return bool(settings.cf_account_id and settings.cf_api_token)

    def _url(self) -> str:
        return (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{settings.cf_account_id}/ai/run/{self.model}"
        )

    def _accept_licence(self, client: httpx.Client, headers: dict) -> None:
        if self._licence_accepted:
            return
        try:
            client.post(self._url(), headers=headers, json={"prompt": "agree"}, timeout=30)
        except httpx.HTTPError:
            pass
        self._licence_accepted = True

    def ask(self, path: str | Path, prompt: str, *, max_tokens: int = 500) -> VisionReply:
        data, _ = _prepare(path)
        headers = {"Authorization": f"Bearer {settings.cf_api_token}"}
        payload = {
            "image": list(data),
            "prompt": prompt,
            "max_tokens": max_tokens,
            # Greedy decoding: the same image must yield the same verdict, or
            # the compliance record is not reproducible for an auditor.
            "temperature": 0,
        }
        with httpx.Client(timeout=120) as client:
            resp = client.post(self._url(), headers=headers, json=payload)
            if resp.status_code == 403 and "Model Agreement" in resp.text:
                self._accept_licence(client, headers)
                resp = client.post(self._url(), headers=headers, json=payload)
            resp.raise_for_status()
            body = resp.json()
        result = body.get("result") or {}
        response = result.get("response")
        # Cloudflare sometimes returns the object already parsed.
        text = response if isinstance(response, str) else json.dumps(response)
        return VisionReply(self.key, self.model, text or "", body)


class OpenAICompatVision(VisionBackend):
    """Shared implementation for any OpenAI-shaped /chat/completions endpoint."""

    def __init__(self, key: str, base_url: str, api_key: str, model: str) -> None:
        self.key = key
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self.model = model

    def available(self) -> bool:
        return bool(self._api_key)

    def ask(self, path: str | Path, prompt: str, *, max_tokens: int = 500) -> VisionReply:
        _, b64 = _prepare(path)
        payload = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                    ],
                }
            ],
        }
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                f"{self._base}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            body = resp.json()
        text = body["choices"][0]["message"]["content"]
        return VisionReply(self.key, self.model, text or "", body)


def _backends() -> list[VisionBackend]:
    candidates: list[VisionBackend] = []
    if settings.gmi_api_key:
        candidates.append(
            OpenAICompatVision(
                "gmicloud", "https://api.gmi-serving.com/v1", settings.gmi_api_key, "openai/gpt-4o"
            )
        )
    if settings.google_api_key:
        candidates.append(
            OpenAICompatVision(
                "google",
                "https://generativelanguage.googleapis.com/v1beta/openai",
                settings.google_api_key,
                settings.google_vision_model,
            )
        )
    candidates.append(CloudflareVision())
    if settings.openai_api_key:
        candidates.append(
            OpenAICompatVision(
                "openai", "https://api.openai.com/v1", settings.openai_api_key, "gpt-4o"
            )
        )
    return [b for b in candidates if b.available()]


# Backends that failed for a reason retrying cannot fix (no balance, bad key,
# forbidden). Without this, an unfunded GMI account is re-tried on every one
# of the two vision calls per attempt — pure added latency on the hot path,
# several seconds per generation, plus a wall of identical warnings.
_DISABLED: dict[str, str] = {}

# 429 is normally transient, but Workers AI returns it for "daily free
# allocation exhausted", which will not clear until UTC midnight. Treating
# it as retryable means every call pays a full round-trip to learn nothing.
_PERMANENT = (401, 402, 403, 429)


def _is_permanent(exc: Exception) -> str | None:
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in _PERMANENT:
        return {
            401: "unauthorized",
            402: "no credit balance",
            403: "forbidden",
            429: "daily quota exhausted",
        }[status]
    return None


def ask_vision(path: str | Path, prompt: str, *, max_tokens: int = 500) -> VisionReply | None:
    """Ask the first working vision backend. None when every backend fails."""
    for backend in _backends():
        if backend.key in _DISABLED:
            continue
        try:
            return backend.ask(path, prompt, max_tokens=max_tokens)
        except Exception as exc:  # noqa: BLE001 - fall through to next backend
            reason = _is_permanent(exc)
            if reason:
                _DISABLED[backend.key] = reason
                logger.warning(
                    "vision backend %s disabled for this process (%s)", backend.key, reason
                )
            else:
                logger.warning("vision backend %s failed: %s", backend.key, exc)
    return None


def judge_status() -> list[dict[str, Any]]:
    """Which judges are live vs disabled — surfaced at /health."""
    return [
        {
            "backend": b.key,
            "model": getattr(b, "model", "?"),
            "status": f"disabled ({_DISABLED[b.key]})" if b.key in _DISABLED else "active",
        }
        for b in _backends()
    ]


def vision_available() -> bool:
    return bool(_backends())
