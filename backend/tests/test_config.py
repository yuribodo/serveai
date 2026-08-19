from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.container import build_container


def test_development_can_use_memory_repository() -> None:
    settings = Settings(
        _env_file=None,
        app_env="development",
        repository_backend="memory",
    )

    container = build_container(settings)

    assert container.modes["repository"] == "memory"


@pytest.mark.parametrize("vercel_env", ["preview", "production"])
def test_vercel_requires_durable_supabase_configuration(vercel_env: str) -> None:
    with pytest.raises(ValidationError, match="SUPABASE_URL"):
        Settings(
            _env_file=None,
            vercel_env=vercel_env,
            repository_backend="auto",
        )


def test_production_rejects_demo_auto_reply() -> None:
    with pytest.raises(ValidationError, match="DEMO_AUTO_REPLY"):
        Settings(
            _env_file=None,
            app_env="production",
            repository_backend="supabase",
            supabase_url="https://example.supabase.co",
            supabase_secret_key="service-role-key",
            demo_auto_reply=True,
        )


def test_production_rejects_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="FRONTEND_ORIGINS"):
        Settings(
            _env_file=None,
            app_env="production",
            repository_backend="supabase",
            supabase_url="https://example.supabase.co",
            supabase_secret_key="service-role-key",
            frontend_origins=["*"],
        )


def test_production_requires_every_live_integration() -> None:
    with pytest.raises(ValidationError, match=r"OPENAI_API_KEY.*GOOGLE_PLACES_API_KEY"):
        Settings(
            _env_file=None,
            app_env="production",
            repository_backend="supabase",
            supabase_url="https://example.supabase.co",
            supabase_secret_key="service-role-key",
        )
