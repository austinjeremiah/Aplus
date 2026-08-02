"""Keyless local image provider — real PNG bytes, no API, no cost.

Wraps genblaze's ``MockProvider`` with an asset factory that renders an actual
PNG at the requested module dimensions via Pillow and hands back a ``file://``
URL, which ``AssetTransfer`` knows how to upload.

Two jobs:

1. Lets the whole system run end to end with zero credentials.
2. Gives the compliance engine deterministic fixtures. ``violation="pricing"``
   renders a "50% OFF" badge and ``violation="safe_zone"`` puts text in the
   bottom 20% — so the rejection path can be demonstrated on demand instead of
   hoping a real model happens to misbehave on camera.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path

from genblaze_core import Asset, Modality, ProviderErrorCode
from genblaze_core.mocks import MockProvider
from genblaze_core.models.step import Step
from PIL import Image, ImageDraw

from app.rubric.modules import get_module

_OUT_DIR = Path(tempfile.gettempdir()) / "aplusplus-mock-assets"

# Muted product-photography-ish backdrops, cycled by prompt hash so repeated
# runs of the same prompt look stable but different prompts look different.
_PALETTE = [
    ((238, 236, 230), (32, 32, 36)),
    ((26, 28, 34), (240, 240, 245)),
    ((222, 232, 238), (18, 44, 62)),
    ((244, 231, 220), (74, 44, 30)),
]


def render_placeholder(
    module_id: str,
    prompt: str,
    *,
    violation: str | None = None,
    out_dir: Path | None = None,
) -> Path:
    """Render a real PNG at the module's canvas size. Returns its path."""
    spec = get_module(module_id)
    w, h = spec["width"], spec["height"]

    seed = int(hashlib.sha256(f"{module_id}:{prompt}".encode()).hexdigest(), 16)
    bg, fg = _PALETTE[seed % len(_PALETTE)]

    img = Image.new("RGB", (w, h), bg)
    draw = ImageDraw.Draw(img)

    # Simple product-ish silhouette so the frame isn't empty.
    cx, cy = w // 2, int(h * 0.46)
    r = int(min(w, h) * 0.22)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fg)
    draw.rectangle([cx - r // 3, cy - int(r * 1.6), cx + r // 3, cy - r], fill=fg)

    label = f"{spec['label']} · {spec['display']}"
    draw.text((int(w * 0.04), int(h * 0.05)), label, fill=fg)
    draw.text((int(w * 0.04), int(h * 0.10)), prompt[:70], fill=fg)

    if violation == "pricing":
        # Deliberate rubric violation: promotional pricing claim.
        bw, bh = int(w * 0.30), int(h * 0.14)
        draw.rectangle([w - bw - 20, 20, w - 20, 20 + bh], fill=(200, 30, 30))
        draw.text((w - bw, 20 + bh // 3), "50% OFF - LOWEST PRICE!", fill=(255, 255, 255))
    elif violation == "safe_zone":
        # Deliberate rubric violation: text inside the bottom-20% mobile safe zone.
        draw.text((int(w * 0.06), int(h * 0.90)), "ORDER NOW - LIMITED STOCK", fill=fg)

    out_dir = out_dir or _OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = hashlib.sha256(f"{module_id}:{prompt}:{violation}".encode()).hexdigest()[:16]
    path = out_dir / f"{module_id}-{stem}.png"
    img.save(path, format="PNG", optimize=True)
    return path


def _asset_factory(violation: str | None):
    def build(step: Step) -> list[Asset]:
        module_id = (step.metadata or {}).get("module_id", "header_970x600")
        prompt = step.prompt or ""
        path = render_placeholder(module_id, prompt, violation=violation)
        data = path.read_bytes()
        with Image.open(path) as im:
            width, height = im.size
        return [
            Asset(
                url=path.as_uri(),  # file:// — AssetTransfer uploads local files
                media_type="image/png",
                sha256=hashlib.sha256(data).hexdigest(),
                size_bytes=len(data),
                width=width,
                height=height,
            )
        ]

    return build


def local_image_provider(
    *,
    violation: str | None = None,
    should_fail: bool = False,
    error_message: str = "simulated provider outage",
    name: str = "local-mock",
) -> MockProvider:
    """A genblaze provider that emits real PNGs from the local machine.

    ``should_fail=True`` raises ``ProviderError``, which is how the fallback
    chain gets exercised without breaking a real provider's model name.
    """
    return MockProvider(
        name=name,
        assets=_asset_factory(violation),
        should_fail=should_fail,
        error_code=ProviderErrorCode.MODEL_ERROR,
        error_message=error_message,
        cost_usd=0.0,
    )


__all__ = ["local_image_provider", "render_placeholder", "Modality"]
