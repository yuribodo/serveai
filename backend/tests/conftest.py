from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_orchestrator
from app.application.orchestrator import ConversationOrchestrator
from app.infrastructure.calendar.adapters import DemoCalendarGateway
from app.infrastructure.contact.adapters import DemoEmailChannel
from app.infrastructure.discovery.adapters import DemoProviderDiscovery
from app.infrastructure.llm.adapters import (
    RuleBasedOfferInterpreter,
    RuleBasedRequirementsExtractor,
)
from app.infrastructure.persistence.memory import InMemoryConversationRepository
from app.main import app


@pytest.fixture
def repository() -> InMemoryConversationRepository:
    return InMemoryConversationRepository()


@pytest.fixture
def contact_channel() -> DemoEmailChannel:
    return DemoEmailChannel()


@pytest.fixture
def orchestrator(
    repository: InMemoryConversationRepository,
    contact_channel: DemoEmailChannel,
) -> ConversationOrchestrator:
    return ConversationOrchestrator(
        repository=repository,
        requirements_extractor=RuleBasedRequirementsExtractor(),
        offer_interpreter=RuleBasedOfferInterpreter(),
        provider_discovery=DemoProviderDiscovery(),
        contact_channel=contact_channel,
        calendar_gateway=DemoCalendarGateway(),
        demo_auto_reply=False,
    )


@pytest.fixture
def client(orchestrator: ConversationOrchestrator) -> Iterator[TestClient]:
    app.dependency_overrides[get_orchestrator] = lambda: orchestrator
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
