"""Manifest embedding and extraction.

Phase 0 confirmed genblaze ships real image handlers (``PngHandler``,
``JpegHandler``, ``WebpHandler``) behind ``SmartEmbedder``, so the sidecar-JSON
fallback in the original plan is unnecessary — the manifest genuinely travels
inside the exported file.

The subtlety that makes ``/verify`` correct: **embedding changes the file's own
SHA-256.** The manifest records the hash of the asset as the provider produced
it; writing the manifest into the file mutates those bytes. So verification
compares the extracted manifest against the *stored original* in B2, looked up
by run id, and never by re-hashing the uploaded file.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from genblaze_core.media import SidecarHandler, SmartEmbedder, get_handler, sniff_mime
from genblaze_core.models.manifest import Manifest, parse_manifest

logger = logging.getLogger(__name__)


def embed_manifest(path: str | Path, manifest: Manifest) -> dict[str, Any]:
    """Write the manifest into the media file. Falls back to a sidecar."""
    path = Path(path)
    try:
        result = SmartEmbedder().embed(path, manifest)
        return {
            "method": getattr(result, "method", "embedded"),
            "path": str(getattr(result, "path", path)),
            "sidecar_path": str(getattr(result, "sidecar_path", "") or "") or None,
        }
    except Exception:
        logger.exception("embed failed for %s — writing sidecar instead", path)
        sidecar = SidecarHandler().embed(path, manifest)
        return {"method": "sidecar", "path": str(path), "sidecar_path": str(sidecar)}


def extract_manifest(path: str | Path) -> Manifest | None:
    """Pull an embedded manifest back out, or None if the file carries none."""
    path = Path(path)
    mime = sniff_mime(path)
    if mime:
        handler = get_handler(mime)
        if handler is not None:
            try:
                extracted = handler.extract(path)
                if extracted:
                    return _coerce(extracted)
            except Exception:
                logger.info("no embedded manifest in %s (%s)", path.name, mime)

    # Sidecar fallback: a .manifest.json written next to the asset.
    for candidate in (path.with_suffix(path.suffix + ".manifest.json"),
                      path.with_suffix(".manifest.json")):
        if candidate.exists():
            try:
                return _coerce(candidate.read_text(encoding="utf-8"))  # noqa: E501
            except Exception:
                logger.exception("unreadable sidecar %s", candidate)
    return None


def _coerce(value: Any) -> Manifest | None:
    """Handlers may return a Manifest, a JSON string, or a dict."""
    if isinstance(value, Manifest):
        return value
    import json

    try:
        # parse_manifest takes the decoded object, not a JSON string.
        if isinstance(value, (str, bytes)):
            return parse_manifest(json.loads(value))
        if isinstance(value, dict):
            return parse_manifest(value)
    except Exception:
        logger.exception("could not parse extracted manifest payload")
    return None
