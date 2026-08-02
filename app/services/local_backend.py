"""LocalStorageBackend — filesystem stand-in for B2.

Implements the six abstract methods of ``genblaze_core.storage.base.StorageBackend``
so the exact same ``ObjectStorageSink`` code path (key strategies, manifest
writes, Parquet sibling, asset transfer) runs with no credentials.

This is a development affordance only — the shipped demo runs on B2. Keeping
the sink identical means "works locally" genuinely implies "works on B2",
rather than exercising a second, weaker code path.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, BinaryIO

from genblaze_core.storage.base import StorageBackend


class LocalStorageBackend(StorageBackend):
    """Stores objects as files under ``root``, keyed by their object key."""

    # NB: the URL base must NOT be ``file://``. ObjectStorageSink calls
    # ``key_from_url(asset.url)`` to decide whether an asset is already stored,
    # and provider assets legitimately arrive as ``file://`` source URIs — a
    # ``file://`` base would match those and silently skip every upload.
    # An HTTP base also means the URL is directly usable by the frontend.
    def __init__(
        self, root: str | Path, *, url_base: str = "http://localhost:8000/local-assets"
    ) -> None:
        self._root = Path(root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._url_base = url_base.rstrip("/")

    # --- helpers -------------------------------------------------------
    def _path(self, key: str) -> Path:
        # Reject traversal: a key must stay inside root.
        target = (self._root / key).resolve()
        if not target.is_relative_to(self._root):
            raise ValueError(f"key escapes storage root: {key!r}")
        return target

    # --- required interface --------------------------------------------
    def put(
        self,
        key: str,
        data: bytes | BinaryIO,
        *,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
        extra_args: dict[str, Any] | None = None,
    ) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, (bytes, bytearray)):
            path.write_bytes(bytes(data))
        else:
            with path.open("wb") as fh:
                shutil.copyfileobj(data, fh)
        return self.get_durable_url(key)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise FileNotFoundError(f"no object at key {key!r}")
        return path.read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def get_url(self, key: str, *, expires_in: int = 3600) -> str:
        # No signing concept locally — durable and presigned are the same file.
        return self.get_durable_url(key)

    def get_durable_url(self, key: str) -> str:
        return f"{self._url_base}/{key.lstrip('/')}"

    # --- convenience for the app layer ---------------------------------
    @property
    def root(self) -> Path:
        return self._root

    def key_from_url(self, url: str) -> str | None:
        prefix = f"{self._url_base}/"
        return url[len(prefix) :] if url.startswith(prefix) else None
