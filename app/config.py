"""Central configuration for A++.

Every external dependency is optional. Missing credentials degrade to a local
equivalent (filesystem storage, mock provider) rather than crashing at import,
so the whole system stays runnable offline.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Backblaze B2 ---
    b2_key_id: str = ""
    b2_app_key: str = ""
    b2_bucket: str = ""
    b2_region: str = "us-west-004"
    manifest_retention_days: int = 7

    # --- image providers, in fallback order ---
    gmi_api_key: str = ""
    gmi_image_model: str = "seedream-3-0-t2i-250415"

    cf_account_id: str = ""
    cf_api_token: str = ""
    # Several Workers AI models, each a separate link in the fallback chain.
    # All are free-tier, so a real multi-model fallback costs nothing to run —
    # which matters because it is otherwise the single point of failure once
    # the credit-funded providers are unavailable. Ordered best-quality first,
    # fastest last (benchmarked: lucid 3.3s, phoenix 4.0s, schnell 1.7s).
    cf_image_models: str = (
        "@cf/leonardo/lucid-origin,"
        "@cf/leonardo/phoenix-1.0,"
        "@cf/black-forest-labs/flux-1-schnell"
    )

    @property
    def cf_model_list(self) -> list[str]:
        return [m.strip() for m in self.cf_image_models.split(",") if m.strip()]

    # Keyless free provider — on by default so the chain always has a link
    # that cannot be disabled by billing or a daily cap.
    enable_pollinations: bool = True
    # Each model is its own chain link, so fallback depth is real without
    # depending on an account that can run out of credit.
    pollinations_models: str = "flux,sana"

    @property
    def pollinations_model_list(self) -> list[str]:
        return [m.strip() for m in self.pollinations_models.split(",") if m.strip()]

    # Providers to leave out of the chain entirely. A provider whose account is
    # unfunded fails on every attempt, and those failures are recorded as
    # reliability data — which misrepresents a billing problem as an outage.
    disabled_providers: str = ""

    @property
    def disabled_provider_list(self) -> list[str]:
        return [d.strip() for d in self.disabled_providers.split(",") if d.strip()]

    replicate_api_token: str = ""
    replicate_image_model: str = "black-forest-labs/flux-schnell"

    # --- compliance judge ---
    groq_api_key: str = ""
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    openai_api_key: str = ""
    # AgentRouter — OpenAI-compatible LLM router. Its models are text+vision
    # only (no image output), so it cannot generate, but a frontier vision
    # model makes by far the strongest compliance judge available here.
    agentrouter_api_key: str = ""
    agentrouter_base_url: str = "https://agentrouter.org/v1"
    # gpt-5.6-sol over claude-opus-5: both read violation text correctly, but
    # measured 3.7s vs 7.1s solo, and Opus times out entirely when the two
    # vision calls per attempt run concurrently. With up to three attempts per
    # job, judge latency dominates the whole pipeline.
    agentrouter_vision_model: str = "gpt-5.6-sol"

    # Google AI Studio. Free tier covers multimodal *input* (vision), which is
    # what the judge needs — only image *generation* is paid there. This is the
    # only free vision judge that is not subject to a daily neuron budget.
    google_api_key: str = ""
    google_vision_model: str = "gemini-2.5-flash"

    # --- app ---
    app_db_path: str = "data/aplusplus.db"
    parquet_dir: str = "data/parquet"
    storage_prefix: str = "aplusplus"
    max_compliance_retries: int = 2
    redis_url: str = ""

    # ------------------------------------------------------------------
    # Derived helpers
    # ------------------------------------------------------------------
    @property
    def b2_configured(self) -> bool:
        """True when a real B2 upload can be attempted."""
        return bool(self.b2_key_id and self.b2_app_key and self.b2_bucket)

    @property
    def has_vision_judge(self) -> bool:
        return bool(self.groq_api_key or self.openai_api_key)

    @property
    def db_path(self) -> Path:
        return _abs(self.app_db_path)

    @property
    def parquet_path(self) -> Path:
        return _abs(self.parquet_dir)

    @property
    def local_storage_path(self) -> Path:
        """Filesystem stand-in for B2 when credentials are absent."""
        return _abs("data/local-b2")

    def describe(self) -> dict[str, str]:
        """Human-readable capability summary — surfaced at /health."""
        return {
            "storage": f"b2://{self.b2_bucket}" if self.b2_configured else "local filesystem",
            "object_lock": (
                f"GOVERNANCE {self.manifest_retention_days}d"
                if self.b2_configured and self.manifest_retention_days > 0
                else "off"
            ),
            "image_providers": ", ".join(self.enabled_image_providers) or "mock only",
            # Groq is deliberately absent: it hosts no vision-capable model, so
            # it cannot judge an image. Naming it here would advertise a judge
            # that does not exist.
            "compliance_judge": (
                f"agentrouter:{self.agentrouter_vision_model}"
                if self.agentrouter_api_key
                else f"google:{self.google_vision_model}"
                if self.google_api_key
                else "gmicloud:gpt-4o"
                if self.gmi_api_key
                else "cloudflare:llama-3.2-11b-vision"
                if (self.cf_account_id and self.cf_api_token)
                else "openai:gpt-4o"
                if self.openai_api_key
                else "deterministic checks only"
            ),
            "queue": "arq/redis" if self.redis_url else "in-process",
        }

    @property
    def enabled_image_providers(self) -> list[str]:
        disabled = set(self.disabled_provider_list)
        enabled = []
        if self.gmi_api_key:
            enabled.append("gmicloud")
        if self.cf_account_id and self.cf_api_token:
            enabled.append("cloudflare")
        if self.enable_pollinations:
            enabled.append("pollinations")
        if self.replicate_api_token:
            enabled.append("replicate")
        if self.openai_api_key:
            enabled.append("openai")
        # Honour the disable list here too — otherwise /health advertises
        # providers that were already dropped from the chain.
        return [e for e in enabled if e not in disabled]


def _abs(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else ROOT / p


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
