from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.domain.models import APIModel, Location


class MessageInput(APIModel):
    message: str = Field(min_length=1, max_length=4_000)
    client_message_id: str = Field(min_length=1, max_length=128)

    @field_validator("message", "client_message_id")
    @classmethod
    def reject_blank_values(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be blank")
        return normalized


class CreateConversationInput(MessageInput):
    location: Location | None = None


class AddMessageInput(MessageInput):
    pass


class WebhookAcknowledgement(APIModel):
    accepted: bool


class HealthResponse(APIModel):
    status: Literal["ok"] = "ok"
    service: str
    environment: str
    repository: str
    llm: str
    discovery: str
    contact: str
    calendar: str
