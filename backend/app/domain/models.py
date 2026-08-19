from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class RequestStatus(StrEnum):
    COLLECTING_REQUIREMENTS = "collecting_requirements"
    READY = "ready"
    SEARCHING = "searching"
    PROVIDERS_FOUND = "providers_found"
    CONTACTING = "contacting"
    WAITING_FOR_REPLIES = "waiting_for_replies"
    OFFER_RECEIVED = "offer_received"
    NEEDS_USER_INPUT = "needs_user_input"
    ACCEPTED = "accepted"
    BOOKED = "booked"
    FAILED = "failed"


class Location(APIModel):
    address: str | None = None
    neighborhood: str | None = None
    city: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_coordinates(self) -> Location:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self

    @property
    def search_text(self) -> str | None:
        parts = [self.address, self.neighborhood, self.city]
        value = ", ".join(part.strip() for part in parts if part and part.strip())
        if value:
            return value
        if self.latitude is not None and self.longitude is not None:
            return "próximo à localização informada"
        return None


class Budget(APIModel):
    minimum: float | None = Field(default=None, ge=0)
    maximum: float | None = Field(default=None, ge=0)
    currency: str = "BRL"

    @model_validator(mode="after")
    def validate_range(self) -> Budget:
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("minimum budget cannot exceed maximum budget")
        return self


class AvailabilityWindow(APIModel):
    start: datetime
    end: datetime

    @field_validator("start", "end")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("availability timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_window(self) -> AvailabilityWindow:
        if self.start >= self.end:
            raise ValueError("availability start must precede end")
        return self


class ServiceRequestData(APIModel):
    service_type: str | None = None
    problem: str | None = None
    location: Location | None = None
    budget: Budget | None = None
    availability: list[AvailabilityWindow] = Field(default_factory=list)
    urgency: str | None = None

    def missing_fields(self) -> list[str]:
        missing: list[str] = []
        if not self.service_type:
            missing.append("serviceType")
        if not self.location or not self.location.search_text:
            missing.append("location")
        if not self.problem:
            missing.append("problem")
        if not self.budget or self.budget.maximum is None:
            missing.append("budget")
        if not self.availability:
            missing.append("availability")
        return missing

    @property
    def exact_address(self) -> str | None:
        address = self.location.address if self.location else None
        return address if address and re.search(r"\d", address) else None


class ProviderCandidate(APIModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    external_id: str
    name: str
    address: str
    latitude: float | None = None
    longitude: float | None = None
    rating: float | None = None
    review_count: int | None = None
    phone: str | None = None
    website: str | None = None
    email: str | None = None
    business_status: str | None = None
    rank: int = 0


class Outreach(APIModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    provider_id: UUID
    channel: Literal["email", "whatsapp"] = "email"
    destination: str
    reply_to: str | None = None
    external_message_id: str | None = None
    status: str = "sent"
    created_at: datetime


class OfferStatus(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    QUESTION = "question"


class ProviderOffer(APIModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    provider_id: UUID
    inbound_message_id: str
    status: OfferStatus
    price: float | None = Field(default=None, ge=0)
    available_at: datetime | None = None
    question: str | None = None
    raw_text: str
    within_budget: bool | None = None
    within_availability: bool | None = None
    acceptable: bool = False
    created_at: datetime


class Booking(APIModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    provider_id: UUID
    offer_id: UUID
    start: datetime
    end: datetime
    price: float
    calendar_event_id: str
    calendar_event_url: str | None = None
    created_at: datetime


class StoredMessage(APIModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    client_message_id: str | None = None
    role: Literal["user", "assistant"]
    content: str
    sequence: int
    created_at: datetime


class AgentEvent(APIModel):
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    event_type: str
    payload: dict[str, Any]
    sequence: int
    created_at: datetime


class MessageItem(APIModel):
    id: UUID
    type: Literal["message"] = "message"
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class OperationItem(APIModel):
    id: UUID
    type: Literal["operation"] = "operation"
    status: RequestStatus
    title: str
    detail: str | None = None
    created_at: datetime


class ProviderSummary(APIModel):
    id: UUID
    name: str
    address: str
    rating: float | None = None
    review_count: int | None = None
    phone: str | None = None
    website: str | None = None


class ProvidersItem(APIModel):
    id: UUID
    type: Literal["providers"] = "providers"
    providers: list[ProviderSummary]
    created_at: datetime


class OfferItem(APIModel):
    id: UUID
    type: Literal["offer"] = "offer"
    provider_id: UUID
    provider_name: str
    price: float | None = None
    available_at: datetime | None = None
    within_budget: bool | None = None
    within_availability: bool | None = None
    acceptable: bool
    created_at: datetime


class BookingItem(APIModel):
    id: UUID
    type: Literal["booking"] = "booking"
    provider_name: str
    start: datetime
    end: datetime
    price: float
    address: str
    calendar_event_url: str | None = None
    created_at: datetime


class ErrorItem(APIModel):
    id: UUID
    type: Literal["error"] = "error"
    code: str
    message: str
    retryable: bool
    created_at: datetime


TimelineItem = Annotated[
    MessageItem | OperationItem | ProvidersItem | OfferItem | BookingItem | ErrorItem,
    Field(discriminator="type"),
]


class ChatConversation(APIModel):
    conversation_id: UUID
    status: RequestStatus
    can_send_message: bool
    poll_after_ms: int | None
    timeline: list[TimelineItem]
    service_request: ServiceRequestData
    updated_at: datetime
