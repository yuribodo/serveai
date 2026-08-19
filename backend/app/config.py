from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration; secrets are accepted only from the environment."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,
    )

    app_name: str = "ServeAI"
    app_env: Literal["development", "test", "production"] = "development"
    # Vercel injects this automatically. It is intentionally modeled so a
    # serverless deployment cannot silently fall back to process-local memory.
    vercel_env: Literal["production", "preview", "development"] | None = None
    api_prefix: str = "/api/v1"
    timezone: str = "America/Sao_Paulo"
    frontend_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    repository_backend: Literal["auto", "memory", "supabase"] = "auto"
    supabase_url: str | None = None
    supabase_secret_key: SecretStr | None = None

    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-5.4-mini"
    openai_timeout_seconds: float = 25.0

    google_places_api_key: SecretStr | None = None
    google_places_timeout_seconds: float = 10.0

    resend_api_key: SecretStr | None = None
    resend_webhook_secret: SecretStr | None = None
    resend_from_email: str = "ServeAI <onboarding@resend.dev>"
    resend_inbound_domain: str | None = None
    demo_contact_override: str | None = None
    demo_auto_reply: bool = False
    demo_auto_reply_delay_seconds: float = Field(default=2.0, ge=0)

    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_refresh_token: SecretStr | None = None
    google_calendar_id: str | None = None

    @field_validator("frontend_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str) and not value.lstrip().startswith("["):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def validate_runtime_safety(self) -> Settings:
        durable_runtime = self.app_env == "production" or self.vercel_env in {
            "production",
            "preview",
        }
        if durable_runtime and self.repository_backend == "memory":
            raise ValueError("REPOSITORY_BACKEND=memory não é permitido em produção ou na Vercel")
        if durable_runtime and not self.has_supabase:
            raise ValueError(
                "SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios em produção ou na Vercel"
            )
        live_runtime = self.is_live_runtime
        if live_runtime and self.demo_auto_reply:
            raise ValueError("DEMO_AUTO_REPLY deve permanecer desativado em produção")
        if live_runtime and "*" in self.frontend_origins:
            raise ValueError("FRONTEND_ORIGINS não pode aceitar '*' em produção")
        if live_runtime:
            missing_integrations = [
                name
                for name, configured in (
                    ("OPENAI_API_KEY", self.has_openai),
                    ("GOOGLE_PLACES_API_KEY", self.has_google_places),
                    (
                        "RESEND_API_KEY/RESEND_WEBHOOK_SECRET/RESEND_INBOUND_DOMAIN",
                        self.has_resend,
                    ),
                    (
                        "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/"
                        "GOOGLE_REFRESH_TOKEN/GOOGLE_CALENDAR_ID",
                        self.has_google_calendar,
                    ),
                    ("DEMO_CONTACT_OVERRIDE", bool(self.demo_contact_override)),
                )
                if not configured
            ]
            if missing_integrations:
                raise ValueError(
                    "Integrações obrigatórias ausentes em produção: "
                    + ", ".join(missing_integrations)
                )
        return self

    @property
    def is_live_runtime(self) -> bool:
        return self.app_env == "production" or self.vercel_env == "production"

    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_secret_key)

    @property
    def has_openai(self) -> bool:
        return self.openai_api_key is not None

    @property
    def has_google_places(self) -> bool:
        return self.google_places_api_key is not None

    @property
    def has_resend(self) -> bool:
        return bool(
            self.resend_api_key and self.resend_webhook_secret and self.resend_inbound_domain
        )

    @property
    def has_google_calendar(self) -> bool:
        return bool(
            self.google_client_id
            and self.google_client_secret
            and self.google_refresh_token
            and self.google_calendar_id
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
