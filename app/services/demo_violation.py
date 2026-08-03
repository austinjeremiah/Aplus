"""Wrap a real provider and composite a policy violation onto its output.

Demonstrating the rejection path needs a non-compliant asset on demand, and
there are only bad ways to get one from a text-to-image model: FLUX and SANA
cannot reliably render requested words, so asking for a "50% OFF" badge simply
produces a clean image, and substituting a locally drawn placeholder proves
nothing — a hand-drawn fixture says nothing about whether the judge can read a
real render.

So the base image is a genuine generation from the real provider chain, and
only the offending element is composited on top. That is also what the failure
mode looks like in practice: a real product photo with promotional artwork
added by someone who did not read Amazon's rules. The rubric then catches a
violation on a real asset, which is the claim being made.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from genblaze_core import Asset, Modality, ProviderCapabilities, SyncProvider
from genblaze_core.models.step import Step
from genblaze_core.runnable.config import RunnableConfig
from PIL import Image, ImageDraw, ImageFont

_OUT = Path(tempfile.gettempdir()) / "aplusfoundry-demo-violations"

_FONTS = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def _font(size: int):
    for path in _FONTS:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _pricing_badge(img: Image.Image) -> Image.Image:
    """A red promotional badge in the top-right — the classic A+ rejection."""
    draw = ImageDraw.Draw(img)
    w, h = img.size
    font = _font(max(24, int(h * 0.11)))
    text = "50% OFF"
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    pad = int(th * 0.5)
    x1, y1 = w - int(w * 0.035), int(h * 0.05)
    x0, y0 = x1 - tw - pad * 2, y1
    draw.rectangle([x0, y0, x1, y0 + th + pad * 2], fill=(198, 24, 30))
    draw.text((x0 + pad, y0 + pad - box[1]), text, fill=(255, 255, 255), font=font)
    return img


def _safe_zone_text(img: Image.Image) -> Image.Image:
    """Large text inside the bottom fifth, where Amazon's mobile UI covers it."""
    draw = ImageDraw.Draw(img)
    w, h = img.size
    font = _font(max(20, int(h * 0.085)))
    text = "ORDER NOW"
    box = draw.textbbox((0, 0), text, font=font)
    tw = box[2] - box[0]
    draw.text(((w - tw) // 2, int(h * 0.87)), text, fill=(255, 255, 255), font=font)
    return img


_COMPOSITORS = {"pricing": _pricing_badge, "safe_zone": _safe_zone_text}


class ViolationInjectingProvider(SyncProvider):
    """Delegates generation, then composites the requested violation."""

    def __init__(self, inner: SyncProvider, violation: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._inner = inner
        self._violation = violation
        self.name = getattr(inner, "name", "provider")  # type: ignore[assignment]

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supported_modalities=[Modality.IMAGE],
            supported_inputs=["text"],
            accepts_chain_input=False,
            output_formats=["image/png"],
        )

    def generate(self, step: Step, config: RunnableConfig | None = None) -> Step:
        step = self._inner.generate(step, config)
        paint = _COMPOSITORS.get(self._violation)
        if paint is None or not step.assets:
            return step

        asset = step.assets[-1]
        src = Path(unquote(urlparse(asset.url).path))
        if not src.exists():
            return step

        with Image.open(src) as im:
            out = paint(im.convert("RGB"))
            _OUT.mkdir(parents=True, exist_ok=True)
            dest = _OUT / f"{src.stem}-{self._violation}.png"
            out.save(dest, format="PNG", optimize=True)
            width, height = out.size

        data = dest.read_bytes()
        # Replace rather than append: the composited file is the artefact that
        # gets stored and judged, so its hash must be the one on record.
        step.assets[-1] = Asset(
            url=dest.as_uri(),
            media_type="image/png",
            sha256=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
            width=width,
            height=height,
        )
        return step
