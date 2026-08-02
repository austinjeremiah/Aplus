"""Deterministic Amazon A+ Content checks.

These are the rules that need no judgement: dimensions, colour mode, file
size, aspect ratio, sharpness. They run on every asset, cost nothing, and
never hallucinate — so they are the floor the vision judge builds on rather
than something it can overrule.

Sources for the constraints: Amazon Seller Central A+ Content guidelines
(image modules must be RGB, within the module's pixel spec, and under 2MB).
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

# Amazon rejects A+ module images above 2MB.
MAX_BYTES = 2 * 1024 * 1024

# Below this Laplacian-variance score an image reads as soft/blurry at listing
# size. Set low deliberately: clean studio renders on plain backgrounds have
# legitimately low edge variance, and a noisy warning on every compliant image
# trains the reviewer to ignore the panel. Advisory, never a hard rejection.
SHARPNESS_FLOOR = 15.0


@dataclass
class Violation:
    rule: str
    severity: str  # "error" blocks approval, "warning" is advisory
    evidence: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


def _aspect(w: int, h: int) -> float:
    return w / h if h else 0.0


def _parse_ratio(ratio: str) -> float:
    try:
        a, b = ratio.split(":")
        return float(a) / float(b)
    except (ValueError, ZeroDivisionError):
        return 0.0


def sharpness(img: Image.Image) -> float:
    """Variance of the Laplacian — a standard focus/blur proxy."""
    gray = img.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    return float(ImageStat.Stat(edges).stddev[0]) ** 2 / 10.0


def check_deterministic(path: str | Path, spec: dict) -> list[Violation]:
    """Run every no-judgement-required rule against a rendered asset."""
    path = Path(path)
    violations: list[Violation] = []

    if not path.exists():
        return [Violation("asset_missing", "error", f"file not found: {path}")]

    size_bytes = os.path.getsize(path)
    if size_bytes > MAX_BYTES:
        violations.append(
            Violation(
                "file_size",
                "error",
                f"{size_bytes / 1_048_576:.2f}MB exceeds Amazon's 2MB module limit",
            )
        )

    try:
        img = Image.open(path)
        img.load()
    except OSError as exc:
        return [Violation("unreadable_image", "error", f"cannot decode image: {exc}")]

    if img.mode not in ("RGB", "L"):
        violations.append(
            Violation(
                "colour_mode",
                "error",
                f"colour mode is {img.mode}; Amazon requires RGB (CMYK is rejected)",
            )
        )

    w, h = img.size
    want_w, want_h = spec["width"], spec["height"]
    if (w, h) != (want_w, want_h):
        # A mismatched aspect ratio cannot be fixed by scaling, so it is an
        # error; a pure scale difference is recoverable on export.
        got, want = _aspect(w, h), _parse_ratio(spec["aspect_ratio"])
        drifted = want and abs(got - want) / want > 0.02
        violations.append(
            Violation(
                "dimensions",
                "error" if drifted else "warning",
                f"{w}×{h} does not match the {want_w}×{want_h} canvas for this module"
                + (f" (aspect {got:.2f} vs required {want:.2f})" if drifted else " (scalable)"),
            )
        )

    score = sharpness(img)
    if score < SHARPNESS_FLOOR:
        violations.append(
            Violation(
                "sharpness",
                "warning",
                f"edge variance {score:.0f} is below {SHARPNESS_FLOOR:.0f} — may read soft on a listing",
            )
        )

    return violations


def safe_zone_box(spec: dict, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Pixel box of the mobile safe zone (bottom N% of the frame)."""
    w, h = size
    pct = spec.get("safe_zone_pct", 20) / 100.0
    return (0, int(h * (1 - pct)), w, h)
