"""A++ — Amazon A+ Content compliance & provenance system.

FastAPI application wiring. See app/routers/ for the endpoint contract.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from genblaze_core.exceptions import GenblazeError, ManifestError, StorageError

from app import db
from app.config import settings
from app.routers import gallery, generate, runs, verify
from app.rubric.modules import module_options
from app.services.pipeline import dead_providers
from app.services.providers import chain_summary
from app.services.vision import judge_status
from app.workers import jobs

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("aplusplus")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    logger.info("A++ ready — %s", settings.describe())
    yield
    jobs.shutdown()


app = FastAPI(
    title="A++",
    description=(
        "Compliance, provenance and reliability layer for Amazon A+ Content "
        "image generation. Built on Genblaze + Backblaze B2."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # The verify page is meant to be usable by third parties, and this API
    # carries no credentials or cookies, so a permissive origin policy costs
    # nothing here.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- error mapping ------------------------------------------------------
@app.exception_handler(ManifestError)
async def _manifest_error(_, exc: ManifestError):
    # A manifest mismatch is the tamper signal, not a server fault.
    return JSONResponse(status_code=409, content={"detail": f"manifest integrity failure: {exc}"})


@app.exception_handler(StorageError)
async def _storage_error(_, exc: StorageError):
    return JSONResponse(status_code=502, content={"detail": f"storage backend error: {exc}"})


@app.exception_handler(GenblazeError)
async def _genblaze_error(_, exc: GenblazeError):
    return JSONResponse(status_code=502, content={"detail": f"pipeline error: {exc}"})


# --- routers ------------------------------------------------------------
app.include_router(generate.router)
app.include_router(runs.router)
app.include_router(gallery.router)
app.include_router(verify.router)


# --- meta ---------------------------------------------------------------
@app.get("/health", tags=["meta"])
def health() -> dict:
    """Capability snapshot — what is actually wired up right now."""
    return {
        "status": "ok",
        "config": settings.describe(),
        "providers": chain_summary(),
        "disabled_providers": dead_providers(),
        "vision_judges": judge_status(),
        "queue_depth": jobs.queue_depth(),
    }


@app.get("/modules", tags=["meta"])
def modules() -> list[dict]:
    """Module catalogue — the frontend dropdown reads this so the two can
    never disagree about which modules exist."""
    return module_options()


@app.get("/local-assets/{key:path}", tags=["meta"], include_in_schema=False)
def local_asset(key: str):
    """Serve assets when running on the filesystem backend instead of B2.

    Only active without B2 credentials; the LocalStorageBackend hands out
    URLs pointing here so the frontend can display images in offline dev.
    """
    from fastapi import HTTPException

    if settings.b2_configured:
        raise HTTPException(404, "not found")
    path = (settings.local_storage_path / key).resolve()
    if not path.is_relative_to(settings.local_storage_path.resolve()) or not path.exists():
        raise HTTPException(404, "not found")
    return FileResponse(path)
