"""Listing-readiness scoring — merchandising quality, measured from the pixels.

Distinct from the compliance rubric, which answers a binary policy question:
does this asset break an Amazon rule. An asset can be perfectly compliant and
still be a bad listing image — the product too small in the frame, detail that
collapses at thumbnail size, a subject that disappears against the page.

Every metric here is computed from the image itself and reports the number it
measured. Deliberately *not* a predicted click-through or conversion rate:
there is no impression or sales data behind this system, so any such figure
would be invented. What follows is an audit of properties Amazon's own imagery
guidance calls out, each one reproducible by anyone with the file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat

# Fraction of the shorter edge sampled as "border" when estimating the
# background colour. Wide enough to be representative, narrow enough that a
# centred product never intrudes.
_BORDER_FRAC = 0.06

# RGB distance beyond which a pixel is considered subject rather than
# background. Deliberately colour-aware, not luminance-only: a coral sneaker on
# a beige backdrop has almost no luminance gap but is obviously the subject,
# and a luminance threshold scored it at 7% of the frame. Kept low enough to
# catch near-neutral parts of a product too, such as a white midsole against a
# beige backdrop.
_SUBJECT_DELTA = 32

# Amazon renders A+ modules small on mobile. 150px is roughly a comparison
# chart cell, the harshest place any of these assets has to survive.
_THUMB_W = 150


@dataclass
class Metric:
    """One scored property, with the measurement that produced it."""

    key: str
    label: str
    score: int  # 0-100
    evidence: str

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "score": self.score,
            "evidence": self.evidence,
        }


@dataclass
class ReadinessReport:
    metrics: list[Metric] = field(default_factory=list)
    unavailable: str | None = None

    @property
    def score(self) -> int | None:
        """Unweighted mean. Each metric is a separate way to fail a shopper —
        there is no principled basis for ranking them against each other."""
        if not self.metrics:
            return None
        return round(sum(m.score for m in self.metrics) / len(self.metrics))

    @property
    def grade(self) -> str | None:
        s = self.score
        if s is None:
            return None
        if s >= 85:
            return "excellent"
        if s >= 70:
            return "good"
        if s >= 55:
            return "fair"
        return "weak"

    @property
    def weakest(self) -> Metric | None:
        return min(self.metrics, key=lambda m: m.score) if self.metrics else None

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "grade": self.grade,
            "metrics": [m.as_dict() for m in self.metrics],
            "unavailable": self.unavailable,
        }


def _clamp(value: float) -> int:
    return max(0, min(100, int(round(value))))


def _background_rgb(rgb: Image.Image) -> tuple[float, float, float]:
    """Mean colour of the border ring — the page-facing backdrop."""
    w, h = rgb.size
    b = max(1, int(min(w, h) * _BORDER_FRAC))
    strips = [
        rgb.crop((0, 0, w, b)),
        rgb.crop((0, h - b, w, h)),
        rgb.crop((0, 0, b, h)),
        rgb.crop((w - b, 0, w, h)),
    ]
    means = [ImageStat.Stat(s).mean[:3] for s in strips]
    return tuple(sum(m[i] for m in means) / len(means) for i in range(3))  # type: ignore[return-value]


def _subject_mask(rgb: Image.Image, bg: tuple[float, float, float]) -> list[bool]:
    """Per-pixel: is this far enough from the backdrop colour to be product?

    Sampled on a downscaled copy — the answer is a proportion, and doing it at
    full resolution costs seconds per image for no extra accuracy.
    """
    small = rgb.resize((200, max(1, int(rgb.height * 200 / rgb.width))), Image.BILINEAR)
    br, bg_, bb = bg
    return [
        (r - br) ** 2 + (g - bg_) ** 2 + (b - bb) ** 2 > _SUBJECT_DELTA**2
        for r, g, b in small.getdata()
    ]


def _prominence(mask: list[bool]) -> Metric:
    """How much of the frame the product occupies.

    Amazon's imagery guidance wants the product to dominate. Too small reads as
    a stock photo; filling the frame edge to edge leaves no room for the text
    overlay an A+ header module places beside it.
    """
    pct = sum(mask) / float(len(mask)) * 100

    # 25-70% is the workable band: enough presence to read in a grid, enough
    # margin for the module's copy. Score falls off outside it.
    if 25 <= pct <= 70:
        score = 100 - abs(47.5 - pct) * 0.6
    elif pct < 25:
        score = max(0.0, pct / 25 * 70)
    else:
        score = max(0.0, 100 - (pct - 70) * 2.2)

    return Metric(
        "prominence",
        "Subject prominence",
        _clamp(score),
        f"product fills {pct:.0f}% of the frame",
    )


def _separation(rgb: Image.Image, bg: tuple[float, float, float], mask: list[bool]) -> Metric:
    """Luminance gap between product and backdrop.

    A low-contrast subject vanishes against the listing page, which renders on
    white in light mode and near-black in dark mode.
    """
    small = rgb.resize((200, max(1, int(rgb.height * 200 / rgb.width))), Image.BILINEAR)
    subject = [px for px, m in zip(small.getdata(), mask) if m]
    if not subject:
        return Metric(
            "separation", "Subject separation", 0, "no subject distinguishable from the backdrop"
        )

    n = len(subject)
    mean = tuple(sum(px[i] for px in subject) / n for i in range(3))
    delta = sum((mean[i] - bg[i]) ** 2 for i in range(3)) ** 0.5
    return Metric(
        "separation",
        "Subject separation",
        _clamp(delta / 110 * 100),
        f"{delta:.0f}/441 colour distance between product and backdrop",
    )


def _backdrop_cleanliness(gray: Image.Image) -> Metric:
    """Texture in the border ring. A+ modules want an uncluttered backdrop."""
    w, h = gray.size
    b = max(1, int(min(w, h) * _BORDER_FRAC))
    strips = [gray.crop((0, 0, w, b)), gray.crop((0, h - b, w, h))]
    noise = sum(ImageStat.Stat(s).stddev[0] for s in strips) / len(strips)
    return Metric(
        "backdrop",
        "Backdrop cleanliness",
        _clamp(100 - noise * 2.4),
        f"{noise:.1f} stddev of texture across the border",
    )


def _thumbnail_survival(img: Image.Image) -> Metric:
    """Does the image still read once Amazon shrinks it?

    Measured as a round trip: downscale to a comparison-chart cell, scale back
    up, and compare against the original. What the round trip destroys is
    exactly the detail a shopper browsing a grid never receives.

    Comparing edge energy *across* the two sizes does not work — a smaller
    image concentrates the same edges into fewer pixels, so downscaling raises
    the statistic and every asset scored above 100%.
    """
    gray = img.convert("L")
    if gray.width <= _THUMB_W:
        return Metric("thumbnail", "Thumbnail legibility", 100, "already at thumbnail scale")

    small = gray.resize((_THUMB_W, max(1, int(gray.height * _THUMB_W / gray.width))), Image.LANCZOS)
    back = small.resize(gray.size, Image.LANCZOS)
    diff = ImageChops.difference(gray, back)
    lost = float(ImageStat.Stat(diff).mean[0])

    # ~12/255 mean absolute error is where a product photo starts looking
    # obviously mushy at cell size.
    return Metric(
        "thumbnail",
        "Thumbnail legibility",
        _clamp(100 - lost / 12 * 100),
        f"{lost:.1f}/255 mean detail lost round-tripping through {_THUMB_W}px",
    )


def _safe_zone_headroom(gray: Image.Image, spec: dict) -> Metric:
    """How empty the mobile safe zone is.

    The compliance rubric asks the binary question — is there *text* down
    there. This asks the merchandising one: is the strip Amazon's mobile UI
    overlays visually quiet, so the overlay does not collide with the product.
    """
    pct = int(spec.get("safe_zone_pct") or 20)
    w, h = gray.size
    strip = gray.crop((0, int(h * (1 - pct / 100)), w, h))
    busy = float(ImageStat.Stat(strip.filter(ImageFilter.FIND_EDGES)).stddev[0])
    overall = float(ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).stddev[0])
    if overall <= 0:
        return Metric("safe_zone", "Safe-zone headroom", 100, "no detail anywhere in the frame")

    # Relative, not absolute. Every product photo has the subject's base and
    # its shadow in the bottom strip, so an absolute threshold scored well
    # composed images at zero. What matters is whether that strip is *quieter*
    # than the frame as a whole — i.e. the product is not sitting in it.
    # Measured across real product renders, a well-composed frame lands
    # between 1.0x and 1.5x — the subject's base and its cast shadow live down
    # there by definition. Past ~2.5x the product itself is sitting in the
    # strip that Amazon's mobile UI overlays.
    ratio = busy / overall
    return Metric(
        "safe_zone",
        "Safe-zone headroom",
        _clamp((2.5 - ratio) / 1.3 * 100),
        f"bottom {pct}% carries {ratio:.2f}x the frame's average detail",
    )


def readiness_report(path: str | Path, spec: dict) -> ReadinessReport:
    """Score an asset on listing readiness. Never raises."""
    try:
        with Image.open(path) as img:
            rgb = img.convert("RGB")
            gray = rgb.convert("L")
            bg = _background_rgb(rgb)
            mask = _subject_mask(rgb, bg)
            return ReadinessReport(
                metrics=[
                    _prominence(mask),
                    _separation(rgb, bg, mask),
                    _backdrop_cleanliness(gray),
                    _thumbnail_survival(rgb),
                    _safe_zone_headroom(gray, spec),
                ]
            )
    except Exception as exc:  # noqa: BLE001 - scoring must never break a run
        return ReadinessReport(unavailable=f"{type(exc).__name__}: {exc}")
