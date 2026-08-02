"""Compliance engine — deterministic rules + vision judgement, combined.

Design decisions that came out of testing the vision backends directly:

* **The safe zone is checked by cropping, not by asking.** Asking a vision
  model "is there text in the bottom 20%?" requires spatial reasoning it does
  the badly — during backend selection it labelled "ORDER NOW" a *pricing*
  violation. Cropping the strip and asking "is there text here?" turns a
  spatial question into a detection question, which the same model answers
  reliably.
* **Questions are asked separately, not as one mega-rubric.** One combined
  prompt produced blended, low-precision answers. Two focused calls cost ~30
  neurons total and are markedly sharper.
* **Replies are parsed defensively.** "JSON only" was ignored on 2 of 3 calls
  in testing, so ``extract_json`` recovers objects from prose and code fences,
  and there is a keyword fallback beneath that.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from app.rubric.aplus_rules import Violation, check_deterministic, safe_zone_box
from app.services.vision import ask_vision, extract_json, vision_available

logger = logging.getLogger(__name__)

CONTENT_PROMPT = """You are auditing a product image against Amazon A+ Content policy.

Report ONLY what is literally visible. Never speculate. When unsure, do not flag.

Flag a violation ONLY for text or marks you can actually read:
- pricing: a price, discount, percentage-off, "sale", or promotional offer
- superlative: a ranking or award claim ("#1", "best seller", "top rated")
- competitor: an actual COMPANY OR BRAND NAME/LOGO, e.g. "Nike", "YETI",
  "Stanley", "Hydro Flask", "Amazon Basics"
- contact_info: a website URL, email address, phone number, or QR code
- warranty: a warranty, guarantee, or free-shipping claim

CRITICAL — do NOT flag any of the following, they are always allowed:
- generic product words ("water bottle", "headphones", "backpack", "mug")
- materials, colours or sizes ("matte black", "stainless steel", "32oz")
- descriptive marketing adjectives ("insulated", "durable", "lightweight")
- the module's own caption text
A generic noun describing the product is NEVER a competitor brand.

If there is no readable text at all, return an empty violations list.

Reply with JSON and nothing else:
{"text_seen": "<every word of text you can read, verbatim, or empty string>",
 "violations": [{"rule": "pricing|superlative|competitor|contact_info|warranty",
                 "evidence": "<the exact text or mark you saw>"}]}"""

# Generic nouns a vision model routinely mislabels as competitor brands. A
# violation whose entire evidence is one of these is dropped: "water bottle"
# is what the product *is*, not a third-party mark. Without this guard the
# engine rejects perfectly compliant images, which is the most damaging
# failure mode a compliance tool can have.
_GENERIC_TERMS = {
    "water bottle", "bottle", "headphones", "earbuds", "backpack", "mug",
    "tumbler", "flask", "container", "product", "matte black", "stainless steel",
    "insulated", "black", "white", "steel", "image", "header image", "logo",
    "product image", "water", "none", "n/a", "",
}

SAFE_ZONE_PROMPT = """This image is a crop of the BOTTOM STRIP of a product image.

On mobile, Amazon overlays this strip with UI, so any text or human face here
gets obscured.

