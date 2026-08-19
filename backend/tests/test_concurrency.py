from __future__ import annotations

import json

from app.application.orchestrator import ConversationOrchestrator
from app.application.ports import ConcurrentConversationWriteError
from app.domain.aggregate import ConversationAggregate
from app.domain.models import Booking
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


class ConflictAfterCalendarRepository(InMemoryConversationRepository):
    def __init__(self) -> None:
        super().__init__()
        self.conflict_pending = True

    async def save(self, aggregate: ConversationAggregate) -> None:
        if self.conflict_pending and aggregate.booking is not None:
            self.conflict_pending = False
            raise ConcurrentConversationWriteError("simulated conflict after calendar")
        await super().save(aggregate)


class CountingCalendarGateway(DemoCalendarGateway):
    def __init__(self) -> None:
        super().__init__()
        self.attempts = 0

    async def create_booking(self, **kwargs: object) -> Booking:
        self.attempts += 1
        return await super().create_booking(**kwargs)  # type: ignore[arg-type]


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


async def test_calendar_booking_resumes_after_the_final_save_conflicts() -> None:
    repository = ConflictAfterCalendarRepository()
    contact = DemoEmailChannel()
    calendar = CountingCalendarGateway()
    orchestrator = ConversationOrchestrator(
        repository=repository,
        requirements_extractor=RuleBasedRequirementsExtractor(),
        offer_interpreter=RuleBasedOfferInterpreter(),
        provider_discovery=DemoProviderDiscovery(),
        contact_channel=contact,
        calendar_gateway=calendar,
    )
    waiting = await orchestrator.create_conversation(
        message=(
            "Preciso de um chaveiro porque perdi a chave na Rua dos Pinheiros, 100, "
            "Pinheiros, São Paulo. Até R$ 250. Hoje das 14h às 18h."
        ),
        client_message_id="calendar-conflict-initial",
    )
    aggregate = await repository.get(waiting.conversation_id)
    provider = aggregate.providers[0]
    email_id = "calendar-conflict-offer"
    event = {
        "type": "email.received",
        "data": {
            "email_id": email_id,
            "to": [f"offer+{provider.id.hex}@inbound.serveai.local"],
            "text": "Consigo hoje às 15h por R$ 180.",
        },
    }

    verified = contact.verify_webhook(json.dumps(event).encode(), {})
    assert await orchestrator.process_verified_resend_event(verified) is True

    recovered = await repository.get(waiting.conversation_id)
    assert recovered.status == "booked"
    assert recovered.booking is not None
    assert calendar.attempts == 2
    assert len([event for event in recovered.events if event.event_type == "booking"]) == 1
