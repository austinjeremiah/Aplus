"""Canvas normalisation — turn a provider's native output into a module asset.

Image providers each generate at their own preferred resolution: Workers AI
caps at 1024px per side, Seedream and gpt-image-1 have their own size menus.
None of them emit Amazon's exact module canvas.

So the raw generation is stored in B2 as-is — that is the provenance record,
and altering it before hashing would undermine the manifest — while the
*export* is normalised to the module's exact pixel spec. Compliance scores the
normalised export, because that is the artefact that would actually be
published to a listing.

Aspect mismatches are centre-cropped rather than stretched: a squashed product
photo fails a human review even when it passes a dimension check.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from PIL import Image


def normalize_to_canvas(src: str | Path, spec: dict, dest: str | Path | None = None) -> Path:
    """Resize/crop ``src`` to the module's exact canvas. Returns the new path."""
    src = Path(src)
    target = (spec["width"], spec["height"])

    with Image.open(src) as img:
        img = img.convert("RGB")
        out = _fit_center_crop(img, target)

    if dest is None:
        dest = Path(tempfile.mkdtemp(prefix="aplusplus-export-")) / f"{src.stem}-export.png"
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    out.save(dest, format="PNG", optimize=True)
    _shrink_under_limit(dest, out, spec.get("max_bytes", 2 * 1024 * 1024))
    return dest


def _fit_center_crop(img: Image.Image, target: tuple[int, int]) -> Image.Image:
    """Scale to cover the target box, then centre-crop the overflow away."""
    tw, th = target
    sw, sh = img.size
    if (sw, sh) == (tw, th):
        return img

    scale = max(tw / sw, th / sh)
    new = (max(tw, int(round(sw * scale))), max(th, int(round(sh * scale))))
    img = img.resize(new, Image.LANCZOS)

    left = (img.width - tw) // 2
    top = (img.height - th) // 2
    return img.crop((left, top, left + tw, top + th))


def _shrink_under_limit(path: Path, img: Image.Image, max_bytes: int) -> None:
    """Re-encode as progressively lower-quality JPEG only if PNG blows the cap.

    Amazon rejects modules over 2MB. A large photographic render can exceed
    that as PNG, and silently shipping an oversized file would fail upload at
    the last step, so degrade quality here instead.
    """
    if path.stat().st_size <= max_bytes:
        return
    for quality in (95, 88, 80, 72, 65):
        img.save(path, format="JPEG", quality=quality, optimize=True)
        if path.stat().st_size <= max_bytes:
            return
