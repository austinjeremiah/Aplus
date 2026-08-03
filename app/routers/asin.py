"""Per-ASIN report — the current state of one listing's A+ imagery.

Every other view in this app is organised by *run*, which is how the system
works but not how a seller thinks. A seller owns a listing and wants one
question answered: is this product's A+ content ready to publish, and if not,
what is wrong with it.

So this rolls the run history up per module and reports the latest state of
each: is it compliant, how strong is it as a listing image, and which modules
have no asset at all. A+ Content is a *set* of modules, so a missing one is a
finding in its own right — not an absence of data.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException

from app import db
from app.routers.runs import _shape
from app.rubric.modules import get_module, module_ids

router = APIRouter(tags=["asin"])

# Runs the local renderer produced are a degradation path, not product output.
SYNTHETIC_PROVIDERS = ("local-mock", "sim-primary", "sim-fallback", "sim-last-resort")

# Statuses that mean a person still has to look at this module.
_UNRESOLVED = {"failed", "needs_review", "rejected"}


def _readiness_of(run: dict) -> dict[str, Any]:
    return ((run.get("compliance") or {}).get("readiness")) or {}


@router.get("/asin/{asin}/report")
def asin_report(asin: str) -> dict:
    """Latest state of every A+ module for one ASIN."""
    asin = asin.strip().upper()
    rows = db.list_runs(asin=asin, limit=500, exclude_providers=SYNTHETIC_PROVIDERS)
    if not rows:
        raise HTTPException(status_code=404, detail=f"No runs recorded for {asin}")

    runs = [_shape(r) for r in rows]

    # Newest first, so the first row seen for a module is its current state.
    runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    latest: dict[str, dict] = {}
    attempts: Counter[str] = Counter()
    for run in runs:
        attempts[run["module_id"]] += 1
        # A provider failure produced no asset, so it cannot represent the
        # module's current state — it belongs in the attempt count only.
        if run["module_id"] not in latest and run.get("asset_url"):
            latest[run["module_id"]] = run

    modules: list[dict[str, Any]] = []
    for module_id in module_ids():
        spec = get_module(module_id)
        run = latest.get(module_id)
        readiness = _readiness_of(run) if run else {}
        modules.append(
            {
                "module_id": module_id,
                "label": spec["label"],
                "display": spec["display"],
                "generated": run is not None,
                "run_id": run["run_id"] if run else None,
                "asset_url": run["asset_url"] if run else None,
                "status": run["status"] if run else "not_generated",
                "provider": run.get("provider") if run else None,
                "attempts": attempts.get(module_id, 0),
                "readiness_score": readiness.get("score"),
                "readiness_grade": readiness.get("grade"),
                "blocking": [
                    v["evidence"]
                    for v in (run.get("violations") or [])
                    if v.get("severity") == "error"
                ]
                if run
                else [],
            }
        )

    scored = [m for m in modules if m["readiness_score"] is not None]
    generated = [m for m in modules if m["generated"]]

    # The single most useful line on the page: across every asset for this
    # listing, which measured property is weakest, and where. Averaged per
    # metric so one bad asset does not masquerade as a systemic problem.
    totals: dict[str, dict[str, Any]] = {}
    for m in modules:
        run = latest.get(m["module_id"])
        for metric in (_readiness_of(run) or {}).get("metrics", []) if run else []:
            entry = totals.setdefault(
                metric["key"],
                {"label": metric["label"], "scores": [], "evidence": [], "modules": []},
            )
            entry["scores"].append(metric["score"])
            if metric["score"] < 60:
                entry["evidence"].append(metric["evidence"])
                entry["modules"].append(m["label"])

    weakest = None
    if totals:
        key, entry = min(totals.items(), key=lambda kv: sum(kv[1]["scores"]) / len(kv[1]["scores"]))
        weakest = {
            "key": key,
            "label": entry["label"],
            "score": round(sum(entry["scores"]) / len(entry["scores"])),
            "evidence": entry["evidence"][0] if entry["evidence"] else None,
            "modules": entry["modules"],
        }

    providers = Counter(r["provider"] for r in runs if r.get("provider"))

    return {
        "asin": asin,
        "modules": modules,
        "summary": {
            "modules_total": len(module_ids()),
            "modules_generated": len(generated),
            "modules_compliant": sum(
                1 for m in generated if m["status"] in ("passed", "approved")
            ),
            "modules_unresolved": sum(1 for m in generated if m["status"] in _UNRESOLVED),
            "readiness_score": (
                round(sum(m["readiness_score"] for m in scored) / len(scored)) if scored else None
            ),
            "weakest": weakest,
            "total_attempts": sum(attempts.values()),
            "total_cost_usd": round(sum(r.get("cost_usd") or 0.0 for r in runs), 4),
            "providers": [{"provider": p, "attempts": n} for p, n in providers.most_common()],
        },
    }


@router.get("/asins")
def list_asins(limit: int = 200) -> dict:
    """Every ASIN with at least one real asset, newest activity first."""
    rows = db.list_runs(limit=2000, exclude_providers=SYNTHETIC_PROVIDERS)
    seen: dict[str, dict] = {}
    for row in rows:
        entry = seen.setdefault(
            row["asin"],
            {"asin": row["asin"], "runs": 0, "modules": set(), "last_seen": row.get("created_at")},
        )
        entry["runs"] += 1
        entry["modules"].add(row["module_id"])
        if (row.get("created_at") or "") > (entry["last_seen"] or ""):
            entry["last_seen"] = row.get("created_at")

    items = [
        {**e, "modules": len(e["modules"])}
        for e in sorted(seen.values(), key=lambda e: e["last_seen"] or "", reverse=True)
    ]
    return {"count": len(items), "items": items[:limit]}
