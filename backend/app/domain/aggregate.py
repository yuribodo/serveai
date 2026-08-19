from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import Field

from app.domain.models import (
    AgentEvent,
    APIModel,
    Booking,
    Outreach,
    ProviderCandidate,
    ProviderOffer,
    RequestStatus,
    ServiceRequestData,
    StoredMessage,
)


class ConversationAggregate(APIModel):
    id: UUID = Field(default_factory=uuid4)
    status: RequestStatus = RequestStatus.COLLECTING_REQUIREMENTS
    request: ServiceRequestData = Field(default_factory=ServiceRequestData)
    messages: list[StoredMessage] = Field(default_factory=list)
    events: list[AgentEvent] = Field(default_factory=list)
    providers: list[ProviderCandidate] = Field(default_factory=list)
    outreaches: list[Outreach] = Field(default_factory=list)
    offers: list[ProviderOffer] = Field(default_factory=list)
    booking: Booking | None = None
    processed_client_message_ids: set[str] = Field(default_factory=set)
    processed_inbound_message_ids: set[str] = Field(default_factory=set)
    pending_offer_id: UUID | None = None
    next_sequence: int = 1
    created_at: datetime
    updated_at: datetime

    def allocate_sequence(self) -> int:
        sequence = self.next_sequence
        self.next_sequence += 1
        return sequence

    def add_message(
        self,
        *,
        role: Literal["user", "assistant"],
        content: str,
        now: datetime,
        client_message_id: str | None = None,
    ) -> StoredMessage:
        message = StoredMessage(
            conversation_id=self.id,
            client_message_id=client_message_id,
            role=role,
            content=content,
            sequence=self.allocate_sequence(),
            created_at=now,
        )
        self.messages.append(message)
        if client_message_id:
            self.processed_client_message_ids.add(client_message_id)
        self.updated_at = now
        return message

    def add_event(self, event_type: str, payload: dict[str, Any], now: datetime) -> AgentEvent:
        event = AgentEvent(
            conversation_id=self.id,
            event_type=event_type,
            payload=payload,
            sequence=self.allocate_sequence(),
            created_at=now,
        )
        self.events.append(event)
        self.updated_at = now
        return event
