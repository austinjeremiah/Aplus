"""Module registry — single source of truth for A+ module dimensions.

``modules.json`` is loaded here and also served over the API, so the frontend
dropdown and the backend validator can never disagree about the module list.

Canvases are rendered at 2× the Amazon display size and downscaled on export.
That gives the compliance crop margin and keeps text crisp on retina listings.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_MODULES_PATH = Path(__file__).with_name("modules.json")


@lru_cache(maxsize=1)
def load_modules() -> dict[str, dict]:
    with _MODULES_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def get_module(module_id: str) -> dict:
    modules = load_modules()
    try:
        return modules[module_id]
    except KeyError:
        raise KeyError(
            f"unknown module_id {module_id!r}; expected one of {sorted(modules)}"
        ) from None


def module_ids() -> list[str]:
    return list(load_modules())


def module_options() -> list[dict]:
    """Shape the frontend dropdown consumes."""
    return [
        {
            "id": mid,
            "label": spec["label"],
            "display": spec["display"],
            "aspect_ratio": spec["aspect_ratio"],
            "canvas": f"{spec['width']}×{spec['height']}",
            "notes": spec["notes"],
        }
        for mid, spec in load_modules().items()
    ]
