from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.application.orchestrator import ConversationOrchestrator
from app.domain.models import Booking
from app.infrastructure.calendar.adapters import DemoCalendarGateway
from app.infrastructure.contact.adapters import DemoEmailChannel
from app.infrastructure.discovery.adapters import DemoProviderDiscovery
from app.infrastructure.llm.adapters import (
    RuleBasedOfferInterpreter,
    RuleBasedRequirementsExtractor,
)
from app.infrastructure.persistence.memory import InMemoryConversationRepository

FULL_REQUEST = (
    "Preciso de um chaveiro porque perdi a chave na Rua dos Pinheiros, 100, "
    "Pinheiros, São Paulo. Até R$ 250. Hoje das 14h às 18h."
)


class FailsOnceCalendarGateway(DemoCalendarGateway):
    def __init__(self) -> None:
        super().__init__()
        self.attempts = 0

    async def create_booking(self, **kwargs: Any) -> Booking:
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("temporary calendar failure")
        return await super().create_booking(**kwargs)


def _create_waiting_conversation(client: TestClient) -> dict[str, Any]:
    response = client.post(
        "/api/v1/conversations",
        json={"message": FULL_REQUEST, "clientMessageId": "booking-initial-message"},
    )
    assert response.status_code == 201, response.text
    snapshot = response.json()
    assert snapshot["status"] == "waiting_for_replies"
    return snapshot


def test_repeated_provider_email_creates_one_offer_and_booking(client: TestClient) -> None:
    waiting = _create_waiting_conversation(client)
    provider_card = next(item for item in waiting["timeline"] if item["type"] == "providers")
    provider_id = provider_card["providers"][0]["id"]
    event = {
        "type": "email.received",
        "data": {
            "email_id": "inbound-offer-1",
            "to": [f"offer+{provider_id.replace('-', '')}@inbound.serveai.local"],
            "text": "Consigo hoje às 15h por R$ 180.",
        },
    }

    first = client.post("/api/v1/webhooks/resend", json=event)
    second = client.post("/api/v1/webhooks/resend", json=event)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == {"accepted": True}

    snapshot = client.get(f"/api/v1/conversations/{waiting['conversationId']}").json()
    item_types = [item["type"] for item in snapshot["timeline"]]
    assert snapshot["status"] == "booked"
    assert item_types.count("offer") == 1
    assert item_types.count("booking") == 1
    assert snapshot["pollAfterMs"] is None
    assert snapshot["canSendMessage"] is False


def test_compatible_offer_requests_exact_address_before_booking(client: TestClient) -> None:
    initial = client.post(
        "/api/v1/conversations",
        json={
            "message": (
                "Preciso de um chaveiro porque perdi a chave em Pinheiros, São Paulo. "
                "Até R$ 250. Hoje das 14h às 18h."
            ),
            "clientMessageId": "no-address-initial",
        },
    ).json()
    provider_card = next(item for item in initial["timeline"] if item["type"] == "providers")
    provider_id = provider_card["providers"][0]["id"]
    webhook = client.post(
        "/api/v1/webhooks/resend",
        json={
            "type": "email.received",
            "data": {
                "email_id": "inbound-needs-address",
                "to": [f"offer+{provider_id.replace('-', '')}@inbound.serveai.local"],
                "text": "Consigo hoje às 15h por R$ 180.",
            },
        },
    )
    assert webhook.status_code == 200

    needs_address = client.get(f"/api/v1/conversations/{initial['conversationId']}").json()
    assert needs_address["status"] == "needs_user_input"
    assert needs_address["canSendMessage"] is True
    assert needs_address["timeline"][-1]["type"] == "message"
    assert "endereço completo" in needs_address["timeline"][-1]["content"]

    booked = client.post(
        f"/api/v1/conversations/{initial['conversationId']}/messages",
        json={
            "message": "Rua dos Pinheiros, 100, apartamento 12",
            "clientMessageId": "address-answer",
        },
    ).json()
    assert booked["status"] == "booked"
    assert [item["type"] for item in booked["timeline"]].count("booking") == 1


def test_adjusted_budget_reevaluates_existing_offers_without_getting_stuck(
    client: TestClient,
) -> None:
    initial = client.post(
        "/api/v1/conversations",
        json={
            "message": (
                "Preciso de um chaveiro porque perdi a chave na Rua dos Pinheiros, 100, "
                "Pinheiros, São Paulo. Até R$ 100. Hoje das 14h às 18h."
            ),
            "clientMessageId": "adjust-budget-initial",
        },
    ).json()
    providers = next(item for item in initial["timeline"] if item["type"] == "providers")

    for index, provider in enumerate(providers["providers"], start=1):
        response = client.post(
            "/api/v1/webhooks/resend",
            json={
                "type": "email.received",
                "data": {
                    "email_id": f"over-budget-{index}",
                    "to": [f"offer+{provider['id'].replace('-', '')}@inbound.serveai.local"],
                    "text": f"Consigo hoje às 15h por R$ {170 + index * 10}.",
                },
            },
        )
        assert response.status_code == 200

    needs_adjustment = client.get(f"/api/v1/conversations/{initial['conversationId']}").json()
    assert needs_adjustment["status"] == "needs_user_input"

    booked = client.post(
        f"/api/v1/conversations/{initial['conversationId']}/messages",
        json={
            "message": "Posso pagar até R$ 200.",
            "clientMessageId": "adjust-budget-answer",
        },
    ).json()

    assert booked["status"] == "booked"
    assert [item["type"] for item in booked["timeline"]].count("booking") == 1


@pytest.mark.asyncio
async def test_failed_calendar_booking_retries_the_accepted_offer() -> None:
    repository = InMemoryConversationRepository()
    contact = DemoEmailChannel()
    calendar = FailsOnceCalendarGateway()
    orchestrator = ConversationOrchestrator(
        repository=repository,
        requirements_extractor=RuleBasedRequirementsExtractor(),
        offer_interpreter=RuleBasedOfferInterpreter(),
        provider_discovery=DemoProviderDiscovery(),
        contact_channel=contact,
        calendar_gateway=calendar,
    )
    waiting = await orchestrator.create_conversation(
        message=FULL_REQUEST,
        client_message_id="calendar-retry-initial",
    )
    aggregate = await repository.get(waiting.conversation_id)
    provider_id = aggregate.providers[0].id
    event = {
        "type": "email.received",
        "data": {
            "email_id": "calendar-retry-offer",
            "to": [f"offer+{provider_id.hex}@inbound.serveai.local"],
            "text": "Consigo hoje às 15h por R$ 180.",
        },
    }

    verified = contact.verify_webhook(json.dumps(event).encode(), {})
    assert await orchestrator.process_verified_resend_event(verified) is True
    failed = await orchestrator.get_conversation(waiting.conversation_id)
    assert failed.status == "failed"
    assert calendar.attempts == 1

    booked = await orchestrator.add_message(
        UUID(str(waiting.conversation_id)),
        message="Tentar novamente",
        client_message_id="calendar-retry-message",
    )

    assert booked.status == "booked"
    assert calendar.attempts == 2
    assert [item.type for item in booked.timeline].count("booking") == 1
