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


@pytest.mark.parametrize("vercel_env", ["preview", "production"])
def test_explicit_demo_deployment_can_run_on_vercel(vercel_env: str) -> None:
    settings = Settings(
        _env_file=None,
        vercel_env=vercel_env,
        demo_deployment=True,
        repository_backend="memory",
        demo_auto_reply=True,
        demo_auto_reply_delay_seconds=0,
        frontend_origins=["*"],
    )

    container = build_container(settings)

    assert container.modes == {
        "repository": "memory",
        "llm": "demo",
        "discovery": "demo",
        "contact": "demo",
        "calendar": "demo",
    }


def test_demo_deployment_rejects_external_integrations() -> None:
    with pytest.raises(ValidationError, match="integrações externas"):
        Settings(
            _env_file=None,
            vercel_env="preview",
            demo_deployment=True,
            google_places_api_key="must-not-be-used-in-demo",
        )


def test_demo_deployment_uses_vercel_ai_gateway_with_oidc() -> None:
    settings = Settings(
        _env_file=None,
        vercel_env="preview",
        vercel_oidc_token="oidc-token",
        demo_deployment=True,
        ai_gateway_enabled=True,
        repository_backend="memory",
        demo_auto_reply=True,
        frontend_origins=["*"],
    )

    container = build_container(settings)

    assert settings.has_ai_gateway is True
    assert container.modes["llm"] == "live"


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


def test_vercel_production_applies_demo_and_cors_protections() -> None:
    base = {
        "_env_file": None,
        "vercel_env": "production",
        "repository_backend": "supabase",
        "supabase_url": "https://example.supabase.co",
        "supabase_secret_key": "service-role-key",
    }
    with pytest.raises(ValidationError, match="DEMO_AUTO_REPLY"):
        Settings(**base, demo_auto_reply=True)
    with pytest.raises(ValidationError, match="FRONTEND_ORIGINS"):
        Settings(**base, frontend_origins=["*"])


def test_live_runtime_requires_controlled_contact_override() -> None:
    with pytest.raises(ValidationError, match="DEMO_CONTACT_OVERRIDE"):
        Settings(
            _env_file=None,
            app_env="production",
            repository_backend="supabase",
            supabase_url="https://example.supabase.co",
            supabase_secret_key="service-role-key",
            openai_api_key="openai-key",
            google_places_api_key="places-key",
            resend_api_key="resend-key",
            resend_webhook_secret="whsec_test",
            resend_inbound_domain="inbound.example.com",
            google_client_id="client-id",
            google_client_secret="client-secret",
            google_refresh_token="refresh-token",
            google_calendar_id="calendar-id",
        )