Reply with JSON and nothing else:
{"has_text": true|false, "has_face": true|false, "detail": "<what you see>"}"""

_VALID_RULES = {"pricing", "superlative", "competitor", "contact_info", "warranty"}


@dataclass
class ComplianceReport:
    passed: bool
    violations: list[Violation] = field(default_factory=list)
    checks_run: list[str] = field(default_factory=list)
    judge: str | None = None
    degraded: bool = False
    text_seen: str = ""
    notes: str = ""

    @property
    def errors(self) -> list[Violation]:
        return [v for v in self.violations if v.severity == "error"]

    @property
    def warnings(self) -> list[Violation]:
        return [v for v in self.violations if v.severity == "warning"]

    @property
    def status(self) -> str:
        """passed | failed | needs_review.

        ``needs_review`` exists because "we found no violations" and "we could
        not check" must never collapse into the same verdict. When the judge
        is unreachable — quota exhausted, no credit, network down — only the
        deterministic rules ran, and reporting that as a clean pass would ship
        an unaudited image while claiming it was audited. That is the single
        most damaging thing a compliance system can do, so it routes to the
        human review queue instead.
        """
        if self.errors:
            return "failed"
        return "needs_review" if self.degraded else "passed"

    def as_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "status": self.status,
            "violations": [v.as_dict() for v in self.violations],
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "checks_run": self.checks_run,
            "judge": self.judge,
            "degraded": self.degraded,
            "text_seen": self.text_seen,
            "notes": self.notes,
        }

    def summary(self) -> str:
        if self.errors:
            return f"FAIL — {'; '.join(v.rule for v in self.errors)}"
        if self.degraded:
            return f"NEEDS REVIEW — {self.notes or 'checks incomplete'}"
        return "PASS" + (f" ({len(self.warnings)} warning)" if self.warnings else "")


def _crop_safe_zone(path: Path, spec: dict) -> Path | None:
    """Write the bottom-strip crop to a temp file for the vision call."""
    try:
        with Image.open(path) as img:
            box = safe_zone_box(spec, img.size)
            crop = img.convert("RGB").crop(box)
        out = Path(tempfile.mkdtemp(prefix="aplusplus-safezone-")) / "strip.png"
        crop.save(out, format="PNG")
        return out
    except Exception:  # pragma: no cover
        logger.exception("safe-zone crop failed")
        return None


def _content_violations(path: Path) -> tuple[list[Violation], str, str | None]:
    """Full-frame content audit. Returns (violations, text_seen, backend)."""
    reply = ask_vision(path, CONTENT_PROMPT, max_tokens=600)
    if reply is None:
        return [], "", None

    parsed = extract_json(reply.text) or {}
    text_seen = str(parsed.get("text_seen") or "")
    violations: list[Violation] = []

    raw_items = parsed.get("violations")
    if isinstance(raw_items, list):
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            rule = str(item.get("rule") or "").strip().lower()
            evidence = str(item.get("evidence") or "").strip()
            if rule not in _VALID_RULES or not evidence:
                continue
            if rule == "competitor" and evidence.lower().strip(" .\"'") in _GENERIC_TERMS:
                logger.info("dropped generic competitor flag: %r", evidence)
                continue
            violations.append(Violation(rule, "error", evidence))
    elif parsed:
        # Well-formed JSON with no violations list means "nothing found".
        pass
    else:
        # Unparseable reply — fall back to keywords over the raw text rather
        # than silently reporting a clean pass we did not actually establish.
        lowered = reply.text.lower()
        if any(k in lowered for k in ("% off", "discount", "sale", "price")) and (
            "no pricing" not in lowered and "not contain" not in lowered
        ):
            violations.append(
                Violation("pricing", "error", f"judge reply suggested pricing: {reply.text[:160]}")
            )

    return violations, text_seen, reply.backend


def _safe_zone_violations(path: Path, spec: dict) -> tuple[list[Violation], bool]:
    """Crop-based mobile safe-zone check. Returns (violations, ran)."""
    crop = _crop_safe_zone(path, spec)
    if crop is None:
        return [], False

    reply = ask_vision(crop, SAFE_ZONE_PROMPT, max_tokens=300)
    if reply is None:
        return [], False

    parsed = extract_json(reply.text) or {}
    pct = spec.get("safe_zone_pct", 20)
    violations: list[Violation] = []
    detail = str(parsed.get("detail") or reply.text)[:200]

    if parsed.get("has_text") is True:
        violations.append(
            Violation("safe_zone_text", "error", f"text in the bottom {pct}%: {detail}")
        )
    if parsed.get("has_face") is True:
        violations.append(
            Violation("safe_zone_face", "warning", f"face in the bottom {pct}%: {detail}")
        )
    return violations, True


def compliance_report(
    path: str | Path,
    spec: dict,
    *,
    skip_vision: bool = False,
) -> ComplianceReport:
    """Score one rendered asset against the full A+ rubric.

    Deterministic checks always run. Vision checks run when a backend is
    configured; when none is, the report is marked ``degraded`` so a clean
    result is never mistaken for a fully audited one.
    """
    path = Path(path)
    violations = list(check_deterministic(path, spec))
    checks = ["dimensions", "colour_mode", "file_size", "sharpness"]
    judge: str | None = None
    text_seen = ""
    degraded = False
    notes = ""

    if skip_vision:
        notes = "vision checks skipped by caller"
        degraded = True
    elif not vision_available():
        notes = "no vision backend configured — content and safe-zone rules unchecked"
        degraded = True
    else:
        content, text_seen, backend = _content_violations(path)
        if backend is None:
            degraded = True
            notes = "every vision backend failed; deterministic checks only"
        else:
            judge = backend
            violations.extend(content)
            checks += ["pricing", "superlative", "competitor", "contact_info", "warranty"]

            zone, ran = _safe_zone_violations(path, spec)
            if ran:
                violations.extend(zone)
                checks.append("mobile_safe_zone")
            else:
                notes = "safe-zone check unavailable"

    # A degraded run is explicitly NOT a pass — see ComplianceReport.status.
    passed = not any(v.severity == "error" for v in violations) and not degraded
    return ComplianceReport(
        passed=passed,
        violations=violations,
        checks_run=checks,
        judge=judge,
        degraded=degraded,
        text_seen=text_seen,
        notes=notes,
    )
