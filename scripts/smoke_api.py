"""Phase 4-6 smoke test — the full HTTP contract, in-process.

    .venv/bin/python -m scripts.smoke_api

Uses FastAPI's TestClient so no server needs to be running. Covers the whole
§11 contract plus the export/verify round-trip that Phase 5 exists for.
"""

from __future__ import annotations

import sys
import time

from fastapi.testclient import TestClient

from app.main import app

ASIN = "B0SMOKEAPI"
MODULE = "card_300x300"
BRIEF = "insulated matte black stainless steel water bottle on light marble"


def banner(t: str) -> None:
    print(f"\n{'=' * 70}\n{t}\n{'=' * 70}")


def main() -> int:
    failures: list[str] = []
    client = TestClient(app)

    banner("A++ — Phase 4-6: HTTP contract")

    # --- meta ---------------------------------------------------------
    r = client.get("/health")
    assert r.status_code == 200, r.text
    health = r.json()
    print(f"  /health          : {health['status']}")
    print(f"    storage        : {health['config']['storage']}")
    print(f"    judge          : {health['config']['compliance_judge']}")
    print(f"    chain          : {len(health['providers'])} providers")

    r = client.get("/modules")
    mods = r.json()
    print(f"  /modules         : {len(mods)} modules — {[m['id'] for m in mods]}")
    if len(mods) != 5:
        failures.append("expected 5 modules")

    # --- generate + poll ----------------------------------------------
    banner("POST /generate  ->  GET /jobs/{id}")
    r = client.post(
        "/generate",
        json={"asin": ASIN, "module_id": MODULE, "brief": BRIEF},
    )
    if r.status_code != 202:
        print(f"FAIL: /generate returned {r.status_code}: {r.text[:200]}")
        return 1
    job_id = r.json()["job_id"]
    print(f"  job_id           : {job_id}  (returned immediately)")

    seen: list[str] = []
    result = None
    for _ in range(90):
        body = client.get(f"/jobs/{job_id}").json()
        if not seen or seen[-1] != body["status"]:
            seen.append(body["status"])
            print(f"  status           : {body['status']}")
        if body["status"] in ("complete", "failed"):
            result = body
            break
        time.sleep(2)

    if result is None:
        failures.append("job never reached a terminal state")
        return _finish(failures)
    if result["status"] == "failed":
        failures.append(f"job failed: {result.get('error')}")
        return _finish(failures)
    if "in_progress" not in seen:
        print("  note: job finished before an in_progress poll was observed")

    payload = result["result"]
    run_id = payload["run_id"]
    print(f"  attempts         : {payload['attempts']}  cost ${payload['total_cost_usd']}")
    print(f"  approved         : {payload['approved']}")
    print(f"  run_id           : {run_id}")

    # --- unknown module rejected --------------------------------------
    r = client.post("/generate", json={"asin": ASIN, "module_id": "nope", "brief": "x"})
    if r.status_code != 422:
        failures.append(f"unknown module_id should be 422, got {r.status_code}")
    else:
        print(f"  bad module_id    : {r.status_code} (rejected)")

    # --- unknown job is not a 404 -------------------------------------
    r = client.get("/jobs/does-not-exist")
    if r.status_code != 200 or r.json()["status"] != "not_found":
        failures.append("unknown job should return 200/not_found for pollers")

    # --- run + lineage ------------------------------------------------
    banner("GET /runs/{id}  ·  /runs/{id}/lineage")
    r = client.get(f"/runs/{run_id}")
    if r.status_code != 200:
        failures.append("run detail not found")
    else:
        run = r.json()
        print(f"  provider/model   : {run['provider']} / {run['model']}")
        print(f"  status           : {run['status']}")

    lineage = client.get(f"/runs/{run_id}/lineage").json()
    print(f"  lineage          : {len(lineage)} entries")
    for e in lineage:
        print(f"    v{e['version']} {e['status']:<15} {str(e['provider']):<18} ok={e['succeeded']}")
    if not lineage:
        failures.append("lineage empty")

    # --- gallery + stats ----------------------------------------------
    banner("GET /gallery  ·  /gallery/stats")
    for view in ("hierarchical", "dedup"):
        g = client.get(f"/gallery?view={view}&limit=5").json()
        print(f"  {view:14}: {g['count']} items")
        if g["view"] != view:
            failures.append(f"gallery view {view} not echoed")

    stats = client.get("/gallery/stats").json()
    print(f"  total_runs       : {stats['total_runs']}")
    print(f"  total_cost_usd   : ${stats['total_cost_usd']}")
    print(f"  overall_pass_rate: {stats['overall_pass_rate']}")
    print("  per-provider     :")
    for p in stats["per_provider"][:5]:
        print(
            f"    {p['provider']:<20} attempts={p['attempts']:<3} "
            f"pass_rate={p['pass_rate']} errors={p['errors']}"
        )

    # --- review queue + override --------------------------------------
    banner("GET /review  ·  PATCH /runs/{id}/review")
    queue = client.get("/review?limit=5").json()
    print(f"  queue length     : {len(queue)}")
    r = client.patch(f"/runs/{run_id}/review", json={"decision": "approved"})
    if r.status_code != 200:
        failures.append(f"review PATCH failed: {r.status_code}")
    else:
        print(f"  override         : {r.json()}")
        after = client.get(f"/runs/{run_id}").json()
        if after["review_decision"] != "approved":
            failures.append("review decision not persisted")
        if not after.get("compliance"):
            print("  note: no machine verdict stored (judge was unavailable)")
        else:
            print("  machine verdict preserved alongside override: OK")

    # --- export -> verify round trip ----------------------------------
    banner("GET /runs/{id}/export  ->  POST /verify   (the differentiator)")
    r = client.get(f"/runs/{run_id}/export")
    if r.status_code != 200:
        failures.append(f"export failed: {r.status_code} {r.text[:150]}")
        return _finish(failures)
    exported = r.content
    print(f"  exported         : {len(exported)} bytes")

    r = client.post(
        "/verify",
        files={"file": ("export.png", exported, "image/png")},
    )
    v = r.json()
    print(f"  valid            : {v['valid']}")
    print(f"  source           : {v['source']}")
    print(f"  integrity.hash_ok: {(v.get('integrity') or {}).get('hash_ok')}")
    print(f"  lineage returned : {len(v.get('lineage') or [])}")
    if v["source"] != "embedded_manifest":
        failures.append(f"expected embedded_manifest, got {v['source']}")
    if not v["valid"]:
        failures.append("verify rejected our own exported file")

    # --- verify by reference ------------------------------------------
    r = client.post("/verify", data={"run_id": run_id})
    v2 = r.json()
    print(f"  by run_id        : valid={v2['valid']} found={v2['found']}")
    if not v2["found"]:
        failures.append("verify by run_id could not find the run")

    r = client.post("/verify", files={"file": ("junk.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, "image/png")})
    v3 = r.json()
    print(f"  unknown file     : valid={v3['valid']} found={v3['found']} (expected False/False)")
    if v3["valid"] or v3["found"]:
        failures.append("verify accepted an unknown file")

    return _finish(failures)


def _finish(failures: list[str]) -> int:
    if failures:
        banner("FAILURES:\n  - " + "\n  - ".join(failures))
        return 1
    banner("PASS — full API contract verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
