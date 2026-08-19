from __future__ import annotations

from app.application.orchestrator import ConversationOrchestrator
from app.application.ports import ConcurrentConversationWriteError
from app.domain.aggregate import ConversationAggregate
from app.infrastructure.calendar.adapters import DemoCalendarGateway
from app.infrastructure.contact.adapters import DemoEmailChannel
from app.infrastructure.discovery.adapters import DemoProviderDiscovery
from app.infrastructure.llm.adapters import (
    RuleBasedOfferInterpreter,
    RuleBasedRequirementsExtractor,
)
from app.infrastructure.persistence.memory import InMemoryConversationRepository


class ConcurrentWinnerRepository(InMemoryConversationRepository):
    def __init__(self) -> None:
        super().__init__()
        self._conflict_pending = True

    async def save(self, aggregate: ConversationAggregate) -> None:
        if self._conflict_pending:
            self._conflict_pending = False
            winner = aggregate.model_copy(deep=True)
            winner.add_message(
                role="assistant",
                content="O que aconteceu? Conte brevemente o problema.",
                now=aggregate.updated_at,
            )
            await super().save(winner)
            raise ConcurrentConversationWriteError("simulated concurrent winner")
        await super().save(aggregate)


async def test_concurrent_creation_returns_the_existing_idempotent_conversation() -> None:
    repository = ConcurrentWinnerRepository()
    orchestrator = ConversationOrchestrator(
        repository=repository,
        requirements_extractor=RuleBasedRequirementsExtractor(),
        offer_interpreter=RuleBasedOfferInterpreter(),
        provider_discovery=DemoProviderDiscovery(),
        contact_channel=DemoEmailChannel(),
        calendar_gateway=DemoCalendarGateway(),
    )

    conversation = await orchestrator.create_conversation(
        message="Preciso de um chaveiro em Pinheiros, São Paulo",
        client_message_id="same-message-from-two-workers",
    )

    assert [item.type for item in conversation.timeline] == ["message", "message"]
    assert conversation.timeline[-1].type == "message"
    assert conversation.timeline[-1].role == "assistant"
