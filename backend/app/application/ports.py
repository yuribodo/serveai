from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from app.domain.aggregate import ConversationAggregate
from app.domain.models import (
    Booking,
    OfferStatus,
    Outreach,
    ProviderCandidate,
    ServiceRequestData,
)


class ConversationNotFoundError(LookupError):
    pass


class ConcurrentConversationWriteError(RuntimeError):
    """A different worker committed a newer version of the conversation."""


class ConversationRepository(Protocol):
    async def get(self, conversation_id: UUID) -> ConversationAggregate: ...

    async def find_by_client_message_id(
        self, client_message_id: str
    ) -> ConversationAggregate | None: ...

    async def find_by_reply_to(
        self, reply_to: str
    ) -> tuple[ConversationAggregate, UUID] | None: ...

    async def save(self, aggregate: ConversationAggregate) -> None: ...


class RequirementsExtractor(Protocol):
    async def extract(
        self,
        current: ServiceRequestData,
        conversation_text: list[tuple[str, str]],
        now: datetime,
    ) -> ServiceRequestData: ...


@dataclass(frozen=True, slots=True)
class InterpretedOffer:
    status: OfferStatus
    price: float | None = None
    available_at: datetime | None = None
    question: str | None = None


class OfferInterpreter(Protocol):
    async def interpret(self, text: str, now: datetime) -> InterpretedOffer: ...


class ProviderDiscovery(Protocol):
    async def search(
        self,
        conversation_id: UUID,
        request: ServiceRequestData,
        limit: int = 10,
    ) -> list[ProviderCandidate]: ...


class ContactChannel(Protocol):
    async def send_outreach(
        self,
        provider: ProviderCandidate,
        request: ServiceRequestData,
        now: datetime,
    ) -> Outreach: ...

    def verify_webhook(self, payload: bytes, headers: dict[str, str]) -> dict[str, object]: ...

    async def fetch_inbound_text(self, email_id: str) -> str: ...


class CalendarGateway(Protocol):
    async def create_booking(
        self,
        *,
        conversation_id: UUID,
        provider: ProviderCandidate,
        offer_id: UUID,
        start: datetime,
        end: datetime,
        price: float,
        address: str,
        attendee_email: str | None,
        now: datetime,
    ) -> Booking: ...
