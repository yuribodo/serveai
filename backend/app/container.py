from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from app.application.orchestrator import ConversationOrchestrator
from app.application.ports import (
    CalendarGateway,
    ContactChannel,
    ConversationRepository,
    OfferInterpreter,
    ProviderDiscovery,
    RequirementsExtractor,
)
from app.config import Settings, get_settings
from app.infrastructure.calendar.adapters import DemoCalendarGateway, GoogleCalendarGateway
from app.infrastructure.contact.adapters import DemoEmailChannel, ResendEmailChannel
from app.infrastructure.discovery.adapters import DemoProviderDiscovery, GooglePlacesDiscovery
from app.infrastructure.llm.adapters import (
    LangChainOfferInterpreter,
    LangChainRequirementsExtractor,
    RuleBasedOfferInterpreter,
    RuleBasedRequirementsExtractor,
)
from app.infrastructure.persistence import (
    InMemoryConversationRepository,
    SupabaseConversationRepository,
)

AdapterMode = Literal["live", "demo", "memory", "supabase"]


@dataclass(frozen=True, slots=True)
class ApplicationContainer:
    orchestrator: ConversationOrchestrator
    modes: dict[str, AdapterMode]
    shutdown_callbacks: tuple[Callable[[], Awaitable[None]], ...] = ()

    async def aclose(self) -> None:
        for callback in reversed(self.shutdown_callbacks):
            await callback()


def build_container(settings: Settings) -> ApplicationContainer:
    repository, repository_mode = _build_repository(settings)

    fallback_requirements = RuleBasedRequirementsExtractor()
    fallback_offer = RuleBasedOfferInterpreter()
    requirements: RequirementsExtractor
    offer_interpreter: OfferInterpreter
    if settings.has_ai_gateway:
        api_key = _secret(settings.ai_gateway_api_key or settings.vercel_oidc_token)
        requirements = LangChainRequirementsExtractor(
            api_key=api_key,
            model=settings.ai_gateway_model,
            base_url=settings.ai_gateway_base_url,
            timeout_seconds=settings.openai_timeout_seconds,
            fallback=fallback_requirements,
        )
        offer_interpreter = LangChainOfferInterpreter(
            api_key=api_key,
            model=settings.ai_gateway_model,
            base_url=settings.ai_gateway_base_url,
            timeout_seconds=settings.openai_timeout_seconds,
            fallback=fallback_offer,
        )
        llm_mode: AdapterMode = "live"
    elif settings.has_openai:
        api_key = _secret(settings.openai_api_key)
        requirements = LangChainRequirementsExtractor(
            api_key=api_key,
            model=settings.openai_model,
            timeout_seconds=settings.openai_timeout_seconds,
            fallback=fallback_requirements,
        )
        offer_interpreter = LangChainOfferInterpreter(
            api_key=api_key,
            model=settings.openai_model,
            timeout_seconds=settings.openai_timeout_seconds,
            fallback=fallback_offer,
        )
        llm_mode = "live"
    else:
        requirements = fallback_requirements
        offer_interpreter = fallback_offer
        llm_mode = "demo"

    if settings.has_google_places:
        discovery: ProviderDiscovery = GooglePlacesDiscovery(
            api_key=_secret(settings.google_places_api_key),
            timeout_seconds=settings.google_places_timeout_seconds,
        )
        discovery_mode: AdapterMode = "live"
    else:
        discovery = DemoProviderDiscovery()
        discovery_mode = "demo"

    shutdown_callbacks: list[Callable[[], Awaitable[None]]] = []
    if settings.has_resend:
        resend_contact = ResendEmailChannel(
            api_key=_secret(settings.resend_api_key),
            webhook_secret=_secret(settings.resend_webhook_secret),
            inbound_domain=settings.resend_inbound_domain or "",
            from_email=settings.resend_from_email,
            destination_override=settings.demo_contact_override,
        )
        contact: ContactChannel = resend_contact
        shutdown_callbacks.append(resend_contact.aclose)
        contact_mode: AdapterMode = "live"
    else:
        contact = DemoEmailChannel()
        contact_mode = "demo"

    if settings.has_google_calendar:
        calendar: CalendarGateway = GoogleCalendarGateway(
            client_id=settings.google_client_id or "",
            client_secret=_secret(settings.google_client_secret),
            refresh_token=_secret(settings.google_refresh_token),
            calendar_id=settings.google_calendar_id or "",
            timezone=settings.timezone,
        )
        calendar_mode: AdapterMode = "live"
    else:
        calendar = DemoCalendarGateway()
        calendar_mode = "demo"

    orchestrator = ConversationOrchestrator(
        repository=repository,
        requirements_extractor=requirements,
        offer_interpreter=offer_interpreter,
        provider_discovery=discovery,
        contact_channel=contact,
        calendar_gateway=calendar,
        timezone=settings.timezone,
        demo_auto_reply=settings.demo_auto_reply and contact_mode == "demo",
        demo_auto_reply_delay_seconds=settings.demo_auto_reply_delay_seconds,
    )
    return ApplicationContainer(
        orchestrator=orchestrator,
        modes={
            "repository": repository_mode,
            "llm": llm_mode,
            "discovery": discovery_mode,
            "contact": contact_mode,
            "calendar": calendar_mode,
        },
        shutdown_callbacks=tuple(shutdown_callbacks),
    )


def _build_repository(settings: Settings) -> tuple[ConversationRepository, AdapterMode]:
    if settings.repository_backend == "supabase" and not settings.has_supabase:
        raise ValueError("REPOSITORY_BACKEND=supabase exige SUPABASE_URL e SUPABASE_SECRET_KEY")
    if settings.repository_backend == "supabase" or (
        settings.repository_backend == "auto" and settings.has_supabase
    ):
        return (
            SupabaseConversationRepository(
                settings.supabase_url or "",
                _secret(settings.supabase_secret_key),
            ),
            "supabase",
        )
    return InMemoryConversationRepository(), "memory"


def _secret(value: object) -> str:
    if value is None:
        return ""
    getter = getattr(value, "get_secret_value", None)
    return str(getter()) if callable(getter) else str(value)


@lru_cache(maxsize=1)
def get_container() -> ApplicationContainer:
    return build_container(get_settings())
